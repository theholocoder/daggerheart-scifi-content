import {
  ARMOR_EFFECT_CHANGE_TYPE,
  ARMOR_ITEM_TYPE,
  FEATURE_ITEM_TYPE,
  INVENTORY_ITEM_TYPES,
  STATION_IDS,
} from "../../constants";

/**
 * The `daggerheart` `armor` Item fields this model reads to derive Shield/thresholds (#10).
 * fvtt-types knows nothing of daggerheart's Item sub-type schemas (docs/adr/0002), so the equipped
 * armor is narrowed through this loose shape rather than `Item.Implementation`'s strict union -
 * the same workaround `SpaceshipActorSheet`'s `LooseDoc` uses for the item lists.
 */
interface ArmorItemLike {
  type: string;
  system: {
    equipped?: boolean;
    /** `current` = Shield slots already marked, `max` = the item's armor score. */
    armor?: { current: number; max: number };
    baseThresholds?: { major: number; severe: number };
  };
  update(data: Record<string, unknown>): Promise<unknown>;
}

/**
 * One entry of a `DhActiveEffect`'s `system.changes` array. An `armor`-typed change is daggerheart's
 * way of granting Shield from something other than an armor Item: applying it adds `value.current`
 * to `system.armorScore.value` and `value.max` to `system.armorScore.max`, and (when present) its
 * `damageThresholds` set a base threshold the same way an armor Item's `baseThresholds` do.
 *
 * `value.max` is a *formula string* upstream (`'1'`, `'@level'`, ...), not a number - see
 * `#parseGrantedSlots`.
 */
interface ArmorChangeLike {
  type?: string;
  value?: { current?: number; max?: string | number; damageThresholds?: unknown };
}

/**
 * One applied ActiveEffect, as both the severe-threshold rule and the Shield-marking distribution
 * below inspect it. Optional throughout - a plain core ActiveEffect with no daggerheart `system`
 * carries none of this and must read as "grants no Shield, sets no threshold".
 */
interface EffectLike {
  disabled?: boolean;
  isSuppressed?: boolean;
  system?: { changes?: ArmorChangeLike[] };
  update(data: Record<string, unknown>): Promise<unknown>;
}

/**
 * One place Shield slots can be marked off: the equipped armor Item, or an `armor`-typed change on
 * an applied ActiveEffect. The sheet's pip row shows the *sum* of these, so marking a pip has to be
 * spread across them - `write` is how each source stores its own share back.
 */
interface ShieldSource {
  current: number;
  max: number;
  write(current: number): Promise<unknown>;
}

/**
 * DataModel for the module-registered `daggerheart-scifi-content.spaceship` Actor sub-type.
 *
 * Deliberately independent from the `daggerheart` system's own actor DataModels (see
 * docs/adr/0001-spaceship-actor-subtype.md) and from its sheet base classes (see
 * docs/adr/0002-spaceship-sheet-independent-application.md). `level`, the six traits, and the
 * core resources (Hope, HP, Stress, Evasion, Proficiency) are modeled here (#5), plus weapon
 * mounts (#6), stations (#8), Shield/damage thresholds (#10), and System Points (#11).
 *
 * The traits and resources mirror `daggerheart`'s own `character` schema shape (`attributeField`/
 * `ResourcesField` in the system bundle) - same `{value, tierMarked}` for traits and `{value, max}`
 * for resources - but are defined independently here per ADR 0001/0002, not imported.
 *
 * `maxWeaponMounts` (#6) caps how many `weapon`-type items can be equipped at once on the
 * Inventory tab - one mount per equipped weapon regardless of its one-handed/two-handed
 * `burden`, mirroring the character sheet's weapon-pairing mechanic generalized to N mounts
 * instead of a fixed primary/secondary pair (see CONTEXT.md's "Weapon Mount" entry).
 *
 * `metadata`, `getRollData`, and `isItemValid` are *not* our own convention: `daggerheart`'s
 * `Actor`/`Token`/`Item` document classes (`CONFIG.Actor.documentClass`/`CONFIG.Token.objectClass`/
 * `Item.createDocuments`, all world-global, not overridable per sub-type) unconditionally read
 * `actor.system.metadata.usesSize` on actor creation, token creation, and every render of the
 * Actors sidebar; unconditionally call `actor.system.getRollData()` from `DhpActor#getRollData`
 * (itself called by core Foundry's `applyActiveEffects` during every data preparation); and, since
 * #6 (Inventory tab), unconditionally call `actor.system.isItemValid(source)` from `Item`'s
 * `createDocuments` override to filter which dropped/created Items an actor accepts - for *every*
 * Actor in the world, including foreign module-registered ones. Without these, creating a
 * Spaceship actor throws (`metadata`/`getRollData`), and creating or dropping an inventory Item on
 * one throws (`isItemValid`). `metadata`'s shape and `isItemValid`'s body mirror `daggerheart`'s
 * own `BaseDataActor.metadata`/`BaseDataActor#isItemValid` defaults (`module/data/actor/base.mjs`) -
 * every metadata flag at its safe/inert default except `hasInventory` (true, since a ship
 * genuinely has one as of #6); `getRollData` mirrors its minimal default implementation.
 */
export default class SpaceshipData extends foundry.abstract.TypeDataModel<
  SpaceshipData.Schema,
  Actor.Implementation
> {
  static get metadata(): SpaceshipData.Metadata {
    return {
      label: "TYPES.Actor.daggerheart-scifi-content.spaceship",
      isNPC: false,
      settingSheet: null,
      hasResistances: false,
      hasAttribution: false,
      hasLimitedView: false,
      usesSize: false,
      hasInventory: true,
    };
  }

  get metadata(): SpaceshipData.Metadata {
    return (this.constructor as typeof SpaceshipData).metadata;
  }

  /** Data made available to roll formulas referencing this actor. Extended as ship stats are added. */
  getRollData(): Record<string, unknown> {
    return { level: this.level };
  }

  /**
   * System Points still unspent (#11) - the ship's only currency-like resource, replacing gold
   * entirely (CONTEXT.md's "System Points" entry).
   *
   * Computed, never stored: `systemPoints` is the base total the GM enters from the ship's Frame
   * (level-up gains fold into it in #12) and `systemPointsSpent` is what is committed to installed
   * systems, so the available count is never a third number that can disagree with them.
   *
   * A plain getter rather than a schema field written in `prepareBaseData` (the route `armorScore`
   * takes): that field only exists because ActiveEffects and daggerheart's own damage code need a
   * schema-declared `system.armorScore` path to find. Nothing outside this module reads System
   * Points, so this one has no such obligation and can stay off the schema entirely.
   *
   * Deliberately *not* clamped at zero: a GM who lowers the base below what is already committed
   * should see the ship over-committed (a negative number) rather than have the overspend silently
   * hidden.
   */
  get systemPointsAvailable(): number {
    return this.systemPoints - this.systemPointsSpent;
  }

  /**
   * The ship's single equipped `armor` Item, if any - the base source of Shield and the only
   * source of damage thresholds (#10). Same one-liner as `daggerheart`'s own character `get armor()`
   * (`items.find(x => x.type === 'armor' && x.system.equipped)`): the sheet enforces that at most
   * one armor item is equipped at a time, so `find` is the whole rule, not a first-match heuristic.
   */
  get armor(): ArmorItemLike | undefined {
    const items = this.parent.items as unknown as Iterable<ArmorItemLike>;
    return Array.from(items).find((item) => item.type === ARMOR_ITEM_TYPE && item.system.equipped === true);
  }

  /**
   * Derive Shield (`armorScore`) and damage thresholds from the equipped armor plus `level` (#10),
   * mirroring `daggerheart`'s character `prepareBaseData` derivation exactly - the ship reuses the
   * system's armor-item mechanic rather than owning a parallel one (CONTEXT.md's "Shield" entry).
   *
   * Runs in `prepareBaseData`, before core Foundry applies ActiveEffects, so an effect targeting
   * `system.armorScore.max` or `system.damageThresholds.*` adds on top of the armor-derived value
   * instead of being overwritten by it - the "and eventual effects" half of the ticket. With no
   * armor equipped this lands back on the unarmored baseline (`0` Shield, `level`/`level * 2`
   * thresholds), which is what makes unequipping drop the numbers with no extra bookkeeping.
   *
   * The `severeThresholdMultiplier` is daggerheart's own rule, copied by value: an unarmored actor
   * gets double level on severe, *unless* something else already sets a base threshold - either
   * armor or an `armor`-typed ActiveEffect change carrying `damageThresholds`.
   */
  override prepareBaseData(): void {
    super.prepareBaseData();

    const armor = this.armor;

    this.armorScore = {
      max: armor?.system.armor?.max ?? 0,
      value: armor?.system.armor?.current ?? 0,
    };

    // `?? []`: core fills `appliedEffects` during `applyActiveEffects`, which runs *after* this -
    // so this reads the previous preparation's array (exactly as daggerheart's character does),
    // and on the very first preparation of a freshly-constructed Actor there may be none yet.
    const effects = (this.parent.appliedEffects ?? []) as unknown as Iterable<EffectLike>;
    const hasThresholdEffect = Array.from(effects).some((effect) =>
      effect.system?.changes?.some(
        (change) => change.type === ARMOR_EFFECT_CHANGE_TYPE && change.value?.damageThresholds,
      ),
    );
    this.damageThresholds = {
      major: (armor?.system.baseThresholds?.major ?? 0) + this.level,
      severe: armor
        ? (armor.system.baseThresholds?.severe ?? 0) + this.level
        // Upstream writes this multiplier as `armor || hasThresholdEffect ? 1 : 2`; the `armor`
        // disjunct is unreachable here, since it is only ever read on this armor-less branch.
        : this.level * (hasThresholdEffect ? 1 : 2),
    };
  }

  /**
   * Mark Shield slots up to `value` (#10) - the write half of the sheet's Shield pip bar.
   *
   * Lives on the model, not the sheet, because `armorScore` is *derived*: there is nothing on the
   * actor to write to, only the sources it was summed from, and the model is what knows them. Same
   * split daggerheart has between its `toggleArmor` action and `updateArmorValue`, and the same
   * distribution: the target total is turned into a delta and spread across every Shield source in
   * `#shieldSources` order until it is used up, since one pip in the row can belong to the armor
   * Item or to an effect and the row itself doesn't say which.
   *
   * Clamped against the *derived* `armorScore.max` (the sum), not any single source's max - the
   * per-source caps are enforced by `room` below as the delta is spread.
   */
  async markShield(value: number): Promise<void> {
    let remaining = Math.clamp(value, 0, this.armorScore.max) - this.armorScore.value;
    if (remaining === 0) return;

    const increasing = remaining > 0;
    for (const source of this.#shieldSources()) {
      // How much this source can absorb, signed the same way as `remaining`: unmarked slots when
      // marking, already-marked ones when unmarking.
      const room = increasing ? source.max - source.current : -source.current;
      const used = increasing ? Math.min(remaining, Math.max(0, room)) : Math.max(remaining, Math.min(0, room));
      if (used === 0) continue;

      await source.write(source.current + used);
      remaining -= used;
      if (remaining === 0) break;
    }
  }

  /**
   * Every place a Shield slot can actually be stored, in the order marks fill them.
   *
   * Effects first, the equipped armor Item last - the order daggerheart's own `getArmorSources`
   * sorts into (it ranks an `armor` origin last of all), and the one that behaves best: marks land
   * on the temporary source first, so an expiring effect takes its own spent slots with it instead
   * of leaving the ship's real armor marked off.
   *
   * A disabled or suppressed effect is skipped, same as upstream's `filter(s => !s.disabled)` -
   * its slots aren't in `armorScore` either, since core never applied its change.
   */
  #shieldSources(): ShieldSource[] {
    const sources: ShieldSource[] = [];

    const effects = (this.parent.appliedEffects ?? []) as unknown as Iterable<EffectLike>;
    for (const effect of effects) {
      if (effect.disabled || effect.isSuppressed) continue;

      const changes = effect.system?.changes;
      const index = changes?.findIndex((change) => change.type === ARMOR_EFFECT_CHANGE_TYPE) ?? -1;
      if (!changes || index < 0) continue;

      const change = changes[index];
      sources.push({
        current: change.value?.current ?? 0,
        max: this.#parseGrantedSlots(change.value?.max),
        // An effect stores its marked slots inside the change itself, so the whole `changes` array
        // has to be written back with that one entry replaced - as upstream's `updateArmorValue`
        // does. `effect.update` covers both an effect owned by the actor and one transferred from
        // an item, where upstream reaches for the parent's `updateEmbeddedDocuments` instead.
        write: (current) =>
          effect.update({
            "system.changes": changes.map((entry, i) =>
              i === index ? { ...entry, value: { ...entry.value, current } } : entry,
            ),
          }),
      });
    }

    const armor = this.armor;
    if (armor) {
      sources.push({
        current: armor.system.armor?.current ?? 0,
        max: armor.system.armor?.max ?? 0,
        write: (current) => armor.update({ "system.armor.current": current }),
      });
    }

    return sources;
  }

  /**
   * How many slots an `armor`-typed effect change grants. Its `value.max` is a *formula string*
   * upstream (`'1'`, `'@level'`, ...), evaluated against the actor when the change is applied - so
   * this evaluates it the same way rather than trusting `DhActiveEffect#armorData`, whose own
   * parse is gated on `actor.type === 'character'` and hands a ship back the raw string.
   *
   * Anything that won't resolve to a deterministic number (a dice formula, an unknown reference)
   * counts as zero: the slot total on the row comes from core applying the change, and a source
   * this can't size is one marks must not be routed to.
   */
  #parseGrantedSlots(max: string | number | undefined): number {
    if (typeof max === "number") return Math.max(0, max);
    if (!max) return 0;

    const literal = Number(max);
    if (Number.isFinite(literal)) return Math.max(0, literal);

    try {
      const roll = new Roll(max, this.parent.getRollData()).evaluateSync();
      return roll.isDeterministic ? Math.max(0, roll.total ?? 0) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Gate for `Item.createDocuments` (see class doc comment): only the Inventory tab's four types
   * (`weapon`/`armor`/`consumable`/`loot`, #6) plus `feature` (the Features tab, #7) can be
   * created/dropped on a ship. The inventory half mirrors `daggerheart`'s own
   * `BaseDataActor#isItemValid` default exactly, `hasInventory` gate included; the `feature`
   * branch bypasses that gate the same way daggerheart's own feature-bearing DataModels widen
   * the default (`super.isItemValid(source) || source.type === 'feature'`, e.g. `DHAncestry`/
   * `DHCommunity`) - a feature isn't inventory, so it shouldn't hang off an inventory flag.
   *
   * `SpaceshipActorSheet` enforces the same rule one level up (rejecting a bad drop/create with
   * our own message before this ever sees it), so both read the shared `constants.ts` lists
   * rather than each spelling out their own copy.
   */
  isItemValid(source: { type: string }): boolean {
    const isInventoryType = (INVENTORY_ITEM_TYPES as readonly string[]).includes(source.type);
    return (this.metadata.hasInventory && isInventoryType) || source.type === FEATURE_ITEM_TYPE;
  }

  static override defineSchema(): SpaceshipData.Schema {
    const fields = foundry.data.fields;

    /** One of the six traits: same `{value, tierMarked}` shape as a `daggerheart` character. */
    const traitField = () =>
      new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
        tierMarked: new fields.BooleanField({ required: true, nullable: false, initial: false }),
      });

    /**
     * One of the markable resources (Hope/HP/Stress): `{value, max}`, both GM-editable directly.
     * `max` defaults to 6 (Hope's max is fixed at 6 by the core rules; HP/Stress vary per Frame,
     * but a nonzero starting max means a freshly-created ship shows markable boxes immediately
     * instead of an empty pip row the GM has to know to fill in first).
     */
    const resourceField = () =>
      new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 6 }),
      });

    /**
     * One Station (#8): whether this ship has the role at all, plus its crew assignments.
     *
     * `enabled` defaults to `true` - a freshly-created ship has all five roles, and the GM
     * disables the ones its Frame lacks. Disabling is non-destructive: `crew` is left untouched so
     * re-enabling restores the previous assignments (the sheet just refuses new drops and renders
     * the station dimmed).
     *
     * `crew` is a plain array of Actor UUID *strings* (core's own `DocumentUUIDField`, which
     * validates the string's shape without dereferencing it) - deliberately not daggerheart's
     * `ForeignDocumentUUIDArrayField`, which initializes to live Documents and is system-internal
     * (docs/adr/0002). A one-way reference, per CONTEXT.md's "Crew assignment" entry: no back-link
     * on the PC, no sync, and an Actor deleted out from under an entry stays a dangling string that
     * the sheet resolves to "Unknown" rather than something that has to be cleaned up here.
     */
    const stationField = () =>
      new fields.SchemaField({
        enabled: new fields.BooleanField({ required: true, nullable: false, initial: true }),
        // No explicit options: `ArrayField`'s own defaults are already
        // `{required: true, nullable: false, initial: []}`.
        crew: new fields.ArrayField(new fields.DocumentUUIDField({ type: "Actor" })),
      });

    /**
     * One `stationField()` per `STATION_IDS` entry, keyed by id - built from that list rather than
     * spelling the five keys out again here, so the ids (and their sheet-facing order) stay
     * defined in exactly one place.
     *
     * Assigned into a pre-cast empty object rather than built with `Object.fromEntries`, which
     * only ever yields `Record<string, ...>` - TS can't narrow that to the five literal keys,
     * whereas `stations[id] = ...` still type-checks each field against `StationField`.
     */
    const stations = {} as SpaceshipData.StationsSchema;
    for (const id of STATION_IDS) stations[id] = stationField();

    return {
      level: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 1,
        initial: 1,
      }),
      traits: new fields.SchemaField({
        agility: traitField(),
        strength: traitField(),
        finesse: traitField(),
        instinct: traitField(),
        presence: traitField(),
        knowledge: traitField(),
      }),
      resources: new fields.SchemaField({
        hope: resourceField(),
        hitPoints: resourceField(),
        stress: resourceField(),
      }),
      evasion: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      proficiency: new fields.NumberField({ required: true, nullable: false, integer: true, min: 1, initial: 1 }),
      // Shield (#10): `max` is the equipped armor's score, `value` the slots marked off it. Both
      // are recomputed from the armor Item every `prepareBaseData`, so the field exists only to
      // give ActiveEffects (and daggerheart's own damage-application code, which reads
      // `actor.system.armorScore` on any actor) a schema-declared place to find them.
      // Daggerheart declares its character equivalent `{persisted: false}`; fvtt-types
      // 13.346-beta's `SchemaField` options type predates that Foundry option and rejects it
      // (TS2353), so this one is left persisted. Harmless in play: nothing writes to it and
      // `prepareBaseData` overwrites whatever was stored on every data preparation - the only cost
      // is two dead numbers riding along in the actor's stored source data (and so in an export).
      armorScore: new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      }),
      // Damage thresholds (#10) - persisted the same way, and in daggerheart's character schema
      // genuinely so: the stored value is the level-1 unarmored baseline a fresh actor shows
      // before `prepareBaseData` ever overwrites it.
      damageThresholds: new fields.SchemaField({
        major: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
        severe: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      }),
      maxWeaponMounts: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 1 }),
      // System Points (#11). `systemPoints` is the base total from the ship's Frame, entered by the
      // GM on the wrench dialog; #12's level-up wizard adds its gains into this same field.
      systemPoints: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      // What is currently committed to installed systems. A GM-entered number *for now*: the
      // `system` Item sub-type this is meant to be summed from doesn't exist yet (#15), which
      // replaces this field with that derivation. `min: 0` only - it is not capped at
      // `systemPoints`, so an over-committed ship reads as a negative `systemPointsAvailable`
      // instead of silently swallowing the excess.
      systemPointsSpent: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      stations: new fields.SchemaField(stations),
      // `rules` (#6): NOT read through `getRollData()` - `DhpActor#getRollData` (document-level,
      // not sheet code) builds the actor's final roll-data object as
      // `{...createShallowProxy(this.system), system: this.system.getRollData(), ...}`: the
      // *proxy spread* (reading straight through to `this.system`'s own properties, i.e. schema
      // fields) is what lands at the top level a roll formula sees, while our `getRollData()`
      // method's return value only ends up nested under `.system` - a different place nothing in
      // this call chain reads. `DualityRoll`'s dice-construction code (`build/daggerheart.js`)
      // reads `this.data.rules.dualityRoll?.defaultHopeDice` off that top-level object, unguarded
      // at the `rules` level (only `.dualityRoll` itself is optional-chained) - so `rules` has to
      // be a genuine schema field here, an empty `getRollData()` addition does nothing. An empty
      // object is enough: every field daggerheart reads under `rules.dualityRoll` is itself
      // optional-chained with a sensible fallback (12-sided Hope/Fear dice, etc.), so this doesn't
      // need to replicate `character`'s actual house-rule schema, just exist as an object.
      rules: new fields.ObjectField({ required: false, nullable: false, initial: {} }),
    };
  }
}

namespace SpaceshipData {
  export interface Metadata {
    label: string;
    isNPC: boolean;
    settingSheet: null;
    hasResistances: boolean;
    hasAttribution: boolean;
    hasLimitedView: boolean;
    usesSize: boolean;
    hasInventory: boolean;
  }

  /** `{value, tierMarked}`, same shape as a `daggerheart` character trait. */
  type TraitField = foundry.data.fields.SchemaField<{
    value: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true; initial: 0 }>;
    tierMarked: foundry.data.fields.BooleanField<{ required: true; nullable: false; initial: false }>;
  }>;

  /** `{value, max}`, same shape as a `daggerheart` character resource. */
  type ResourceField = foundry.data.fields.SchemaField<{
    value: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 0;
    }>;
    max: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true; min: 0; initial: 6 }>;
  }>;

  /** One Station (#8): `{enabled, crew: Actor UUID string[]}`. */
  export type StationField = foundry.data.fields.SchemaField<{
    enabled: foundry.data.fields.BooleanField<{ required: true; nullable: false; initial: true }>;
    crew: foundry.data.fields.ArrayField<foundry.data.fields.DocumentUUIDField<{ type: "Actor" }>>;
  }>;

  /** The `stations` sub-schema: exactly one `StationField` per `STATION_IDS` entry. */
  export type StationsSchema = Record<(typeof STATION_IDS)[number], StationField>;

  export interface Schema extends foundry.data.fields.DataSchema {
    level: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 1;
      initial: 1;
    }>;
    traits: foundry.data.fields.SchemaField<{
      agility: TraitField;
      strength: TraitField;
      finesse: TraitField;
      instinct: TraitField;
      presence: TraitField;
      knowledge: TraitField;
    }>;
    resources: foundry.data.fields.SchemaField<{
      hope: ResourceField;
      hitPoints: ResourceField;
      stress: ResourceField;
    }>;
    evasion: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true; initial: 0 }>;
    proficiency: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 1;
      initial: 1;
    }>;
    /** Shield (#10): `{value: slots marked, max: equipped armor's score}`. Never persisted. */
    armorScore: foundry.data.fields.SchemaField<{
      value: foundry.data.fields.NumberField<{
        required: true;
        nullable: false;
        integer: true;
        min: 0;
        initial: 0;
      }>;
      max: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true; min: 0; initial: 0 }>;
    }>;
    /** Damage thresholds (#10), derived from the equipped armor + level in `prepareBaseData`. */
    damageThresholds: foundry.data.fields.SchemaField<{
      major: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true; initial: 0 }>;
      severe: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true; initial: 0 }>;
    }>;
    maxWeaponMounts: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 1;
    }>;
    /** System Points (#11): the base total from the ship's Frame, GM-entered. */
    systemPoints: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 0;
    }>;
    /** System Points committed to installed systems (#11); derived from `system` items in #15. */
    systemPointsSpent: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 0;
    }>;
    stations: foundry.data.fields.SchemaField<StationsSchema>;
    rules: foundry.data.fields.ObjectField<{ required: false; nullable: false; initial: Record<string, never> }>;
  }
}
