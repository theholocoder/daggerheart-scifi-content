import {
  FEATURE_ITEM_TYPE,
  MODULE_ID,
  STATION_FLAG_KEY,
  STATION_IDS,
  isStationId,
  stationLabelKey,
  type StationId,
} from "../../constants";
import { deleteRowDocument } from "../sheets/document-rows";
import { splitStationActions, type PinnableItem } from "../../station-actions/membership";

const BaseSettings = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2);

/**
 * The parts of a Spaceship's owned Items this dialog renders and manipulates. Loose for the same
 * reason `SpaceshipActorSheet`'s `LooseDoc` is: fvtt-types knows nothing of daggerheart's `feature`
 * Item sub-type (docs/adr/0002-spaceship-sheet-independent-application.md). Structurally satisfies
 * `PinnableItem`, so the membership seam takes these as-is.
 */
interface LooseFeature extends PinnableItem {
  id: string;
  name: string;
  img: string | null;
  sheet?: { render: (options?: unknown) => unknown } | null;
  delete(): Promise<unknown>;
}

/** The parts of the Spaceship Actor this dialog reads and writes. */
interface LooseSpaceship {
  items: Iterable<LooseFeature> & { get(id: string): LooseFeature | undefined };
  createEmbeddedDocuments(type: "Item", data: Record<string, unknown>[]): Promise<LooseFeature[]>;
}

/** One Station's section of the dialog: its label and the actions pinned to it, in `sort` order. */
interface StationActionSection {
  id: StationId;
  label: string;
  actions: { id: string; name: string; img: string | null }[];
}

/**
 * "Configure Spaceship" dialog, mirroring the official Character Settings application
 * (`DHCharacterSettings`/`DHBaseActorSettings` in the `daggerheart` bundle): an `ActorSheetV2`
 * instantiated manually alongside the main sheet - not registered via `DocumentSheetConfig` -
 * with `submitOnChange` so every edit updates the actor immediately and the main sheet
 * re-renders. Two ActorSheetV2 instances on one actor coexist because `DocumentSheetV2`
 * namespaces the application id by class name.
 *
 * The `daggerheart`/`dh-style`/`dialog` marker classes opt into the system's public dialog
 * theming (`.application.daggerheart.dh-style.dialog` rules: `.dialog-header`, `.tab.details`,
 * `.traits-inner-container`, fieldsets), same borrow-by-marker-class approach as the main sheet
 * (docs/adr/0002-spaceship-sheet-independent-application.md).
 *
 * Since #23 it is also where a GM authors the ship's Station actions - one section per Station,
 * each creating/editing/deleting `feature` Items pinned to that Station. This is the whole
 * authoring surface for them: they are deliberately absent from the ship's Features tab, and the
 * Stations tab (#24) only presses them.
 */
// @ts-ignore Same fvtt-types class-comparison overflow, and the same `@ts-ignore`-not-
// `@ts-expect-error` reasoning, as `SpaceshipActorSheet` - see the comment on that class.
export default class SpaceshipSettings extends BaseSettings {
  static override DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "spaceship-settings", "daggerheart", "dh-style", "dialog"],
    window: {
      icon: "fa-solid fa-wrench",
      resizable: false,
      title: "DHSCIFI.Spaceship.Settings.title",
    },
    position: {
      width: 455,
      height: "auto" as const,
    },
    form: {
      submitOnChange: true,
    },
    actions: {
      createStationAction: SpaceshipSettings.#onCreateStationAction,
      editStationAction: SpaceshipSettings.#onEditStationAction,
      deleteStationAction: SpaceshipSettings.#onDeleteStationAction,
    },
  };

  static override PARTS = {
    header: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/settings/header.hbs`,
    },
    details: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/settings/details.hbs`,
    },
    stationActions: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/settings/station-actions.hbs`,
    },
  };

  // Unlike the official `DHBaseActorSettings` we keep core's `sheet` class on the frame:
  // the only `.sheet`-scoped system rules that could reach this dialog's markup set a CSS
  // variable or target item-sheet structures it doesn't contain, and removing the class needs
  // an override (`_initializeApplicationOptions`/`_renderFrame`) that trips fvtt-types'
  // deep class-comparison into an excessive-stack-depth error.

  /**
   * Adds the Station-actions sections to the shared context. `any` in and out for the same reason
   * `SpaceshipActorSheet`'s render overrides are: fvtt-types' RenderContext/RenderOptions shapes
   * add member-level TS2416 mismatches on top of the class-level suppression above.
   *
   * Every part shares one context here rather than this being a `_preparePartContext` branch -
   * there are only three parts and the other two need nothing of their own.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async _prepareContext(options: any): Promise<any> {
    const context = await super._prepareContext(options);
    const actor = this.document as unknown as LooseSpaceship;

    return Object.assign(context, {
      stationSections: SpaceshipSettings.#buildStationSections(actor),
    });
  }

  /**
   * One section per Station, in `STATION_IDS` order, whether or not it has any actions - an empty
   * Station is an empty section with just its Create control (#23).
   *
   * The split is the membership seam's, not this dialog's: the same call decides what the sheet's
   * Features tab leaves out (see `station-actions/membership.ts`).
   */
  static #buildStationSections(actor: LooseSpaceship): StationActionSection[] {
    const { byStation } = splitStationActions(actor.items, STATION_IDS);

    return STATION_IDS.map((id) => ({
      id,
      label: stationLabelKey(id),
      actions: byStation[id].map((item) => ({ id: item.id, name: item.name, img: item.img })),
    }));
  }

  /** The Station a clicked control belongs to, from the `data-station` on its enclosing section. */
  static #getStationId(target: HTMLElement): StationId | undefined {
    const id = target.closest<HTMLElement>("[data-station]")?.dataset.station;
    return id && isStationId(id) ? id : undefined;
  }

  /** The Station action a clicked row control belongs to, from its row's `data-item-id`. */
  static #getRowItem(target: HTMLElement, actor: LooseSpaceship): LooseFeature | undefined {
    const itemId = target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
    return itemId ? actor.items.get(itemId) : undefined;
  }

  /**
   * Create a blank Station action on the ship, pinned to the clicked section's Station, and open
   * its sheet so the GM lands on the feature's Actions tab and configures what it does (#23).
   *
   * The pin is written with the create, not afterwards: an item that exists for a moment without
   * one would flash into the ship's Features tab, and a failed follow-up write would strand it
   * there for good.
   *
   * The pin carries `id` and nothing else. #21's full flag shape also holds a `roller`, but that
   * is #25's - which owns the Roller select, and therefore also owns what a pin with no `roller`
   * on it means; writing a default here would be this ticket guessing that answer early.
   */
  static async #onCreateStationAction(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const stationId = SpaceshipSettings.#getStationId(target);
    if (!stationId) return;

    const actor = this.document as unknown as LooseSpaceship;
    // fvtt-types' `getDefaultArtwork` only accepts its strict, daggerheart-unaware `type` union
    // (the same gap the loose shapes above work around) - called through a loosened signature,
    // exactly as `SpaceshipActorSheet#onCreateItem` does.
    const getDefaultArtwork = CONFIG.Item.documentClass.getDefaultArtwork as (data: {
      type: string;
    }) => { img: string | null };
    const { img } = getDefaultArtwork({ type: FEATURE_ITEM_TYPE });

    const [created] = await actor.createEmbeddedDocuments("Item", [
      {
        type: FEATURE_ITEM_TYPE,
        name: game.i18n!.localize("DHSCIFI.Spaceship.StationActions.newAction"),
        img,
        flags: { [MODULE_ID]: { [STATION_FLAG_KEY]: { id: stationId } } },
      },
    ]);

    created?.sheet?.render(true);
  }

  /** Open a Station action's underlying `feature` sheet, from `data-item-id` on the clicked row. */
  static async #onEditStationAction(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const actor = this.document as unknown as LooseSpaceship;
    SpaceshipSettings.#getRowItem(target, actor)?.sheet?.render(true);
  }

  /**
   * Delete a Station action behind a confirmation, mirroring the Stations tab's crew-removal
   * confirm (#23) - the same `deleteRowDocument` helper every other list in this module deletes
   * through, with this list's own wording.
   */
  static async #onDeleteStationAction(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const actor = this.document as unknown as LooseSpaceship;
    const item = SpaceshipSettings.#getRowItem(target, actor);
    if (!item) return;

    await deleteRowDocument(
      item,
      "DHSCIFI.Spaceship.StationActions.Delete.title",
      "DHSCIFI.Spaceship.StationActions.Delete.body",
    );
  }
}
