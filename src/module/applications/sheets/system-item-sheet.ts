import { MODULE_ID } from "../../constants";
import { deleteRowDocument, pickDocumentImage, toRowEntry, type ItemRowEntry } from "./document-rows";

const BaseSheet = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2);

/**
 * The fields this sheet's own handlers need of a row document, on top of what `RowDocument`
 * already declares for the shared row partial. fvtt-types knows nothing of daggerheart's Action
 * pseudo-documents or its ActiveEffect sub-types (docs/adr/0002), so both are narrowed through one
 * loose shape - the same workaround `SpaceshipActorSheet`'s own `LooseDoc` is.
 */
interface LooseDoc {
  id: string;
  uuid: string;
  name: string;
  img?: string | null;
  disabled?: boolean;
  sheet?: { render: (options?: unknown) => unknown } | null;
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

/**
 * Sheet for the module-registered `daggerheart-scifi-content.system` Item sub-type (#15).
 *
 * Independent ApplicationV2 class, not a subclass of daggerheart's `DHBaseItemSheet` - same
 * reasoning, and the same borrow-the-CSS-by-marker-class approach, as the Spaceship actor sheet
 * (docs/adr/0002-spaceship-sheet-independent-application.md). The part split, the tab set and the
 * markup mirror `LootSheet` (`header` / `tabs` / `description` / `actions` / `settings` /
 * `effects`), which is the sheet this item type is modeled on.
 */
export default class SystemItemSheet extends BaseSheet {
  static override DEFAULT_OPTIONS = {
    // `daggerheart`/`dh-style`/`item` are the system's own world-global CSS marker classes - its
    // stylesheet themes any element carrying them regardless of item type, so adding them opts
    // this independent application into that theming without subclassing anything.
    classes: [MODULE_ID, "system-item-sheet", "daggerheart", "dh-style", "item"],
    // `LootSheet`'s own footprint.
    position: {
      width: 550,
    },
    window: {
      resizable: true,
    },
    form: {
      submitOnChange: true,
    },
    actions: {
      editImage: SystemItemSheet.#onEditImage,
      createAction: SystemItemSheet.#onCreateAction,
      createEffect: SystemItemSheet.#onCreateEffect,
      editItem: SystemItemSheet.#onEditItem,
      deleteItem: SystemItemSheet.#onDeleteItem,
      toChat: SystemItemSheet.#onToChat,
      toggleEffect: SystemItemSheet.#onToggleEffect,
    },
  };

  static override PARTS = {
    header: { template: `modules/${MODULE_ID}/templates/items/system/header.hbs` },
    tabs: { template: `modules/${MODULE_ID}/templates/items/system/tab-navigation.hbs` },
    description: {
      template: `modules/${MODULE_ID}/templates/items/system/description.hbs`,
      scrollable: [".description-section"],
    },
    actions: { template: `modules/${MODULE_ID}/templates/items/system/actions.hbs`, scrollable: [""] },
    settings: { template: `modules/${MODULE_ID}/templates/items/system/settings.hbs`, scrollable: [""] },
    effects: { template: `modules/${MODULE_ID}/templates/items/system/effects.hbs`, scrollable: [""] },
  };

  // `cssClass` is filled in at runtime by `_prepareTabs`; the empty string only satisfies
  // fvtt-types' (stricter-than-runtime) TabsConfiguration shape.
  static override TABS: Record<string, foundry.applications.api.ApplicationV2.TabsConfiguration> = {
    primary: {
      tabs: [
        { id: "description", cssClass: "" },
        { id: "settings", cssClass: "" },
        { id: "actions", cssClass: "" },
        { id: "effects", cssClass: "" },
      ],
      initial: "description",
      labelPrefix: "DHSCIFI.SystemItem.Tabs",
    },
  };

  // Both render-method overrides take/return `any`, same reason as `SpaceshipActorSheet`'s: typing
  // them with fvtt-types' RenderContext/RenderOptions shapes adds member-level TS2416 mismatches on
  // top of the class-level stack-depth failure suppressed above.
  protected override async _prepareContext(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const context = await super._prepareContext(options);
    return Object.assign(context, { tabs: this._prepareTabs("primary") });
  }

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

    if (partId === "description") {
      // Enriched here rather than in `_onRender` (the route the actor sheet's expandable rows take):
      // this tab renders one known description into a `prose-mirror` element that needs its
      // enriched HTML at render time, exactly as daggerheart's own `tab-description.hbs` does.
      const system = this.document.system as unknown as {
        getEnrichedDescription(config?: { gmNotes?: boolean }): Promise<string>;
        gmNotes?: string | null;
      };
      Object.assign(context, {
        enrichedDescription: await system.getEnrichedDescription({ gmNotes: false }),
        enrichedGMNotes: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.gmNotes ?? "", {
          relativeTo: this.document,
          secrets: this.document.isOwner,
        }),
      });
    }
    if (partId === "actions") {
      Object.assign(context, { actions: this.#buildActionRows() });
    }
    if (partId === "effects") {
      Object.assign(context, { effects: this.#buildEffectsContext() });
    }
    return context;
  }

  /**
   * The item's own actions, as rows. Reads `system.actions` - daggerheart's `ActionCollection`,
   * borrowed as a field by `SystemItemData` - which is iterable, so an item whose schema ended up
   * without the field (see `borrowActionsField`) simply lists nothing.
   */
  #buildActionRows(): ItemRowEntry[] {
    const actions = (this.document.system as unknown as { actions?: Iterable<LooseDoc> }).actions;
    return Array.from(actions ?? [], (doc) => toRowEntry(doc, this.isEditable));
  }

  /**
   * The item's ActiveEffects, split active/inactive on `effect.active` - the same split, off the
   * same source, as daggerheart's own `DHBaseItemSheet#_prepareEffectsContext`.
   */
  #buildEffectsContext(): { actives: ItemRowEntry[]; inactives: ItemRowEntry[] } {
    const actives: ItemRowEntry[] = [];
    const inactives: ItemRowEntry[] = [];
    for (const effect of this.document.effects) {
      const row = toRowEntry(effect as unknown as LooseDoc, this.isEditable);
      (effect.active ? actives : inactives).push(row);
    }
    return { actives, inactives };
  }

  /**
   * The document a row's controls act on, from `data-item-uuid` on the closest row - one resolver
   * for Action and ActiveEffect rows alike, exactly as daggerheart has one `getDocFromElement`.
   *
   * Async (`fromUuid`, daggerheart's own `getDocFromElement`) rather than the sync variant the
   * Spaceship actor sheet's rows use: an item sheet can be opened on a *compendium* item, whose
   * pack index `fromUuidSync` refuses to resolve, and every caller here is already async.
   */
  static async #getRowDocument(target: HTMLElement): Promise<LooseDoc | undefined> {
    const uuid = target.closest<HTMLElement>("[data-item-uuid]")?.dataset.itemUuid;
    if (!uuid) return undefined;

    return ((await fromUuid(uuid)) as unknown as LooseDoc | null) ?? undefined;
  }

  /** The item's portrait. Same `FilePicker` flow as the Spaceship sheet's, shared with it. */
  static async #onEditImage(this: SystemItemSheet, _event: PointerEvent, target: HTMLElement): Promise<void> {
    if (!(target instanceof HTMLImageElement)) return;

    const attribute = target.dataset.edit;
    if (attribute) await pickDocumentImage(this.document, attribute);
  }

  /**
   * Create a new Action on this item, from the "+" on the Actions legend.
   *
   * Mirrors the `type === 'action'` branch of daggerheart's own `createDoc`, which reaches the
   * Action class through `game.system.api.models.actions.actionsTypes` - its public API surface,
   * the same registry its own `#onCreateDoc` reads.
   *
   * The `parent` is the item's *DataModel*, not the Item document: that is where an `ActionsField`
   * lives, and `Action.create` writes through `parent.parent.update({'system.actions.<id>': ...})`.
   *
   * **No `type` is passed on purpose.** `Action.create` opens daggerheart's own action-type picker
   * ("Attack", "Damage", "Healing", ...) whenever `data.type` isn't a registered action type, and
   * that picker is the intended create flow - upstream reaches it by passing the literal string
   * `'action'`, which is a document class name rather than an action type and so never matches.
   * Passing `base` explicitly would silently skip the picker and make every action a bare one.
   * `data.name` is not passed either: `create` ignores it and builds the action from
   * `getSourceConfig` instead, which is why a new action opens its config sheet to be named.
   *
   * Shift-click skips opening that sheet, matching `createDoc`.
   */
  static async #onCreateAction(
    this: SystemItemSheet,
    event: PointerEvent,
    _target: HTMLElement,
  ): Promise<void> {
    const cls = (game.system as unknown as DaggerheartSystem)?.api?.models?.actions?.actionsTypes?.base;
    if (!cls) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.SystemItem.Actions.Unavailable"));
      return;
    }

    await cls.create({}, { parent: this.document.system, renderSheet: !event.shiftKey });
  }

  /**
   * Create a new ActiveEffect on this item, from the "+" on an Effects legend. Same `base`
   * sub-type, same `data-disabled` convention (creating from the *inactive* list lands the new
   * effect there), and the same deliberate absence of an `img` as the Spaceship sheet's own
   * `createEffect` - see that handler for why.
   */
  static async #onCreateEffect(
    this: SystemItemSheet,
    event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    // fvtt-types' `ActiveEffect.create` signature is daggerheart-unaware (no knowledge of the
    // system's `base` ActiveEffect sub-type) - called through a loosened signature, same workaround
    // as the Spaceship sheet's.
    const cls = getDocumentClass("ActiveEffect") as unknown as {
      defaultName(context: { type: string; parent: unknown }): string;
      create(data: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown>;
    };
    const parent = this.document;
    await cls.create(
      {
        name: cls.defaultName({ type: "base", parent }),
        type: "base",
        disabled: target.dataset.disabled === "true",
      },
      { parent, renderSheet: !event.shiftKey },
    );
  }

  /** Open a row document's own sheet - an Action's config or an ActiveEffect's, whichever it is. */
  static async #onEditItem(_event: PointerEvent, target: HTMLElement): Promise<void> {
    (await SystemItemSheet.#getRowDocument(target))?.sheet?.render(true);
  }

  /**
   * Delete a row document behind a confirm dialog, from the row's own trash control - daggerheart's
   * `hideContextMenu` branch, which is what this sheet's lists pass.
   *
   * The wording follows the list the row sits in: `data-type="effect"` is the marker the row
   * partial already stamps on an ActiveEffect row, so an action row is simply everything else.
   */
  static async #onDeleteItem(_event: PointerEvent, target: HTMLElement): Promise<void> {
    const doc = await SystemItemSheet.#getRowDocument(target);
    if (!doc) return;

    const isEffect = target.closest<HTMLElement>("[data-item-uuid]")?.dataset.type === "effect";
    const key = isEffect ? "DHSCIFI.Rows.DeleteEffect" : "DHSCIFI.Rows.DeleteAction";
    await deleteRowDocument(doc, `${key}.title`, `${key}.body`);
  }

  /**
   * Post a row document to chat, from the row partial's "Send to Chat" control - the same
   * document-level `toChat` the Spaceship sheet's rows call. Both row types here define one
   * (daggerheart gives its Action documents a `toChat` just as it does its Items and
   * ActiveEffects), which is why `toRowEntry`'s `canChat` guard lights the control on both.
   */
  static async #onToChat(_event: PointerEvent, target: HTMLElement): Promise<void> {
    const doc = await SystemItemSheet.#getRowDocument(target);
    await (doc as unknown as { toChat?: (uuid: string) => Promise<unknown> } | undefined)?.toChat?.(doc!.id);
  }

  /** Enable/disable an ActiveEffect - the same one-line update as daggerheart's `toggleEffect`. */
  static async #onToggleEffect(_event: PointerEvent, target: HTMLElement): Promise<void> {
    const effect = await SystemItemSheet.#getRowDocument(target);
    if (!effect) return;

    await effect.update({ disabled: !effect.disabled });
  }
}

/**
 * Minimal shape of the `game.system.api.models.actions` registry this sheet reaches through -
 * daggerheart's own public API surface, the same path its `#onCreateDoc` uses.
 */
interface DaggerheartSystem {
  api?: {
    models?: {
      actions?: {
        actionsTypes?: Record<
          string,
          { create(data: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown> }
        >;
      };
    };
  };
}
