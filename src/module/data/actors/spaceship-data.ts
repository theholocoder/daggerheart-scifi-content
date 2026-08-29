import { FEATURE_ITEM_TYPE, INVENTORY_ITEM_TYPES } from "../../constants";

/**
 * DataModel for the module-registered `daggerheart-scifi-content.spaceship` Actor sub-type.
 *
 * Deliberately independent from the `daggerheart` system's own actor DataModels (see
 * docs/adr/0001-spaceship-actor-subtype.md) and from its sheet base classes (see
 * docs/adr/0002-spaceship-sheet-independent-application.md). `level`, the six traits, and the
 * core resources (Hope, HP, Stress, Evasion, Proficiency) are modeled here (#5); Shield,
 * thresholds, stations, system points, and weapon mounts are added by later tickets.
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
      maxWeaponMounts: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 1 }),
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
    maxWeaponMounts: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 1;
    }>;
    rules: foundry.data.fields.ObjectField<{ required: false; nullable: false; initial: Record<string, never> }>;
  }
}
