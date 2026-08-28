import { MODULE_ID } from "../../constants";
import SpaceshipSettings from "../settings/spaceship-settings";

const BaseSheet = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2);

/**
 * Minimal sheet for the `daggerheart-scifi-content.spaceship` Actor sub-type.
 *
 * Independent ApplicationV2 class - does not extend the `daggerheart` system's own sheet base
 * classes. See docs/adr/0002-spaceship-sheet-independent-application.md for why.
 */
// @ts-expect-error fvtt-types 13.346-beta cannot relate a subclass that overrides any inherited
// render method (`_prepareContext`/`_preparePartContext`) to the HandlebarsApplicationMixin
// base: the class-extends comparison overflows ("excessive stack depth") regardless of how the
// override is typed, even with `any` signatures. Members are still individually type-checked.
export default class SpaceshipActorSheet extends BaseSheet {
  static override DEFAULT_OPTIONS = {
    // `daggerheart`/`dh-style` are the system's own generic, world-global CSS marker classes
    // (its stylesheet themes any element carrying them - gold window border, dark backdrop,
    // `--color-border`/`--color-text-emphatic` tokens - regardless of actor type; see
    // docs/adr/0002-spaceship-sheet-independent-application.md). Adding them here only opts
    // this independent ApplicationV2 into that public theming, it doesn't subclass anything.
    classes: [MODULE_ID, "spaceship-sheet", "daggerheart", "dh-style"],
    // Wide enough for the sidebar (220px) + all six trait boxes on one row, matching the
    // official character sheet's proportions instead of wrapping them into extra rows.
    position: {
      width: 760,
      height: 700,
    },
    form: {
      submitOnChange: true,
    },
    actions: {
      editImage: SpaceshipActorSheet.#onEditImage,
      toggleTraitTier: SpaceshipActorSheet.#onToggleTraitTier,
      toggleHope: SpaceshipActorSheet.#onToggleResourceBox,
      toggleHitPoints: SpaceshipActorSheet.#onToggleResourceBox,
      toggleStress: SpaceshipActorSheet.#onToggleResourceBox,
      openSettings: SpaceshipActorSheet.#onOpenSettings,
    },
  };

  // Same part split as the official character sheet (sidebar / header / one part per tab);
  // our SCSS places them on the same window-content grid the official sheet uses. The four
  // tab parts share one placeholder template until tickets #6-#12 build them for real.
  static override PARTS = {
    sidebar: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/sidebar.hbs`,
    },
    header: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/header.hbs`,
    },
    features: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/tab-placeholder.hbs`,
    },
    inventory: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/tab-placeholder.hbs`,
    },
    stations: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/tab-placeholder.hbs`,
    },
    effects: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/tab-placeholder.hbs`,
    },
  };

  // `cssClass` is filled in at runtime by `_prepareTabs`; the empty string only satisfies
  // fvtt-types' (stricter-than-runtime) TabsConfiguration shape.
  static override TABS: Record<string, foundry.applications.api.ApplicationV2.TabsConfiguration> = {
    primary: {
      tabs: [
        { id: "features", cssClass: "" },
        { id: "inventory", cssClass: "" },
        { id: "stations", cssClass: "" },
        { id: "effects", cssClass: "" },
      ],
      initial: "features",
      labelPrefix: "DHSCIFI.Spaceship.Tabs",
    },
  };

  // Both render-method overrides take/return `any`: typing them with fvtt-types'
  // RenderContext/RenderOptions shapes (concrete or `...Of<this>`) adds member-level TS2416
  // mismatches on top of the class-level stack-depth failure suppressed above.
  protected override async _prepareContext(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const context = await super._prepareContext(options);
    return Object.assign(context, { tabs: this._prepareTabs("primary") });
  }

  /** Expose the part's own tab entry as `tab` for the shared tab-placeholder template. */
  protected override async _preparePartContext(
    partId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    await super._preparePartContext(partId, context, options);
    const withTabs = context as {
      tabs?: Record<string, foundry.applications.api.ApplicationV2.Tab>;
      tab?: foundry.applications.api.ApplicationV2.Tab;
    };
    if (withTabs.tabs && partId in withTabs.tabs) withTabs.tab = withTabs.tabs[partId];
    return context;
  }

  /**
   * Open a FilePicker to change the actor's portrait, mirroring core Foundry's own
   * `editImage` action convention.
   */
  static async #onEditImage(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    if (!(target instanceof HTMLImageElement)) return;

    const attribute = target.dataset.edit;
    if (!attribute) return;

    const current = foundry.utils.getProperty(this.document, attribute) as string;
    const fp = new foundry.applications.apps.FilePicker.implementation({
      current,
      type: "image",
      callback: (path: string) => {
        void this.document.update({ [attribute]: path });
      },
    });
    await fp.browse();
  }

  /**
   * Toggle a trait's `tierMarked` flag, from `data-trait="agility"` etc. on the tier-mark box.
   */
  static async #onToggleTraitTier(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const trait = target.dataset.trait;
    if (!trait) return;

    const path = `system.traits.${trait}.tierMarked`;
    const current = foundry.utils.getProperty(this.document, path) as boolean;
    await this.document.update({ [path]: !current });
  }

  /** Open the "Configure Spaceship" dialog for this actor (wrench button in the tab bar). */
  static async #onOpenSettings(this: foundry.applications.sheets.ActorSheetV2.Any): Promise<void> {
    await new SpaceshipSettings({ document: this.document as Actor.Implementation }).render({ force: true });
  }

  /**
   * Toggle a markable resource box (Hope/HP/Stress), mirroring the `daggerheart` character
   * sheet's click pattern: clicking a box sets the resource's value to that box's 1-based
   * index, unless the value is already at/above it, in which case it steps back down to
   * `index - 1`. `data-resource` names the resource key (`hope`/`hitPoints`/`stress`),
   * `data-value` the clicked box's 1-based index.
   */
  static async #onToggleResourceBox(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const resource = target.dataset.resource;
    const boxValue = Number.parseInt(target.dataset.value ?? "", 10);
    if (!resource || Number.isNaN(boxValue)) return;

    const path = `system.resources.${resource}.value`;
    const current = foundry.utils.getProperty(this.document, path) as number;
    const newValue = current >= boxValue ? boxValue - 1 : boxValue;
    await this.document.update({ [path]: newValue });
  }
}
