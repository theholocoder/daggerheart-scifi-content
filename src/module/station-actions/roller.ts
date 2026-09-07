import type { Roller } from "../constants";

/**
 * The **station-actions** seam (#21/#25), Roller half - who a pressed Station action is rolled as,
 * decided before anything runs.
 *
 * Same rules as its siblings `./ownership.ts` and `./membership.ts`: nothing here touches an
 * `Actor`, an `Item` or `game`, not in a signature and not in a body. The caller resolves the
 * documents, hands this a Roller, a Station's crew as bare UUID strings and the UUID of the
 * pressing user's own character, and applies whatever comes back - which is what makes "who
 * rolls" readable in one place and testable without Foundry (#21's Testing Decisions; the prompt
 * dialog and the action-running path are Foundry-bound and live in `./press.ts`).
 */

/**
 * One entry of a roller prompt: the ship itself, or one of the Station's crew.
 *
 * A crew option is a bare UUID and nothing else - no name, no portrait. Resolving a UUID to a
 * document is exactly what this module may not do, so the prompt's own code fills those in (and
 * has to cope with a crew UUID that no longer resolves, the same way the Stations tab's crew strip
 * does).
 */
export type RollerOption = { kind: "ship" } | { kind: "actor"; uuid: string };

/**
 * What pressing a Station action resolves to, before the system's own action workflow is entered
 * at all. The shape is #21's, taken from the prototype:
 *
 * - `ship` - use the ship's own owned action, untouched (docs/adr/0003's `ship` branch).
 * - `actor` - re-parent the action to that Actor and use it as them; no question asked.
 * - `prompt` - ask at press time, over `options`.
 */
export type RollerResolution =
  | { kind: "ship" }
  | { kind: "actor"; uuid: string }
  | { kind: "prompt"; options: RollerOption[] };

/**
 * Decide who acts when a Station action is pressed.
 *
 * - `ship` never asks.
 * - `crew` uses the pressing user's own character when that character crews *this* Station, and
 *   asks over the Station's crew otherwise. That second branch is what keeps the button usable for
 *   a GM, who owns no assigned PC (#21's user story 30) - and for a player pressing another
 *   Station's action, which #21 deliberately allows.
 * - `ask` offers the ship plus every crew member of the Station (user story 9).
 *
 * A prompt is returned even when it holds a single option, and even when it holds none. Both are
 * deliberate:
 *
 * - Collapsing a one-option prompt would mean that assigning a second crew member silently changes
 *   whether the same button asks a question. A Station action asking the same thing on every press
 *   is worth one extra click on a one-crew Station.
 * - An empty `options` list is the "`crew` at a Station with no crew" case, and is how this
 *   reports "there is nobody to roll this as" without inventing a fourth outcome or throwing. The
 *   caller says so and does nothing (#25 - it must fail gracefully). `ask` cannot produce it: the
 *   ship is always among its options, so an uncrewed Station's `ask` still offers the ship.
 *
 * Crew UUIDs are de-duplicated, first-seen order kept, in case a Station ever holds the same Actor
 * twice - the drop handler rejects that today, but a hand-edited or imported ship need not.
 */
export function resolveRoller(
  roller: Roller,
  crew: readonly string[],
  pressingCharacterUuid: string | null,
): RollerResolution {
  if (roller === "ship") return { kind: "ship" };

  const crewOptions: RollerOption[] = [...new Set(crew)].map((uuid) => ({ kind: "actor", uuid }));

  if (roller === "ask") return { kind: "prompt", options: [{ kind: "ship" }, ...crewOptions] };

  // `crew`: the presser's own character, if it is sitting at this Station.
  if (pressingCharacterUuid && crew.includes(pressingCharacterUuid)) {
    return { kind: "actor", uuid: pressingCharacterUuid };
  }

  return { kind: "prompt", options: crewOptions };
}
