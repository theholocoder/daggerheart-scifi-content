import { SYSTEM_ITEM_TYPE } from "../../constants";

/**
 * The `system.actions` field class, borrowed from `daggerheart`'s own `loot` item at schema-build
 * time.
 *
 * `ActionsField` is the one piece of the `loot`-equivalent shape this module cannot define for
 * itself: it is a `TypedObjectField` whose element field swaps DataModel class per action `type`
 * (`game.system.api.models.actions.actionsTypes`), and unlike `RollField`/`CostField`/etc. it is
 * *not* re-exported on `game.system.api.fields` (only `ActionCollection`/`ActionFields` are). So
 * it is reached through the live `CONFIG.Item.dataModels` registry instead - the same
 * "stable CONFIG path, class read off an instance" route
 * `src/module/compat/character-only-patches.ts` already takes for `DHActionRollData`, and the
 * narrowest possible dependency on daggerheart internals (one class identity, no behavior copied).
 *
 * Returns `null` rather than a stand-in field if `loot` ever stops carrying `actions`: the whole
 * `actions` key is then simply absent from our schema, which every consumer already tolerates
 * (`DHItem#prepareEmbeddedDocuments` iterates `this.system.actions ?? []`, our own `actionsList`
 * does the same). A structurally-similar-but-wrong field would be worse - a plain
 * `TypedObjectField` initializes to a non-iterable object and would throw in that very loop.
 */
function borrowActionsField(): foundry.data.fields.DataField.Any | null {
  const lootModel = (CONFIG.Item.dataModels as Record<string, { schema?: { fields?: Record<string, unknown> } }>)
    .loot;
  const lootActions = lootModel?.schema?.fields?.actions as { constructor?: unknown } | undefined;
  const ActionsField = lootActions?.constructor as (new () => foundry.data.fields.DataField.Any) | undefined;

  if (!ActionsField) {
    console.warn("DHSciFi | could not locate daggerheart's ActionsField - System items will carry no actions.");
    return null;
  }
  return new ActionsField();
}

/**
 * DataModel for the module-registered `daggerheart-scifi-content.system` Item sub-type (#15): a
 * piece of installed ship equipment bought with System Points (CONTEXT.md's "System (Item)").
 *
 * Modeled on `daggerheart`'s `DHLoot` - which is `BaseDataItem` with `hasDescription`,
 * `isInventoryItem` and `hasActions` metadata and no schema of its own - plus one added field,
 * `systemPointsCost`. The fields those three flags produce (`description`/`gmNotes`, `quantity`,
 * `actions`) and the `attribution` block every item carries are re-declared here rather than
 * inherited, for the same reason `SpaceshipData` re-declares the character stat shape: `BaseDataItem`
 * is internal to daggerheart's bundle and unsafe to subclass across the module boundary
 * (docs/adr/0001, docs/adr/0002). Only `ActionsField` itself is borrowed - see `borrowActionsField`.
 *
 * Standard vs. Advanced (the ticket's open question) is deliberately *not* a schema field: it is
 * compendium folder organisation only (`packs-src/character-options/Spaceships/Systems/{Standard,
 * Advanced}`), since nothing in the rules keys off it mechanically - it only says when a system may
 * be acquired, which is a table ruling rather than sheet state.
 *
 * `metadata`, `getRollData`, `getLinkedItems`, `actionsList` and the description helpers are not
 * this module's own convention: they are the surface `daggerheart`'s world-global `DHItem` document
 * class (`CONFIG.Item.documentClass`, not overridable per sub-type) reads off *every* item's
 * `system`, ours included - `metadata.isInventoryItem` from `DHItem#isInventoryItem`,
 * `getLinkedItems()` unconditionally from `DHItem.deleteDocuments`, `getRollData()` from
 * `DHItem#getRollData`, `actionsList` from `DHItem#usable`, and `getEnrichedDescription()` from
 * every sheet that renders an item row (the Spaceship sheet's included). Each mirrors
 * `BaseDataItem`'s own implementation.
 */
export default class SystemItemData extends foundry.abstract.TypeDataModel<
  SystemItemData.Schema,
  Item.Implementation
> {
  static LOCALIZATION_PREFIXES = ["DHSCIFI.SystemItem"];

  /**
   * Same flags `DHLoot` sets, at the same values. `hasResource` stays false (loot has no resource
   * die/counter) and `hasAttribution` true (every `BaseDataItem` carries the attribution block).
   */
  static get metadata(): SystemItemData.Metadata {
    return {
      label: `TYPES.Item.${SYSTEM_ITEM_TYPE}`,
      type: SYSTEM_ITEM_TYPE,
      hasDescription: true,
      hasResource: false,
      isInventoryItem: true,
      hasActions: true,
      hasAttribution: true,
    };
  }

  get metadata(): SystemItemData.Metadata {
    return (this.constructor as typeof SystemItemData).metadata;
  }

  /**
   * `DHItem.getDefaultArtwork` reads `CONFIG.Item.dataModels[type].DEFAULT_ICON` for every created
   * item. A core Foundry icon rather than one of daggerheart's own item SVGs (all of them fantasy
   * props) - a circuit chip is the closest thing core ships to a piece of installed vehicle tech.
   */
  static DEFAULT_ICON = "icons/commodities/tech/electronics-chip-data.webp";

  /** Convenient access to the item's actor, if it has one. Same one-liner as `BaseDataItem`. */
  get actor(): Actor.Implementation | null {
    return this.parent.actor;
  }

  /**
   * The actions this item offers. `BaseDataItem#actionsList` returns `[]` whenever the owning actor
   * isn't a `character`, which is precisely the gate `src/module/compat/character-only-patches.ts`
   * has to wrap for daggerheart's own item types on a ship; this model simply doesn't have it, so
   * no patch is registered for `system` items.
   */
  get actionsList(): Iterable<unknown> & { size?: number } {
    return (this.actions ?? []) as unknown as Iterable<unknown> & { size?: number };
  }

  /**
   * Items granted *by* this one. Always empty: a System grants no features (it has no
   * `system.features` link field, which is what daggerheart's granter mechanic keys off). Defined
   * anyway because `DHItem.deleteDocuments` calls it unconditionally on every item being deleted.
   */
  getLinkedItems(): never[] {
    return [];
  }

  /**
   * Data made available to roll formulas on this item's actions. Mirrors `BaseDataItem#getRollData`
   * minus its `createShallowProxy` wrapper (an internal helper of daggerheart's bundle whose only
   * purpose is to let a formula reach the model's getters without retaining it) - handing the model
   * itself over is the same reachable data.
   */
  getRollData(): Record<string, unknown> {
    const data = (this.actor?.getRollData() ?? {}) as Record<string, unknown>;
    data.item = this;
    return data;
  }

  /**
   * The item's tag chips, as the Spaceship sheet's item rows render them (`DHItem#_getTags`
   * forwards to this when the model defines it - the same hook daggerheart's own weapon/armor tags
   * come through). One chip: what this System costs to install, which is the whole reason the
   * sub-type exists.
   */
  _getTags(): string[] {
    return [game.i18n!.format("DHSCIFI.SystemItem.CostTag", { cost: String(this.systemPointsCost) })];
  }

  /**
   * The description as `getEnrichedDescription` composes it. Split out for the same reason
   * `BaseDataItem` splits it: a sub-type augments the description by overriding this, not the
   * enrichment around it.
   */
  getDescriptionData(): { prefix: string | null; value: string | null; suffix: string | null } {
    return { prefix: null, value: this.description, suffix: null };
  }

  /**
   * Enriched description HTML, with the GM-notes block appended for a GM. Mirrors
   * `BaseDataItem#getEnrichedDescription`, minus its `embed` mode (`simplifyDescriptionForEmbed` is
   * internal to daggerheart's bundle, and nothing here renders an embed).
   *
   * Called by name from the Spaceship sheet's row-description enrichment and from this item sheet's
   * Description tab, so its signature has to match what daggerheart's own items expose.
   */
  async getEnrichedDescription(config: { gmNotes?: boolean } = {}, options: Record<string, unknown> = {}) {
    const { prefix, value, suffix } = this.getDescriptionData();
    let fullDescription = [prefix, value, suffix].filter((part) => !!part).join("\n<hr>\n");

    if (this.gmNotes && (config.gmNotes ?? true)) {
      const section = document.createElement("section");
      section.classList.add("gm-notes-section");
      section.dataset.visibility = "gm";
      const header = document.createElement("header");
      header.classList.add("gm-notes");
      header.textContent = game.i18n!.localize("DHSCIFI.SystemItem.FIELDS.gmNotes.label");
      section.innerHTML = header.outerHTML + this.gmNotes;
      fullDescription += section.outerHTML;
    }

    return await foundry.applications.ux.TextEditor.implementation.enrichHTML(fullDescription, {
      ...options,
      relativeTo: this.parent,
      rollData: this.getRollData(),
      secrets: this.parent.isOwner,
    });
  }

  static override defineSchema(): SystemItemData.Schema {
    const fields = foundry.data.fields;
    const actions = borrowActionsField();

    const schema = {
      // `BaseDataItem`'s own `attribution` block, verbatim - every daggerheart item carries it and
      // its `artist` half is rendered by the Description tab's attribution label.
      attribution: new fields.SchemaField({
        source: new fields.StringField(),
        page: new fields.NumberField(),
        artist: new fields.StringField(),
      }),
      // `hasDescription`'s two fields.
      description: new fields.HTMLField({ required: true, nullable: true }),
      gmNotes: new fields.HTMLField({ required: true, nullable: true }),
      // `isInventoryItem`'s field, same options as `BaseDataItem`'s.
      quantity: new fields.NumberField({ integer: true, initial: 1, min: 0, required: true }),
      // The one field this sub-type adds over `loot`: how much of the ship's System Points pool
      // installing this consumes. `SpaceshipData#systemPointsSpent` sums it across the ship's
      // installed Systems.
      systemPointsCost: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
      }),
    };

    // Conditional rather than always-present: see `borrowActionsField` for why an absent key beats
    // a wrong field. The cast is what lets the declared `Schema` keep `actions` non-optional -
    // consumers that read it go through `DHItem`/`actionsList`, both of which handle it missing.
    if (actions) (schema as Record<string, unknown>).actions = actions;
    return schema as unknown as SystemItemData.Schema;
  }
}

namespace SystemItemData {
  /** The shape `DHItem` reads off `system.metadata` - same keys as `BaseDataItem.metadata`. */
  export interface Metadata {
    label: string;
    type: string;
    hasDescription: boolean;
    hasResource: boolean;
    isInventoryItem: boolean;
    hasActions: boolean;
    hasAttribution: boolean;
  }

  export interface Schema extends foundry.data.fields.DataSchema {
    attribution: foundry.data.fields.SchemaField<{
      source: foundry.data.fields.StringField;
      page: foundry.data.fields.NumberField;
      artist: foundry.data.fields.StringField;
    }>;
    description: foundry.data.fields.HTMLField<{ required: true; nullable: true }>;
    gmNotes: foundry.data.fields.HTMLField<{ required: true; nullable: true }>;
    quantity: foundry.data.fields.NumberField<{ integer: true; initial: 1; min: 0; required: true }>;
    /** System Points consumed by installing this System (#15). */
    systemPointsCost: foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      integer: true;
      min: 0;
      initial: 0;
    }>;
    /**
     * daggerheart's own `ActionsField`, borrowed at schema-build time - typed only as loosely as
     * fvtt-types can express it (a `TypedObjectField` of opaque action data; at runtime the field
     * initializes it to daggerheart's `ActionCollection` of Action documents).
     */
    actions: foundry.data.fields.TypedObjectField<foundry.data.fields.ObjectField>;
  }
}

