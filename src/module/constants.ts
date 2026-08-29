export const MODULE_ID = "daggerheart-scifi-content";

/** Namespaced Actor sub-type, per Foundry's module `documentTypes` mechanism. */
export const SPACESHIP_ACTOR_TYPE = `${MODULE_ID}.spaceship`;

/** The `daggerheart` Item types the Spaceship sheet's Inventory tab lists (#6). */
export const INVENTORY_ITEM_TYPES = ["weapon", "armor", "consumable", "loot"] as const;

/** The `daggerheart` Item type the Spaceship sheet's Features tab lists (#7). */
export const FEATURE_ITEM_TYPE = "feature";

/**
 * Every Item type a Spaceship accepts: the Inventory tab's four plus `feature`, the Features
 * tab's own type (#7).
 *
 * Lives here rather than in either consumer because the rule is enforced in *two* places that
 * must agree - `SpaceshipActorSheet` (rejects a bad drop/create with our own message) and
 * `SpaceshipData#isItemValid` (the document-level gate daggerheart's own `Item.createDocuments`
 * override consults for every embedded create, ours included). Both import this list so widening
 * it is one edit, not two that can silently drift; see docs/adr/0002-spaceship-sheet-independent-
 * application.md's #7 addendum. The user-facing "invalid item type" message in `lang/*.json`
 * enumerates the same list in prose and still has to be updated by hand.
 */
export const SPACESHIP_ITEM_TYPES = [...INVENTORY_ITEM_TYPES, FEATURE_ITEM_TYPE] as const;
