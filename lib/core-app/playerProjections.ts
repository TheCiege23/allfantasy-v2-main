import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadIdpProjections, mergeIdpStatLine } from '@/lib/idp-projections/loadIdpProjections'
import type { IdpProjectionSuccess } from '@/lib/idp-projections/types'
import { hasIdpScoring, isIdpPosition } from './scoringNotes'

/**
 * Weekly player projections, shared by My Team and Player Finder.
 *
 * ⚠ BOTH SCREENS SAID "no weekly projection feed ingested" AND BOTH WERE WRONG.
 * That sentence was written when fantasy_projections was empty; 994 rows exist for
 * 2026 wk1, keyed by Sleeper id — the same id space roster starters use. Two
 * screens carrying the same stale claim is the argument for one shared lookup
 * rather than a third copy of the query.
 */

export type PlayerProjection = {
  playerId: string
  projectedPoints: number
  name: string | null
  position: string | null
  team: string | null
  /**
   * The per-stat component line the vendor projected — passing yards, receptions,
   * sacks and so on — as opposed to `projectedPoints`, which is those components
   * already collapsed under a GENERIC PPR preset.
   *
   * ⚠ THIS IS WHAT MAKES A LEAGUE-SPECIFIC NUMBER POSSIBLE. `projectedPoints` is
   * scored for a league nobody is in. Re-scoring these components under the
   * league's own `scoring_settings` is the whole difference between "12.4 points
   * somewhere" and "12.4 points HERE" — and in a TE-premium, 6-point-passing-TD
   * or IDP league those are not close.
   *
   * It sits one level deeper than the rest of this object: the row's `stats`
   * carries name/position/team at the top and the real stat line at `stats.stats`.
   */
  componentStats: Record<string, unknown> | null
  /**
   * Present only when a defensive line was projected for this player.
   *
   * Carries the basis, the confidence derived from real coverage, and the notes — including
   * the standing one that no defensive snap data exists. A surface rendering the number
   * without them is showing a projection whose provenance it is choosing not to state.
   */
  idpProjection?: IdpProjectionSuccess
}

type ProjectionStats = {
  name?: string
  position?: string
  team?: string
  stats?: unknown
}

function toProjection(row: {
  playerId: string
  projectedPoints: number
  stats: unknown
}): PlayerProjection {
  const s = (row.stats ?? {}) as ProjectionStats
  const inner = s.stats
  return {
    playerId: row.playerId,
    projectedPoints: Number(row.projectedPoints),
    name: s.name ?? null,
    position: s.position ?? null,
    team: s.team ?? null,
    componentStats:
      inner && typeof inner === 'object' && !Array.isArray(inner)
        ? (inner as Record<string, unknown>)
        : null,
  }
}

/**
 * The season/week the projection feed actually holds.
 *
 * ⚠ RESOLVED FROM THE DATA, NOT FROM A CLOCK. A league's `currentWeek` and the
 * week the feed was last written for drift apart constantly — the cron runs on its
 * own schedule and the offseason stalls it entirely. Asking "what is this week"
 * and finding nothing would render "no projections" on a screen whose real problem
 * is that it asked for the wrong week.
 */
export async function latestProjectionWeek(): Promise<{ season: string; week: number } | null> {
  const row = await prisma.fantasyProjection.findFirst({
    // AF mirror rows (source 'allfantasy') are engine output for the accuracy loop, not the
    // provider feed — they must not decide, or serve as, "the week the feed holds".
    where: { source: { not: 'allfantasy' } },
    orderBy: [{ season: 'desc' }, { week: 'desc' }],
    select: { season: true, week: true },
  })
  return row ? { season: row.season, week: row.week } : null
}

/**
 * Ask for defensive component lines alongside the vendor feed.
 *
 * ⚠ ONLY SUPPLY THIS FOR A LEAGUE THAT ACTUALLY SCORES IDP. The enrichment is skipped
 * outright unless `hasIdpScoring` agrees, so a league that rosters no defenders pays nothing
 * for the feature — no extra query runs at all.
 */
export interface IdpEnrichment {
  /** The league's own `scoring_settings`, already extracted. */
  scoringSettings: Record<string, unknown> | null
  /** Position by Sleeper id. Falls back to the position on the projection row itself. */
  positionBySleeperId?: ReadonlyMap<string, string | null>
  /** Opponent abbreviation for the target week, by Sleeper id. Drives the pace adjustment. */
  opponentBySleeperId?: ReadonlyMap<string, string | null>
  /** Injury designation by Sleeper id. Reported on the projection, never applied to it. */
  injuryBySleeperId?: ReadonlyMap<string, string | null>
}

/** Projections for a set of players, keyed by player id. */
export async function lookupProjections(
  playerIds: readonly string[],
  at?: { season: string; week: number } | null,
  idp?: IdpEnrichment | null
): Promise<Map<string, PlayerProjection>> {
  const ids = playerIds.filter((id) => typeof id === 'string' && id.length > 0 && !id.startsWith('name:'))
  if (ids.length === 0) return new Map()

  const when = at ?? (await latestProjectionWeek())
  if (!when) return new Map()

  const rows = await prisma.fantasyProjection.findMany({
    where: { playerId: { in: [...ids] }, season: when.season, week: when.week, source: { not: 'allfantasy' } },
    select: { playerId: true, projectedPoints: true, stats: true },
  })
  const out = new Map(rows.map((r) => [r.playerId, toProjection(r)]))

  if (idp && hasIdpScoring(idp.scoringSettings)) {
    await enrichWithIdpProjections(out, ids, when, idp)
  }
  return out
}

/**
 * Fill in the defensive half of the component line.
 *
 * WHY THIS IS NEEDED AT ALL. The vendor line is standard PPR, which contains no defensive
 * scoring, so a linebacker arrives with an offensive component line and nothing for
 * `computeLeagueProjectedPoints` to price. This adds a projected defensive line in the same
 * key vocabulary, and every surface that already re-scores `componentStats` starts producing
 * a real number without changing a line of its own code.
 *
 * Mutates the map in place. Failures are absorbed: an enrichment that cannot run must leave
 * the vendor projection exactly as it was, never take the screen down with it.
 */
async function enrichWithIdpProjections(
  out: Map<string, PlayerProjection>,
  ids: readonly string[],
  when: { season: string; week: number },
  idp: IdpEnrichment
): Promise<void> {
  const positionOf = (id: string): string | null =>
    idp.positionBySleeperId?.get(id) ?? out.get(id)?.position ?? null

  /*
   * Scoped to defenders before any query runs. A 10-man offensive lineup in an IDP league
   * produces an empty list here and returns without touching the database.
   */
  const defenders = ids
    .filter((id) => isIdpPosition(positionOf(id)))
    .map((id) => ({ sleeperId: id, position: positionOf(id) }))
  if (defenders.length === 0) return

  const season = Number(when.season)
  if (!Number.isFinite(season)) return

  try {
    const { bySleeperId } = await loadIdpProjections({
      prisma,
      season,
      week: when.week,
      players: defenders,
      opponentBySleeperId: idp.opponentBySleeperId,
      injuryBySleeperId: idp.injuryBySleeperId,
    })

    for (const [sleeperId, outcome] of bySleeperId) {
      if (!outcome.ok) continue
      const existing = out.get(sleeperId)
      /*
       * A defender with no vendor row at all still deserves his league's number. The
       * importer drops any player Sleeper gives no numeric `pts_ppr`, so this is the only
       * path by which those players are priced — and `projectedPoints` stays 0 because the
       * GENERIC number really is nothing for them, while `componentStats` carries the truth.
       */
      const base: PlayerProjection = existing ?? {
        playerId: sleeperId,
        projectedPoints: 0,
        name: null,
        position: positionOf(sleeperId),
        team: null,
        componentStats: null,
      }

      const merged = mergeIdpStatLine(base.componentStats, outcome.statLine)
      out.set(sleeperId, { ...base, componentStats: merged, idpProjection: outcome })
    }
  } catch {
    /*
     * Swallowed on purpose, and only here. The vendor projection in `out` is already correct
     * and complete for every offensive player; a failed defensive enrichment must degrade to
     * the em dash it was showing yesterday rather than fail the whole lineup.
     */
  }
}

export type PositionRank = {
  rank: number
  outOf: number
  position: string
  projectedPoints: number
}

/**
 * Where a player sits among projected scorers at their position.
 *
 * ⚠ RANKED WITHIN THE PROJECTION SET, AND THE DENOMINATOR IS REPORTED FOR A REASON.
 * "WR12" sounds absolute and is not — it means twelfth among the WRs this feed
 * projected, which is a few hundred players, not every WR alive. Returning
 * `outOf` lets the UI say "WR12 of 143" and stops a rank implying a completeness
 * the feed does not have.
 */
export async function positionRanks(
  playerIds: readonly string[],
  at?: { season: string; week: number } | null
): Promise<Map<string, PositionRank>> {
  const when = at ?? (await latestProjectionWeek())
  if (!when) return new Map()

  const all = await prisma.fantasyProjection.findMany({
    where: { season: when.season, week: when.week, source: { not: 'allfantasy' } },
    select: { playerId: true, projectedPoints: true, stats: true },
  })

  const byPosition = new Map<string, PlayerProjection[]>()
  for (const row of all) {
    const p = toProjection(row)
    if (!p.position) continue
    const arr = byPosition.get(p.position) ?? []
    arr.push(p)
    byPosition.set(p.position, arr)
  }
  for (const arr of byPosition.values()) arr.sort((a, b) => b.projectedPoints - a.projectedPoints)

  const wanted = new Set(playerIds.map(String))
  const out = new Map<string, PositionRank>()
  for (const [position, arr] of byPosition) {
    arr.forEach((p, i) => {
      if (!wanted.has(p.playerId)) return
      out.set(p.playerId, {
        rank: i + 1,
        outOf: arr.length,
        position,
        projectedPoints: Math.round(p.projectedPoints * 100) / 100,
      })
    })
  }
  return out
}

/**
 * Summarise a lineup's projected total.
 *
 * ⚠ REPORTS `unprojected` RATHER THAN QUIETLY SUMMING WHAT IT HAS. A total built
 * from 7 of 10 starters is not a lineup projection, it is a fragment presented as
 * one — and it always reads LOW, which is the direction that makes a manager bench
 * someone they should start.
 */
export function summariseLineup(
  playerIds: readonly string[],
  projections: Map<string, PlayerProjection>
): { total: number; projected: number; unprojected: number } {
  let total = 0
  let projected = 0
  let unprojected = 0
  for (const id of playerIds) {
    const p = projections.get(id)
    if (!p || !Number.isFinite(p.projectedPoints)) {
      unprojected++
      continue
    }
    total += p.projectedPoints
    projected++
  }
  return { total: Math.round(total * 100) / 100, projected, unprojected }
}
