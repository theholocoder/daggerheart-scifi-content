import { MODULE_ID, SPACESHIP_ACTOR_TYPE } from "../constants";

/**
 * lib-wrapper patches (#6): daggerheart hard-codes several `character`-only gates around item
 * actions - none of them "safe/inert default" gaps like `isItemValid`/`metadata` were (see ADR
 * 0002's other addenda), all deliberate restrictions this module can't work around by filling in
 * `SpaceshipData` or reusing an Item-level getter as-is, since the getter itself is what's gated:
 *
 * - `BaseDataItem#actionsList`/`DHWeapon#actionsList` (comment: "No actions on non-characters")
 *   return `[]` for a non-`character` actor - without patching this, the Inventory tab's
 *   `.item-buttons` "Use" dialog can't find the action it's trying to run and crashes resolving
 *   its cost (`this.parent` undefined - see ADR 0002's addendum for the full story).
 * - `DHItem#usable` additionally requires `actor.type === 'character'` (or the item itself being
 *   a `feature`) - without patching this, clicking an item's portrait always falls back to
 *   opening its sheet, never to rolling/using its action (and the hover roll-icon never shows,
 *   since it's conditioned on `item.usable` too) - even once `actionsList` is patched.
 * - `DhpActor#rollClass` (`CONFIG.Actor.documentClass`, i.e. any actor at all) is what actually
 *   picks the dice: `CONFIG.Dice.daggerheart[['character','companion'].includes(this.type) ?
 *   'DualityRoll' : 'D20Roll']`. Not a crash - a ship's weapon Attack opened a real, working
 *   dialog, just the *wrong* one (adversary-style flat d20 instead of character-style duality/
 *   2d12), because `this.type` is never `'character'`/`'companion'` for a ship. This is the actual
 *   fix for that; `rollTrait` below turned out to be a real, separate gate worth patching too (it
 *   picks *which trait* modifies the roll) but wasn't why the dice type itself was wrong.
 * - `DHActionRollData#rollTrait` returns `null` for any non-`character` actor - once `rollClass`
 *   above is fixed and a duality roll is actually being built, an unpatched `rollTrait` would
 *   still roll with no trait modifier at all.
 *
 * Each patch wraps the real getter to also treat a `daggerheart-scifi-content.spaceship` actor as
 * valid - for every other actor type (character/adversary/npc/companion/environment) nothing
 * changes, since the wrapper only takes over for our own actor type and calls the original
 * (unmodified) getter otherwise. `actionsList`/`usable`/`rollClass` go through `libWrapper` (all
 * reachable by a stable `CONFIG.Item...`/`CONFIG.Actor...` string path); `rollTrait` is a plain
 * `Object.defineProperty` monkey-patch instead - `DHActionRollData` (the class that owns it) isn't
 * exposed at any stable global path, only reachable at runtime via `new (daggerheart's own
 * RollField class)().model` (a standard Foundry `EmbeddedDataField` convention), which
 * `libWrapper.register`'s string-target resolution can't express.
 *
 * `lib-wrapper` is a **required** module dependency (`src/module.json`'s `relationships.requires`)
 * specifically for this, not merely "nice to have": without it active, `registerCharacterOnly
 * Patches` silently no-ops (defensive - checks `libWrapper` is actually defined) rather than
 * monkey-patching daggerheart directly, so a world missing the dependency degrades to "item
 * action buttons/portrait-click-to-roll don't do anything useful" rather than a load-time crash.
 */
export default function registerCharacterOnlyPatches(): void {
  const libWrapper = (globalThis as unknown as { libWrapper?: LibWrapperApi }).libWrapper;
  if (!libWrapper) {
    console.warn("DHSciFi | lib-wrapper not active - Spaceship item actions/portrait-roll will not work.");
    return;
  }

  // Armor/consumable/loot don't override `actionsList` themselves - all three inherit
  // `BaseDataItem#actionsList` directly (confirmed: none of `DHArmor`/`DHConsumable`/`DHLoot`
  // define their own `actionsList` in daggerheart's bundle). Registering against just one of
  // their `.prototype`s did *not* cover the other two in testing (a Medpack, `consumable`, still
  // crashed after only `loot` was registered) - `libWrapper` shadows the getter on whichever
  // prototype the target string names, it does not also patch sibling classes that merely share
  // an ancestor. So each of the three gets its own explicit registration below, not one shared
  // one; `weapon` needs its own regardless, since `DHWeapon#actionsList` fully overrides the base
  // getter rather than calling `super`.
  const actionsListWrapper = function actionsListForShipInventoryItem(
    this: PatchableItemSystem,
    wrapped: () => unknown,
  ): unknown {
    if (this.actor?.type === SPACESHIP_ACTOR_TYPE) return this.actions ?? [];
    return wrapped();
  };
  for (const itemType of ["armor", "consumable", "loot"]) {
    libWrapper.register(
      MODULE_ID,
      `CONFIG.Item.dataModels.${itemType}.prototype.actionsList`,
      actionsListWrapper,
      "MIXED",
    );
  }

  libWrapper.register(
    MODULE_ID,
    "CONFIG.Item.dataModels.weapon.prototype.actionsList",
    function actionsListForShipWeapon(this: PatchableItemSystem, wrapped: () => unknown): unknown {
      // Mirrors `DHWeapon#actionsList`'s own ungated branch (`[this.attack, ...super.actionsList]`,
      // where the base `super.actionsList` ungated is `this.actions`) - not just `this.actions`
      // alone, or a ship weapon's built-in Attack action would be silently dropped.
      if (this.actor?.type === SPACESHIP_ACTOR_TYPE) return [this.attack, ...(this.actions ?? [])];
      return wrapped();
    },
    "MIXED",
  );

  // `DHItem#usable` (a single getter, on the Item *document* class - shared by every item type,
  // unlike `actionsList` above) drives both the portrait's click-to-roll `data-action` and its
  // hover roll-icon in `inventory.hbs`.
  libWrapper.register(
    MODULE_ID,
    "CONFIG.Item.documentClass.prototype.usable",
    function usableForShipItem(this: PatchableItemDocument, wrapped: () => unknown): unknown {
      if (this.actor?.type !== SPACESHIP_ACTOR_TYPE) return wrapped();

      // Mirrors `DHItem#usable`'s own body, minus its `actor.type === 'character'` clause.
      const pack = this.actor.pack ? game.packs?.get(this.actor.pack) : null;
      const hasActions = this.system.actionsList?.length || this.system.actionsList?.size;
      return !pack?.locked && this.isOwner && !!hasActions;
    },
    "MIXED",
  );

  // `DhpActor#rollClass` (`CONFIG.Actor.documentClass`) is what actually picks duality (2d12) vs
  // flat d20 dice for *any* roll on an actor, not just item actions - the real fix for "wrong
  // dice" (see this file's top comment; `rollTrait` below is a separate, additional gate).
  libWrapper.register(
    MODULE_ID,
    "CONFIG.Actor.documentClass.prototype.rollClass",
    function rollClassForShip(this: { type?: string }, wrapped: () => unknown): unknown {
      if (this.type === SPACESHIP_ACTOR_TYPE) {
        return (CONFIG as unknown as { Dice: { daggerheart: { DualityRoll: unknown } } }).Dice.daggerheart
          .DualityRoll;
      }
      return wrapped();
    },
    "MIXED",
  );

  patchRollTrait();
}

/**
 * `Object.defineProperty` monkey-patch of `DHActionRollData#rollTrait` (see this file's top
 * comment for why not `libWrapper`). Located via `game.system.api.fields.ActionFields.RollField`
 * - daggerheart's own public API surface for its Action field classes (the same namespace the
 * system's own code reaches `CostField`/`UsesField`/etc. through) - `.model` is where Foundry's
 * `EmbeddedDataField` base class stores the DataModel class a field wraps.
 */
function patchRollTrait(): void {
  const rollFieldClass = (game.system as unknown as DaggerheartSystem)?.api?.fields?.ActionFields?.RollField;
  if (!rollFieldClass) {
    console.warn("DHSciFi | could not locate daggerheart's RollField class - ship weapon rolls may use wrong dice.");
    return;
  }

  const rollDataPrototype = (new rollFieldClass() as { model?: { prototype: PatchableActionRollData } }).model
    ?.prototype;
  const original = rollDataPrototype && Object.getOwnPropertyDescriptor(rollDataPrototype, "rollTrait")?.get;
  if (!rollDataPrototype || !original) {
    console.warn("DHSciFi | could not locate daggerheart's rollTrait getter - ship weapon rolls may use wrong dice.");
    return;
  }

  Object.defineProperty(rollDataPrototype, "rollTrait", {
    configurable: true,
    get(this: PatchableActionRollData) {
      if (this.parent?.actor?.type !== SPACESHIP_ACTOR_TYPE) return original.call(this);

      // Mirrors `DHActionRollData#rollTrait`'s own switch, minus its `actor.type === 'character'`
      // gate - `CONFIG.DH.GENERAL.rollTypes` is daggerheart's own public roll-type registry.
      const dhConfig = (CONFIG as unknown as { DH?: { GENERAL?: { rollTypes?: Record<string, { id: string }> } } })
        .DH;
      const rollTypes = dhConfig?.GENERAL?.rollTypes;
      switch (this.type) {
        case rollTypes?.spellcast?.id:
          return this.parent.actor?.system?.spellcastModifierTrait?.key ?? "agility";
        case rollTypes?.attack?.id:
        case rollTypes?.trait?.id:
          return this.useDefault || !this.trait
            ? (this.parent.item?.system?.attack?.roll?.trait ?? "agility")
            : this.trait;
        default:
          return null;
      }
    },
  });
}

/** The `this` shape `actionsList` wrappers run against - an Item's `system` DataModel instance. */
interface PatchableItemSystem {
  actor?: { type?: string } | null;
  actions?: unknown[];
  attack?: unknown;
}

/** The `this` shape the `usable` wrapper runs against - the Item document itself. */
interface PatchableItemDocument {
  actor?: { type?: string; pack?: string | null } | null;
  isOwner?: boolean;
  system: { actionsList?: { length?: number; size?: number } };
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

/** The `this` shape the `rollTrait` patch runs against - a `DHActionRollData` instance. */
interface PatchableActionRollData {
  type?: string | null;
  trait?: string | null;
  useDefault?: boolean;
  parent?: {
    actor?: { type?: string; system?: { spellcastModifierTrait?: { key?: string } } } | null;
    item?: { system?: { attack?: { roll?: { trait?: string } } } } | null;
  } | null;
}

/** Minimal shape of `game.system.api.fields.ActionFields` this module reaches through. */
interface DaggerheartSystem {
  api?: {
    fields?: {
      ActionFields?: {
        // A Foundry `EmbeddedDataField` subclass - constructible with no arguments purely to read
        // the `.model` (the `DHActionRollData` class) it wraps; never actually used as a field.
        RollField?: new () => unknown;
      };
    };
  };
}
