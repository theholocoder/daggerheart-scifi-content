/**
 * The shared plumbing behind this module's two row-rendering partials
 * (`templates/partials/inventory-fieldset-items.hbs` and `inventory-item.hbs`).
 *
 * Both the Spaceship actor sheet and the System item sheet (#15) render lists through those
 * partials, so both have to hand them the *same* row context. That shape and the code that builds
 * it live here rather than being written twice - the TypeScript counterpart of sharing the
 * partials themselves, and the same "generalize, don't duplicate" line docs/adr/0002's #7 and #9
 * addenda drew for the templates.
 *
 * Everything here is typed against the narrowest shape the partials actually read, not against
 * `Item.Implementation`/`ActiveEffect.Implementation`: fvtt-types knows nothing of daggerheart's
 * Item sub-types, its ActiveEffect sub-types, or its Action pseudo-documents (docs/adr/0002), and
 * a row can hold any of the three. Each sheet keeps its own richer local interface for the fields
 * only it needs (`system.equipped`, `system.quantity`, ...); those structurally satisfy the
 * minimal shapes below, so nothing has to be cast at the call site.
 */

/**
 * What `dhscifi.inventory-item` reads off the document it is given. Deliberately minimal: an Item,
 * an ActiveEffect and a daggerheart Action are all rendered through that one partial, and only
 * `id`/`uuid`/`name`/`img` are common to all three - everything else is optional and simply absent
 * on the row types that don't have it.
 */
export interface RowDocument {
  id: string;
  uuid: string;
  name: string;
  img?: string | null;
  /**
   * Daggerheart's own `Item`/`DhActiveEffect`-level tag mixin (not sheet code), which is what
   * renders the "Finesse"/"One-Handed"/"d8+1 (Phy)" chips. Absent on Action documents.
   */
  _getTags?: () => string[];
  /** Item/effect-level: is there description text worth an expand affordance? */
  hasDescription?: boolean;
  /** Item-level: should the portrait roll/use the document rather than open its sheet? */
  usable?: boolean;
  /** Item/effect-level: posts to chat. Absent on Action documents. */
  toChat?: (uuid: string) => Promise<unknown>;
  /** ActiveEffect-only: the stored flag the Effects lists' toggle flips. */
  disabled?: boolean;
}

/**
 * One rendered row: the live document plus the display bits Handlebars can't compute for itself.
 *
 * Kept under the key `item` because the row partial is daggerheart's own `inventory-item` markup
 * copied by value, where that is what the document is called - even when the row holds an
 * ActiveEffect or an Action.
 */
export interface ItemRowEntry {
  item: RowDocument;
  tags: string[];
  hasDescription: boolean;
  usable: boolean;
  canChat: boolean;
  disabled: boolean;
}

/**
 * Build one row's context.
 *
 * `tags` is resolved here, not read as `item._getTags` from the template: Handlebars only binds a
 * resolved function's `this` correctly to the object it is a *direct* property of (daggerheart's
 * own item-tags.hbs relies on exactly that, invoking `_getTags` as a bare path with `item` as the
 * partial's context) - a nested path like `item._getTags` would call it with the wrong `this` and
 * break every tag that reads `this.attack`/etc.
 *
 * `usable` is ANDed with `editable` here rather than gated in the template, because the character
 * sheet's equivalent is one uniform flag: *both* its tabs pass `showActions=@root.editable` into
 * `inventory-item-V2.hbs`, whose portrait falls back to "open the sheet" whenever that is false.
 *
 * `canChat` mirrors daggerheart's own `{{#if (hasProperty item "toChat")}}` guard around the same
 * control. Resolved here rather than in the template for the same reason `tags` is - this module
 * registers only its own Handlebars helpers (docs/adr/0002) and has no `hasProperty`.
 *
 * `disabled` is ActiveEffect-only and drives the row's `data-disabled` marker, which is what the
 * Spaceship sheet's context menu keys its Enable/Disable entries off.
 */
export function toRowEntry(doc: RowDocument, editable: boolean): ItemRowEntry {
  return {
    item: doc,
    tags: doc._getTags?.() ?? [],
    hasDescription: doc.hasDescription ?? false,
    usable: editable && (doc.usable ?? false),
    canChat: typeof doc.toChat === "function",
    disabled: doc.disabled ?? false,
  };
}

/** The minimum a row's delete control needs of the document behind it. */
interface DeletableDocument {
  name: string;
  delete(): Promise<unknown>;
}

/**
 * Delete a row document behind a confirm dialog.
 *
 * `titleKey`/`bodyKey` are passed rather than derived: the same control deletes an Item, an
 * ActiveEffect or an Action depending on which list it sits in, and the wording is the only thing
 * that differs between the three.
 */
export async function deleteRowDocument(
  doc: DeletableDocument,
  titleKey: string,
  bodyKey: string,
): Promise<void> {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n!.localize(titleKey) },
    content: `<p>${game.i18n!.format(bodyKey, { name: doc.name })}</p>`,
  });
  if (!confirmed) return;

  await doc.delete();
}

/** The minimum `pickDocumentImage` needs of the document whose artwork is being changed. */
interface ImageableDocument {
  update(data: Record<string, unknown>): Promise<unknown>;
}

/**
 * Open a FilePicker to change a document's portrait, mirroring core Foundry's own `editImage`
 * action convention. Shared by the Spaceship actor sheet and the System item sheet, whose
 * `editImage` handlers are otherwise identical.
 *
 * `attribute` comes from the clicked element's `data-edit` (core's convention), so it names the
 * document path to write - `img` in both of this module's uses.
 */
export async function pickDocumentImage(document: ImageableDocument, attribute: string): Promise<void> {
  const current = foundry.utils.getProperty(document, attribute) as string | undefined;
  const picker = new foundry.applications.apps.FilePicker.implementation({
    current,
    type: "image",
    callback: (path: string) => {
      void document.update({ [attribute]: path });
    },
  });
  await picker.browse();
}
