import { prisma } from '@/lib/prisma'
import { ingestSleeperPlayerScoresForWeek } from '@/lib/sleeper/sync/ingestSleeperPlayerScores'
import { sleeperScoreTargetWeeks } from '@/lib/sleeper/sync/sleeperScoreTargetWeeks'
import { inProgressRiGameIds } from '@/lib/live/playByPlayFeed'

/**
 * Keep "Your starters" points current WHILE NFL games are being played.
 *
 * ⚠ WHY THE ROWS READ 0.0 ON A SUNDAY. `/core/live` shows each player's points
 * from `LeaguePlayerWeeklyScore` — points exactly as the league's own platform
 * scored them, never recomputed by us, because leagues score the same play
 * differently. Its only scheduled writer was the league sync, which runs on a
 * sync cadence, not a game cadence; so during a game the page showed whatever
 * that sync last saw, usually before kickoff.
 *
 * User decision, 2026-09-13: keep the platform as the source of truth and refresh
 * it DURING games. This does exactly what the league sync does for points — the
 * same writer, the same target weeks — on the live tick, for Sleeper leagues a
 * user has claimed. Other platforms have no per-player weekly writer yet.
 *
 * Bounded three ways so a Sunday cannot run away with the tick:
 *   - only while an NFL game is in progress (a quiet Tuesday costs one query);
 *   - a rotating slice of leagues per pass, so a large league set is covered
 *     over several passes rather than blowing one;
 *   - a wall-clock budget per pass, checked between leagues.
 */

/** How often the live tick refreshes points. A Sleeper matchup call per league per pass. */
export const LIVE_POINTS_INTERVAL_MS = 120_000

export const LIVE_POINTS_LEAGUES_PER_PASS = 40
const CONCURRENCY = 4
const PASS_BUDGET_MS = 30_000
const CURSOR_KEY = 'live-points:cursor:NFL'
const CURSOR_TTL_MS = 24 * 3_600_000

export type LivePointsResult = {
  leaguesConsidered: number
  leaguesSynced: number
  scoresUpserted: number
  errors: number
  skipped: 'no-live-games' | 'no-leagues' | null
}

/** The NFL season a date belongs to: January and February games are last year's season. */
export function nflSeasonFor(now: Date): number {
  const y = now.getUTCFullYear()
  return now.getUTCMonth() <= 1 ? y - 1 : y
}

async function readCursor(): Promise<number> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: CURSOR_KEY } }).catch(() => null)
  if (!row || row.expiresAt.getTime() < Date.now()) return 0
  const n = Number((row.data as { offset?: unknown } | null)?.offset)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

async function writeCursor(offset: number): Promise<void> {
  const expiresAt = new Date(Date.now() + CURSOR_TTL_MS)
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: CURSOR_KEY },
      update: { data: { offset } as never, expiresAt },
      create: { cacheKey: CURSOR_KEY, data: { offset } as never, expiresAt },
    })
    .catch(() => undefined)
}

export async function refreshLiveSleeperPoints(
  now: Date = new Date(),
  deps: { liveGameIds: (now: Date) => Promise<string[]>; clock: () => number } = {
    liveGameIds: inProgressRiGameIds,
    clock: () => Date.now(),
  },
): Promise<LivePointsResult> {
  const result: LivePointsResult = { leaguesConsidered: 0, leaguesSynced: 0, scoresUpserted: 0, errors: 0, skipped: null }

  const live = await deps.liveGameIds(now).catch(() => [] as string[])
  if (live.length === 0) return { ...result, skipped: 'no-live-games' }

  const season = nflSeasonFor(now)
  const leagues = await prisma.league
    .findMany({
      where: {
        platform: { equals: 'sleeper', mode: 'insensitive' },
        sport: 'NFL',
        season,
        // Only leagues someone here follows: nobody reads points for an unclaimed league.
        teams: { some: { claimedByUserId: { not: null } } },
      },
      select: { platformLeagueId: true },
      orderBy: { platformLeagueId: 'asc' },
    })
    .catch(() => [] as Array<{ platformLeagueId: string }>)
  const ids = [...new Set(leagues.map((l) => l.platformLeagueId).filter(Boolean))]
  if (ids.length === 0) return { ...result, skipped: 'no-leagues' }

  const start = (await readCursor()) % ids.length
  const rotated = [...ids.slice(start), ...ids.slice(0, start)]
  const batch = rotated.slice(0, LIVE_POINTS_LEAGUES_PER_PASS)
  result.leaguesConsidered = batch.length

  const deadline = deps.clock() + PASS_BUDGET_MS
  let next = 0
  let attempted = 0
  const worker = async () => {
    while (next < batch.length && deps.clock() < deadline) {
      const leagueId = batch[next++]!
      attempted += 1
      try {
        const weeks = await sleeperScoreTargetWeeks(leagueId, season)
        let failed = false
        for (const week of weeks) {
          const r = await ingestSleeperPlayerScoresForWeek(leagueId, season, week)
          result.scoresUpserted += r.scoresUpserted
          if (r.error) failed = true
        }
        if (failed) result.errors += 1
        else result.leaguesSynced += 1
      } catch {
        // One league's failure must not stop the others, and never the tick.
        result.errors += 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker()))

  // Resume after the leagues this pass actually reached, so a budget cut-off is not skipped next time.
  await writeCursor((start + attempted) % ids.length)
  return result
}
