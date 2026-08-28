/**
 * Which id space a `SportsPlayer.externalId` is written in, and how to query it safely.
 *
 * ⚠ `externalId` IS FOUR NAMESPACES IN ONE COLUMN, AND THE FORMAT DOES NOT IDENTIFY THEM.
 * Measured on production 2026-08-27:
 *
 *   rolling_insights  bare numeric   113,669
 *   sleeper           sleeper:*       11,896
 *   thesportsdb       tsdb_*           5,852
 *   cfbd              bare numeric     5,226
 *   api_football      bare numeric       737
 *   backfill          bare numeric       261
 *
 * Three different sources write bare numerics, so only `source` says which space a row is in.
 * The spaces overlap: 42,032 bare-numeric ids also exist as a Sleeper id and 42,031 of those
 * are a DIFFERENT PERSON — one coincidental true match in the whole table. A numeric match
 * between the Sleeper space and the provider spaces is not weak evidence, it is none.
 *
 * ⚠ THIS HAS ALREADY SHIPPED WRONG DATA TWICE. `getPlayerDataForSurface` served 211 players
 * another player's photograph, because it keyed one map by both columns and its tie-break
 * ranked `rolling_insights` above `sleeper`, actively preferring the impostor.
 * `sleeperPlayerCrosswalk` had the same shape and leaked name, position and team as well.
 *
 * The rule this module exists to make easy: NEVER look a Sleeper id up against `externalId`.
 * `SportsPlayer` has a dedicated `sleeperId` column — use `sleeperIdWhere`. Provider ids belong
 * against `externalId` and must be scoped by `source` — use `providerIdWhere`.
 */

/** The id spaces `SportsPlayer` rows are written in. */
export type IdNamespace =
  | 'sleeper'
  | 'rolling_insights'
  | 'thesportsdb'
  | 'cfbd'
  | 'api_football'
  /** A row whose source we do not recognise; treat its `externalId` as unjoinable. */
  | 'unknown'

/**
 * Sources whose `externalId` is a bare number.
 *
 * These are the dangerous ones: they are numerically indistinguishable from a Sleeper id and
 * from each other, so a query that filters `externalId` without `source` can match any of them.
 */
export const BARE_NUMERIC_SOURCES: readonly string[] = ['rolling_insights', 'cfbd', 'api_football', 'backfill']

const SOURCE_TO_NAMESPACE: Record<string, IdNamespace> = {
  sleeper: 'sleeper',
  rolling_insights: 'rolling_insights',
  thesportsdb: 'thesportsdb',
  cfbd: 'cfbd',
  api_football: 'api_football',
}

/** The namespace a row's `externalId` is written in, decided by its `source`. */
export function externalIdNamespace(source: string | null | undefined): IdNamespace {
  return SOURCE_TO_NAMESPACE[String(source ?? '').trim().toLowerCase()] ?? 'unknown'
}

/** True when this source writes a bare number, and so cannot be told apart by id shape alone. */
export function isBareNumericSource(source: string | null | undefined): boolean {
  return BARE_NUMERIC_SOURCES.includes(String(source ?? '').trim().toLowerCase())
}

/**
 * Look players up BY SLEEPER ID.
 *
 * ⚠ QUERIES THE `sleeperId` COLUMN, NOT `externalId`, AND THAT IS THE WHOLE POINT. Sleeper-sourced
 * rows store `sleeper:8144` in `externalId`, so a bare `8144` never matches them there — it
 * matches a Rolling Insights row for someone else instead. That is not a near miss, it is the
 * documented failure: the bare id is a valid RI id belonging to a different player.
 *
 * The prefixed form is accepted too, because it is the same row reached by its own spelling.
 */
export function sleeperIdWhere(sleeperIds: readonly string[], sport?: string) {
  const ids = [...new Set(sleeperIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  return {
    ...(sport ? { sport: sport.toUpperCase() } : {}),
    OR: [
      { sleeperId: { in: ids } },
      { externalId: { in: ids.map((id) => `sleeper:${id}`) } },
    ],
  }
}

/**
 * Look players up by a PROVIDER's own id, scoped to that provider.
 *
 * The `source` argument is required rather than optional on purpose: an unscoped `externalId`
 * filter is the bug this module exists to prevent, so there is no way to spell one here.
 */
export function providerIdWhere(
  source: Exclude<IdNamespace, 'unknown' | 'sleeper'> | 'sleeper',
  externalIds: readonly string[],
  sport?: string,
) {
  const ids = [...new Set(externalIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  return {
    source,
    externalId: { in: ids },
    ...(sport ? { sport: sport.toUpperCase() } : {}),
  }
}

/**
 * Two names for the same person, allowing for how differently sources spell them.
 *
 * ⚠ THE LAST LINE OF DEFENCE WHEN AN ID MATCH CANNOT BE SCOPED. Where a query has to accept
 * ids of unknown provenance, the row it finds should still be checked against the name before
 * it is used. This is the same guard `getPlayerDataForSurface` applies; it is duplicated here
 * so callers migrating off unscoped lookups have it to hand rather than reinventing it.
 */
export function playerNamesAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .replace(/(jr|sr|ii|iii|iv|v)$/, '')
  const x = norm(a)
  return x.length > 0 && x === norm(b)
}
