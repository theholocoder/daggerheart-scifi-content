import {
  ARMOR_ITEM_TYPE,
  CREW_ACTOR_TYPES,
  FEATURE_ITEM_TYPE,
  INVENTORY_ITEM_TYPES,
  MODULE_ID,
  SPACESHIP_ITEM_TYPES,
  STATION_IDS,
  SYSTEM_ITEM_TYPE,
} from "../../constants";
import { deleteRowDocument, pickDocumentImage, toRowEntry, type ItemRowEntry } from "./document-rows";
import { resolveUuidSync } from "../../utils/resolve-uuid";
import SpaceshipSettings from "../settings/spaceship-settings";
import SpaceshipLevelup from "../levelup/spaceship-levelup";
import SpaceshipLevelupView from "../levelup/spaceship-levelup-view";

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
 * Fields this sheet reads off a row document's `system` - not the full daggerheart schema.
 * `equipped`/`burden` are weapon/armor-only in practice; `quantity` is consumable/loot-only.
 * One shared shape (rather than a type per Item type) because `LooseDoc` below is itself a
 * loosened stand-in for all four Item types, not just weapon/armor. An ActiveEffect (#9) has a
 * `system` too (daggerheart gives its ActiveEffects typed sub-types), it just carries none of
 * these fields - every one of them is optional, so the same shape covers it.
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
 * item-management methods below work through this loose `LooseDoc`/`LooseActor` shape rather
 * than fighting fvtt-types' strict, daggerheart-unaware `Item.type`/`Item.CreateData` unions.
 *
 * "Doc", not "Item": the Effects tab (#9) renders ActiveEffects through the *same* row partial and
 * the same row-resolution/edit/delete/description code paths as items, exactly as daggerheart's own
 * sheets do (one `inventory-item` partial, one `getDocFromElement` helper, for both). Most of the
 * shape is genuinely shared: `DhActiveEffect` defines its own `_getTags` (origin/status chips),
 * `hasDescription`, and `toChat`, so an effect row lights up the same controls an item row does.
 * Only `usable` is Item-only (already optional here), and the two fields an effect adds over an
 * Item (`active`, `disabled`) are optional in turn.
 */
interface LooseDoc {
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
  // Also `Item`-level (not sheet code, weapon-only in practice): the same label array
  // `daggerheart`'s own character sidebar reads for its equipped-weapons list (#17) - trait/range
  // short forms plus damage, the damage entries carrying `icons` for the damage-type chips. A
  // shorter, sidebar-appropriate cousin of `_getTags` above (which lists burden and the full damage
  // string for the Inventory tab's row); see `#buildEquippedWeapons`.
  _getLabels?: () => WeaponLabel[];
  // Also `Item`-level (not sheet code): whether the item has description/feature text worth
  // expanding. `system.getEnrichedDescription` is the actual enriched-HTML source used once
  // expanded (see `#enrichRowDescriptions`); `system.description` is its plain fallback.
  hasDescription?: boolean;
  // Also `Item`-level: whether clicking the portrait should roll/use the item's action instead of
  // opening its sheet - `false` for a ship item without `src/module/compat/character-only-
  // patches.ts`'s `usable` patch (daggerheart's own `usable` getter hard-gates non-`character`
  // actors, same restriction `_getTags`/`hasDescription` above are *not* subject to).
  usable?: boolean;
  // Item-level: posts the item's description to chat, same as the character sheet's own "Send to
  // Chat" control - not gated to `character` actors anywhere found so far, used as-is.
  toChat?: (uuid: string) => Promise<unknown>;
  // ActiveEffect-only (#9), both core Foundry fields rather than daggerheart's: `disabled` is the
  // stored flag the Effects tab's toggle flips, `active` the derived "is it actually applying?"
  // (false when disabled *or* suppressed - e.g. an effect transferred from unequipped armor) that
  // daggerheart's own effects tab splits its two lists on.
  active?: boolean;
  disabled?: boolean;
  // ActiveEffect-only: an effect's description lives at the document's top level, not under
  // `system` like an Item's - see `#enrichRowDescriptions`, which falls back to it exactly as
  // daggerheart's own `#prepareInventoryDescription` does.
  description?: string;
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
  toObject(): Record<string, unknown>;
  // Core `ClientDocumentMixin` behavior (both Item and ActiveEffect get it), used by
  // `_onDragStart` (#14) to build the same drag payload daggerheart's own default
  // `ActorSheetV2#_onDragStart` would - see that override's comment for why it's called
  // through here rather than left to the base class's dataset-based lookup.
  toDragData?: () => Record<string, unknown>;
}

interface LooseActor {
  uuid: string;
  system: {
    maxWeaponMounts: number;
    // One entry per `STATION_IDS` id (#8) - `crew` is a plain array of Actor UUID strings, see
    // `SpaceshipData`'s `stationField`.
    stations: Record<StationId, { enabled: boolean; crew: string[] }>;
    // Shield (#10), derived in `SpaceshipData#prepareBaseData`: `max` is the equipped armor's
    // score, `value` the slots already marked off it.
    armorScore: { value: number; max: number };
    // Writes a Shield-slot click through to the equipped armor Item (`SpaceshipData#markShield`) -
    // `armorScore` above is derived, so there is nothing on the actor to update directly.
    markShield(value: number): Promise<void>;
    /** Level-up history (#12) - see `SpaceshipData`. `updateLevel` is the level input's write. */
    canLevelUp: boolean;
    levelData: { changed: number };
    levelups: Record<string, unknown>;
    updateLevel(newLevel: number): Promise<void>;
  };
  items: Iterable<LooseDoc> & { get(id: string): LooseDoc | undefined };
  /**
   * Core Foundry's own generator over every ActiveEffect that applies to this Actor - its own
   * effects plus the `transfer` effects of its items. Daggerheart *overrides* it (on
   * `CONFIG.Actor.documentClass`, so our ship gets the override too) purely to add the
   * `noSelfArmor`/`noTransferArmor` filters; the override is actor-type agnostic, unlike the
   * `character`-only gates `src/module/compat/character-only-patches.ts` has to work around.
   * `noTransferArmor: true` is what daggerheart's own effects tab passes: an armor item's
   * transferred effect is already represented by the Shield/threshold numbers (#10), so listing it
   * again as a togglable row would be a second, contradictory control over the same value.
   */
  allApplicableEffects(options?: { noSelfArmor?: boolean; noTransferArmor?: boolean }): Iterable<LooseDoc>;
  createEmbeddedDocuments(type: "Item", data: Record<string, unknown>[]): Promise<unknown>;
}

type StationId = (typeof STATION_IDS)[number];

/**
 * One crew assignment as the Stations tab renders it: the stored UUID plus whatever the referenced
 * Actor still provides. `missing` is the "the Actor was deleted" case the ticket calls for - a
 * dangling reference renders as "Unknown" with a placeholder portrait instead of erroring the
 * sheet, and stays stored (the reference is one-way and never synced, per CONTEXT.md).
 */
interface CrewEntry {
  uuid: string;
  name: string;
  img: string;
  missing: boolean;
}

/** One station row: its id, its label key, whether it's enabled, and its resolved crew. */
interface StationRow {
  id: StationId;
  label: string;
  enabled: boolean;
  crew: CrewEntry[];
}

/**
 * One entry of `Item#_getLabels()` (weapon-only in practice, see `LooseDoc._getLabels`): a plain
 * localized string (trait/range short forms), or a damage entry pairing its formula string with
 * damage-type icons - the same shape daggerheart's own `inventory-item-compact.hbs` renders.
 */
type WeaponLabel = string | { value: string; icons: string[] };

/**
 * One row of the sidebar's equipped-weapons list (#17): the fields
 * `templates/partials/equipped-weapon.hbs` needs, resolved here rather than read off the live
 * document in the template - `_getLabels` only binds `this` correctly when Handlebars invokes it as
 * a bare path on the object it's a direct property of (same reasoning `toRowEntry`'s own doc
 * comment gives for `tags`), which a nested `weapon.item._getLabels` path would break.
 */
interface EquippedWeaponRow {
  uuid: string;
  name: string;
  img: string | null;
  labels: WeaponLabel[];
  /** Same `editable && item.usable` flag `toRowEntry` resolves - rolls the weapon's attack from
   *  the portrait instead of opening its sheet, exactly like the Inventory tab's own row. */
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
      toggleShield: SpaceshipActorSheet.#onToggleShield,
      openSettings: SpaceshipActorSheet.#onOpenSettings,
      levelUp: SpaceshipActorSheet.#onLevelUp,
      viewLevelups: SpaceshipActorSheet.#onViewLevelups,
      createItem: SpaceshipActorSheet.#onCreateItem,
      editItem: SpaceshipActorSheet.#onEditItem,
      toggleEquipItem: SpaceshipActorSheet.#onToggleEquipItem,
      toggleExtended: SpaceshipActorSheet.#onToggleExtended,
      useItem: SpaceshipActorSheet.#onUseItem,
      toChat: SpaceshipActorSheet.#onToChat,
      createEffect: SpaceshipActorSheet.#onCreateEffect,
      toggleEffect: SpaceshipActorSheet.#onToggleEffect,
      toggleStation: SpaceshipActorSheet.#onToggleStation,
      removeCrew: SpaceshipActorSheet.#onRemoveCrew,
      openCrew: SpaceshipActorSheet.#onOpenCrew,
    },
  };

  // Same part split as the official character sheet (sidebar / header / one part per tab);
  // our SCSS places them on the same window-content grid the official sheet uses. Every tab has
  // its own template as of #9 - Features (#7), Inventory (#6), Stations (#8), Effects (#9).
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
      template: `modules/${MODULE_ID}/templates/actors/spaceship/stations.hbs`,
    },
    effects: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/effects.hbs`,
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

  /** Expose the part's own tab entry as `tab` for that tab's template, plus its own list context. */
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
    // `context` is the same object mutated across every part render, not a fresh copy per part
    // (core's `HandlebarsApplicationMixin#_renderHTML` reuses one reference) - so a key set for
    // one part otherwise leaks into every later one. `mounts` is header-only (the weapon-mount
    // chip, #17); reset it here so a later tab's `dhscifi.inventory-items` partial call, which
    // falls through to ambient context when it doesn't pass its own `mounts`, doesn't inherit the
    // header's chip and show a stray "(n / n)" next to e.g. the Features legend.
    Object.assign(context, { mounts: undefined });
    if (partId === "header") {
      // Only offer the level-up history control once there is a history to review (#12).
      Object.assign(context, {
        hasLevelups: Object.keys(actor.system.levelups).length > 0,
        // Weapon-mount chip (#17): live `equipped / maxWeaponMounts`, reusing the same
        // `#countEquippedWeapons` the Inventory tab's own mount display and cap enforcement use -
        // see that method's doc comment for the counting rule.
        mounts: { value: SpaceshipActorSheet.#countEquippedWeapons(actor), max: actor.system.maxWeaponMounts },
      });
    }
    if (partId === "sidebar") {
      Object.assign(context, { equippedWeapons: SpaceshipActorSheet.#buildEquippedWeapons(actor, editable) });
    }
    if (partId === "inventory") {
      Object.assign(context, { inventory: SpaceshipActorSheet.#buildInventoryContext(actor, editable) });
    }
    if (partId === "features") {
      Object.assign(context, { features: SpaceshipActorSheet.#buildFeaturesContext(actor, editable) });
    }
    if (partId === "stations") {
      Object.assign(context, { stations: SpaceshipActorSheet.#buildStationsContext(actor) });
    }
    if (partId === "effects") {
      Object.assign(context, { effects: SpaceshipActorSheet.#buildEffectsContext(actor, editable) });
    }
    return context;
  }

  /**
   * The ActiveEffects applying to the ship, split into active/inactive lists for the Effects tab
   * (#9) - the same two-list split, off the same `effect.active` flag and the same
   * `allApplicableEffects({ noTransferArmor: true })` source, as daggerheart's own
   * `DHBaseActorSheet#_prepareEffectsContext`.
   *
   * Rows go through the same shared `toRowEntry` as items, and mostly light up the same way:
   * `DhActiveEffect` has its own `_getTags` (an origin chip plus one per applied status condition),
   * `hasDescription`, and `toChat`. Only `usable` is absent, so an effect's portrait opens its
   * config sheet rather than rolling anything - which is what daggerheart's own row does too.
   */
  static #buildEffectsContext(actor: LooseActor, editable: boolean): { actives: ItemRowEntry[]; inactives: ItemRowEntry[] } {
    const actives: ItemRowEntry[] = [];
    const inactives: ItemRowEntry[] = [];

    for (const effect of actor.allApplicableEffects({ noTransferArmor: true })) {
      (effect.active ? actives : inactives).push(toRowEntry(effect, editable));
    }

    return { actives, inactives };
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
      .map((item) => toRowEntry(item, editable));
  }

  /**
   * Group the ship's inventory items for the Inventory tab - daggerheart's `weapon`/`armor`/
   * `consumable`/`loot` (#6) plus this module's own `system` sub-type (#15) - along with the
   * weapon-mount usage (`equipped` count vs `maxWeaponMounts`) shown next to the weapons list.
   * Passes the live `LooseDoc`s through as-is (not a flattened row shape) so `inventory.hbs` can
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
    systems: ItemRowEntry[];
    mounts: { value: number; max: number };
  } {
    const rows: Record<InventoryItemType, ItemRowEntry[]> = {
      weapon: [],
      armor: [],
      consumable: [],
      loot: [],
      [SYSTEM_ITEM_TYPE]: [],
    };

    for (const item of actor.items) {
      if (SpaceshipActorSheet.#isInventoryItemType(item.type)) {
        rows[item.type].push(toRowEntry(item, editable));
      }
    }

    return {
      weapons: rows.weapon,
      armor: rows.armor,
      consumables: rows.consumable,
      loot: rows.loot,
      systems: rows[SYSTEM_ITEM_TYPE],
      mounts: {
        value: SpaceshipActorSheet.#countEquippedWeapons(actor),
        max: actor.system.maxWeaponMounts,
      },
    };
  }

  /**
   * The five Stations (#8) in `STATION_IDS` order, each with its crew assignments resolved for
   * display. Built per-render rather than cached: a crew Actor can be renamed, re-portraited, or
   * deleted at any time without this sheet hearing about it (the reference is one-way and never
   * synced - CONTEXT.md's "Crew assignment").
   */
  static #buildStationsContext(actor: LooseActor): StationRow[] {
    return STATION_IDS.map((id) => {
      const station = actor.system.stations[id];
      return {
        id,
        label: `DHSCIFI.Spaceship.Stations.Roles.${id}`,
        enabled: station.enabled,
        crew: station.crew.map((uuid) => SpaceshipActorSheet.#resolveCrewEntry(uuid)),
      };
    });
  }

  /**
   * Resolve one stored crew UUID to a name/portrait, or to the `missing` placeholder the ticket
   * requires when the referenced Actor is gone.
   *
   * `resolveUuidSync` (not the async `fromUuid`) because Handlebars can't await and the Stations
   * tab has no post-render fill-in step; it returns the live Actor for a world document and a
   * plain index record (`{name, img, ...}`, enough for both fields here) for a compendium one -
   * an unresolvable reference of any kind (including the throw `fromUuidSync` raises for a
   * compendium UUID whose pack index isn't loaded) collapses to the same "Unknown" outcome.
   */
  static #resolveCrewEntry(uuid: string): CrewEntry {
    const doc = resolveUuidSync<{ name?: string | null; img?: string | null }>(uuid);

    if (!doc?.name) {
      return {
        uuid,
        name: game.i18n!.localize("DHSCIFI.Spaceship.Stations.UnknownCrew"),
        img: "icons/svg/mystery-man.svg",
        missing: true,
      };
    }

    return { uuid, name: doc.name, img: doc.img ?? "icons/svg/mystery-man.svg", missing: false };
  }

  static #isStationId(id: string): id is StationId {
    return (STATION_IDS as readonly string[]).includes(id);
  }

  /** Resolve the `data-station` of the closest station container (fieldset or crew row) to `el`. */
  static #getStationId(el: HTMLElement): StationId | undefined {
    const id = el.closest<HTMLElement>("[data-station]")?.dataset.station;
    return id && SpaceshipActorSheet.#isStationId(id) ? id : undefined;
  }

  static #isInventoryItemType(type: string): type is InventoryItemType {
    return (INVENTORY_ITEM_TYPES as readonly string[]).includes(type);
  }

  /** Whether `type` is an Item type this sheet can create/accept at all (inventory + `feature`). */
  static #isSpaceshipItemType(type: string): type is SpaceshipItemType {
    return (SPACESHIP_ITEM_TYPES as readonly string[]).includes(type);
  }

  /**
   * Every currently-equipped `weapon` item on the ship, in item order - the single source of truth
   * behind both the header's mount-count chip and the sidebar's equipped-weapons list (#17), so
   * the two can never disagree about which weapons count. `#countEquippedWeapons` and
   * `#buildEquippedWeapons` both call this rather than each re-deriving the filter.
   */
  static #getEquippedWeapons(actor: LooseActor): LooseDoc[] {
    return Array.from(actor.items).filter((item) => item.type === "weapon" && item.system.equipped === true);
  }

  /**
   * One equipped weapon = one used mount, regardless of `burden` (#6/CONTEXT.md's "Weapon
   * Mount" entry): unlike the character sheet's primary/secondary pairing, a ship doesn't halve
   * the cost of two one-handed weapons sharing a mount - each equipped weapon item gets its own.
   * Single source of truth for this count - `#buildInventoryContext`/the header chip (display) and
   * the equip/drop handlers below (cap enforcement) call this rather than each re-deriving it.
   */
  static #countEquippedWeapons(actor: LooseActor): number {
    return SpaceshipActorSheet.#getEquippedWeapons(actor).length;
  }

  /**
   * The sidebar's equipped-weapons list (#17), one row per `#getEquippedWeapons` entry. `labels`
   * comes from the weapon's own `_getLabels()` (falling back to an empty array for a ship item
   * without it, though every real weapon has one) - see `LooseDoc._getLabels`'s doc comment for why
   * this reads that rather than `_getTags()` (the fuller Inventory-tab tag set). `usable` is the
   * same `editable && item.usable` flag `toRowEntry` resolves for the Inventory tab's own row, so
   * the portrait here hovers/rolls the weapon's attack exactly like that one does.
   */
  static #buildEquippedWeapons(actor: LooseActor, editable: boolean): EquippedWeaponRow[] {
    return SpaceshipActorSheet.#getEquippedWeapons(actor).map((item) => ({
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      labels: item._getLabels?.() ?? [],
      usable: editable && (item.usable ?? false),
    }));
  }

  /** The actor's portrait. Same `FilePicker` flow as the System item sheet's, shared with it. */
  static async #onEditImage(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    if (!(target instanceof HTMLImageElement)) return;

    const attribute = target.dataset.edit;
    if (attribute) await pickDocumentImage(this.document, attribute);
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
   * The `daggerheart` sheets' pip-click rule, shared by every markable row on this sheet
   * (Hope/HP/Stress and, since #10, the Shield slots - upstream repeats it per handler):
   * clicking a pip marks up to it, unless it is already marked, in which case it steps back down
   * to the pip before it. `clicked` is 1-based, as `data-value` renders it.
   */
  static #togglePipValue(current: number, clicked: number): number {
    return current >= clicked ? clicked - 1 : clicked;
  }

  /**
   * Toggle a markable resource box (Hope/HP/Stress) via `#togglePipValue`. `data-resource` names
   * the resource key (`hope`/`hitPoints`/`stress`), `data-value` the clicked box's 1-based index.
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
    await this.document.update({ [path]: SpaceshipActorSheet.#togglePipValue(current, boxValue) });
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
    // (same gap `LooseDoc`/`LooseActor` work around above) - called through a loosened signature.
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

  /**
   * Open the row document's own sheet, from `data-item-uuid` on the clicked row - an Item's Item
   * sheet or an ActiveEffect's ActiveEffectConfig (#9), whichever the row holds. One action for
   * both, exactly as daggerheart has one `editDoc`.
   */
  static async #onEditItem(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const doc = SpaceshipActorSheet.#getRowDocument(target);
    doc?.sheet?.render(true);
  }

  /**
   * Equip/unequip a `weapon` or `armor` item, from `data-item-uuid` on the clicked row.
   *
   * Weapons: equipping beyond `maxWeaponMounts` is blocked - one mount per equipped weapon
   * regardless of `burden` (see `#countEquippedWeapons`).
   * Armor: equipping one unequips any other equipped armor (only one Shield source at a time,
   * mirroring the character sheet's single-armor-slot rule) - that single item is what
   * `SpaceshipData#prepareBaseData` derives Shield and the damage thresholds from (#10), so both
   * update live as this runs.
   */
  static async #onToggleEquipItem(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const actor = this.document as unknown as LooseActor;
    const item = SpaceshipActorSheet.#getRowDocument(target);
    if (!item || (item.type !== "weapon" && item.type !== ARMOR_ITEM_TYPE)) return;

    const equipping = !item.system.equipped;

    if (equipping && item.type === "weapon" && SpaceshipActorSheet.#countEquippedWeapons(actor) >= actor.system.maxWeaponMounts) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Inventory.MountsFull"));
      return;
    }

    await item.update({ "system.equipped": equipping });

    if (equipping && item.type === ARMOR_ITEM_TYPE) {
      const otherEquippedArmor = Array.from(actor.items).filter(
        (other) => other.type === ARMOR_ITEM_TYPE && other.id !== item.id && other.system.equipped === true,
      );
      await Promise.all(otherEquippedArmor.map((other) => other.update({ "system.equipped": false })));
    }
  }

  /**
   * Mark/unmark a Shield slot (#10), from `data-value` on the clicked pip.
   *
   * Only resolves the click to a value; the write itself belongs to `SpaceshipData#markShield`,
   * which owns both the equipped armor Item the value lands on and the clamp that keeps it in
   * range - the same split daggerheart has between its `toggleArmor` action and `updateArmorValue`.
   */
  static async #onToggleShield(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const actor = this.document as unknown as LooseActor;
    const slot = Number.parseInt(target.dataset.value ?? "", 10);
    if (Number.isNaN(slot)) return;

    await actor.system.markShield(SpaceshipActorSheet.#togglePipValue(actor.system.armorScore.value, slot));
  }

  /**
   * Resolve the embedded document referenced by the closest `[data-item-uuid]` ancestor of
   * `target` - mirrors daggerheart's own `getDocFromElementSync` helper, which every one of its
   * row actions (`editDoc`/`deleteDoc`/`toChat`/`toggleEffect`/...) goes through for exactly this
   * reason: a row can hold an Item *or* an ActiveEffect (#9), and a UUID resolves either, where
   * `actor.items.get(id)` (what this was before #9) only ever finds an Item.
   *
   * Resolved through the shared `resolveUuidSync` guard, same as `#resolveCrewEntry`'s.
   */
  static #getRowDocument(target: HTMLElement): LooseDoc | undefined {
    const uuid = target.closest<HTMLElement>("[data-item-uuid]")?.dataset.itemUuid;
    if (!uuid) return undefined;

    return resolveUuidSync<LooseDoc>(uuid) ?? undefined;
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
    const item = SpaceshipActorSheet.#getRowDocument(target);
    await item?.toChat?.(item.uuid);
  }

  /**
   * Create a new ActiveEffect on the ship (#9), from the "+" on an Effects tab legend.
   *
   * Mirrors daggerheart's own `createDoc` action for `type='effect'`: the `base` ActiveEffect
   * sub-type, named by the document class's own `defaultName`, and `disabled: true` when the "+"
   * clicked belongs to the *inactive* list (`data-disabled` on the anchor) - the same convention
   * its `inventory-fieldset-items-V2.hbs` legend uses, so creating from the inactive section lands
   * the new effect in that section rather than jumping to the active one.
   *
   * Shift-click skips opening the new effect's sheet, again matching daggerheart's `createDoc`.
   */
  static async #onCreateEffect(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    // fvtt-types' `ActiveEffect.create` signature is daggerheart-unaware (it has no knowledge of
    // the system's `base` ActiveEffect sub-type), the same gap `LooseDoc`/`LooseActor` work around
    // for Items - called through a loosened signature for the same reason.
    const cls = getDocumentClass("ActiveEffect") as unknown as {
      defaultName(context: { type: string; parent: unknown }): string;
      create(data: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown>;
    };
    const parent = this.document;
    await cls.create(
      {
        name: cls.defaultName({ type: "base", parent }),
        type: "base",
        // No `img`: daggerheart's own `DhActiveEffect#_preCreate` fills in
        // `icons/magic/life/heart-cross-blue.webp` for any effect created without one, so passing
        // one here would give ship effects a different default portrait than character ones.
        // Its `#onCreateDoc` passes none for the same reason.
        disabled: target.dataset.disabled === "true",
      },
      { parent, renderSheet: !event.shiftKey },
    );
  }

  /**
   * Enable/disable an ActiveEffect (#9), from `data-action="toggleEffect"` on the row's toggle -
   * the same one-line `update({ disabled: !disabled })` as daggerheart's own `toggleEffect` action.
   */
  static async #onToggleEffect(_event: PointerEvent, target: HTMLElement): Promise<void> {
    const effect = SpaceshipActorSheet.#getRowDocument(target);
    if (!effect) return;

    await SpaceshipActorSheet.#setEffectDisabled(effect, !effect.disabled);
  }

  /** The one write behind the row's toggle and the context menu's Enable/Disable pair alike. */
  static async #setEffectDisabled(effect: LooseDoc, disabled: boolean): Promise<void> {
    await effect.update({ disabled });
  }

  /**
   * Enable/disable a Station (#8), from `data-station` on the legend's toggle.
   *
   * Non-destructive: the station's existing `crew` array is left alone, so re-enabling restores
   * the previous assignments. A disabled station just refuses new drops (`_onDropActor`) and
   * renders dimmed.
   */
  static async #onToggleStation(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    _event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const stationId = SpaceshipActorSheet.#getStationId(target);
    if (!stationId) return;

    const path = `system.stations.${stationId}.enabled`;
    const current = foundry.utils.getProperty(this.document, path) as boolean;
    await this.document.update({ [path]: !current });
  }

  /**
   * Remove one crew assignment, from `data-station`/`data-uuid` on the clicked row.
   *
   * Confirms first unless Shift is held - the same pattern daggerheart's own party sheet uses for
   * removing a party member. Filters by UUID rather than by index so a station holding the same
   * Actor twice can't be desynced by a concurrent edit; duplicates can't be created through
   * `_onDropActor` anyway.
   */
  static async #onRemoveCrew(
    this: foundry.applications.sheets.ActorSheetV2.Any,
    event: PointerEvent,
    target: HTMLElement,
  ): Promise<void> {
    const row = target.closest<HTMLElement>("[data-uuid]");
    const uuid = row?.dataset.uuid;
    const stationId = SpaceshipActorSheet.#getStationId(target);
    if (!uuid || !stationId) return;

    if (!event.shiftKey) {
      const { name } = SpaceshipActorSheet.#resolveCrewEntry(uuid);
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n!.localize("DHSCIFI.Spaceship.Stations.RemoveCrew.title") },
        content: `<p>${game.i18n!.format("DHSCIFI.Spaceship.Stations.RemoveCrew.body", { name })}</p>`,
      });
      if (!confirmed) return;
    }

    const actor = this.document as unknown as LooseActor;
    const crew = actor.system.stations[stationId].crew.filter((entry) => entry !== uuid);
    await this.document.update({ [`system.stations.${stationId}.crew`]: crew });
  }

  /**
   * Open an assigned Actor's own sheet, from `data-uuid` on the clicked row - the Stations tab's
   * equivalent of an item row's portrait opening the Item sheet. Never rendered for a `missing`
   * entry (nothing to open), but still guarded: the reference can go stale between render and
   * click.
   */
  static async #onOpenCrew(_event: PointerEvent, target: HTMLElement): Promise<void> {
    const uuid = target.closest<HTMLElement>("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;

    const doc = (await fromUuid(uuid)) as { sheet?: { render: (options?: unknown) => unknown } | null } | null;
    doc?.sheet?.render(true);
  }

  /**
   * Assign a dropped PC Actor to the Station it was dropped on (#8), storing a one-way UUID
   * reference on the ship (`system.stations.<id>.crew`) - no back-link on the PC and no sync, per
   * CONTEXT.md's "Crew assignment" entry.
   *
   * Same wiring story as `_onDropItem` below: core `ActorSheetV2`'s own drag-drop already routes an
   * Actor drop here, so this overrides that hook rather than adding a competing listener - and
   * fvtt-types doesn't declare it, hence the `any`s. Unlike `_onDropItem` there's no base behavior
   * worth delegating to (core's default does nothing for an Actor dropped on an Actor sheet), so
   * this handles the drop outright.
   *
   * Which station? The drop's own `event.target` - stations are separate drop targets within the
   * one tab, so a drop that didn't land inside a `[data-station]` fieldset is rejected rather than
   * guessed at.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async _onDropActor(event: any, actor: any): Promise<any> {
    const dropped = actor as { uuid: string; type: string };
    const target = event.target as HTMLElement | null;
    const stationId = target ? SpaceshipActorSheet.#getStationId(target) : undefined;
    if (!stationId) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Stations.DropOnStation"));
      return null;
    }

    if (!(CREW_ACTOR_TYPES as readonly string[]).includes(dropped.type)) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Stations.InvalidActorType"));
      return null;
    }

    const ship = this.document as unknown as LooseActor;
    const station = ship.system.stations[stationId];
    if (!station.enabled) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Stations.StationDisabled"));
      return null;
    }

    if (station.crew.includes(dropped.uuid)) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Stations.AlreadyAssigned"));
      return null;
    }

    await this.document.update({ [`system.stations.${stationId}.crew`]: [...station.crew, dropped.uuid] });
    // Core's contract for this hook (`client/applications/sheets/actor-sheet.mjs`): return an Actor
    // to signal success, a nullish value to signal failure or no action taken - and
    // `_onDropDocument` propagates whatever comes back. Every rejection above returns `null`; this
    // path succeeded, so it returns the dropped Actor.
    return actor;
  }

  /**
   * Write the drag payload for an Item or ActiveEffect row being dragged off the sheet (#14),
   * overriding core `ActorSheetV2`'s own `_onDragStart` rather than its default dataset-based
   * lookup (`actor.items.get(target.dataset.itemId)`, then `.effects.get(target.dataset.effectId)`
   * for an effect) - that lookup reads `data-item-id`/`data-effect-id` straight off the dragged
   * element, which is not what this sheet's rows carry (`data-item-uuid` on the row, resolved via
   * `resolveUuidSync` - the same gap `#getRowDocument` exists to close for click handlers, since a
   * row can hold a top-level ActiveEffect (#9) as well as an Item). `event.currentTarget` is
   * whichever `.img-portait`/`.item-label` element core's own default `dragSelector` (`.draggable`,
   * unchanged - see `partials/inventory-item.hbs`) actually matched, so `#getRowDocument` walks up
   * from it to the row's `[data-item-uuid]` rather than reading its own dataset.
   *
   * `toDragData()` is core `ClientDocumentMixin` behavior, both Item and ActiveEffect get it - same
   * document-level reuse category as `toChat`/`_getTags` above, not sheet code. Same wiring story
   * as `_onDropItem`/`_onDropActor`: nothing here binds a second listener, this only overrides the
   * hook `_dragDrop`'s cached `dragstart` callback already calls (`this._onDragStart.bind(this)`,
   * resolved through the prototype chain to this override) - and fvtt-types doesn't declare it,
   * hence the `any`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _onDragStart(event: any): void {
    const target = event.currentTarget as HTMLElement;
    const dragData = SpaceshipActorSheet.#getRowDocument(target)?.toDragData?.();
    if (dragData) event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  // Same `any`/`any` reasoning as `_prepareContext`/`_preparePartContext` above.
  protected override async _onRender(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
  ): Promise<void> {
    await super._onRender(context, options);
    this.#bindLevelInput();
    this.#bindQuantityInputs();
    this.#bindItemContextMenu();
    void this.#enrichRowDescriptions();
  }

  /**
   * The header's level field writes through `SpaceshipData#updateLevel` rather than through the
   * form (#12), which is why it carries no `name`: typing a higher level records a *target* and
   * lights up the level-up button, typing a lower one de-levels the ship. A plain
   * `name="system.level"` input would move the level with no record of how, which is exactly what
   * the level-up history exists to prevent. Same arrangement, same `.level-value` hook, as
   * daggerheart's own character sheet.
   */
  #bindLevelInput(): void {
    const input = this.element.querySelector<HTMLInputElement>(".level-value");
    if (!input || !this.isEditable) return;

    input.addEventListener("change", (event) => {
      const field = event.currentTarget as HTMLInputElement;
      const system = (this.document as unknown as LooseActor).system;
      const raw = field.value.trim();
      const value = Number(raw);

      // An emptied or non-numeric field must not read as level 0: `updateLevel` would clamp it to
      // 1 and take the de-level path, dropping every level-up record the ship has. Put the real
      // level back in the box instead - the same thing a rejected edit does anywhere else.
      if (raw === "" || !Number.isInteger(value)) {
        field.value = String(system.levelData.changed);
        return;
      }
      void system.updateLevel(value);
    });
  }

  /** Open the level-up wizard for the ship's pending level(s). */
  static #onLevelUp(this: SpaceshipActorSheet): void {
    new SpaceshipLevelup(this.document as unknown as Actor.Implementation).render({ force: true });
  }

  /** Open the read-only review of the ship's past level-ups. */
  static #onViewLevelups(this: SpaceshipActorSheet): void {
    new SpaceshipLevelupView(this.document as unknown as Actor.Implementation).render({ force: true });
  }

  /** Whether the row `target` sits in holds an ActiveEffect rather than an Item (`data-type`). */
  static #isEffectRow(target: HTMLElement): boolean {
    return target.closest<HTMLElement>("[data-item-uuid]")?.dataset.type === "effect";
  }

  /**
   * `true`/`false` for an effect row's current `disabled` state, `undefined` for a row that isn't
   * an effect at all - so the Enable/Disable menu entries can each test one value and both stay
   * hidden on an item row. Read off the live document rather than the row's `data-disabled`
   * attribute: the attribute is what the *template* rendered, and a context menu opened against a
   * row whose effect was toggled elsewhere (another sheet, a macro) would otherwise offer the
   * entry that no longer applies.
   */
  static #isDisabledEffectRow(target: HTMLElement): boolean | undefined {
    if (!SpaceshipActorSheet.#isEffectRow(target)) return undefined;
    return SpaceshipActorSheet.#getRowDocument(target)?.disabled ?? undefined;
  }

  /**
   * The per-row context menu (the kebab/"..." button), matching the character sheet's own default
   * controls exactly (equip toggle, "Send to Chat", kebab menu - not standalone edit/delete icons,
   * see `inventory.hbs`'s comment). Built with core's own `ContextMenu` class, not daggerheart's
   * `triggerContextMenu` handler (sheet code, out of reach per docs/adr/0002).
   *
   * One menu for every row on the sheet, its entries switched on the row's `data-type` via core
   * `ContextMenu`'s own `condition` callback. Daggerheart instead registers *two* menus against two
   * selectors (`[data-type="effect"]` and `[data-type="feature"]`), because its base sheet class
   * takes a declarative `contextMenus` array; with one hand-built `ContextMenu` here, conditioned
   * entries are the same result with one binding. The Enable/Disable pair mirrors its own
   * `#getEffectContextOptions` (a conditioned pair keyed off the row's disabled state), and
   * Edit/Delete mirror the `_getContextMenuCommonOptions` every one of its menus appends.
   *
   * Cached on the instance and only constructed once, same reasoning as `ActorSheetV2`'s own
   * cached `_dragDrop`: `ContextMenu`'s constructor binds a listener to `container` (`this.element`
   * here, which persists across re-renders - only the parts inside it get replaced), so
   * constructing a new one on every render would accumulate listeners on that same element.
   */
  #bindItemContextMenu(): void {
    if (this.#itemContextMenu) return;

    this.#itemContextMenu = new foundry.applications.ux.ContextMenu.implementation(
      this.element,
      // Every `.inventory-item` on the sheet, not just the Inventory tab's - Features (#7) and
      // Effects (#9) render through the same row partial and get the same menu.
      ".inventory-item [data-action='triggerContextMenu']",
      [
        {
          name: "DHSCIFI.Rows.EnableEffect",
          icon: '<i class="fa-regular fa-lightbulb"></i>',
          condition: (target: HTMLElement) => SpaceshipActorSheet.#isDisabledEffectRow(target) === true,
          callback: (target: HTMLElement) => {
            const effect = SpaceshipActorSheet.#getRowDocument(target);
            if (effect) void SpaceshipActorSheet.#setEffectDisabled(effect, false);
          },
        },
        {
          name: "DHSCIFI.Rows.DisableEffect",
          icon: '<i class="fa-solid fa-lightbulb"></i>',
          condition: (target: HTMLElement) => SpaceshipActorSheet.#isDisabledEffectRow(target) === false,
          callback: (target: HTMLElement) => {
            const effect = SpaceshipActorSheet.#getRowDocument(target);
            if (effect) void SpaceshipActorSheet.#setEffectDisabled(effect, true);
          },
        },
        {
          name: "DHSCIFI.Rows.EditEffect",
          icon: '<i class="fa-solid fa-edit"></i>',
          condition: SpaceshipActorSheet.#isEffectRow,
          callback: (target: HTMLElement) => {
            SpaceshipActorSheet.#getRowDocument(target)?.sheet?.render(true);
          },
        },
        {
          name: "DHSCIFI.Rows.DeleteEffect.title",
          icon: '<i class="fa-solid fa-trash"></i>',
          condition: SpaceshipActorSheet.#isEffectRow,
          callback: (target: HTMLElement) => {
            const effect = SpaceshipActorSheet.#getRowDocument(target);
            if (effect) {
              void deleteRowDocument(
                effect,
                "DHSCIFI.Rows.DeleteEffect.title",
                "DHSCIFI.Rows.DeleteEffect.body",
              );
            }
          },
        },
        {
          name: "DHSCIFI.Rows.EditItem",
          icon: '<i class="fa-solid fa-edit"></i>',
          condition: (target: HTMLElement) => !SpaceshipActorSheet.#isEffectRow(target),
          callback: (target: HTMLElement) => {
            SpaceshipActorSheet.#getRowDocument(target)?.sheet?.render(true);
          },
        },
        {
          name: "DHSCIFI.Rows.DeleteItem.title",
          icon: '<i class="fa-solid fa-trash"></i>',
          condition: (target: HTMLElement) => !SpaceshipActorSheet.#isEffectRow(target),
          callback: (target: HTMLElement) => {
            const item = SpaceshipActorSheet.#getRowDocument(target);
            if (item) {
              void deleteRowDocument(
                item,
                "DHSCIFI.Rows.DeleteItem.title",
                "DHSCIFI.Rows.DeleteItem.body",
              );
            }
          },
        },
      ],
      // `fixed: true` (#14): core `ContextMenu`'s default (`fixed: false`) injects the menu as a
      // child of `target` itself, positioned with `position: absolute` - fine for a row near the
      // top of a tall list, but the Inventory/Features/Effects tabs (`.items-list`, scrolled
      // internally - see `docs/adr/0002`'s `.items-section` note) clip that absolute child to
      // their own scroll bounds, so a menu opened on a row near the bottom renders off-screen
      // below the visible list instead of over it. `fixed: true` instead renders the menu through
      // the Popover API, appended to `document.body` (`_setFixedPosition`,
      // `client/applications/ux/context-menu.mjs`) - floats above the whole sheet window, immune
      // to any ancestor's `overflow`, positioned at the triggering click's own coordinates
      // (`relative`'s default, `"cursor"`).
      { eventName: "click", jQuery: false, fixed: true },
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
    const droppedItem = item as LooseDoc;
    if (!SpaceshipActorSheet.#isSpaceshipItemType(droppedItem.type)) {
      ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.Inventory.InvalidItemType"));
      return null;
    }

    const base = Object.getPrototypeOf(SpaceshipActorSheet.prototype) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _onDropItem(event: any, item: any): Promise<any>;
    };
    const result = (await base._onDropItem.call(this, event, item)) as LooseDoc | null;

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
    const inputs = this.element.querySelectorAll<HTMLInputElement>(".inventory-item-quantity");
    inputs.forEach((input) => {
      input.addEventListener("change", () => {
        const item = SpaceshipActorSheet.#getRowDocument(input);
        const quantity = Number.parseInt(input.value, 10);
        if (item && !Number.isNaN(quantity)) void item.update({ "system.quantity": Math.max(0, quantity) });
      });
    });
  }

  /**
   * Fill in each expandable row's `.inventory-description` with the document's own enriched
   * description HTML, mirroring daggerheart's own `#prepareInventoryDescription` (document-level
   * `getEnrichedDescription()` + `TextEditor.enrichHTML`, not sheet code) - Handlebars can't
   * `await`, so `partials/inventory-item.hbs` renders the container empty and this fills it in
   * post-render. Covers every `.inventory-item` on the sheet (Inventory, Features, and Effects).
   *
   * The `doc.description` fallback is the ActiveEffect case (#9): an effect's description is a
   * top-level document field, not `system.description` like an Item's. Same two-step fallback
   * daggerheart's own version does (`doc.system?.description ?? doc.description`).
   */
  async #enrichRowDescriptions(): Promise<void> {
    const rows = this.element.querySelectorAll<HTMLElement>(".inventory-item[data-item-uuid]");
    for (const row of rows) {
      const uuid = row.dataset.itemUuid;
      const descriptionElement = row.querySelector<HTMLElement>(".inventory-description");
      if (!uuid || !descriptionElement) continue;

      const doc = (await fromUuid(uuid)) as unknown as LooseDoc | null;
      if (!doc) continue;

      const description = doc.system.getEnrichedDescription
        ? await doc.system.getEnrichedDescription()
        : (doc.system.description ?? doc.description ?? "");
      descriptionElement.innerHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        description,
        { secrets: doc.isOwner ?? false },
      );
    }
  }

}
