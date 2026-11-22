import 'server-only'
import { loadLeaguePlayerMetrics } from '@/lib/af-projections/leaguePlayerMetrics'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { afEngineForLeague, latestProjectionWeek, lookupAfEngineProjections, lookupProjections } from './playerProjections'
import { rosterIdSpaceOf } from './rosterIdSpace'

/** League boards use shared AF rates and the league's stored schedule.
 * The optional no-league reader retains the legacy Sleeper projection contract. */
export type DraftAfProjection = {
  /** This week's AF number under the league's scoring. Null when the engine has no weekly row. */
  af: number | null
  /** Rest-of-season total in league scoring, or generic PPR on the legacy unscoped reader. */
  ros: number | null
  /** Games `ros` covers. */
  rosWeeks: number | null
  /** The week `af` describes. */
  week: number | null
}

export type DraftAfProjections = {
  byPlayerId: Map<string, DraftAfProjection>
  /** The week `af` describes, so the surface can say so. */
  week: number | null
}

const NONE: DraftAfProjections = { byPlayerId: new Map(), week: null }

export async function loadDraftAfProjections(args: {
  leagueId?: string
  platform: string | null | undefined
  playerIds: readonly (string | null | undefined)[]
  /** The league's `settings` blob; the scoring is extracted here. */
  leagueSettings: unknown
  /**
   * The league's sport. A Sleeper NBA draft's ids are Sleeper's NBA namespace, which collides with
   * NFL ids, so a known non-NFL sport reads only its own rows (`projectionSportScope`) — none today.
   */
  sport?: string | null
}): Promise<DraftAfProjections> {
  if (args.leagueId) {
    const rosterIds = args.playerIds.filter((id): id is string => Boolean(id))
    if (!rosterIds.length) return NONE
    const board = await loadLeaguePlayerMetrics({ leagueId: args.leagueId, rosterIds, limit: rosterIds.length, includeTradeValues: false }).catch(() => null)
    if (!board || board.unit !== 'fantasy points') return NONE
    const byPlayerId = new Map<string, DraftAfProjection>()
    for (const row of board.rows) {
      if (row.rosterPlayerId) byPlayerId.set(row.rosterPlayerId, { af: row.weekly, ros: row.restOfSeason,
        rosWeeks: row.remainingGames ?? null, week: board.week })
    }
    return { byPlayerId, week: board.week }
  }
  if (rosterIdSpaceOf(args.platform, args.sport) !== 'sleeper') return NONE
  const ids = [...new Set(args.playerIds.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id)))]
  if (ids.length === 0) return NONE

  try {
    const when = await latestProjectionWeek()
    if (!when) return NONE
    const scoring = extractScoringSettings(args.leagueSettings)
    const [providers, engine] = await Promise.all([
      lookupProjections(ids, when, null, args.sport).catch((): Awaited<ReturnType<typeof lookupProjections>> => new Map()),
      lookupAfEngineProjections(ids, when, args.sport).catch((): Awaited<ReturnType<typeof lookupAfEngineProjections>> => new Map()),
    ])
    if (engine.size === 0) return NONE

    const canonicalIds = [...new Set([...engine.values()].map((e) => e.canonicalPlayerId).filter((c): c is string => Boolean(c)))]
    const season = Number(when.season)
    const baselines =
      canonicalIds.length > 0 && Number.isFinite(season)
        ? await prisma.aFProjectionSnapshot
            .findMany({
              where: { playerId: { in: canonicalIds }, season, week: null },
              orderBy: { computedAt: 'desc' },
              select: { playerId: true, rosProjection: true, rosWeeksRemaining: true },
            })
            .catch(() => [])
        : []
    /* Freshest baseline per player — the order above puts it first. */
    const rosByCanonical = new Map<string, { ros: number | null; weeks: number | null }>()
    for (const b of baselines) {
      if (rosByCanonical.has(b.playerId)) continue
      rosByCanonical.set(b.playerId, {
        ros: b.rosProjection != null && Number.isFinite(b.rosProjection) ? Math.round(b.rosProjection * 10) / 10 : null,
        weeks: b.rosWeeksRemaining ?? null,
      })
    }

    const byPlayerId = new Map<string, DraftAfProjection>()
    for (const id of ids) {
      const e = engine.get(id)
      if (!e) continue
      const provider = providers.get(id)
      const league =
        scoring && provider?.componentStats ? computeLeagueProjectedPoints(provider.componentStats, scoring) : null
      const season = e.canonicalPlayerId ? rosByCanonical.get(e.canonicalPlayerId) : undefined
      byPlayerId.set(id, {
        af: afEngineForLeague(e, provider?.projectedPoints ?? null, league?.points ?? null, scoring),
        ros: season?.ros ?? null,
        rosWeeks: season?.weeks ?? null,
        week: when.week,
      })
    }
    return { byPlayerId, week: when.week }
  } catch {
    return NONE
  }
}
