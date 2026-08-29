import {
  ARMOR_EFFECT_CHANGE_TYPE,
  ARMOR_ITEM_TYPE,
  FEATURE_ITEM_TYPE,
  INVENTORY_ITEM_TYPES,
  STATION_IDS,
  SYSTEM_ITEM_TYPE,
} from "../../constants";
import {
  SHIP_LEVEL_OPTION_TYPES,
  SPACESHIP_MAX_LEVEL,
  shipTierForLevel,
  type ShipLevelOptionType,
} from "../../config/spaceship-level-tiers";
import { resolveUuidSync } from "../../utils/resolve-uuid";

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
 * The one field `#pilotBaseEvasion` reads off a Pilot station's crew Actor - loose for the same
 * reason `ArmorItemLike`/`EffectLike` above are: fvtt-types knows nothing of daggerheart's
 * `character` schema (docs/adr/0002). Optional throughout since a crewed Actor without an Evasion
 * stat (an NPC/adversary) is a valid, expected shape here, not an error case.
 */
interface CrewMemberLike {
  system?: { evasion?: number };
}

/**
 * One point-buy tick a player committed at a given level (#12), as stored under
 * `system.levelData.levelups.<level>.selections`. Same fields as one entry of daggerheart's own
 * `DhLevelData` `selections` array, minus the ones only its character-only options need
 * (`subType`, `secondaryData`, `itemUuid`, `features`): a ship never picks a domain card, a
 * subclass, a multiclass, or anything that creates an Item.
 *
 * `tier`/`level`/`optionKey`/`checkboxNr` are what make a selection reversible and auditable - they
 * identify the exact checkbox it came from, so re-opening the wizard (or the read-only view) can
 * re-tick it and de-levelling can drop it.
 */
export interface ShipLevelSelection {
  tier: number;
  level: number;
  /** Key of the option row in the tier's `options` table (`trait`, `hitPoint`, ...). */
  optionKey: string;
  type: ShipLevelOptionType;
  checkboxNr: number;
  /** How much the stat moves. Null for `trait`, whose movement is always +1 per picked trait. */
  value: number | null;
  minCost: number | null;
  amount: number | null;
  /** The sub-choices the tick asked for - trait keys, for a `trait` selection. Empty otherwise. */
  data: string[];
}

/** Everything one level of a ship's history records: what it granted, and what was chosen. */
export interface ShipLevelup {
  /** Granted by entering the level, not chosen: +1 Proficiency on a tier's first level. */
  achievements: { proficiency: number };
  selections: ShipLevelSelection[];
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
   * (level-up gains are layered onto it by `#applyLevelupAdvancements`, #12) and
   * `systemPointsSpent` is summed off the ship's installed `system` items (#15), so the available
   * count is never a third number that can disagree with them.
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
   * System Points committed to the ship's installed Systems (#15): the sum of `systemPointsCost`
   * over its `daggerheart-scifi-content.system` items.
   *
   * Was a GM-entered schema field in #11, replaced here by this derivation - which is why nothing
   * needs to keep the two in step any more, and why the wrench dialog no longer offers a "Spent"
   * input. `migrateData` below drops the stored number off any ship saved before this change.
   *
   * Quantity is deliberately not a multiplier: a System's cost is what installing it costs, and a
   * `quantity` of 2 on one item is inventory bookkeeping (it comes with the `loot`-equivalent shape
   * the sub-type is modeled on), not a second installation.
   *
   * A getter rather than a `prepareBaseData` write, same reasoning as `systemPointsAvailable`
   * above: nothing outside this module needs a schema-declared path to find it, and reading the
   * items live means installing or removing a System is reflected without a preparation pass.
   */
  /**
   * Drop `systemPointsSpent` from the source data of any ship stored before #15, when it was still
   * a GM-entered schema field.
   *
   * Foundry calls this on every source object before validation, so the stale key never reaches
   * the model - without it, the number would sit in `_source` indefinitely, shadowed by the getter
   * above but reappearing in `toObject()`, in exports, and in the compendium. Foundry tolerates
   * unrecognised source keys rather than erroring on them, so this is about the data being
   * genuinely gone rather than about avoiding a crash.
   *
   * A `migrateData` cleanup rather than a world migration script: the field is inert either way,
   * and the value is rewritten out the next time the actor is updated.
   */
  static override migrateData(source: Record<string, unknown>): Record<string, unknown> {
    delete source.systemPointsSpent;

    // #18: `evasion` used to be the GM-entered total; it's now fully derived (pilot base + item/
    // effect/manual bonuses) and `evasionBonus` is the new manual-adjustment field. A ship stored
    // before this change has a number sitting in `evasion` and nothing in `evasionBonus` - carried
    // across so its old manually-set total keeps acting as a bonus until the GM revisits it,
    // rather than silently resetting to 0.
    if (source.evasionBonus === undefined && typeof source.evasion === "number") {
      source.evasionBonus = source.evasion;
    }

    return super.migrateData(source);
  }

  get systemPointsSpent(): number {
    const items = (this.parent?.items ?? []) as unknown as Iterable<{
      type: string;
      system: { systemPointsCost?: number };
    }>;

    let spent = 0;
    for (const item of items) {
      if (item.type === SYSTEM_ITEM_TYPE) spent += item.system.systemPointsCost ?? 0;
    }
    return spent;
  }

  /**
   * The ship's stored level-up history, in the shape the wizard and `prepareBaseData` read it.
   *
   * A cast, not a re-derivation: fvtt-types resolves the `TypedObjectField`/`ArrayField` nest in
   * `levelData.levelups` to a structurally-identical but anonymous type, and every consumer wants
   * the two named interfaces above instead.
   */
  get levelups(): Record<string, ShipLevelup> {
    return this.levelData.levelups as unknown as Record<string, ShipLevelup>;
  }

  /**
   * Is there a pending level-up to walk? True once the GM has raised the ship's target level above
   * the level it has actually taken - the same `current < changed` split daggerheart's own
   * `DhLevelData#canLevelUp` uses, and what the sheet header's glow button keys off.
   *
   * Ships keep the "current" half in the pre-existing `system.level` field rather than adding a
   * `levelData.level.current` beside `changed`: `level` was already the ship's level everywhere
   * (#5's header, #10's damage thresholds, `getRollData`), and a second copy of it would be a
   * second thing to keep in sync for no gain.
   */
  get canLevelUp(): boolean {
    return this.level < this.levelData.changed;
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
   * The base half of ship Evasion (#18): the highest Evasion stat among the Pilot station's crew,
   * or `0` if the station is disabled or has no crew. A crewed actor with no Evasion stat of its
   * own (an NPC/adversary, which daggerheart doesn't give one) contributes `0` to the comparison
   * rather than being skipped - the ship's Evasion is never *raised* by such a crewmate, but an
   * all-adversary Pilot station isn't the same as an empty one either.
   *
   * `stations.pilot.crew` is a plain array of Actor UUID *strings* (see `stationField` in
   * `defineSchema`), so each entry is resolved with `resolveUuidSync` - the shared guard
   * `SpaceshipActorSheet#resolveCrewEntry`/`#getRowDocument` also use, since a stale reference to a
   * deleted Actor (or an unindexed compendium one) throws rather than returning `null`.
   */
  #pilotBaseEvasion(): number {
    const pilot = this.stations.pilot;
    if (!pilot.enabled || pilot.crew.length === 0) return 0;

    let best = 0;
    for (const uuid of pilot.crew) {
      const evasion = resolveUuidSync<CrewMemberLike>(uuid)?.system?.evasion ?? 0;
      if (evasion > best) best = evasion;
    }
    return best;
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
   * thresholds), which is what makes unequipping drop the numbers with no extra bookkeeping. The
   * threshold half of that derivation lives in `damageThresholdsAtLevel`, which the level-up
   * summary also projects forward through.
   */
  override prepareBaseData(): void {
    super.prepareBaseData();

    // Evasion (#18): base is the best Evasion stat among the enabled Pilot station's crew (`0`
    // with the station disabled/empty, or for a crewed actor with no Evasion stat of its own -
    // e.g. an NPC/adversary - contributing to the comparison rather than being excluded from it).
    // Set *before* `#applyLevelupAdvancements` so a `evasion`-type level-up selection's `+=` stacks
    // on top of the pilot base, and before core applies ActiveEffects so an item/effect granting
    // `system.evasion` stacks on top of both - the same "derive base first, let core layer
    // ActiveEffects on top" arrangement `armorScore` below uses.
    this.evasion = this.#pilotBaseEvasion();

    // Level-up gains (#12) are *derived*, not written into the stats: the stored trait/resource/
    // evasion/proficiency/System Point numbers stay the ship's Frame statline, and every level
    // taken since is layered on top from `levelData.levelups` on each data preparation. Same
    // arrangement as daggerheart's own character `prepareBaseData`, and what makes the history
    // reversible - dropping a level's record is all de-levelling has to do. Runs first so the
    // threshold derivation below still sees a settled `level`.
    this.#applyLevelupAdvancements();

    // The manual bonus (#18): the wrench Settings dialog's GM-entered escape hatch, same role as
    // every other derived stat's manual-adjustment field. Added last, after the pilot base and
    // level-up gains, so it reads as a flat adjustment on top of both.
    this.evasion += this.evasionBonus;

    // A target level below the level already taken is meaningless, and is what a ship stored
    // before #12 looks like (`changed` defaulting to 1 under an already-levelled `level`). Clamped
    // here rather than migrated so the header's level input - which reads `changed`, as the
    // character sheet's does - shows the real level on such a ship instead of 1.
    if (this.levelData.changed < this.level) this.levelData.changed = this.level;

    const armor = this.armor;

    this.armorScore = {
      max: armor?.system.armor?.max ?? 0,
      value: armor?.system.armor?.current ?? 0,
    };

    this.damageThresholds = this.damageThresholdsAtLevel(this.level);
  }

  /**
   * The ship's damage thresholds *if* it were the given level (#10), with its current armour and
   * effects - the derivation `prepareBaseData` runs on `this.level`, exposed as a projection so
   * the level-up summary (#12) can show what the levels being taken will move them to without
   * restating the rule. An earlier version of that summary restated it and got the unarmoured
   * case wrong for a ship carrying a threshold effect.
   *
   * The `severeThresholdMultiplier` is daggerheart's own rule, copied by value: an unarmoured
   * actor gets double level on severe, *unless* something else already sets a base threshold -
   * either armor or an `armor`-typed ActiveEffect change carrying `damageThresholds`.
   */
  damageThresholdsAtLevel(level: number): { major: number; severe: number } {
    const armor = this.armor;

    // `?? []`: core fills `appliedEffects` during `applyActiveEffects`, which runs *after*
    // `prepareBaseData` - so this reads the previous preparation's array (exactly as daggerheart's
    // character does), and on the very first preparation of a fresh Actor there may be none yet.
    const effects = (this.parent.appliedEffects ?? []) as unknown as Iterable<EffectLike>;
    const hasThresholdEffect = Array.from(effects).some((effect) =>
      effect.system?.changes?.some(
        (change) => change.type === ARMOR_EFFECT_CHANGE_TYPE && change.value?.damageThresholds,
      ),
    );

    return {
      major: (armor?.system.baseThresholds?.major ?? 0) + level,
      severe: armor
        ? (armor.system.baseThresholds?.severe ?? 0) + level
        : // Upstream writes this multiplier as `armor || hasThresholdEffect ? 1 : 2`; the `armor`
          // disjunct is unreachable here, since it is only ever read on this armor-less branch.
          level * (hasThresholdEffect ? 1 : 2),
    };
  }

  /**
   * Layer every level-up the ship has actually taken onto the stored base stats (#12).
   *
   * A copy by value of the equivalent block in daggerheart's character `prepareBaseData`, switched
   * over the same option `type` ids and narrowed to the six ship options - including its handling
   * of `tierMarked`, where a trait picked in the *current* tier reads as marked and one picked in
   * an earlier tier does not. That single line is what implements "entering a new tier clears all
   * marks on traits" without anything having to write to the actor at the tier boundary. Traits
   * never picked through a level-up keep whatever the sheet's own tier-mark toggle stored.
   *
   * Levels above `this.level` are skipped: `applyLevelUp` writes the level and its records
   * together, so there normally are none, but a record that outlived its level (a failed write, a
   * hand-edited actor) must not silently inflate the ship's stats.
   */
  #applyLevelupAdvancements(): void {
    const currentTier = shipTierForLevel(this.level)?.tier ?? null;
    // Indexed by trait key from stored selection data, which the schema types as a plain string.
    const traits = this.traits as Record<string, { value: number; tierMarked: boolean }>;

    for (const [levelKey, levelup] of Object.entries(this.levelups)) {
      if (Number(levelKey) > this.level) continue;

      this.proficiency += levelup.achievements.proficiency;

      for (const selection of levelup.selections) {
        switch (selection.type) {
          case SHIP_LEVEL_OPTION_TYPES.trait:
            for (const traitKey of selection.data) {
              const trait = traits[traitKey];
              if (!trait) continue;
              trait.value += 1;
              trait.tierMarked = selection.tier === currentTier;
            }
            break;
          case SHIP_LEVEL_OPTION_TYPES.hitPoint:
            this.resources.hitPoints.max += selection.value ?? 0;
            break;
          case SHIP_LEVEL_OPTION_TYPES.stress:
            this.resources.stress.max += selection.value ?? 0;
            break;
          case SHIP_LEVEL_OPTION_TYPES.evasion:
            this.evasion += selection.value ?? 0;
            break;
          case SHIP_LEVEL_OPTION_TYPES.proficiency:
            this.proficiency += selection.value ?? 0;
            break;
          case SHIP_LEVEL_OPTION_TYPES.systemPoints:
            this.systemPoints += selection.value ?? 0;
            break;
        }
      }
    }
  }

  /**
   * Retarget the ship's level (#12) - the write behind the sheet header's level input, mirroring
   * daggerheart's own `DhpActor#updateLevel` split.
   *
   * Raising it only records the *target* (`levelData.changed`), which is what turns the level-up
   * button on; the level itself moves when the wizard finishes (`applyLevelUp`). Lowering it is
   * the de-level path and takes effect immediately, dropping the records of every level above the
   * new one - since the advancements those levels granted are derived from exactly those records,
   * that is the whole rollback.
   *
   * Lives on the DataModel rather than the Actor document (where daggerheart puts it) because a
   * module-registered sub-type shares the world's single `CONFIG.Actor.documentClass` with every
   * other actor and cannot subclass it - the same reason `markShield` (#10) lives here.
   */
  async updateLevel(newLevel: number): Promise<void> {
    if (newLevel > SPACESHIP_MAX_LEVEL) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Levelup.tooHighLevel"));
    } else if (newLevel < 1) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Levelup.tooLowLevel"));
    }
    const usedLevel = Math.clamp(newLevel, 1, SPACESHIP_MAX_LEVEL);
    if (usedLevel === this.levelData.changed && usedLevel >= this.level) return;

    if (usedLevel > this.level) {
      await this.parent.update({ system: { levelData: { changed: usedLevel } } });
      return;
    }

    // `-=` is core Foundry's delete-this-key update syntax; the records above `usedLevel` go away
    // in the same write that lowers the level, so the derivation never sees the two disagree.
    const droppedLevelups = Object.keys(this.levelups).reduce<Record<string, null>>((acc, levelKey) => {
      if (Number(levelKey) > usedLevel) acc[`-=${levelKey}`] = null;
      return acc;
    }, {});

    await this.parent.update({
      system: {
        level: usedLevel,
        levelData: { changed: usedLevel, levelups: droppedLevelups },
      },
    });
  }

  /**
   * Commit a finished level-up (#12): take the ship to `level` and record what each of the levels
   * crossed granted and chose.
   *
   * `level` is the level the wizard actually walked, not `levelData.changed` read back here: the
   * target can move while the wizard is open (another client, a second sheet), and reading it at
   * save time would take the ship to a level it has no records for - which
   * `#applyLevelupAdvancements` would then silently under-apply. A target raised mid-run simply
   * leaves the ship able to level up again, which is what `canLevelUp` is for.
   *
   * One update, so a ship is never briefly at its new level with no record of how it got there -
   * the derivation reads both halves and would otherwise show the ship's old stats at its new level.
   */
  async applyLevelUp(level: number, levelups: Record<number, ShipLevelup>): Promise<void> {
    await this.parent.update({
      system: {
        level,
        levelData: { levelups },
      },
    });
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
   * Gate for `Item.createDocuments` (see class doc comment): only the Inventory tab's types
   * (daggerheart's `weapon`/`armor`/`consumable`/`loot`, #6, plus this module's own `system`
   * sub-type, #15) and `feature` (the Features tab, #7) can be created/dropped on a ship. The
   * inventory half mirrors `daggerheart`'s own
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

    /** The six ship option ids, as the plain `string[]` `StringField`'s `choices` option takes. */
    const shipLevelOptionTypeChoices: string[] = Object.values(SHIP_LEVEL_OPTION_TYPES);

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

    /**
     * One damage-type resistance entry: `{resistance, immunity, reduction}`, same shape as core's
     * `resistanceField()` on `character`/`adversary`. Ships have no sheet UI for this yet (the
     * schema exists purely so `system.resistance` is populated) but the field is unconditionally
     * required: `daggerheart`'s own `takeDamage` → `getDamageTypeReduction` does
     * `Object.entries(this.system.resistance)` with no `?.` guard, so any actor type missing this
     * key throws `TypeError: can't convert undefined to object` the moment it's dealt damage in
     * combat - `metadata.hasResistances` above only gates whether *core's* actor base class adds
     * the field, and ships don't extend that base class, so leaving it out here is fatal even
     * though hasResistances is false.
     */
    const resistanceField = () =>
      new fields.SchemaField({
        resistance: new fields.BooleanField({ required: true, nullable: false, initial: false }),
        immunity: new fields.BooleanField({ required: true, nullable: false, initial: false }),
        reduction: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
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
      // Evasion (#18): fully derived in `prepareBaseData` from the Pilot station's best crew
      // Evasion plus `evasionBonus`, then further stacked on by core-applied ActiveEffects
      // targeting `system.evasion` (an item's transferred effect included) - same persisted-but-
      // overwritten-every-preparation arrangement `armorScore` below uses, and for the same
      // reason: ActiveEffects need a schema-declared `system.evasion` path to add onto.
      evasion: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      // The manual-adjustment escape hatch (#18) behind the wrench Settings dialog's Evasion
      // input - GM-entered, and the only half of `evasion` actually persisted with meaning (see
      // `migrateData`, which carries a pre-#18 ship's old `evasion` total over into this field).
      evasionBonus: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
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
      // See `resistanceField()` above for why this is present despite `metadata.hasResistances`
      // being false and there being no sheet UI for it yet.
      resistance: new fields.SchemaField({
        physical: resistanceField(),
        magical: resistanceField(),
      }),
      maxWeaponMounts: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 1 }),
      // Crew/passenger capacity (#16): informational only, per user story 22 (#3) - nothing checks
      // these against the Stations tab's actual crew assignments.
      maxCrew: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      maxPassengers: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      // System Points (#11). `systemPoints` is the base total from the ship's Frame, entered by the
      // GM on the wrench dialog; #12's level-up wizard adds its gains into this same field.
      systemPoints: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      // Level-up history (#12). `changed` is the *target* level the GM typed in the header; the
      // level actually taken stays in `level` above (see `canLevelUp`). `levelups` is keyed by
      // level number, exactly as daggerheart's `DhLevelData.levelups` is - one entry per level
      // taken, holding what that level granted and what was chosen for it.
      levelData: new fields.SchemaField({
        changed: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 1,
          initial: 1,
        }),
        levelups: new fields.TypedObjectField(
          new fields.SchemaField({
            achievements: new fields.SchemaField({
              proficiency: new fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                initial: 0,
              }),
            }),
            selections: new fields.ArrayField(
              new fields.SchemaField({
                tier: new fields.NumberField({ required: true, nullable: false, integer: true }),
                level: new fields.NumberField({ required: true, nullable: false, integer: true }),
                optionKey: new fields.StringField({ required: true }),
                type: new fields.StringField({ required: true, choices: shipLevelOptionTypeChoices }),
                checkboxNr: new fields.NumberField({ required: true, nullable: false, integer: true }),
                value: new fields.NumberField({ integer: true }),
                minCost: new fields.NumberField({ integer: true }),
                amount: new fields.NumberField({ integer: true }),
                data: new fields.ArrayField(new fields.StringField({ required: true })),
              }),
            ),
          }),
        ),
      }),
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
      // need to replicate `character`'s actual house-rule schema, just exist as an object - *except*
      // `rules.attack.damage.hpDamageTakenMultiplier`, which daggerheart's `applyDamage` reads the
      // same optional-chained way but then multiplies straight into the incoming damage total with
      // no `?? 1` fallback: `Math.ceil(total * actor.system.rules?.attack?.damage
      // ?.hpDamageTakenMultiplier)`. With no `attack` key at all that chain resolves to `undefined`,
      // and `total * undefined` is `NaN` - which then makes every threshold comparison in
      // `convertDamageToThreshold` false, so damage silently always reads as the lowest tier (1 HP)
      // no matter the actual hit. `hpDamageMultiplier` is included alongside it for the same reason,
      // even though its one read (`getTotalBonus`, an ActiveEffect-change scan) already defaults
      // safely - keeping both present mirrors `character`'s real defaults instead of leaving a second
      // foot-gun for the next unguarded read to find.
      rules: new fields.ObjectField({
        required: false,
        nullable: false,
        initial: { attack: { damage: { hpDamageMultiplier: 1, hpDamageTakenMultiplier: 1 } } },
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

  /** One damage-type resistance entry: `{resistance, immunity, reduction}` (see `resistanceField()`). */
  type ResistanceField = foundry.data.fields.SchemaField<{
    resistance: foundry.data.fields.BooleanField<{ required: true; nullable: false; initial: false }>;
    immunity: foundry.data.fields.BooleanField<{ required: true; nullable: false; initial: false }>;
    reduction: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true; initial: 0 }>;
  }>;

  /** One stored point-buy tick (#12) - the schema counterpart of `ShipLevelSelection`. */
  type SelectionSchema = {
    tier: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true }>;
    level: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true }>;
    optionKey: foundry.data.fields.StringField<{ required: true }>;
    type: foundry.data.fields.StringField<{ required: true }>;
    checkboxNr: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true }>;
    value: foundry.data.fields.NumberField<{ integer: true }>;
    minCost: foundry.data.fields.NumberField<{ integer: true }>;
    amount: foundry.data.fields.NumberField<{ integer: true }>;
    data: foundry.data.fields.ArrayField<foundry.data.fields.StringField<{ required: true }>>;
  };

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
    /** Fully derived (#18): Pilot-crew base + `evasionBonus`, plus core-applied ActiveEffects. */
    evasion: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true; initial: 0 }>;
    /** The manual-adjustment bonus (#18) behind the wrench Settings dialog's Evasion input. */
    evasionBonus: foundry.data.fields.NumberField<{ required: true; nullable: false; integer: true; initial: 0 }>;
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
    /** See `resistanceField()` in `defineSchema` for why this exists despite no sheet UI yet. */
    resistance: foundry.data.fields.SchemaField<{
      physical: ResistanceField;
      magical: ResistanceField;
    }>;
    maxWeaponMounts: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 1;
    }>;
    /** Crew/passenger capacity (#16): informational only, GM-entered. */
    maxCrew: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 0;
    }>;
    maxPassengers: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 0;
    }>;
    /** System Points (#11): the base total from the ship's Frame, GM-entered. */
    systemPoints: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 0;
    }>;
    /** Level-up history (#12): the target level plus one record per level taken. */
    levelData: foundry.data.fields.SchemaField<{
      changed: foundry.data.fields.NumberField<{
        required: true;
        nullable: false;
        integer: true;
        min: 1;
        initial: 1;
      }>;
      levelups: foundry.data.fields.TypedObjectField<
        foundry.data.fields.SchemaField<{
          achievements: foundry.data.fields.SchemaField<{
            proficiency: foundry.data.fields.NumberField<{
              required: true;
              nullable: false;
              integer: true;
              initial: 0;
            }>;
          }>;
          selections: foundry.data.fields.ArrayField<foundry.data.fields.SchemaField<SelectionSchema>>;
        }>
      >;
    }>;
    stations: foundry.data.fields.SchemaField<StationsSchema>;
    /** See `rules` in `defineSchema` for why `attack.damage` isn't the empty object it looks like. */
    rules: foundry.data.fields.ObjectField<{
      required: false;
      nullable: false;
      initial: { attack: { damage: { hpDamageMultiplier: 1; hpDamageTakenMultiplier: 1 } } };
    }>;
  }
}
