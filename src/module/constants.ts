export const MODULE_ID = "daggerheart-scifi-content";

/** Namespaced Actor sub-type, per Foundry's module `documentTypes` mechanism. */
export const SPACESHIP_ACTOR_TYPE = `${MODULE_ID}.spaceship`;

/**
 * The six traits a Spaceship has, in sheet order - the same six a `daggerheart` character has
 * (CONTEXT.md's "Spaceship" entry: same core stat shape as a character).
 *
 * Named here because three places need the set and its order: `SpaceshipData`'s schema, the level-up
 * wizard's trait picker (#12), and the `DHSCIFI.Spaceship.Traits.<key>` localization keys both
 * render through.
 */
export const TRAIT_KEYS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"] as const;

/**
 * The five fixed crew Stations a Spaceship has (#8, CONTEXT.md's "Station" entry). Fixed, not
 * user-extensible: a ship enables/disables individual stations rather than adding its own.
 *
 * Shared between `SpaceshipData`'s schema (one sub-field per id) and `SpaceshipActorSheet`'s
 * Stations tab context/drop handler, so the set and its iteration order are defined once. Each id
 * is also a localization key suffix under `DHSCIFI.Spaceship.Stations.Roles`.
 */
export const STATION_IDS = ["pilot", "mechanic", "commander", "systemsOperator", "gunner"] as const;

/**
 * Actor types a Station accepts as a crew assignment (#8). Just `character`: CONTEXT.md defines a
 * crew assignment as a reference to a *PC* Actor, and daggerheart's `character` is that type.
 *
 * A list rather than a bare comparison so widening it later (NPC crew, companions - daggerheart's
 * own party sheet accepts `['character','companion','adversary','npc']`) is one edit; the
 * user-facing rejection message in `lang/*.json` names the same set in prose and still has to be
 * updated by hand, same as `SPACESHIP_ITEM_TYPES`'s.
 */
export const CREW_ACTOR_TYPES = ["character"] as const;

/** The `daggerheart` Item types the Spaceship sheet's Inventory tab lists (#6). */
export const INVENTORY_ITEM_TYPES = ["weapon", "armor", "consumable", "loot"] as const;

/**
 * The `daggerheart` Item type a Spaceship's Shield and damage thresholds derive from (#10) - the
 * system's ordinary `armor` item, not a ship-only mechanic (CONTEXT.md's "Shield" entry). Named
 * here because three places key off it: `SpaceshipData`'s `armor` getter, the sheet's
 * single-equipped-armor rule, and its Shield-slot handler.
 */
export const ARMOR_ITEM_TYPE = "armor";

/**
 * The `system.changes` entry type daggerheart uses for an ActiveEffect that grants Shield slots
 * and/or base damage thresholds (`CONFIG.DH.EFFECTS.customChangeTypes.armor.id`, #10). Same
 * spelling as `ARMOR_ITEM_TYPE` above, deliberately kept separate: one names an Item sub-type, the
 * other a key in daggerheart's effect-change registry, and only coincidence makes them equal.
 */
export const ARMOR_EFFECT_CHANGE_TYPE = "armor";

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
