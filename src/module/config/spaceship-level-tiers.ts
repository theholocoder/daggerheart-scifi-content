/**
 * The Spaceship level-up option pool and tier table (#12).
 *
 * A module-owned copy, by value, of `daggerheart`'s own `defaultLevelTiers`/`LevelOptionType`
 * (its `DhLevelTiers`/`DhLevelTier`/`DhLevelOption` models in the system bundle), narrowed to the
 * six ship-appropriate options - see CONTEXT.md's "Ship level-up" entry. Copied rather than read
 * off the system's `LevelTiers` world setting for the reasons in
 * docs/adr/0002-spaceship-sheet-independent-application.md: that setting is a `character` contract
 * (its option pool carries `domainCard`/`subclass`/`experience`/`multiclass`, and classes extend
 * it through `levelupOptionTiers` on a `class` Item a ship never has), and its per-tier
 * `domainCardByLevel`/`initialAchievements.experience` fields describe achievements ships have no
 * equivalent for.
 *
 * Deliberately a plain constant, not a game setting: unlike characters, ships have no GM-facing
 * tier editor (daggerheart's `levelupOptionsDialog`) and nothing to homebrew against yet. If that
 * changes, this object is the shape a setting would register with.
 */

/**
 * Every level-up option a Spaceship can take, keyed the same way (and with the same ids) as
 * daggerheart's `LevelOptionType`, so a stored ship selection's `type` reads identically to a
 * character's for the five options they share.
 *
 * `dataPath`-style metadata from upstream is omitted: it exists there to drive generic code paths
 * this module doesn't have - `SpaceshipData#prepareBaseData` switches on `type` explicitly, the
 * same way daggerheart's own character `prepareBaseData` does.
 */
export const SHIP_LEVEL_OPTION_TYPES = {
  trait: "trait",
  hitPoint: "hitPoint",
  stress: "stress",
  evasion: "evasion",
  proficiency: "proficiency",
  /** Ship-only, replacing the character pool's `domainCard`/`experience`/`subclass`/`multiclass`. */
  systemPoints: "systemPoints",
} as const;

export type ShipLevelOptionType = (typeof SHIP_LEVEL_OPTION_TYPES)[keyof typeof SHIP_LEVEL_OPTION_TYPES];

/** The option types whose stored selection carries a `data` array (which traits were picked). */
export const SHIP_LEVEL_DATA_OPTION_TYPES: readonly ShipLevelOptionType[] = [SHIP_LEVEL_OPTION_TYPES.trait];

/** One row of a tier's option list - same fields as daggerheart's `DhLevelOption`. */
export interface ShipLevelOption {
  /** Localization key for the row's prose ("Permanently gain one HP slot."). */
  label: string;
  /** How many checkboxes the row shows across the whole tier. */
  checkboxSelections: number;
  /** How many of the level's available choices one tick costs (and how boxes are grouped). */
  minCost: number;
  type: ShipLevelOptionType;
  /** How much the stat moves per tick. Unused by `trait`, which moves `amount` traits by +1. */
  value?: number;
  /** How many sub-choices one tick asks for - `trait` picks this many distinct traits. */
  amount?: number;
}

/** One tier band - same fields as daggerheart's `DhLevelTier`, minus the character-only ones. */
export interface ShipLevelTier {
  tier: number;
  /** Localization key for the tier's legend. */
  name: string;
  levels: { start: number; end: number };
  /**
   * What entering the tier grants on its own, before any point-buy choice. Ships have no
   * Experiences, so daggerheart's `experience: {nr, modifier}` half of this drops out and only
   * the Proficiency bump remains (#12's "tier-entry behavior pattern ... adapted for ships").
   */
  initialAchievements: { proficiency: number };
  /** How many choices each level in the band buys. */
  availableOptions: number;
  options: Record<string, ShipLevelOption>;
}


/**
 * The three tier bands (2-4 / 5-7 / 8-10), keyed by tier number exactly as upstream keys its own.
 * Level 1 has no tier: a level-1 ship is the Frame's printed statline, entered by the GM.
 *
 * Option availability follows the character table: `proficiency` (the one two-cost option) only
 * appears from tier 3, everything else from tier 2. `systemPoints` takes the slot the character
 * table gives `experience` - two one-cost checkboxes, +1 point each.
 */
export const SHIP_LEVEL_TIERS: Record<string, ShipLevelTier> = {
  2: {
    tier: 2,
    name: "DHSCIFI.Spaceship.Levelup.tier2.name",
    levels: { start: 2, end: 4 },
    initialAchievements: { proficiency: 1 },
    availableOptions: 2,
    options: {
      trait: {
        label: "DHSCIFI.Spaceship.Levelup.options.trait",
        checkboxSelections: 3,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.trait,
        amount: 2,
      },
      hitPoint: {
        label: "DHSCIFI.Spaceship.Levelup.options.hitPoint",
        checkboxSelections: 2,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.hitPoint,
        value: 1,
      },
      stress: {
        label: "DHSCIFI.Spaceship.Levelup.options.stress",
        checkboxSelections: 2,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.stress,
        value: 1,
      },
      systemPoints: {
        label: "DHSCIFI.Spaceship.Levelup.options.systemPoints",
        checkboxSelections: 2,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.systemPoints,
        value: 1,
      },
      evasion: {
        label: "DHSCIFI.Spaceship.Levelup.options.evasion",
        checkboxSelections: 1,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.evasion,
        value: 1,
      },
    },
  },
  3: {
    tier: 3,
    name: "DHSCIFI.Spaceship.Levelup.tier3.name",
    levels: { start: 5, end: 7 },
    initialAchievements: { proficiency: 1 },
    availableOptions: 2,
    options: {
      trait: {
        label: "DHSCIFI.Spaceship.Levelup.options.trait",
        checkboxSelections: 3,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.trait,
        amount: 2,
      },
      hitPoint: {
        label: "DHSCIFI.Spaceship.Levelup.options.hitPoint",
        checkboxSelections: 2,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.hitPoint,
        value: 1,
      },
      stress: {
        label: "DHSCIFI.Spaceship.Levelup.options.stress",
        checkboxSelections: 2,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.stress,
        value: 1,
      },
      systemPoints: {
        label: "DHSCIFI.Spaceship.Levelup.options.systemPoints",
        checkboxSelections: 2,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.systemPoints,
        value: 1,
      },
      evasion: {
        label: "DHSCIFI.Spaceship.Levelup.options.evasion",
        checkboxSelections: 1,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.evasion,
        value: 1,
      },
      proficiency: {
        label: "DHSCIFI.Spaceship.Levelup.options.proficiency",
        checkboxSelections: 2,
        minCost: 2,
        type: SHIP_LEVEL_OPTION_TYPES.proficiency,
        value: 1,
      },
    },
  },
  4: {
    tier: 4,
    name: "DHSCIFI.Spaceship.Levelup.tier4.name",
    levels: { start: 8, end: 10 },
    initialAchievements: { proficiency: 1 },
    availableOptions: 2,
    options: {
      trait: {
        label: "DHSCIFI.Spaceship.Levelup.options.trait",
        checkboxSelections: 3,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.trait,
        amount: 2,
      },
      hitPoint: {
        label: "DHSCIFI.Spaceship.Levelup.options.hitPoint",
        checkboxSelections: 2,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.hitPoint,
        value: 1,
      },
      stress: {
        label: "DHSCIFI.Spaceship.Levelup.options.stress",
        checkboxSelections: 2,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.stress,
        value: 1,
      },
      systemPoints: {
        label: "DHSCIFI.Spaceship.Levelup.options.systemPoints",
        checkboxSelections: 2,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.systemPoints,
        value: 1,
      },
      evasion: {
        label: "DHSCIFI.Spaceship.Levelup.options.evasion",
        checkboxSelections: 1,
        minCost: 1,
        type: SHIP_LEVEL_OPTION_TYPES.evasion,
        value: 1,
      },
      proficiency: {
        label: "DHSCIFI.Spaceship.Levelup.options.proficiency",
        checkboxSelections: 2,
        minCost: 2,
        type: SHIP_LEVEL_OPTION_TYPES.proficiency,
        value: 1,
      },
    },
  },
};

/**
 * The highest level a ship can reach: the end of the last tier, derived rather than written down,
 * exactly as daggerheart's `updateLevel` derives its own cap from the `LevelTiers` setting.
 */
export const SPACESHIP_MAX_LEVEL = Object.values(SHIP_LEVEL_TIERS).reduce(
  (acc, tier) => Math.max(acc, tier.levels.end),
  1,
);

/** The tier a given level belongs to, or `null` for level 1 (which has no tier). */
export function shipTierForLevel(level: number): ShipLevelTier | null {
  return Object.values(SHIP_LEVEL_TIERS).find((tier) => level >= tier.levels.start && level <= tier.levels.end) ?? null;
}
