import {
  DEFAULT_ROLLER,
  FEATURE_ITEM_TYPE,
  MODULE_ID,
  STATION_FLAG_KEY,
  isRoller,
  type Roller,
} from "../constants";

/**
 * The **station-actions** seam (#21/#23/#25), membership half - which of a Spaceship's items belong
 * to which Station, who each one is rolled as, and which ones the Features tab must therefore leave
 * out. It is the only place the Station pin flag is read.
 *
 * Same rules as its sibling `./ownership.ts`: nothing here touches an `Actor`, an `Item` or `game`,
 * not in a signature and not in a body. Callers hand it plain records and apply what it returns,
 * which is what makes this decision readable in one place and testable without Foundry (#21's
 * Testing Decisions - the sheet and the wrench dialog are Foundry-bound and are deliberately *not*
 * part of the seam).
 *
 * The two consumers - the wrench dialog's per-Station lists and the sheet's Features tab - are two
 * halves of one rule, so they go through one function (`splitStationActions`) rather than two
 * filters that could drift: every ship feature lands in exactly one of its outputs.
 */

/**
 * The parts of an owned Item this module decides membership from. Structurally satisfied by a live
 * `Item` (and by the sheets' own looser local shapes), so nothing is cast at the call sites.
 *
 * `flags` is typed as loosely as Foundry stores it - an arbitrary namespaced blob - because a pin
 * can be hand-edited, imported from another world, or left behind by an older version; `stationPin`
 * narrows it rather than trusting it.
 */
export interface PinnableItem {
  type: string;
  /** Foundry's own document ordering value, which is what orders actions within a Station (#21). */
  sort?: number;
  flags?: Readonly<Record<string, unknown>>;
}

/**
 * A ship's features, split the only two ways they can go.
 *
 * `byStation` has an entry for *every* station id asked about, empty ones included - a Station with
 * no actions is an empty section, not a missing one (#23). Its lists are in the order they render.
 */
export interface StationActionSplit<T> {
  byStation: Record<string, T[]>;
  /** Everything the Features tab still lists: ship features pinned to no known Station. */
  features: T[];
}

/**
 * A Station action's pin, as this module reads it back: which Station the action hangs off, and
 * who it is rolled as.
 *
 * The two halves are stored together and read together because they are written together - the
 * wrench dialog creates the pin with an `id` and later writes a `roller` into the same object.
 */
export interface StationPin {
  id: string;
  roller: Roller;
}

/**
 * The Station pin on an item, or `null` if it carries none.
 *
 * Everything below the flag namespace is narrowed rather than trusted, for the reasons
 * `PinnableItem.flags` gives - which is also why a pin with an `id` but no (or an unrecognised)
 * `roller` reads as `DEFAULT_ROLLER` rather than as no pin at all: that is exactly the shape #23
 * wrote, and losing the `id` over a missing `roller` would unpin every action authored before #25.
 *
 * Whether the item is even *eligible* to be pinned is the caller's check, not this one's -
 * `splitStationActions` gates on `feature` before it asks (that is the only type a Station
 * accepts: #21 - weapons belong to Weapon Mounts and Systems are bought with System Points).
 */
export function stationPin(item: Pick<PinnableItem, "flags">): StationPin | null {
  const moduleFlags = item.flags?.[MODULE_ID];
  if (typeof moduleFlags !== "object" || moduleFlags === null) return null;

  const pin = (moduleFlags as Record<string, unknown>)[STATION_FLAG_KEY];
  if (typeof pin !== "object" || pin === null) return null;

  const { id, roller } = pin as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0) return null;

  return { id, roller: typeof roller === "string" && isRoller(roller) ? roller : DEFAULT_ROLLER };
}

/**
 * The Roller of a Station action - `DEFAULT_ROLLER` for an item carrying no pin at all, so the
 * press path and the wrench dialog's select never have to spell that fallback themselves.
 */
export function stationRoller(item: Pick<PinnableItem, "flags">): Roller {
  return stationPin(item)?.roller ?? DEFAULT_ROLLER;
}

/**
 * Split a ship's items into each Station's actions and the leftover features.
 *
 * An item pinned to a station id that is not in `stationIds` counts as *unpinned* and stays in
 * `features`. That is deliberate: the pin is the only record of membership, so an unrecognised one
 * would otherwise make the item invisible in both places at once - listed by no Station and hidden
 * from the Features tab - with no way to reach it. Falling back to the Features tab keeps it
 * editable and deletable, and costs nothing while `STATION_IDS` is fixed.
 *
 * Non-feature items are ignored entirely; the caller passes the ship's whole `items` collection and
 * gets back only what the two feature lists render.
 */
export function splitStationActions<T extends PinnableItem>(
  items: Iterable<T>,
  stationIds: readonly string[],
): StationActionSplit<T> {
  const byStation: Record<string, T[]> = {};
  for (const id of stationIds) byStation[id] = [];

  const features: T[] = [];

  for (const item of items) {
    if (item.type !== FEATURE_ITEM_TYPE) continue;

    const pin = stationPin(item);
    const station = pin === null ? undefined : byStation[pin.id];
    if (station) station.push(item);
    else features.push(item);
  }

  // `sort` is Foundry's own ordering value and is what #21 chose to order a Station's actions by.
  // `Array#sort` is stable, so items sharing a `sort` (every item created before anything was
  // reordered has `0`) keep their collection order.
  for (const id of stationIds) byStation[id].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  return { byStation, features };
}
