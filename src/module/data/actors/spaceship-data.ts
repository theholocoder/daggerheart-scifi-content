/**
 * DataModel for the module-registered `daggerheart-scifi-content.spaceship` Actor sub-type.
 *
 * Deliberately independent from the `daggerheart` system's own actor DataModels (see
 * docs/adr/0001-spaceship-actor-subtype.md) and from its sheet base classes (see
 * docs/adr/0002-spaceship-sheet-independent-application.md). Only `level` is modeled for now;
 * the rest of the Spaceship resource shape (Hope, HP, Stress, Evasion, Shield, Proficiency,
 * thresholds, stations, system points, weapon mounts, ...) is added by later tickets.
 *
 * `metadata` and `getRollData` are *not* our own convention: `daggerheart`'s `Actor`/`Token`
 * document classes (`CONFIG.Actor.documentClass`/`CONFIG.Token.objectClass`, both world-global,
 * not overridable per sub-type) unconditionally read `actor.system.metadata.usesSize` on actor
 * creation, token creation, and every render of the Actors sidebar, and unconditionally call
 * `actor.system.getRollData()` from `DhpActor#getRollData` (itself called by core Foundry's
 * `applyActiveEffects` during every data preparation) - for *every* Actor in the world, including
 * foreign module-registered ones. Without these, creating a Spaceship actor throws. `metadata`'s
 * shape mirrors `daggerheart`'s own `BaseDataActor.metadata` default (`module/data/actor/base.mjs`),
 * every flag at its safe/inert default; `getRollData` mirrors its minimal default implementation.
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
      hasInventory: false,
    };
  }

  get metadata(): SpaceshipData.Metadata {
    return (this.constructor as typeof SpaceshipData).metadata;
  }

  /** Data made available to roll formulas referencing this actor. Extended as ship stats are added. */
  getRollData(): Record<string, unknown> {
    return { level: this.level };
  }

  static override defineSchema(): SpaceshipData.Schema {
    const fields = foundry.data.fields;

    return {
      level: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 1,
        initial: 1,
      }),
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

  export interface Schema extends foundry.data.fields.DataSchema {
    level: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 1;
      initial: 1;
    }>;
  }
}
