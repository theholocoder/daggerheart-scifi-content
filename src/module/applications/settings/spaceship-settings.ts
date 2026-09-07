import {
  DEFAULT_ROLLER,
  FEATURE_ITEM_TYPE,
  MODULE_ID,
  ROLLERS,
  STATION_FLAG_KEY,
  STATION_IDS,
  isRoller,
  isStationId,
  rollerLabelKey,
  stationLabelKey,
  type Roller,
  type StationId,
} from "../../constants";
import { deleteRowDocument } from "../sheets/document-rows";
import { splitStationActions, stationRoller, type PinnableItem } from "../../station-actions/membership";

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
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

/** The parts of the Spaceship Actor this dialog reads and writes. */
interface LooseSpaceship {
  items: Iterable<LooseFeature> & { get(id: string): LooseFeature | undefined };
  createEmbeddedDocuments(type: "Item", data: Record<string, unknown>[]): Promise<LooseFeature[]>;
}

/**
 * The parts of a dropped Item this dialog needs (#26). Loose for the same reason the two shapes
 * above are - the dropped document is a daggerheart `feature`, a sub-type fvtt-types has no
 * knowledge of (docs/adr/0002).
 *
 * `parent` is the Actor or Item the drop came off, `null` for a world or compendium item; it is
 * how a feature already owned by *this* ship is told apart from a foreign copy.
 */
interface LooseDroppedItem {
  id: string;
  type: string;
  inCompendium: boolean;
  parent?: { uuid: string } | null;
  toObject(): Record<string, unknown>;
}

/**
 * One Station action's Roller select option: the stored value, its localization key, and whether
 * it is the row's current Roller.
 *
 * Built here rather than in the template because this module registers only its own Handlebars
 * helpers (docs/adr/0002) and has no `selectOptions`/`eq` to compare against a bound value with.
 */
interface RollerOptionRow {
  value: Roller;
  label: string;
  selected: boolean;
}

/** One Station's section of the dialog: its label and the actions pinned to it, in `sort` order. */
interface StationActionSection {
  id: StationId;
  label: string;
  actions: { id: string; name: string; img: string | null; rollerOptions: RollerOptionRow[] }[];
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
 * each creating/editing/deleting `feature` Items pinned to that Station, and since #25 setting each
 * one's Roller. This is the whole authoring surface for them: they are deliberately absent from the
 * ship's Features tab, and the Stations tab (#24) only presses them.
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
      actions: byStation[id].map((item) => ({
        id: item.id,
        name: item.name,
        img: item.img,
        rollerOptions: SpaceshipSettings.#buildRollerOptions(stationRoller(item)),
      })),
    }));
  }

  /** The Roller select's three options, with `current` marked - see `RollerOptionRow`. */
  static #buildRollerOptions(current: Roller): RollerOptionRow[] {
    return ROLLERS.map((roller) => ({
      value: roller,
      label: rollerLabelKey(roller),
      selected: roller === current,
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
   * The pin carries both halves of #21's flag shape as of #25: the Station `id` and the Roller.
   * `DEFAULT_ROLLER` is written explicitly rather than left off - a pin missing its `roller` reads
   * as the same value (`station-actions/membership.ts`), but the row's select then shows a state
   * that isn't stored, and the first change to any *other* action's Roller would be the only write
   * that ever made it real.
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
        flags: { [MODULE_ID]: { [STATION_FLAG_KEY]: { id: stationId, roller: DEFAULT_ROLLER } } },
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

  /**
   * Accept a `feature` Item dropped onto a Station's section and pin it there (#26).
   *
   * Same wiring story as the Spaceship sheet's own drop handlers: `ActorSheetV2` (this dialog's
   * base class) already binds drag-drop in `_onRender` and routes an Item drop through this exact
   * hook, so this overrides the hook rather than adding a second, competing listener. Not typed as
   * a real override - fvtt-types declares neither `_onDropItem` nor `_dragDrop` - hence the `any`s
   * and the loose dropped-item shape.
   *
   * Which Station? The drop's own `event.target`, exactly as the Stations tab resolves a dropped
   * Actor's: the sections are separate drop targets within one dialog, so a drop that landed
   * outside a `[data-station]` fieldset is refused rather than guessed at.
   *
   * `feature` is the only type accepted (#21): weapons belong to Weapon Mounts and Systems are
   * bought with System Points, so neither gets a second home at a Station.
   *
   * The copy is made here rather than delegated to the base implementation so the pin is written
   * *with* the create, for the reason `#onCreateStationAction` above gives: an item that exists
   * for a moment without one flashes into the ship's Features tab, and a failed follow-up write
   * would strand it there for good.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async _onDropItem(event: any, item: any): Promise<any> {
    const dropped = item as LooseDroppedItem;
    const target = event.target as HTMLElement | null;
    const stationId = target ? SpaceshipSettings.#getStationId(target) : undefined;
    if (!stationId) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.StationActions.DropOnStation"));
      return null;
    }

    if (dropped.type !== FEATURE_ITEM_TYPE) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.StationActions.InvalidItemType"));
      return null;
    }

    const actor = this.document as unknown as LooseSpaceship;

    // A feature the ship already owns - dragged off its own Features tab, or from one Station's
    // section to another's. Re-pin it instead of embedding a second copy, and write only the
    // Station half of the pin so an existing Roller survives the move.
    if (dropped.parent?.uuid === this.document.uuid) {
      const owned = actor.items.get(dropped.id);
      if (!owned) return null;
      await owned.update({ [`flags.${MODULE_ID}.${STATION_FLAG_KEY}.id`]: stationId });
      return item;
    }

    // `fromCompendium` strips the world-specific bookkeeping a compendium copy must not keep
    // (its folder, its ownership) and records the source - core's own `_onDropItem` makes the
    // same call. Reached through a loosened signature for the usual fvtt-types reason: it is
    // typed against core's `Item`, which knows nothing of daggerheart's `feature` sub-type.
    const fromCompendium = game.items!.fromCompendium as unknown as (
      document: unknown,
      options?: Record<string, unknown>,
    ) => Record<string, unknown>;
    const source = dropped.inCompendium ? fromCompendium(dropped, { clearFolder: true }) : dropped.toObject();

    // Merged rather than assigned: a feature can arrive carrying flags of its own (daggerheart's,
    // another module's), and replacing the whole `flags` object would drop them. The pin carries
    // both halves of #21's flag shape for the reason `#onCreateStationAction` gives - a stored
    // `roller` is what the row's select reads back.
    const data = foundry.utils.mergeObject(source, {
      flags: { [MODULE_ID]: { [STATION_FLAG_KEY]: { id: stationId, roller: DEFAULT_ROLLER } } },
    });

    const [created] = await actor.createEmbeddedDocuments("Item", [data]);
    // Core's contract for this hook (`client/applications/sheets/actor-sheet.mjs`): the created
    // Item on success, a nullish value on failure or no action taken.
    return created ?? null;
  }

  /**
   * `any` in for the same reason `_prepareContext` above takes it - fvtt-types' RenderContext/
   * RenderOptions shapes add member-level TS2416 mismatches on top of the class-level suppression.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async _onRender(context: any, options: any): Promise<void> {
    await super._onRender(context, options);
    this.#bindRollerSelects();
  }

  /**
   * Bind each Station action row's Roller select (#25). A `<select>` is not a `data-action` target
   * - core `ApplicationV2` actions only fire on click - so its `change` is bound here, exactly as
   * the Spaceship sheet binds its own quantity and Shield inputs. Re-bound on every render: a
   * render replaces the part's DOM, so these are always freshly-created elements.
   *
   * The select carries no `name`, deliberately: this dialog submits on change (`submitOnChange`),
   * and a named control inside its form would be posted into the *Actor's* update as a field that
   * does not exist on `SpaceshipData`. The Roller lives on the item's own flag, so the write is
   * made here by hand instead of going through the form.
   */
  #bindRollerSelects(): void {
    const selects = this.element.querySelectorAll<HTMLSelectElement>(".station-action-roller");
    selects.forEach((select) => {
      select.addEventListener("change", (event) => {
        // The select sits inside a `submitOnChange` form whose own `change` listener is on the
        // form element. It carries no `name`, so submitting would write nothing - but it would
        // still cost a second render, one that rebuilds the options from a flag the write below
        // has not landed yet and so briefly snaps the select back. Stop the event here instead;
        // the item update re-renders this dialog on its own.
        event.stopPropagation();
        if (!isRoller(select.value)) return;

        const actor = this.document as unknown as LooseSpaceship;
        const item = SpaceshipSettings.#getRowItem(select, actor);
        // Written as one dotted path into the flag rather than through `setFlag`, so it merges
        // into the existing pin object and leaves the Station `id` beside it untouched.
        void item?.update({ [`flags.${MODULE_ID}.${STATION_FLAG_KEY}.roller`]: select.value });
      });
    });
  }
}
