import {
  computeLeagueProjectedPoints,
  extractScoringSettings,
  hasScoringRules,
} from '@/lib/projections/leagueScoring'

/**
 * The pure half of `starterProjections.ts`: price each starter under each league's own rules.
 * Kept free of the database so it can be tested on fixtures.
 */

export type ProjectionRow = {
  playerId: string
  season: number
  week: number
  stats: unknown
  fetchedAt: Date
}

/** `out` means ruled out: priced at 0 on purpose, and the screen says why. */
export type StarterProjection = { projected: number; out: boolean }

export function priceStarterProjections(
  leagues: ReadonlyArray<{ key: string; season: number; week: number; settings: unknown; playerIds: readonly string[] }>,
  rows: readonly ProjectionRow[],
  outIds: ReadonlySet<string>,
): Map<string, StarterProjection> {
  /*
   * One row per (season, week, player). Several sources can each write one; the NEWEST wins, so the
   * pick is decided by the data rather than by whatever order Postgres returned.
   */
  const newest = new Map<string, ProjectionRow>()
  for (const r of rows) {
    const k = `${r.season}:${r.week}:${r.playerId}`
    const held = newest.get(k)
    if (!held || r.fetchedAt.getTime() > held.fetchedAt.getTime()) newest.set(k, r)
  }

  const out = new Map<string, StarterProjection>()
  for (const league of leagues) {
    const scoring = extractScoringSettings(league.settings)
    /*
     * ⚠ NO RULES, NO NUMBER. A generic PPR total substituted for a league's own scoring looks exactly
     * like the real thing on screen and is wrong precisely where leagues differ most — the stance
     * `loadSideProjections` takes. Those rows keep showing a dash.
     */
    if (!hasScoringRules(scoring)) continue
    for (const id of league.playerIds) {
      const key = `${league.key}:${id}`
      if (outIds.has(id)) {
        out.set(key, { projected: 0, out: true })
        continue
      }
      const row = newest.get(`${league.season}:${league.week}:${id}`)
      if (!row) continue
      // The feed nests the component stat line one level down; the outer object is metadata.
      const s = (row.stats ?? {}) as Record<string, unknown>
      const scored = computeLeagueProjectedPoints((s.stats ?? null) as Record<string, unknown> | null, scoring)
      if (!scored || !Number.isFinite(scored.points)) continue
      out.set(key, { projected: Math.round(scored.points * 10) / 10, out: false })
    }
  }
  return out
}
