/**
 * Resolve a document UUID with core's synchronous `fromUuid` lookup, treating "can't resolve" as
 * `null` rather than a thrown error.
 *
 * `fromUuidSync` *throws* (rather than returning `null`) for a compendium UUID whose pack index
 * isn't loaded - every caller here needs "unresolvable reference" and "resolved to nothing" to
 * collapse to the same outcome, so the guard lives in one place instead of being copied at each
 * call site (`SpaceshipData#pilotBaseEvasion`, `SpaceshipActorSheet#resolveCrewEntry`/
 * `#getRowDocument`).
 */
export function resolveUuidSync<T>(uuid: string | null | undefined): T | null {
  try {
    return (fromUuidSync(uuid) as T | null) ?? null;
  } catch {
    return null;
  }
}
