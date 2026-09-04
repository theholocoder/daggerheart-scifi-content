import {
  SHIP_LEVEL_OPTION_TYPES,
  SHIP_LEVEL_TIERS,
  type ShipLevelOption,
  type ShipLevelOptionType,
} from "../../config/spaceship-level-tiers";
import { TRAIT_KEYS } from "../../constants";
import type SpaceshipData from "../../data/actors/spaceship-data";
import type { ShipLevelSelection, ShipLevelup } from "../../data/actors/spaceship-data";

/** One level being walked: how many choices it buys, what it grants, and what has been ticked. */
interface LevelupLevel {
  maxSelections: number;
  achievements: { proficiency: number };
  /**
   * `choices[optionKey][checkboxNr]` - the same two-level nesting daggerheart's wizard uses. A
   * ticked checkbox is already exactly what gets stored, so these are `ShipLevelSelection`s from
   * the moment they are made rather than a wizard-local shape converted on save.
   */
  choices: Record<string, Record<number, ShipLevelSelection>>;
}

/** One tier as the wizard renders it: its legend, the levels it covers, and its option rows. */
interface LevelupTier {
  name: string;
  belongingLevels: number[];
  options: Record<string, ShipLevelOption>;
}

/** One checkbox in the advancements grid. */
export interface RenderedCheckbox extends ShipLevelOption {
  tier: string;
  option: string;
  checkboxNr: number;
  selected: boolean;
  disabled: boolean;
}

/** One option row: its prose label and its checkboxes, grouped `minCost` at a time. */
export interface RenderedGroup {
  label: string;
  checkboxGroups: { multi: boolean; checkboxes: RenderedCheckbox[] }[];
}

export interface RenderedTier {
  name: string;
  active: boolean;
  groups: RenderedGroup[];
}

/** One trait chip on the Selections tab. */
export interface RenderedTrait {
  key: string;
  label: string;
  selected: boolean;
  disabled: boolean;
}

/**
 * Split `list` into runs of `size`, mapping each run through `transform` - daggerheart's own
 * `chunkify` helper, copied by value (docs/adr/0002-spaceship-sheet-independent-application.md):
 * it is what makes a two-cost option render as one bordered pair of checkboxes rather than two
 * independent ones.
 */
function chunkify<T, R>(list: T[], size: number, transform: (chunk: T[]) => R): R[] {
  const chunks: R[] = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(transform(list.slice(index, index + size)));
  }
  return chunks;
}

/**
 * The same tier grid the wizard renders, built straight from a ship's stored history and entirely
 * read-only (#12) - what the sheet's "review past level-ups" control shows. Daggerheart's
 * `DhlevelUpViewMode` builds its equivalent the same way, off `levelData.levelups` rather than off
 * a live wizard state.
 */
export function renderStoredTiers(levelups: Record<string, ShipLevelup>): RenderedTier[] {
  const selectedBoxes = new Set<string>();
  for (const levelup of Object.values(levelups)) {
    for (const selection of levelup.selections) {
      selectedBoxes.add(`${selection.tier}.${selection.optionKey}.${selection.checkboxNr}`);
    }
  }

  return Object.entries(SHIP_LEVEL_TIERS).map(([tierKey, tier]) => ({
    name: game.i18n!.localize(tier.name),
    active: true,
    groups: Object.entries(tier.options).map(([optionKey, option]) => ({
      label: game.i18n!.localize(option.label),
      checkboxGroups: chunkify(
        Array.from({ length: option.checkboxSelections }, (_, index) => ({
          ...option,
          tier: tierKey,
          option: optionKey,
          checkboxNr: index + 1,
          selected: selectedBoxes.has(`${tierKey}.${optionKey}.${index + 1}`),
          disabled: true,
        })),
        option.minCost,
        (chunk) => ({
          multi: option.minCost > 1,
          checkboxes: chunk.map((box) => ({ ...box, selected: chunk.some((other) => other.selected) })),
        }),
      ),
    })),
  }));
}

/**
 * The in-memory state of one run of the Spaceship level-up wizard (#12) - everything the player
 * has ticked but not yet committed to the actor.
 *
 * Structurally daggerheart's `DhLevelup`: same `tiers`/`levels`/`startLevel`/`currentLevel`/
 * `endLevel` shape, same `choices[optionKey][checkboxNr]` nesting, same
 * `tiersForRendering`/`currentLevelFinished`/`allLevelsFinished` surface. Two deliberate
 * differences:
 *
 * - It is a plain class, not a `foundry.abstract.DataModel`. Upstream needs one because its
 *   application mutates state through `updateSource` with dotted paths built in the template
 *   (`levels.3.choices.trait.1.data`) - a generic path indirection that exists to serve options
 *   this pool doesn't have. With six options and one sub-choice (which traits), named mutators
 *   (`select`/`deselect`/`toggleTrait`) say the same thing and stay type-checked.
 * - There is no `unmarkedTraits`-by-deletion or `classUpgradeChoices`: no domains, subclasses or
 *   multiclassing on a ship.
 *
 * The tier table it walks is this module's own (`SHIP_LEVEL_TIERS`), not the system's `LevelTiers`
 * world setting - see that file for why.
 */
export default class SpaceshipLevelupState {
  readonly tiers: Record<string, LevelupTier> = {};
  readonly levels: Record<number, LevelupLevel> = {};
  readonly startLevel: number;
  readonly endLevel: number;
  currentLevel: number;

  /**
   * Build the state for the ship's pending level-up: the levels from the one after its current
   * level up to its target, plus - read-only - the already-taken levels of the tiers those fall
   * in, so their ticks show up in the grid where the tier's checkbox budget was actually spent.
   */
  constructor(system: SpaceshipData) {
    this.startLevel = system.level + 1;
    this.endLevel = system.levelData.changed;
    this.currentLevel = this.startLevel;

    const stored = system.levelups;
    for (const [tierKey, tier] of Object.entries(SHIP_LEVEL_TIERS)) {
      const belongingLevels: number[] = [];
      for (let level = tier.levels.start; level <= tier.levels.end; level++) {
        belongingLevels.push(level);
        if (level > this.endLevel) continue;

        const storedLevel = stored[String(level)];
        this.levels[level] = {
          maxSelections: tier.availableOptions,
          achievements: {
            proficiency:
              storedLevel?.achievements.proficiency ??
              (level === tier.levels.start ? tier.initialAchievements.proficiency : 0),
          },
          choices: (storedLevel?.selections ?? []).reduce<LevelupLevel["choices"]>((acc, selection) => {
            acc[selection.optionKey] ??= {};
            acc[selection.optionKey][selection.checkboxNr] = { ...selection, data: [...selection.data] };
            return acc;
          }, {}),
        };
      }

      this.tiers[tierKey] = { name: tier.name, belongingLevels, options: tier.options };
    }
  }

  /** The level currently being decided. */
  get current(): LevelupLevel {
    return this.levels[this.currentLevel];
  }

  /** The tier key the current level falls in. Always set: level 1 is never walked by the wizard. */
  get currentTierKey(): string {
    return (
      Object.keys(this.tiers).find((key) => this.tiers[key].belongingLevels.includes(this.currentLevel)) ??
      Object.keys(this.tiers)[0]
    );
  }

  /** How many of the current level's choices are spent, and how many are left. */
  get nrSelections(): { selections: number; available: number } {
    const selections = Object.values(this.current.choices).reduce(
      (acc, choice) => acc + Object.values(choice).reduce((sum, checkbox) => sum + (checkbox.minCost ?? 1), 0),
      0,
    );
    return { selections, available: this.current.maxSelections - selections };
  }

  /**
   * Is the current level fully decided? Its budget spent, and every tick that asks for
   * sub-choices given them - the `data.length === amount` half of daggerheart's `#levelFinished`,
   * which for ships only ever concerns `trait`.
   */
  get currentLevelFinished(): boolean {
    if (this.nrSelections.available !== 0) return false;
    return Object.values(this.current.choices).every((choice) =>
      Object.values(choice).every((checkbox) => checkbox.data.length === (checkbox.amount ?? checkbox.data.length)),
    );
  }

  /** Are all the levels this run covers decided? Gates the "Finish Level Up" button. */
  get allLevelsFinished(): boolean {
    const previousLevel = this.currentLevel;
    try {
      return Object.keys(this.levels)
        .map(Number)
        .filter((level) => level >= this.startLevel)
        .every((level) => {
          this.currentLevel = level;
          return this.currentLevelFinished;
        });
    } finally {
      this.currentLevel = previousLevel;
    }
  }

  /**
   * Tick a checkbox for the current level, if its cost fits in what is left of the level's budget.
   * Returns false when it doesn't, so the caller can say so.
   */
  select(optionKey: string, checkboxNr: number, tierKey: string): boolean {
    const option = this.tiers[tierKey].options[optionKey];
    if (this.nrSelections.available < option.minCost) return false;

    this.current.choices[optionKey] ??= {};
    this.current.choices[optionKey][checkboxNr] = {
      tier: Number(tierKey),
      level: this.currentLevel,
      optionKey,
      checkboxNr,
      type: option.type,
      value: option.value ?? null,
      minCost: option.minCost,
      amount: option.amount ?? null,
      data: [],
    };
    return true;
  }

  /**
   * Untick a checkbox at the current level. A multi-box (two-cost) option is dropped whole - the
   * boxes of one group are a single choice, exactly as upstream's `selectionClick` treats them.
   */
  deselect(optionKey: string, checkboxNr: number): void {
    const choice = this.current.choices[optionKey];
    if (!choice) return;

    const isMultiCost = (choice[checkboxNr]?.minCost ?? 1) > 1;
    if (isMultiCost || Object.keys(choice).length === 1) {
      delete this.current.choices[optionKey];
    } else {
      delete choice[checkboxNr];
    }
  }

  /** Every trait tick taken at the current level, in checkbox order. */
  #currentTraitChoices(): ShipLevelSelection[] {
    return Object.values(this.current.choices[SHIP_LEVEL_OPTION_TYPES.trait] ?? {});
  }

  /** How many traits the current level's trait ticks ask for, and how many are picked so far. */
  get traitProgress(): { selected: number; max: number; active: boolean } {
    const choices = this.#currentTraitChoices();
    return {
      selected: choices.reduce((acc, choice) => acc + choice.data.length, 0),
      max: choices.reduce((acc, choice) => acc + (choice.amount ?? 0), 0),
      active: choices.length > 0,
    };
  }

  /**
   * The six traits as selectable chips.
   *
   * A trait already raised at another level *of the same tier* is out of reach - the "two unmarked
   * traits" rule, which upstream enforces by deleting those keys from its tagify whitelist. Once
   * the level's trait picks are full, the unpicked ones grey out rather than silently no-op.
   */
  get renderedTraits(): RenderedTrait[] {
    const tierLevels = this.tiers[this.currentTierKey].belongingLevels;
    const takenElsewhere = new Set<string>();
    for (const level of tierLevels) {
      if (level === this.currentLevel) continue;
      for (const choice of Object.values(this.levels[level]?.choices[SHIP_LEVEL_OPTION_TYPES.trait] ?? {})) {
        for (const traitKey of choice.data) takenElsewhere.add(traitKey);
      }
    }

    const picked = new Set(this.#currentTraitChoices().flatMap((choice) => choice.data));
    const progress = this.traitProgress;
    return TRAIT_KEYS.map((key) => ({
      key,
      label: `DHSCIFI.Spaceship.Traits.${key}`,
      selected: picked.has(key),
      disabled: takenElsewhere.has(key) || (!picked.has(key) && progress.selected >= progress.max),
    }));
  }

  /**
   * Pick or unpick a trait for the current level, spreading picks across the level's trait ticks -
   * the first one with room takes it, the one holding it gives it back. Returns false when there
   * is nowhere to put it.
   */
  toggleTrait(traitKey: string): boolean {
    const choices = this.#currentTraitChoices();
    const holder = choices.find((choice) => choice.data.includes(traitKey));
    if (holder) {
      holder.data = holder.data.filter((key) => key !== traitKey);
      return true;
    }

    const target = choices.find((choice) => choice.data.length < (choice.amount ?? 0));
    if (!target) return false;
    target.data = [...target.data, traitKey];
    return true;
  }

  /** Step to the next level of the run. */
  advanceLevel(): void {
    this.currentLevel = Math.min(this.currentLevel + 1, this.endLevel);
  }

  /**
   * Step back a level, discarding what was ticked for the level being left - the same destructive
   * "go back" daggerheart's `updateCurrentLevel` performs (and warns about) on its way back.
   */
  retreatLevel(): void {
    this.levels[this.currentLevel].choices = {};
    this.currentLevel = Math.max(this.currentLevel - 1, this.startLevel);
  }

  /**
   * The advancements grid: every tier, every option row, every checkbox with its selected/disabled
   * state. Copy by value of daggerheart's `tiersForRendering`, minus its multiclass/subclass
   * cross-out rules (no such options here) and its domain-card label interpolation.
   *
   * A checkbox ticked at a level other than the current one renders ticked but disabled: it is
   * part of the tier's spent budget and only the level that spent it can give it back.
   */
  get tiersForRendering(): RenderedTier[] {
    return Object.keys(this.tiers).map((tierKey) => {
      const tier = this.tiers[tierKey];
      return {
        name: game.i18n!.localize(tier.name),
        active: this.currentLevel >= Math.min(...tier.belongingLevels),
        groups: Object.keys(tier.options).map((optionKey) => {
          const option = tier.options[optionKey];
          const checkboxes = Array.from({ length: option.checkboxSelections }, (_, index) => {
            const checkboxNr = index + 1;
            const selectedAt = tier.belongingLevels.find(
              (level) => this.levels[level]?.choices[optionKey]?.[checkboxNr] !== undefined,
            );
            return {
              ...option,
              tier: tierKey,
              option: optionKey,
              checkboxNr,
              selected: selectedAt !== undefined,
              disabled: selectedAt !== undefined && selectedAt !== this.currentLevel,
            };
          });

          return {
            label: game.i18n!.localize(option.label),
            checkboxGroups: chunkify(checkboxes, option.minCost, (chunk) => {
              const anySelected = chunk.some((box) => box.selected);
              const anyDisabled = chunk.some((box) => box.disabled);
              return {
                multi: option.minCost > 1,
                checkboxes: chunk.map((box) => ({ ...box, selected: anySelected, disabled: anyDisabled })),
              };
            }),
          };
        }),
      };
    });
  }

  /** Everything the run adds up to, by stat - what the Summary tab shows and the ship will gain. */
  get advancements(): {
    proficiency: number;
    hitPoints: number;
    stress: number;
    evasion: number;
    systemPoints: number;
    traits: Record<string, number>;
  } {
    const totals = { proficiency: 0, hitPoints: 0, stress: 0, evasion: 0, systemPoints: 0 };
    const traits: Record<string, number> = {};

    for (const [levelKey, level] of Object.entries(this.levels)) {
      if (Number(levelKey) < this.startLevel) continue;

      for (const choice of Object.values(level.choices)) {
        for (const checkbox of Object.values(choice)) {
          const value = checkbox.value ?? 0;
          switch (checkbox.type) {
            case SHIP_LEVEL_OPTION_TYPES.trait:
              for (const traitKey of checkbox.data) traits[traitKey] = (traits[traitKey] ?? 0) + 1;
              break;
            case SHIP_LEVEL_OPTION_TYPES.hitPoint:
              totals.hitPoints += value;
              break;
            case SHIP_LEVEL_OPTION_TYPES.stress:
              totals.stress += value;
              break;
            case SHIP_LEVEL_OPTION_TYPES.evasion:
              totals.evasion += value;
              break;
            case SHIP_LEVEL_OPTION_TYPES.proficiency:
              totals.proficiency += value;
              break;
            case SHIP_LEVEL_OPTION_TYPES.systemPoints:
              totals.systemPoints += value;
              break;
          }
        }
      }
    }

    return { ...totals, traits };
  }

  /** Proficiency granted by crossing tier boundaries in this run, before any point-buy choice. */
  get achievedProficiency(): number {
    return Object.entries(this.levels).reduce(
      (acc, [levelKey, level]) => (Number(levelKey) < this.startLevel ? acc : acc + level.achievements.proficiency),
      0,
    );
  }

  /**
   * The run, in the shape `SpaceshipData#applyLevelUp` stores: one record per level *taken*.
   * Levels below `startLevel` are the ship's existing history and are left where they are.
   */
  toStored(): Record<number, ShipLevelup> {
    const levelups: Record<number, ShipLevelup> = {};
    for (const [levelKey, level] of Object.entries(this.levels)) {
      if (Number(levelKey) < this.startLevel) continue;

      levelups[Number(levelKey)] = {
        achievements: { ...level.achievements },
        selections: Object.values(level.choices).flatMap((choice) =>
          Object.values(choice).map((checkbox) => ({ ...checkbox, data: [...checkbox.data] })),
        ),
      };
    }
    return levelups;
  }
}

/** Re-exported so templates and the application share one name for an option's id. */
export type { ShipLevelOptionType };
