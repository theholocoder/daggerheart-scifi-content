import { MODULE_ID } from "../../constants";

const BaseSheet = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2);

/**
 * Minimal sheet for the `daggerheart-scifi-content.spaceship` Actor sub-type.
 *
 * Independent ApplicationV2 class - does not extend the `daggerheart` system's own sheet base
 * classes. See docs/adr/0002-spaceship-sheet-independent-application.md for why.
 */
export default class SpaceshipActorSheet extends BaseSheet {
  static override DEFAULT_OPTIONS = {
    // `daggerheart`/`dh-style` are the system's own generic, world-global CSS marker classes
    // (its stylesheet themes any element carrying them - gold window border, dark backdrop,
    // `--color-border`/`--color-text-emphatic` tokens - regardless of actor type; see
    // docs/adr/0002-spaceship-sheet-independent-application.md). Adding them here only opts
    // this independent ApplicationV2 into that public theming, it doesn't subclass anything.
    classes: [MODULE_ID, "spaceship-sheet", "daggerheart", "dh-style"],
    // Wide enough for the sidebar (180px) + all six trait boxes on one row, matching the
    // official character sheet's proportions instead of wrapping them into extra rows.
    position: {
      width: 720,
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
    },
  };

  static override PARTS = {
    header: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/header.hbs`,
    },
  };

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
