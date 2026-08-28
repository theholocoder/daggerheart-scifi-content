/**
 * DataModel for the module-registered `daggerheart-scifi-content.spaceship` Actor sub-type.
 *
 * Deliberately independent from the `daggerheart` system's own actor DataModels (see
 * docs/adr/0001-spaceship-actor-subtype.md) and from its sheet base classes (see
 * docs/adr/0002-spaceship-sheet-independent-application.md). Only `level` is modeled for now;
 * the rest of the Spaceship resource shape (Hope, HP, Stress, Evasion, Shield, Proficiency,
 * thresholds, stations, system points, weapon mounts, ...) is added by later tickets.
 */
export default class SpaceshipData extends foundry.abstract.TypeDataModel<
  SpaceshipData.Schema,
  Actor.Implementation
> {
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
