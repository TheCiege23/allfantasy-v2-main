import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { afEngineForLeague, latestProjectionWeek, lookupAfEngineProjections, lookupProjections } from './playerProjections'
import { rosterIdSpaceOf } from './rosterIdSpace'

/**
 * AllFantasy's own projection for the players on a draft board — the AF number every other /core
 * surface already shows, plus the engine's rest-of-season total, which is the figure a draft is
 * actually about.
 *
 * ── WHAT IS RETURNED, PER SLEEPER ID ─────────────────────────────────────────────────────────
 *   `af`       this week's AF engine number, carried into the league's scoring by the player's
 *              provider line (`afEngineForLeague`) — identical to the AF he shows on My Team,
 *              Matchup and the player card, so a pick never reads differently on the board.
 *   `ros`      the engine's rest-of-season total from its season-long baseline row
 *              (`AFProjectionSnapshot`, `week: null`), GENERIC PPR — the engine has no component
 *              line to re-score and the provider publishes no season projection to carry it by.
 *              `rosWeeks` travels with it: a low total is indistinguishable from a late one without it.
 *
 * ── 🛑 SLEEPER-ID LEAGUES ONLY ────────────────────────────────────────────────────────────────
 * Both tables are keyed on Sleeper ids (the mirror) and the engine's own key (the snapshot). A draft
 * pick's `playerId` is the PROVIDER's id: an ESPN or Fleaflicker id is a number in Sleeper's range and
 * collides with real Sleeper players (see rosterIdSpace.ts). So anything but a Sleeper or native
 * league returns an empty map — the board shows no AF rather than a stranger's.
 *
 * ── THE ENGINE'S KEY IS NOT A SLEEPER ID ──────────────────────────────────────────────────────
 * `AFProjectionSnapshot.playerId` is our canonical uuid. The mirror row the weekly read already
 * fetched records it (`stats.canonicalPlayerId`), so the season rows are read by that key with no
 * name matching — a player the mirror does not carry simply has no `ros`.
 *
 * Failure-tolerant by construction: every read degrades to "no AF", never to an exception.
 */

export type DraftAfProjection = {
  /** This week's AF number under the league's scoring. Null when the engine has no weekly row. */
  af: number | null
  /** Rest-of-season total, generic PPR. Null when no season baseline row carries one. */
  ros: number | null
  /** Games `ros` covers. */
  rosWeeks: number | null
  /** The week `af` describes. */
  week: number
}

export type DraftAfProjections = {
  byPlayerId: Map<string, DraftAfProjection>
  /** The week `af` describes, so the surface can say so. */
  week: number | null
}

const NONE: DraftAfProjections = { byPlayerId: new Map(), week: null }

export async function loadDraftAfProjections(args: {
  platform: string | null | undefined
  playerIds: readonly (string | null | undefined)[]
  /** The league's `settings` blob; the scoring is extracted here. */
  leagueSettings: unknown
}): Promise<DraftAfProjections> {
  if (rosterIdSpaceOf(args.platform) !== 'sleeper') return NONE
  const ids = [...new Set(args.playerIds.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id)))]
  if (ids.length === 0) return NONE

  try {
    const when = await latestProjectionWeek()
    if (!when) return NONE
    const scoring = extractScoringSettings(args.leagueSettings)
    const [providers, engine] = await Promise.all([
      lookupProjections(ids, when).catch((): Awaited<ReturnType<typeof lookupProjections>> => new Map()),
      lookupAfEngineProjections(ids, when).catch((): Awaited<ReturnType<typeof lookupAfEngineProjections>> => new Map()),
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
