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
 * Look players up by OUR row id or a Sleeper id — the two spellings a native league's player ids
 * come in (its pools are seeded from Sleeper; some paths store `SportsPlayer.id`).
 *
 * ⚠ STILL NEVER A BARE ID AGAINST `externalId`. The old spelling of this — `id IN ids OR externalId
 * IN ids` — could reach a Sleeper-id'd player ONLY through a Rolling Insights row for somebody else,
 * because Sleeper's own rows store `sleeper:<id>` there (2026-09-29: 422 of the top 900 week-4
 * projections had such an impostor). A caller must key its results with `playerRowKeys`, not by
 * `externalId`, or the impostor comes back in through the map.
 */
export function ourIdOrSleeperIdWhere(ids: readonly string[], sport?: string) {
  const clean = [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))]
  const bySleeper = sleeperIdWhere(clean)
  return {
    ...(sport ? { sport: sport.toUpperCase() } : {}),
    OR: [{ id: { in: clean } }, ...bySleeper.OR],
  }
}

/**
 * The ids a `SportsPlayer` row may be looked up BY, in the Sleeper/our-row space: its own `id` and
 * its `sleeperId`. Never its `externalId` — for a Rolling Insights, CFBD, API-Football or backfill
 * row that is the provider's own number, which collides with Sleeper's for a different person.
 */
export function playerRowKeys(row: { id?: string | null; sleeperId?: string | null }): string[] {
  return [row.id, row.sleeperId].map((k) => String(k ?? '').trim()).filter(Boolean)
}

/**
 * Rows from a `sleeperIdWhere` read, keyed by Sleeper id. Several rows can carry one Sleeper id
 * (Sleeper's own plus the RI / TheSportsDB rows the crosswalk stamped) — one person, but Sleeper's
 * row holds the fantasy-shaped fields (`QB`, `CAR`), so it wins; otherwise the first row found.
 */
export function indexBySleeperId<T extends { sleeperId?: string | null; source?: string | null }>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>()
  for (const row of rows) {
    const key = String(row.sleeperId ?? '').trim()
    if (!key) continue
    const held = out.get(key)
    if (!held || (row.source === 'sleeper' && held.source !== 'sleeper')) out.set(key, row)
  }
  return out
}

/**
 * Can this id be a Sleeper id? Only in NFL — the one sport whose `SportsPlayer` rows carry Sleeper
 * ids (13,838 NFL rows; ZERO in NBA, MLB, NHL, NCAAB, NCAAF and SOCCER, measured 2026-09-29) — and
 * only as a bare number. `name:Josh Allen:QB:BUF` (backfill) and `tsdb_34415964` (TheSportsDB)
 * describe their own space, so they can never be mistaken for one.
 */
export function mayBeSleeperId(id: string, sport: string | null | undefined): boolean {
  return String(sport ?? '').trim().toUpperCase() === 'NFL' && /^\d+$/.test(String(id ?? '').trim())
}

/**
 * Look ids up against `externalId` when they CANNOT be Sleeper ids — a native league's
 * self-describing ids, or a provider's numbers in a sport Sleeper does not cover (a native NHL
 * roster holds Rolling Insights ids, and `externalId` is the only place they are named).
 *
 * Any id that `mayBeSleeperId` is DROPPED rather than matched: in NFL a bare number reaching
 * `externalId` finds Rolling Insights' or the backfill's player of that number, who is someone else
 * (Sleeper 9228 is Bryce Young; RI 9228 is an offensive tackle). Those go through `sleeperIdWhere`.
 * Sleeper's own rows are excluded too — their `externalId` is `sleeper:<id>`, never a bare token.
 */
export function nonSleeperExternalIdWhere(ids: readonly string[], sport: string) {
  const s = sport.toUpperCase()
  const clean = [...new Set(ids.map((id) => String(id ?? '').trim()).filter((id) => id && !mayBeSleeperId(id, s)))]
  return {
    sport: s,
    source: { not: 'sleeper' },
    externalId: { in: clean },
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
