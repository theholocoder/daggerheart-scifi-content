import { MODULE_ID, SPACESHIP_ACTOR_TYPE } from "../constants";
import { resolveUuidSync } from "../utils/resolve-uuid";
import {
  OWNERSHIP_DEFAULT_KEY,
  crewOwnershipPatch,
  crewUuids,
  owningUserIds,
  type CrewedStation,
  type OwnershipMap,
} from "./ownership";

/**
 * The Foundry-bound edge of the ownership half of **station-actions** (#22): it resolves the
 * documents, calls the pure routines in `./ownership.ts` - the actual seam, which sees plain data
 * only - and writes the result.
 *
 * A Crew assignment is the one thing on a Spaceship that writes *outside* the ship (CONTEXT.md's
 * "Crew assignment"): assigning a PC grants that PC's owning users OWNER on the Spaceship, which is
 * what lets a player press a Station action at all; removing the assignment reverts them to the
 * ship's `default`, unless the same user still crews another Station. Ownership is derived from the
 * union of every Station's crew, so this one routine covers assign, remove and Station toggling
 * with no special cases.
 *
 * The write is silent (never a dialog) and GM-only, since only a GM may change `ownership`. That is
 * why it runs off the `updateActor` hook rather than at the Stations tab's call sites: a player
 * holding OWNER on a Spaceship can assign crew, their own client attempts nothing, and the active
 * GM's client - which sees the same hook - performs the write for them. With no GM connected the
 * assignment still lands and the grant waits for the next Stations write made while one is online;
 * closing that window would need a socket handshake this ticket does not call for.
 */

/**
 * The parts of a Spaceship Actor this file reads. Loose for the same reason the sheet's
 * `LooseActor` is (docs/adr/0002-spaceship-sheet-independent-application.md): fvtt-types knows
 * nothing of this module's Actor sub-type or of `SpaceshipData`'s schema.
 */
interface LooseSpaceship {
  type: string;
  system: { stations: Record<string, CrewedStation> };
  ownership: OwnershipMap;
  update(data: Record<string, unknown>): Promise<unknown>;
}

/** The parts of a crewed Actor this file reads - its ownership map, and nothing else. */
interface LooseCrewActor {
  ownership: OwnershipMap;
}

/**
 * Bring a Spaceship's `ownership` in line with its crew, and write nothing at all if it already is.
 *
 * A no-op - not an error - for a crewed character with no owning user (NPC crew) and for a stale or
 * unresolvable crew UUID: crew assignments are one-way references that are never synced, so this
 * has to tolerate every one of them going bad (CONTEXT.md's "Crew assignment").
 */
async function syncCrewOwnership(spaceship: LooseSpaceship): Promise<void> {
  const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const defaultLevel = spaceship.ownership[OWNERSHIP_DEFAULT_KEY] ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;

  const crewUserIds = new Set<string>();
  for (const uuid of crewUuids(Object.values(spaceship.system.stations))) {
    // Synchronous resolution, same as the Stations tab's own `#resolveCrewEntry`: it swallows the
    // throw a compendium UUID with an unloaded pack index raises, which is exactly the "reference
    // has gone bad" case this must survive.
    const crewActor = resolveUuidSync<LooseCrewActor>(uuid);
    if (!crewActor) continue;
    for (const userId of owningUserIds(crewActor.ownership, ownerLevel)) crewUserIds.add(userId);
  }

  const patch = crewOwnershipPatch(crewUserIds, spaceship.ownership, ownerLevel, defaultLevel);
  if (!patch) return;

  await spaceship.update({ ownership: patch });
}

/**
 * Run `syncCrewOwnership` whenever a Spaceship's Stations change, on the active GM's client only.
 *
 * `updateActor` fires on every client, so the write is funnelled through `game.users.activeGM` -
 * core's own designated-GM pick, which is a GM by construction - rather than being raced by every
 * connected GM. The `stations` guard keeps this off every other Spaceship write, and stops the
 * ownership update it makes from re-entering it.
 */
export default function registerCrewOwnershipSync(): void {
  Hooks.on("updateActor", (document, changed) => {
    const spaceship = document as unknown as LooseSpaceship;
    if (spaceship.type !== SPACESHIP_ACTOR_TYPE) return;

    const changedStations = (changed as { system?: { stations?: unknown } }).system?.stations;
    if (!changedStations) return;

    if (!game.users?.activeGM?.isSelf) return;

    syncCrewOwnership(spaceship).catch((error: unknown) => {
      console.error(`${MODULE_ID} | Failed to sync Spaceship crew ownership`, error);
    });
  });
}
