import { FEATURE_ITEM_TYPE, INVENTORY_ITEM_TYPES, MODULE_ID, SPACESHIP_ITEM_TYPES } from "../../constants";
import SpaceshipSettings from "../settings/spaceship-settings";

const BaseSheet = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2);

/**
 * The Item types this sheet's two item tabs deal with. Both lists live in `constants.ts`, shared
 * with `SpaceshipData#isItemValid` (the document-level half of the same accept/reject rule) so
 * widening either is one edit - see that file, and docs/adr/0002-spaceship-sheet-independent-
 * application.md, for why reusing daggerheart's own Item types on a foreign Actor sub-type is
 * sanctioned in the first place (public/system-scoped state, not a private sheet contract).
 */
type InventoryItemType = (typeof INVENTORY_ITEM_TYPES)[number];
type SpaceshipItemType = (typeof SPACESHIP_ITEM_TYPES)[number];

/**
 * Fields this sheet reads off an inventory item's `system` - not the full daggerheart schema.
 * `equipped`/`burden` are weapon/armor-only in practice; `quantity` is consumable/loot-only.
 * One shared shape (rather than a type per Item type) because `LooseItem` below is itself a
 * loosened stand-in for all four Item types, not just weapon/armor.
 */
interface InventoryItemSystem {
  equipped?: boolean;
  burden?: "oneHanded" | "twoHanded";
  quantity?: number;
  description?: string;
  getEnrichedDescription?: () => Promise<string>;
}

/**
 * fvtt-types has no knowledge of daggerheart's Item sub-types (`weapon`/`armor`/`consumable`/
 * `loot`) or their `system` schemas - the same "no `game.system.api`" gap the sheet class itself
 * works around (docs/adr/0002-spaceship-sheet-independent-application.md). The Inventory tab's
 * item-management methods below work through this loose `LooseItem`/`LooseActor` shape rather
 * than fighting fvtt-types' strict, daggerheart-unaware `Item.type`/`Item.CreateData` unions.
 */
interface LooseItem {
  id: string;
  uuid: string;
  type: string;
  name: string;
  img: string | null;
  system: InventoryItemSystem;
  parent?: { uuid?: string } | null;
  sheet?: { render: (options?: unknown) => unknown } | null;
  isOwner?: boolean;
  // Daggerheart's own `Item`-level mixin (not sheet code - see class doc comment on
  // `isItemValid`), used here by the Inventory tab template to render the same tag chips
  // ("Finesse", "One-Handed", "d8+1 (Phy)", "Base Score: 3"...) the character sheet shows,
  // without reimplementing daggerheart's per-item-type tag logic ourselves.
  _getTags?: () => string[];
  // Also `Item`-level (not sheet code): whether the item has description/feature text worth
  // expanding. `system.getEnrichedDescription` is the actual enriched-HTML source used once
  // expanded (see `#enrichInventoryDescriptions`); `system.description` is its plain fallback.
  hasDescription?: boolean;
  // Also `Item`-level: whether clicking the portrait should roll/use the item's action instead of
  // opening its sheet - `false` for a ship item without `src/module/compat/character-only-
  // patches.ts`'s `usable` patch (daggerheart's own `usable` getter hard-gates non-`character`
  // actors, same restriction `_getTags`/`hasDescription` above are *not* subject to).
  usable?: boolean;
  // Item-level: posts the item's description to chat, same as the character sheet's own "Send to
  // Chat" control - not gated to `character` actors anywhere found so far, used as-is.
  toChat?: (uuid: string) => Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
  toObject(): Record<string, unknown>;
}

interface LooseActor {
  uuid: string;
  system: { maxWeaponMounts: number };
  items: Iterable<LooseItem> & { get(id: string): LooseItem | undefined };
  createEmbeddedDocuments(type: "Item", data: Record<string, unknown>[]): Promise<unknown>;
}

/** One row of an item list (Inventory or Features): the item plus its precomputed display bits. */
interface ItemRowEntry {
  item: LooseItem;
  tags: string[];
  hasDescription: boolean;
  usable: boolean;
}

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
    // Same footprint as the official character sheet (850x800, 275px sidebar).
    position: {
      width: 850,
      height: 800,
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
      createItem: SpaceshipActorSheet.#onCreateItem,
      editItem: SpaceshipActorSheet.#onEditItem,
      toggleEquipItem: SpaceshipActorSheet.#onToggleEquipItem,
      toggleExtended: SpaceshipActorSheet.#onToggleExtended,
      useItem: SpaceshipActorSheet.#onUseItem,
      toChat: SpaceshipActorSheet.#onToChat,
    },
  };

  // Same part split as the official character sheet (sidebar / header / one part per tab);
  // our SCSS places them on the same window-content grid the official sheet uses. Features (#7)
  // and Inventory (#6) have their own templates; the remaining tab parts still share the
  // placeholder until #8-#12.
  static override PARTS = {
    sidebar: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/sidebar.hbs`,
    },
    header: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/header.hbs`,
    },
    features: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/features.hbs`,
    },
    inventory: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/inventory.hbs`,
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
    const actor = this.document as unknown as LooseActor;
    const editable = this.isEditable;
    if (partId === "inventory") {
      Object.assign(context, { inventory: SpaceshipActorSheet.#buildInventoryContext(actor, editable) });
    }
    if (partId === "features") {
      Object.assign(context, { features: SpaceshipActorSheet.#buildFeaturesContext(actor, editable) });
    }
    return context;
  }

  /**
   * One row of a shared item list: the live `LooseItem` plus the display bits the template can't
   * compute itself.
   *
   * `tags` is resolved here, not read as `item._getTags` from the template: Handlebars only binds
   * a resolved function's `this` correctly to the object it's a *direct* property of (daggerheart's
   * own item-tags.hbs partial relies on exactly that, invoking `_getTags` as a bare path with
   * `item` as the partial's context) - a nested path like `item._getTags` would call it with the
   * wrong `this` and break every tag that reads `this.attack`/etc.
   *
   * `usable` (does the portrait roll the item, or just open its sheet?) is ANDed with `editable`
   * here rather than gated in the template, because the character sheet's equivalent is one
   * uniform flag: *both* its tabs pass `showActions=@root.editable` into `inventory-item-V2.hbs`,
   * whose portrait falls back to "open the sheet" whenever that's false. Nothing on this sheet
   * wants the two to differ, so it collapses to one precomputed boolean.
   */
  static #toEntry(item: LooseItem, editable: boolean): ItemRowEntry {
    return {
      item,
      tags: item._getTags?.() ?? [],
      hasDescription: item.hasDescription ?? false,
      usable: editable && (item.usable ?? false),
    };
  }

  /**
   * The ship's embedded `feature` items for the Features tab (#7) - the same `ItemRowEntry`
   * rows the Inventory tab uses, since both tabs render through the same partials (see
   * `features.hbs`). A single flat list: unlike a character, a ship has no class/subclass/
   * ancestry/community granters to group features under (CONTEXT.md).
   */
  static #buildFeaturesContext(actor: LooseActor, editable: boolean): ItemRowEntry[] {
    return Array.from(actor.items)
      .filter((item) => item.type === FEATURE_ITEM_TYPE)
      .map((item) => SpaceshipActorSheet.#toEntry(item, editable));
  }

  /**
   * Group the ship's `weapon`/`armor`/`consumable`/`loot` items for the Inventory tab (#6), plus
   * the weapon-mount usage (`equipped` count vs `maxWeaponMounts`) shown next to the weapons list.
   * Passes the live `LooseItem`s through as-is (not a flattened row shape) so `inventory.hbs` can
   * call `item._getTags`/`item.system.*` directly, same as daggerheart's own inventory template.
   */
  static #buildInventoryContext(
    actor: LooseActor,
    editable: boolean,
  ): {
    weapons: ItemRowEntry[];
    armor: ItemRowEntry[];
    consumables: ItemRowEntry[];
    loot: ItemRowEntry[];
    mounts: { value: number; max: number };
  } {
    const rows: Record<InventoryItemType, ItemRowEntry[]> = { weapon: [], armor: [], consumable: [], loot: [] };

    for (const item of actor.items) {
      if (SpaceshipActorSheet.#isInventoryItemType(item.type)) {
        rows[item.type].push(SpaceshipActorSheet.#toEntry(item, editable));
      }
    }

    return {
      weapons: rows.weapon,
      armor: rows.armor,
      consumables: rows.consumable,
      loot: rows.loot,
      mounts: {
        value: SpaceshipActorSheet.#countEquippedWeapons(actor),
        max: actor.system.maxWeaponMounts,
      },
    };
  }

  static #isInventoryItemType(type: string): type is InventoryItemType {
    return (INVENTORY_ITEM_TYPES as readonly string[]).includes(type);
  }

  /** Whether `type` is an Item type this sheet can create/accept at all (inventory + `feature`). */
  static #isSpaceshipItemType(type: string): type is SpaceshipItemType {
    return (SPACESHIP_ITEM_TYPES as readonly string[]).includes(type);
  }

  /**
   * One equipped weapon = one used mount, regardless of `burden` (#6/CONTEXT.md's "Weapon
   * Mount" entry): unlike the character sheet's primary/secondary pairing, a ship doesn't halve
   * the cost of two one-handed weapons sharing a mount - each equipped weapon item gets its own.
   * Single source of truth for this count - both `#buildInventoryContext` (display) and the
   * equip/drop handlers below (cap enforcement) call this rather than each re-deriving it.
   */
  static #countEquippedWeapons(actor: LooseActor): number {
    return Array.from(actor.items).filter((item) => item.type === "weapon" && item.system.equipped === true).length;
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

  /** Create a new embedded Item of the type named by the clicked button's `data-item-type`. */
  static async #onCreateItem(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const itemType = target.dataset.itemType ?? "";
    if (!SpaceshipActorSheet.#isSpaceshipItemType(itemType)) return;

    const actor = this.document as unknown as LooseActor;
    // fvtt-types' `getDefaultArtwork` only accepts its strict, daggerheart-unaware `type` union
    // (same gap `LooseItem`/`LooseActor` work around above) - called through a loosened signature.
    const getDefaultArtwork = CONFIG.Item.documentClass.getDefaultArtwork as (data: {
      type: string;
    }) => { img: string | null };
    const { img } = getDefaultArtwork({ type: itemType });
    await actor.createEmbeddedDocuments("Item", [
      {
        type: itemType,
        name: game.i18n!.localize(`TYPES.Item.${itemType}`),
        img,
      },
    ]);
  }

  /** Open the embedded Item's own sheet, from `data-item-id` on the clicked row. */
  static async #onEditItem(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const item = SpaceshipActorSheet.#getRowItem(this.document as unknown as LooseActor, target);
    item?.sheet?.render(true);
  }

  /**
   * Delete an embedded Item after a confirm dialog - called from the row's context menu
   * (`#bindItemContextMenu`), the only way to delete an item now that the controls match the
   * character sheet's own default set (equip/Send to Chat/kebab, not standalone edit/delete
   * icons - see `inventory.hbs`'s comment).
   */
  static async #deleteItemWithConfirm(item: LooseItem): Promise<void> {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n!.localize("DHSCIFI.Spaceship.Inventory.DeleteItem.title") },
      content: `<p>${game.i18n!.format("DHSCIFI.Spaceship.Inventory.DeleteItem.body", { name: item.name })}</p>`,
    });
    if (!confirmed) return;

    await item.delete();
  }

  /**
   * Equip/unequip a `weapon` or `armor` item, from `data-item-id` on the clicked row.
   *
   * Weapons: equipping beyond `maxWeaponMounts` is blocked - one mount per equipped weapon
   * regardless of `burden` (see `#countEquippedWeapons`).
   * Armor: equipping one unequips any other equipped armor (only one Shield source at a time,
   * mirroring the character sheet's single-armor-slot rule); ticket #7 derives Shield from it.
   */
  static async #onToggleEquipItem(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const actor = this.document as unknown as LooseActor;
    const item = SpaceshipActorSheet.#getRowItem(actor, target);
    if (!item || (item.type !== "weapon" && item.type !== "armor")) return;

    const equipping = !item.system.equipped;

    if (equipping && item.type === "weapon" && SpaceshipActorSheet.#countEquippedWeapons(actor) >= actor.system.maxWeaponMounts) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Inventory.MountsFull"));
      return;
    }

    await item.update({ "system.equipped": equipping });

    if (equipping && item.type === "armor") {
      const otherEquippedArmor = Array.from(actor.items).filter(
        (other) => other.type === "armor" && other.id !== item.id && other.system.equipped === true,
      );
      await Promise.all(otherEquippedArmor.map((other) => other.update({ "system.equipped": false })));
    }
  }

  /** Resolve the embedded Item referenced by the closest `[data-item-id]` ancestor of `target`. */
  static #getRowItem(actor: LooseActor, target: HTMLElement): LooseItem | undefined {
    const itemId = target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
    return itemId ? actor.items.get(itemId) : undefined;
  }

  /**
   * Expand/collapse an item row's description, from `data-action="toggleExtended"` on
   * `.inventory-item-header` - mirrors daggerheart's own `DHSheetV2#toggleExtended` exactly (a
   * plain class toggle, no actor/item access at all, so nothing about it is `character`-only).
   */
  static #onToggleExtended(_event: PointerEvent, target: HTMLElement): void {
    const extensible = target.closest(".inventory-item")?.querySelector(".extensible");
    extensible?.classList.toggle("extended");
  }

  /**
   * Run one of an item's own `system.actions` (e.g. a Medpack's "Clear 1d4 HP" Healing action),
   * from `data-item-uuid` on the clicked `.item-buttons` button - resolves the Action document by
   * UUID and calls its own `use(event)`, mirroring daggerheart's own `useItem` action exactly
   * (Action-document-level behavior, not sheet code, same reuse category as `item._getTags`).
   * Only reachable at all because of `src/module/compat/actions-list-patch.ts` - without it,
   * `item.system.actions.size` still renders truthfully, but daggerheart's own `actionsList` gate
   * hides the action from its "Use" dialog's cost resolution, and it throws.
   */
  static async #onUseItem(event: PointerEvent, target: HTMLElement): Promise<void> {
    const uuid = target.closest<HTMLElement>("[data-item-uuid]")?.dataset.itemUuid;
    if (!uuid) return;

    const action = (await fromUuid(uuid)) as { use?: (event: PointerEvent) => Promise<unknown> } | null;
    await action?.use?.(event);
  }

  /**
   * Post an item's description to chat, from `data-action="toChat"` - mirrors the character
   * sheet's own "Send to Chat" control (`item.toChat(item.uuid)`, Item-document-level behavior,
   * not sheet code).
   */
  static async #onToChat(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const item = SpaceshipActorSheet.#getRowItem(this.document as unknown as LooseActor, target);
    await item?.toChat?.(item.id);
  }

  // Same `any`/`any` reasoning as `_prepareContext`/`_preparePartContext` above.
  protected override async _onRender(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
  ): Promise<void> {
    await super._onRender(context, options);
    this.#bindQuantityInputs();
    this.#bindItemContextMenu();
    void this.#enrichInventoryDescriptions();
  }

  /**
   * The Inventory tab's per-row context menu (the kebab/"..." button - Edit/Delete), matching the
   * character sheet's own default controls exactly (equip toggle, "Send to Chat", kebab menu -
   * not standalone edit/delete icons, see `inventory.hbs`'s comment). Built with core's own
   * `ContextMenu` class, not daggerheart's `triggerContextMenu` handler (sheet code, out of reach
   * per docs/adr/0002).
   *
   * Cached on the instance and only constructed once, same reasoning as `ActorSheetV2`'s own
   * cached `_dragDrop`: `ContextMenu`'s constructor binds a listener to `container` (`this.element`
   * here, which persists across re-renders - only the parts inside it get replaced), so
   * constructing a new one on every render would accumulate listeners on that same element.
   */
  #bindItemContextMenu(): void {
    if (this.#itemContextMenu) return;

    const actor = this.document as unknown as LooseActor;
    this.#itemContextMenu = new foundry.applications.ux.ContextMenu.implementation(
      this.element,
      // Every `.inventory-item` on the sheet, not just the Inventory tab's - the Features tab
      // (#7) renders through the same row partial and gets the same Edit/Delete menu.
      ".inventory-item [data-action='triggerContextMenu']",
      [
        {
          name: "DHSCIFI.Spaceship.Inventory.EditItem",
          icon: '<i class="fa-solid fa-edit"></i>',
          callback: (target: HTMLElement) => {
            const item = SpaceshipActorSheet.#getRowItem(actor, target);
            item?.sheet?.render(true);
          },
        },
        {
          name: "DHSCIFI.Spaceship.Inventory.DeleteItem.title",
          icon: '<i class="fa-solid fa-trash"></i>',
          callback: (target: HTMLElement) => {
            const item = SpaceshipActorSheet.#getRowItem(actor, target);
            if (item) void SpaceshipActorSheet.#deleteItemWithConfirm(item);
          },
        },
      ],
      { eventName: "click", jQuery: false },
    );
  }

  #itemContextMenu: InstanceType<typeof foundry.applications.ux.ContextMenu.implementation> | null = null;

  /**
   * Accept an Item dropped onto the sheet, restricted to `SPACESHIP_ITEM_TYPES` (the Inventory tab's
   * four types plus `feature`) and capped at `maxWeaponMounts`. Keep this set in sync with
   * `SpaceshipData#isItemValid`, which rejects the same types one level down (daggerheart's own
   * `Item.createDocuments` override consults it for *every* embedded create, drops included), so
   * a type allowed here but not there fails with the system's own generic warning instead of
   * ours. `ActorSheetV2` (our base class) already wires up drag-drop
   * itself - `_onRender` calls `this._dragDrop.bind(this.element)`, and its default `_onDrop`
   * routes an Item drop through this exact hook - so this overrides that hook rather than
   * building a second, competing drop listener (an earlier version of this method did that, and
   * every drop created the item twice: once from each listener firing on the same event).
   * The base class's own `_onDropItem` does the actual embedding (also handling same-actor
   * reorder, compendium source items, and ownership - all for free); items whose type isn't one
   * of `SPACESHIP_ITEM_TYPES` are rejected before that with a warning instead of embedded.
   *
   * Not typed as a real override (fvtt-types doesn't declare `_onDropItem`/`_dragDrop`/`_onDrop`
   * anywhere in its `ActorSheetV2` definition, the same gap already worked around for
   * `_prepareContext`/`_preparePartContext` above) - called via the prototype chain rather than
   * `super.` since TS won't resolve a `super` member it has no type for.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async _onDropItem(event: any, item: any): Promise<any> {
    const droppedItem = item as LooseItem;
    if (!SpaceshipActorSheet.#isSpaceshipItemType(droppedItem.type)) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Inventory.InvalidItemType"));
      return null;
    }

    const base = Object.getPrototypeOf(SpaceshipActorSheet.prototype) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _onDropItem(event: any, item: any): Promise<any>;
    };
    const result = (await base._onDropItem.call(this, event, item)) as LooseItem | null;

    // A weapon that landed equipped beyond the mount cap (e.g. dragged in already-equipped from
    // another actor): unequip the *new* copy, same rule `#onToggleEquipItem` enforces - `count`
    // already includes this just-created item, so `>` (not `>=`) means it pushed things over.
    const actor = this.document as unknown as LooseActor;
    if (
      result?.type === "weapon" &&
      result.system.equipped &&
      SpaceshipActorSheet.#countEquippedWeapons(actor) > actor.system.maxWeaponMounts
    ) {
      await result.update({ "system.equipped": false });
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Inventory.MountsFull"));
    }

    return result;
  }

  /**
   * `.inventory-item-quantity` (consumable/loot rows, `partials/inventory-item.hbs`'s own markup/
   * class - matches daggerheart's real inventory item template) is a plain `<input>`, not wired to
   * a `data-action` (core `ApplicationV2` actions only fire on click) - bind its `change` here
   * instead. Re-bound on every render (unlike `#bindItemContextMenu`, which caches): a render
   * replaces the part's DOM, so these are always freshly-created elements with no listener yet.
   */
  #bindQuantityInputs(): void {
    const actor = this.document as unknown as LooseActor;
    const inputs = this.element.querySelectorAll<HTMLInputElement>(".inventory-item-quantity");
    inputs.forEach((input) => {
      input.addEventListener("change", () => {
        const item = SpaceshipActorSheet.#getRowItem(actor, input);
        const quantity = Number.parseInt(input.value, 10);
        if (item && !Number.isNaN(quantity)) void item.update({ "system.quantity": Math.max(0, quantity) });
      });
    });
  }

  /**
   * Fill in each expandable row's `.inventory-description` with the item's own enriched
   * description HTML, mirroring daggerheart's own `#prepareInventoryDescription` (item-level
   * `getEnrichedDescription()` + `TextEditor.enrichHTML`, not sheet code) - Handlebars can't
   * `await`, so `partials/inventory-item.hbs` renders the container empty and this fills it in
   * post-render. Covers every `.inventory-item` on the sheet (Inventory and Features alike).
   */
  async #enrichInventoryDescriptions(): Promise<void> {
    const rows = this.element.querySelectorAll<HTMLElement>(".inventory-item[data-item-uuid]");
    for (const row of rows) {
      const uuid = row.dataset.itemUuid;
      const descriptionElement = row.querySelector<HTMLElement>(".inventory-description");
      if (!uuid || !descriptionElement) continue;

      const item = (await fromUuid(uuid)) as unknown as LooseItem | null;
      if (!item) continue;

      const description = item.system.getEnrichedDescription
        ? await item.system.getEnrichedDescription()
        : (item.system.description ?? "");
      descriptionElement.innerHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        description,
        { secrets: item.isOwner ?? false },
      );
    }
  }

}
