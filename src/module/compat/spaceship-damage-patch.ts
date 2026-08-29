import { MODULE_ID, SPACESHIP_ACTOR_TYPE } from "../constants";

/**
 * lib-wrapper patch (#10 addendum): daggerheart's `DhpActor#takeDamage` hard-gates the
 * "spend Armor to reduce this hit" flow behind `this.type === 'character'` - a plain inline
 * comparison, not a guardable getter, so it can't be widened the lightweight way
 * `character-only-patches.ts`'s four patches are (wrapping a getter to also accept
 * `daggerheart-scifi-content.spaceship`). Left unpatched, a ship's Shield sits there unspent and
 * every hit marks full HP regardless of how much Shield it has.
 *
 * The interactive half of that flow (`armorSlot` query → `DamageReductionDialog`, prompting the
 * owning player to choose which armor/effect slots and how much Stress to spend) assumes a
 * character's per-item armor marking UI, which a ship has no equivalent of - so rather than widen
 * that gate too, this replaces the whole method for ship actors with an auto-spend version
 * (`SpaceshipData#autoSpendShield`, see its own doc comment for the rule it implements) and falls
 * through to daggerheart's own `takeDamage` unchanged for every other actor type.
 *
 * The replacement is a transcription of `takeDamage`'s orchestration only (`#parseDamageArgs`'s
 * body inlined, since it's private) - `calculateDamage`/`convertDamageToThreshold`/
 * `modifyResource` are called exactly as upstream calls them, since those stay on the shared
 * `DhpActor` prototype and already work correctly for a ship (the resistance/rules-defaults fixes
 * elsewhere in this module are what made that true). Not reproduced: the `adversary` severity-
 * reduction branch (ships don't take it, being neither `character` nor `adversary`) and the
 * `postDamageReduction` registered-trigger call upstream makes after reduction - an automation
 * hook orthogonal to Shield-spending itself, and outside this ticket's scope.
 */
export default function registerSpaceshipDamagePatch(): void {
  const libWrapper = (globalThis as unknown as { libWrapper?: LibWrapperApi }).libWrapper;
  if (!libWrapper) {
    console.warn("DHSciFi | lib-wrapper not active - Spaceship Shield will not auto-spend on incoming damage.");
    return;
  }

  libWrapper.register(
    MODULE_ID,
    "CONFIG.Actor.documentClass.prototype.takeDamage",
    async function takeDamageForShip(
      this: PatchableShipActor,
      wrapped: (...args: unknown[]) => unknown,
      rawArgs: unknown,
      rawIsDirect?: unknown,
    ): Promise<unknown> {
      const isDirect = rawIsDirect === true;
      if (this.type !== SPACESHIP_ACTOR_TYPE) return wrapped(rawArgs, rawIsDirect);

      const dh = (CONFIG as unknown as { DH?: { id?: string } }).DH;
      const hookNamespace = dh?.id ?? "daggerheart";

      // `#parseDamageArgs`'s body, upstream (private, so transcribed rather than called) - turns
      // whatever shape `takeDamage`'s caller passed (`{main: DamageRoll}`, `{damage: DamageRoll}`,
      // a raw `DamageRoll` with `.total`, or `{resources: {...}}`) into the one internal shape
      // the rest of this method (and upstream's) works with.
      const args = (rawArgs ?? {}) as DamagePayload & Partial<DamageRoll>;
      const damageRoll: DamageRoll | number | undefined = "total" in args ? args : (args.main ?? args.damage);
      const damageValue = typeof damageRoll === "number" ? damageRoll : damageRoll?.total;
      const damageTypeSource =
        typeof damageRoll === "object" ? (damageRoll?.options?.damageTypes ?? damageRoll?.damageTypes) : undefined;
      const damageTypes = Array.from(damageTypeSource ?? []);
      const main = typeof damageValue === "number" ? { key: "damage", value: damageValue, damageTypes } : null;
      const resourceUpdates: ResourceUpdate[] = Object.entries(args.resources ?? {}).map(([key, damage]) => ({
        key,
        value: typeof damage === "number" ? damage : (damage?.total ?? 0),
        clear: typeof damage === "number" ? false : !!damage?.options?.fullRestore,
      }));

      // `Hooks.call` is a `static` method, and fvtt-types only knows core's own hook name
      // literals - `.bind(Hooks)` keeps the class bound as receiver (a bare reference would lose
      // it, the same mistake that broke `#useResourcePips`'s `game.settings.get` call earlier)
      // while the cast widens the first parameter enough to accept daggerheart's dynamic names.
      const callHook = Hooks.call.bind(Hooks) as (hook: string, ...args: unknown[]) => boolean;

      if (callHook(`${hookNamespace}.preTakeDamage`, this, { main, resourceUpdates }) === false) return null;

      const updates = resourceUpdates;
      if (main) main.value = this.calculateDamage(main.value, main.damageTypes);

      if (callHook(`${hookNamespace}.postCalculateDamage`, this, { main, resourceUpdates: updates }) === false) {
        return null;
      }
      if (!updates.some((u) => u.value) && !main) return;

      if (main) {
        const hpDamage: ResourceUpdate = {
          value: this.convertDamageToThreshold(main.value),
          damageTypes: new Set(main.damageTypes),
          key: "hitPoints",
        };

        if (!isDirect && hpDamage.value > 0) {
          hpDamage.value = await this.system.autoSpendShield(hpDamage.value, hpDamage.damageTypes ?? []);
        }

        const existing = updates.find((u) => u.key === "hitPoints");
        if (existing) {
          existing.value += hpDamage.value;
          existing.damageTypes = hpDamage.damageTypes;
        } else {
          updates.push(hpDamage);
        }
      }

      for (const u of updates) {
        u.value = u.key === "fear" || this.system?.resources?.[u.key]?.isReversed === false ? u.value * -1 : u.value;
      }

      await this.modifyResource(updates);
      if (callHook(`${hookNamespace}.postTakeDamage`, this, updates) === false) return null;
      return updates;
    },
    "MIXED",
  );
}

/** Minimal shape of the global `libWrapper` API this module calls - not a full type definition. */
interface LibWrapperApi {
  register(
    packageId: string,
    target: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn: (this: any, wrapped: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown,
    type?: "WRAPPER" | "MIXED" | "OVERRIDE",
  ): void;
}

/** One rolled/flat damage amount, as `#parseDamageArgs` reads it off whatever shape it's handed. */
interface DamageRoll {
  total?: number;
  options?: { damageTypes?: Iterable<string> };
  damageTypes?: Iterable<string>;
}

/** The raw argument `takeDamage` accepts - a bare roll/number, or one wrapping `main`/`resources`. */
interface DamagePayload {
  main?: DamageRoll | number;
  damage?: DamageRoll | number;
  resources?: Record<string, number | { total?: number; options?: { fullRestore?: boolean } }>;
}

/** One entry of `takeDamage`'s internal `updates` array (`resourceUpdates` plus the HP entry). */
interface ResourceUpdate {
  key: string;
  value: number;
  clear?: boolean;
  damageTypes?: Set<string>;
}

/** The `this` shape this wrapper runs against - a ship's Actor document. */
interface PatchableShipActor {
  type: string;
  system: {
    resources?: Record<string, { isReversed?: boolean }>;
    autoSpendShield(hpDamage: number, damageTypes: Iterable<string>): Promise<number>;
  };
  calculateDamage(baseDamage: number, damageTypes: Iterable<string>): number;
  convertDamageToThreshold(damage: number): number;
  modifyResource(resources: ResourceUpdate[]): Promise<void>;
}
