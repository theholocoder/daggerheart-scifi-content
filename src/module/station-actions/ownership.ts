/**
 * The **station-actions** seam (#21/#22): the module's pure decisions about Stations, over plain
 * data only.
 *
 * Nothing here touches an `Actor`, an `Item` or `game` - not in a signature and not in a body.
 * Callers resolve documents, hand this module arrays, records and numbers, and apply whatever it
 * returns. That is what makes the rules readable in one place and testable without Foundry (see
 * #21's Testing Decisions: the sheet, the wrench dialog and the action-running path are
 * Foundry-bound and are deliberately *not* part of this seam).
 *
 * This file holds the ownership half - who may open a Spaceship, derived from its crew.
 */

/**
 * The `ownership` key core Foundry reserves for "every user without an entry of their own"
 * (`DocumentOwnershipField`'s `default`). Not a user id, so every routine below skips it when it
 * walks the map.
 */
export const OWNERSHIP_DEFAULT_KEY = "default";

/**
 * One Station as this module needs to see it: its crew, as Actor UUID strings.
 *
 * `enabled` is deliberately absent. Disabling a Station is non-destructive - it keeps its `crew`
 * array so re-enabling restores the assignments (`SpaceshipActorSheet#onToggleStation`) - so a
 * disabled Station's crew still own the ship, and toggling a Station changes no ownership at all
 * (#22's acceptance criteria).
 */
export interface CrewedStation {
  crew: readonly string[];
}

/** The ownership map of a document: user id (or `default`) to a `DOCUMENT_OWNERSHIP_LEVELS` value. */
export type OwnershipMap = Readonly<Record<string, number>>;

/**
 * An `ownership` update fragment, ready to be merged into a document update: user id to the level
 * that user should hold explicitly.
 *
 * Reverting a user is a *write of the `default` level*, not a removal of their entry. Foundry's
 * `-=`/`ForcedDeletion` update syntax is migrated only for schema keys, not for keys *inside* an
 * `ObjectField`'s value - and `ownership` is one (`DocumentOwnershipField`), whose validator
 * rejects both a `-=<userId>` key and a `null` level outright. So the user is left with an explicit
 * entry that says exactly what `default` says, which is the same access with a redundant row.
 */
export type OwnershipPatch = Record<string, number>;

/**
 * Every Actor UUID crewing this ship, in first-seen order and without duplicates - the union over
 * *all* Stations, which is what makes one routine cover assign, remove and Station toggling with
 * no special cases (#21's Permissions decision).
 *
 * The same Actor crewing two Stations appears once, which is exactly the case that must keep its
 * ownership when it is removed from one of them.
 */
export function crewUuids(stations: Iterable<CrewedStation>): string[] {
  const seen = new Set<string>();
  for (const station of stations) {
    for (const uuid of station.crew) seen.add(uuid);
  }
  return [...seen];
}

/**
 * The user ids explicitly holding `ownerLevel` on a document - the "owning users" of a crewed
 * character, whom a Crew assignment grants access to the ship.
 *
 * Explicit entries only: a character whose ownership is nothing but a permissive `default` has no
 * *particular* player behind it, and granting the whole table ownership of the ship is not what
 * assigning that character meant. A character with no owning user therefore yields an empty list,
 * which is what makes NPC crew a harmless no-op (#22).
 */
export function owningUserIds(ownership: OwnershipMap, ownerLevel: number): string[] {
  return Object.entries(ownership)
    .filter(([userId, level]) => userId !== OWNERSHIP_DEFAULT_KEY && level === ownerLevel)
    .map(([userId]) => userId);
}

/**
 * The ownership change a Spaceship needs so that exactly its crew's owning users hold `ownerLevel`
 * on it, or `null` when the ship is already in that state (the common case on a re-render, and the
 * reason this can be run on every `stations` write without churning the database).
 *
 * Derived, not incremental: `crewUserIds` is the union over every Station, so the same call covers
 * "a player was assigned" (they gain `ownerLevel`), "a player was removed" (they drop back to the
 * ship's `default`, unless they still crew another Station) and "a Station was toggled" (nothing
 * changes at all).
 *
 * Only entries at exactly `ownerLevel` are ever reverted. A user the GM has hand-granted a *lower*
 * level - an observer with no character on the crew - is left alone; pushing them to `default`
 * would be a change this module was never asked to make. A hand-granted *owner* is not
 * distinguishable from a crew grant and is reverted, which is what "ownership is derived from the
 * union of every Station's crew" (#21) means.
 */
export function crewOwnershipPatch(
  crewUserIds: Iterable<string>,
  ownership: OwnershipMap,
  ownerLevel: number,
  defaultLevel: number,
): OwnershipPatch | null {
  const crew = new Set(crewUserIds);
  const patch: OwnershipPatch = {};

  for (const userId of crew) {
    if (ownership[userId] !== ownerLevel) patch[userId] = ownerLevel;
  }

  // Nothing to revert when the ship's `default` is already `ownerLevel`: the entry would be
  // rewritten to the value it holds, every write, forever.
  if (defaultLevel !== ownerLevel) {
    for (const [userId, level] of Object.entries(ownership)) {
      if (userId === OWNERSHIP_DEFAULT_KEY) continue;
      if (level === ownerLevel && !crew.has(userId)) patch[userId] = defaultLevel;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
