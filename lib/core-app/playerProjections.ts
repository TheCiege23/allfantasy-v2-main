import 'server-only'

import { prisma } from '@/lib/prisma'

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
}

type ProjectionStats = { name?: string; position?: string; team?: string }

function toProjection(row: {
  playerId: string
  projectedPoints: number
  stats: unknown
}): PlayerProjection {
  const s = (row.stats ?? {}) as ProjectionStats
  return {
    playerId: row.playerId,
    projectedPoints: Number(row.projectedPoints),
    name: s.name ?? null,
    position: s.position ?? null,
    team: s.team ?? null,
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
    orderBy: [{ season: 'desc' }, { week: 'desc' }],
    select: { season: true, week: true },
  })
  return row ? { season: row.season, week: row.week } : null
}

/** Projections for a set of players, keyed by player id. */
export async function lookupProjections(
  playerIds: readonly string[],
  at?: { season: string; week: number } | null
): Promise<Map<string, PlayerProjection>> {
  const ids = playerIds.filter((id) => typeof id === 'string' && id.length > 0 && !id.startsWith('name:'))
  if (ids.length === 0) return new Map()

  const when = at ?? (await latestProjectionWeek())
  if (!when) return new Map()

  const rows = await prisma.fantasyProjection.findMany({
    where: { playerId: { in: [...ids] }, season: when.season, week: when.week },
    select: { playerId: true, projectedPoints: true, stats: true },
  })
  return new Map(rows.map((r) => [r.playerId, toProjection(r)]))
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
    where: { season: when.season, week: when.week },
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
