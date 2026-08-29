import { MODULE_ID } from "../../constants";
import type SpaceshipData from "../../data/actors/spaceship-data";
import SpaceshipLevelupState, { type RenderedTier, type RenderedTrait } from "./spaceship-levelup-state";

const BaseApp = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

/** One "old → new" line on the Summary tab: the sentence naming the old value, and the new one. */
interface SummaryRow {
  text: string;
  new: number;
}

/**
 * The Spaceship level-up wizard (#12).
 *
 * An independent `ApplicationV2` rather than a subclass of daggerheart's `DhlevelUp`, for the same
 * reason the ship sheet is independent of its sheet classes
 * (docs/adr/0002-spaceship-sheet-independent-application.md): the system's wizard is welded to
 * `DhLevelData` and to character-only option types - it drag-drops domain cards, fetches
 * subclasses, writes Experiences, and hands off to a companion level-up on save. What it *does*
 * share is its shape and its markup: same three parts (advancements / selections / summary), same
 * per-level point-buy budget, same tier grid, and the templates under
 * templates/actors/spaceship/levelup/ are copies of its own with the same class names, so the
 * system's `.daggerheart.levelup` stylesheet themes this window unchanged.
 *
 * Nothing is written to the actor until "Finish Level Up": the run lives in `SpaceshipLevelupState`
 * and lands in one `applyLevelUp` call.
 */
export default class SpaceshipLevelup extends BaseApp {
  readonly actor: Actor.Implementation;
  // Named `levelup`, as daggerheart names its own - `state` is taken by ApplicationV2's own
  // render-state accessor.
  readonly levelup: SpaceshipLevelupState;

  constructor(actor: Actor.Implementation) {
    super({});
    this.actor = actor;
    this.levelup = new SpaceshipLevelupState(this.system);
    this.tabGroups.primary = "advancements";
  }

  /** The ship's DataModel. Cast for the same reason `SpaceshipActorSheet` casts its document. */
  get system(): SpaceshipData {
    return this.actor.system as unknown as SpaceshipData;
  }

  override get title(): string {
    return game.i18n!.format("DHSCIFI.Spaceship.Levelup.title", { actor: this.actor.name });
  }

  static override DEFAULT_OPTIONS = {
    tag: "form",
    // `daggerheart`/`dh-style`/`dialog`/`levelup` are the system's world-global CSS marker classes;
    // `levelup` is the one that brings in the tier grid and summary styling this window is built
    // from. Same borrow-by-marker-class as the sheet and settings dialog.
    classes: [MODULE_ID, "spaceship-levelup", "daggerheart", "dialog", "dh-style", "levelup"],
    position: { width: 1000, height: "auto" as const },
    window: {
      resizable: true,
      icon: "fa-solid fa-arrow-turn-up",
    },
    actions: {
      save: SpaceshipLevelup.#onSave,
      updateCurrentLevel: SpaceshipLevelup.#onUpdateCurrentLevel,
      activatePart: SpaceshipLevelup.#onActivatePart,
      toggleTrait: SpaceshipLevelup.#onToggleTrait,
    },
  };

  static override PARTS = {
    tabs: { template: `modules/${MODULE_ID}/templates/actors/spaceship/levelup/tab-navigation.hbs` },
    advancements: { template: `modules/${MODULE_ID}/templates/actors/spaceship/levelup/advancements.hbs` },
    selections: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/levelup/selections.hbs`,
      scrollable: [".levelup-selections-container"],
    },
    summary: { template: `modules/${MODULE_ID}/templates/actors/spaceship/levelup/summary.hbs` },
    footer: { template: `modules/${MODULE_ID}/templates/actors/spaceship/levelup/footer.hbs` },
  };

  // `cssClass` is filled in at runtime by `_prepareTabs`; the empty string only satisfies
  // fvtt-types' (stricter-than-runtime) TabsConfiguration shape. Same as the sheet's.
  static override TABS: Record<string, foundry.applications.api.ApplicationV2.TabsConfiguration> = {
    primary: {
      tabs: [
        { id: "advancements", cssClass: "" },
        { id: "selections", cssClass: "" },
        { id: "summary", cssClass: "" },
      ],
      initial: "advancements",
      labelPrefix: "DHSCIFI.Spaceship.Levelup.Tabs",
    },
  };

  /**
   * Shared context: the tab bar, and the footer's two navigation buttons.
   *
   * `navigate` is built here rather than in the `tabs` part the way upstream does it - there, the
   * footer template reads a key an *earlier* part happened to leave on the shared context, which
   * only works because parts render in declaration order.
   */
  // Both render-method overrides take/return `any`, as on the sheet: fvtt-types' RenderContext
  // shapes add member-level mismatches on top of the class-level suppression above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async _prepareContext(options: any): Promise<any> {
    const context = await super._prepareContext(options);
    const state = this.levelup;
    const tabs = this._prepareTabs("primary") as Record<
      string,
      foundry.applications.api.ApplicationV2.Tab & { progress?: { selected: number; max: number } }
    >;

    const previous = state.currentLevel === state.startLevel ? null : state.currentLevel - 1;
    const next = state.currentLevel === state.endLevel ? null : state.currentLevel + 1;
    const onSummary = this.tabGroups.primary === "summary";
    const { selections } = state.nrSelections;

    tabs.advancements.progress = { selected: selections, max: state.current.maxSelections };

    return Object.assign(context, {
      tabs,
      navTabs: Object.values(tabs).filter((tab) => tab.id !== "summary"),
      navigate: {
        previous: {
          disabled: previous === null,
          label: previous === null ? "" : game.i18n!.format("DHSCIFI.Spaceship.Levelup.navigateLevel", { level: String(previous) }),
          fromSummary: onSummary,
        },
        next: {
          disabled: !state.currentLevelFinished,
          label: next === null ? "" : game.i18n!.format("DHSCIFI.Spaceship.Levelup.navigateLevel", { level: String(next) }),
          toSummary: next === null,
          show: !onSummary,
        },
      },
      allLevelsFinished: state.allLevelsFinished,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async _preparePartContext(partId: string, context: any, options: any): Promise<any> {
    await super._preparePartContext(partId, context, options);

    if (partId === "advancements") {
      Object.assign(context, { tiers: this.levelup.tiersForRendering satisfies RenderedTier[] });
    }
    if (partId === "selections") {
      const progress = this.levelup.traitProgress;
      Object.assign(context, {
        traits: { ...progress, progress, values: this.levelup.renderedTraits satisfies RenderedTrait[] },
      });
    }
    if (partId === "summary") {
      Object.assign(context, this.#buildSummaryContext());
    }
    return context;
  }

  /**
   * The Summary tab's two halves.
   *
   * Achievements first, advancements on top of them - the same layering as upstream, so
   * Proficiency's "old" on the advancements side is the value the tier bump already moved it to.
   * Damage thresholds appear under achievements because they follow from level alone
   * (`SpaceshipData#prepareBaseData`), not from anything chosen here.
   */
  #buildSummaryContext(): {
    achievements: {
      proficiency: SummaryRow | null;
      unshielded: boolean;
      damageThresholds: SummaryRow[];
    };
    statistics: SummaryRow[];
    traitRows: SummaryRow[];
  } {
    const system = this.system;
    const state = this.levelup;
    const advancements = state.advancements;
    const thresholdsNow = system.damageThresholdsAtLevel(system.level);
    const thresholdsAfter = system.damageThresholdsAtLevel(state.endLevel);
    const format = (key: string, value: number) =>
      game.i18n!.format(`DHSCIFI.Spaceship.Levelup.summary.${key}`, { value: String(value) });

    const achievedProficiency = state.achievedProficiency;
    const proficiencyAfterAchievements = system.proficiency + achievedProficiency;

    // One row per stat the pool can move, in sheet-reading order. A table rather than five
    // `addRow(...)` calls so a seventh option can never be added to `SHIP_LEVEL_TIERS` and totalled
    // by `SpaceshipLevelupState` while quietly missing from this summary.
    const statRows: { key: string; old: number; gain: number }[] = [
      { key: "proficiencyIncrease", old: proficiencyAfterAchievements, gain: advancements.proficiency },
      { key: "hpIncrease", old: system.resources.hitPoints.max, gain: advancements.hitPoints },
      { key: "stressIncrease", old: system.resources.stress.max, gain: advancements.stress },
      { key: "evasionIncrease", old: system.evasion, gain: advancements.evasion },
      { key: "systemPointsIncrease", old: system.systemPoints, gain: advancements.systemPoints },
    ];
    const rows: SummaryRow[] = statRows
      .filter((row) => row.gain > 0)
      .map((row) => ({ text: format(row.key, row.old), new: row.old + row.gain }));

    const traits = system.traits as unknown as Record<string, { value: number }>;
    const traitRows = Object.entries(advancements.traits).map(([traitKey, gain]) => ({
      text: `${game.i18n!.localize(`DHSCIFI.Spaceship.Traits.${traitKey}`)}: ${traits[traitKey].value}`,
      new: traits[traitKey].value + gain,
    }));

    return {
      achievements: {
        proficiency: achievedProficiency
          ? { text: format("proficiencyIncrease", system.proficiency), new: proficiencyAfterAchievements }
          : null,
        // A ship with no Shield gains double level on severe, so the summary has to say which
        // rule the numbers below came from - same note upstream shows.
        unshielded: !system.armor,
        // Both ends come from the model's own projection rather than from a delta computed here:
        // the severe rule has three inputs (armor, an `armor`-typed threshold effect, level) and
        // restating any of them is how the summary and the sheet drift apart.
        damageThresholds: [
          {
            text: format("damageThresholdMajorIncrease", thresholdsNow.major),
            new: thresholdsAfter.major,
          },
          {
            text: format("damageThresholdSevereIncrease", thresholdsNow.severe),
            new: thresholdsAfter.severe,
          },
        ],
      },
      statistics: rows,
      traitRows,
    };
  }

  /**
   * The tier grid's checkboxes are plain inputs, not `data-action` buttons: an action fires on
   * click, which would also fire for a box the browser refuses to toggle. Binding `change` means
   * the handler only ever sees a box that actually flipped.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override _attachPartListeners(partId: string, htmlElement: HTMLElement, options: any): void {
    super._attachPartListeners(partId, htmlElement, options);
    for (const element of htmlElement.querySelectorAll<HTMLInputElement>(".selection-checkbox")) {
      element.addEventListener("change", this.#onSelectionChange.bind(this));
    }
  }

  /** Tick or untick one option checkbox for the level being decided. */
  #onSelectionChange(event: Event): void {
    event.stopPropagation();
    const input = event.currentTarget as HTMLInputElement;
    const { tier, option, checkboxNr } = input.dataset;
    if (!tier || !option || !checkboxNr) return;

    if (!input.checked) {
      this.levelup.deselect(option, Number(checkboxNr));
    } else if (!this.levelup.select(option, Number(checkboxNr), tier)) {
      ui.notifications?.info(game.i18n!.localize("DHSCIFI.Spaceship.Levelup.insufficientAdvancements"));
    }
    void this.render();
  }

  /** Pick or unpick one trait for a `trait` tick taken at the current level. */
  static #onToggleTrait(this: SpaceshipLevelup, _event: Event, target: HTMLElement): void {
    const traitKey = target.dataset.trait;
    if (!traitKey) return;
    if (!this.levelup.toggleTrait(traitKey)) {
      ui.notifications?.info(game.i18n!.localize("DHSCIFI.Spaceship.Levelup.noSelectionsLeft"));
      return;
    }
    void this.render();
  }

  /**
   * Step between the levels of the run. Going back discards the level being left - confirmed
   * first, same warning as daggerheart's own.
   */
  static async #onUpdateCurrentLevel(this: SpaceshipLevelup, _event: Event, target: HTMLElement): Promise<void> {
    if (target.dataset.forward) {
      this.levelup.advanceLevel();
    } else {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n!.localize("DHSCIFI.Spaceship.Levelup.delevel.title") },
        content: `<p>${game.i18n!.localize("DHSCIFI.Spaceship.Levelup.delevel.content")}</p>`,
      });
      if (!confirmed) return;
      this.levelup.retreatLevel();
    }

    this.tabGroups.primary = "advancements";
    void this.render();
  }

  /** Jump straight to a part (the footer's "To Summary" / "Return To Levelup" buttons). */
  static #onActivatePart(this: SpaceshipLevelup, _event: Event, target: HTMLElement): void {
    const part = target.dataset.part;
    if (!part) return;
    this.tabGroups.primary = part;
    void this.render();
  }

  /** Commit the run to the actor and close. */
  static async #onSave(this: SpaceshipLevelup, _event: Event, target: HTMLElement): Promise<void> {
    (target as HTMLButtonElement).disabled = true;
    await this.system.applyLevelUp(this.levelup.endLevel, this.levelup.toStored());
    this.actor.sheet?.render();
    await this.close();
  }
}
