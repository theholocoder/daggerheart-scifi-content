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
    classes: [MODULE_ID, "spaceship-sheet"],
    position: {
      width: 480,
    },
    form: {
      submitOnChange: true,
    },
    actions: {
      editImage: SpaceshipActorSheet.#onEditImage,
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
}
