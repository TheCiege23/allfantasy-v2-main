/**
 * MFL franchise ids are zero-padded strings ("0001"), stored verbatim as
 * `LeagueTeam.externalId`. `WeeklyMatchup.rosterId` is an `Int` column, so the
 * same id loses its leading zeros the moment it is written there — "0001"
 * becomes 1. Every reader that later does `String(rosterId)` to find a team
 * back by its `externalId` gets "1", which never matches the stored "0001"
 * again. See `lib/import-os/collector/index.ts` for the fuller writeup;
 * this file is the one place the comparison is done correctly, so it cannot
 * drift between the several call sites that each need it.
 *
 * Every function here is purely additive/no-op for a non-numeric `externalId`
 * (e.g. Yahoo's "449.l.12345.t.3") — nothing here changes behaviour for a
 * provider whose ids were never zero-padded integers to begin with.
 */

function isPlainDigits(value: string): boolean {
  return /^\d+$/.test(value)
}

/**
 * True when `externalId` and `rosterId` name the same team, padding included.
 *
 * `rosterId` accepts `number | string` because `WeeklyMatchup.rosterId` itself
 * is mid-migration from Int to Text (see the schema comment and
 * prisma/migrations-pending/20260903222531_weekly_matchup_roster_id_text) —
 * some callers still hand this a number, others already hand it the raw
 * string. Both are coerced to a string before comparing, so this keeps
 * working unchanged either way.
 */
export function rosterIdsMatch(
  externalId: string | null | undefined,
  rosterId: number | string,
): boolean {
  if (externalId == null) return false
  const rid = String(rosterId)
  if (externalId === rid) return true
  return isPlainDigits(externalId) && isPlainDigits(rid) && Number(externalId) === Number(rid)
}

/**
 * The key(s) `externalId` should be registered under in a `{rosterId string ->
 * X}` lookup map, so a lookup by `String(rosterId)` still finds it even when
 * `externalId` carries leading zeros `String(rosterId)` can never reproduce.
 */
export function rosterIdMapKeys(externalId: string): string[] {
  if (!isPlainDigits(externalId)) return [externalId]
  const normalized = String(Number(externalId))
  return normalized === externalId ? [externalId] : [externalId, normalized]
}

/** Build a `String(rosterId) -> value` map that is safe against that same padding loss. */
export function buildRosterIdMap<T, V = T>(
  items: readonly T[],
  getExternalId: (item: T) => string,
  getValue: (item: T) => V = (item) => item as unknown as V,
): Map<string, V> {
  const map = new Map<string, V>()
  for (const item of items) {
    const value = getValue(item)
    for (const key of rosterIdMapKeys(getExternalId(item))) map.set(key, value)
  }
  return map
}
