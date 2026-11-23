import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { MY_TEAM_BENCH_SURFACE } from '@/lib/chimmy-advice/adviceSurfaces'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { bridgeImportedGameLogIds } from '@/lib/redraft/importedGameLogIdBridge'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import {
  gradeSportBenchCalls,
  sportPeriodState,
  SPORT_BENCH_SPORTS,
  type GradedSportBenchCall,
  type SportBenchCall,
  type SportBenchSport,
  type SportPeriod,
} from './sportBenchRecord'
import type { BenchTally } from './ledgerRecord'

/**
 * MY TEAM'S BENCH CHECK, GRADED IN BASKETBALL, HOCKEY AND BASEBALL (2026-11-23) — the server half: read the recorded
 * calls and what happened, from Postgres only, and hand them to `sportBenchRecord.ts`. Called by the ledger rebuild
 * (`ledgerGrading.ts`), one sport at a time, each contained: a failure costs only that sport's line.
 *
 * Read-only, and no provider call: the calls (`chimmy_advice`), the sport's schedule (`SportsGame`), the game lines
 * (`player_game_stats`) and the identity registry (`PlayerIdentityMap`) are all tables the import crons keep current.
 *
 * THE IDS. A call is keyed by the id the roster holds (`LineupPlayer.sleeperId`): a Sleeper NBA league's Sleeper ids,
 * a native league's Rolling Insights / TheSportsDB ids. Game lines are keyed on `PlayerIdentityMap.id`. The bridges are
 * the ones the lineup's own pricing uses (`myTeamDailySport.ts`, `dailySportOutlook.ts`): Sleeper NBA ids through
 * `bridgeImportedGameLogIds`, everything else through `bridgeRosterIdsToGameLogIds` (the weekly matchup score's), the
 * translated id preferred over the id itself. An id neither bridge places is unscored.
 */

type Db = typeof prisma

/** Calls older than this are not re-read: a sport's season is under a year, and its record decays anyway. */
export const SPORT_BENCH_LOOKBACK_DAYS = 400

type SportBenchSql = {
  league_id: string
  platform: string | null
  settings: unknown
  season: number
  week: number
  withdrawn: boolean
  rec_key: string
  alt_key: string
  rec_projected: number | null
  alt_projected: number | null
  given_at: Date | null
}

function sportKeys(sport: string): string[] {
  const upper = sport.toUpperCase()
  const lower = sport.toLowerCase()
  return upper === lower ? [upper] : [upper, lower]
}

/** Exported for its test. One sport's recorded bench calls, newest year only. */
export async function loadSportBenchRows(sport: SportBenchSport, now: Date, db: Db, leagueIds?: readonly string[]): Promise<SportBenchSql[]> {
  const since = new Date(now.getTime() - SPORT_BENCH_LOOKBACK_DAYS * 86_400_000)
  const scope = leagueIds ? Prisma.sql`AND a.league_id = ANY(${[...leagueIds]}::text[])` : Prisma.empty
  return db.$queryRaw<SportBenchSql[]>`
    SELECT a.league_id, l.platform, l.settings, a.season, a.week, a.withdrawn_at IS NOT NULL AS withdrawn,
           a.rec_player_key AS rec_key, a.alt_player_key AS alt_key, a.rec_projected, a.alt_projected, a.given_at
    FROM chimmy_advice a
    JOIN leagues l ON l.id = a.league_id
    WHERE a.surface = ${MY_TEAM_BENCH_SURFACE} AND a.advice_type = 'start_sit' AND a.alt_player_key <> ''
      AND upper(a.sport) = ${sport} AND a.given_at >= ${since}
      ${scope}`
}

/** Each (season, week)'s window and its last scheduled start. */
async function loadPeriods(sport: SportBenchSport, rows: readonly SportBenchSql[], db: Db): Promise<Map<string, SportPeriod>> {
  const out = new Map<string, SportPeriod>()
  for (const r of rows) {
    const key = `${r.season}:${r.week}`
    if (out.has(key)) continue
    const window = resolveDailySportWeekWindow(sport, Number(r.season), Number(r.week))
    if (!window) {
      out.set(key, { window: null, lastStart: null })
      continue
    }
    const last = await db.sportsGame.findFirst({
      where: { sport: { in: sportKeys(sport) }, startTime: { gte: window.start, lt: window.end } },
      orderBy: { startTime: 'desc' },
      select: { startTime: true },
    })
    out.set(key, { window, lastStart: last?.startTime ?? null })
  }
  return out
}

/** Roster key → game-log id, per id space ('sleeper' for a Sleeper NBA league, else the roster's own). */
async function bridgeKeys(sport: SportBenchSport, rows: readonly SportBenchSql[], db: Db): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const sleeper = new Set<string>()
  const other = new Set<string>()
  for (const r of rows) {
    const isSleeper = String(r.platform ?? '').trim().toLowerCase() === 'sleeper'
    for (const k of [r.rec_key, r.alt_key]) if (k) (isSleeper ? sleeper : other).add(k)
  }
  if (sleeper.size > 0 && sport === 'NBA') {
    const b = await bridgeImportedGameLogIds({ provider: 'sleeper', sport, rosterIds: [...sleeper] })
    for (const gameLogId of b.gameLogIds) {
      const rosterId = b.rosterIdFor(gameLogId)
      if (rosterId) out.set(`sleeper:${rosterId}`, gameLogId)
    }
  }
  if (other.size > 0) {
    const b = await bridgeRosterIdsToGameLogIds(db as never, sportKeys(sport), [...other])
    for (const gameLogId of b.gameLogIds) {
      const rosterId = b.rosterIdFor(gameLogId)
      if (!rosterId) continue
      const k = `other:${rosterId}`
      // The translated id wins over the id itself: an RI number that happens to be an identity id is not him.
      if (!out.has(k) || gameLogId !== rosterId) out.set(k, gameLogId)
    }
  }
  return out
}

const spaceKey = (platform: string | null, key: string) =>
  `${String(platform ?? '').trim().toLowerCase() === 'sleeper' ? 'sleeper' : 'other'}:${key}`

/** One sport's bench calls, graded. Throws on any failure — the caller contains it to this sport's line. */
export async function gradeSportBench(
  sport: SportBenchSport,
  opts: { now: Date; db?: Db; leagueIds?: readonly string[] },
): Promise<{ tally: BenchTally; graded: GradedSportBenchCall[] } | null> {
  const db = opts.db ?? prisma
  const now = opts.now
  const rows = await loadSportBenchRows(sport, now, db, opts.leagueIds)
  if (rows.length === 0) return null
  const periods = await loadPeriods(sport, rows, db)
  const overRows = rows.filter((r) => !r.withdrawn && sportPeriodState(periods.get(`${r.season}:${r.week}`), now) === 'over')

  // Points for the rows whose period is over: bridge, read the game lines in each window, score under the league.
  const points = new Map<string, number>() // `${leagueId}|${season}:${week}|${spaceKey}` → points
  if (overRows.length > 0) {
    const normalizer = getDailySportNormalizer(sport)
    const bridge = await bridgeKeys(sport, overRows, db)
    const gameLogIds = [...new Set(bridge.values())]
    const windows = [...new Set(overRows.map((r) => `${r.season}:${r.week}`))].map((k) => periods.get(k)!.window!)
    const from = new Date(Math.min(...windows.map((w) => w.start.getTime())))
    const to = new Date(Math.max(...windows.map((w) => w.end.getTime())))
    const [lines, identities] = normalizer && gameLogIds.length > 0
      ? await Promise.all([
          db.playerGameStat.findMany({
            where: { playerId: { in: gameLogIds }, sportType: { in: sportKeys(sport) }, gameDate: { gte: from, lt: to } },
            select: { playerId: true, normalizedStatMap: true, sportType: true, season: true, gameDate: true },
          }),
          db.playerIdentityMap.findMany({ where: { id: { in: gameLogIds } }, select: { id: true, position: true } }),
        ])
      : [[], []]
    const positionOf = new Map(identities.map((i) => [i.id, i.position ?? null]))
    const scorers = new Map<string, ReturnType<typeof buildLeagueStatScorer>>()
    for (const r of overRows) {
      const window = periods.get(`${r.season}:${r.week}`)!.window!
      if (!scorers.has(r.league_id)) scorers.set(r.league_id, buildLeagueStatScorer({ sport, settings: r.settings } as never))
      const scorer = scorers.get(r.league_id)
      if (!scorer || !normalizer) continue
      for (const key of [r.rec_key, r.alt_key]) {
        const sk = spaceKey(r.platform, key)
        const pk = `${r.league_id}|${r.season}:${r.week}|${sk}`
        if (points.has(pk)) continue
        const gameLogId = bridge.get(sk)
        if (!gameLogId) continue
        const mine = lines.filter(
          (l) =>
            l.playerId === gameLogId &&
            l.gameDate != null &&
            l.gameDate.getTime() >= window.start.getTime() &&
            l.gameDate.getTime() < window.end.getTime() &&
            resolveStoredSeasonType({ normalizedStatMap: l.normalizedStatMap, sport: l.sportType, season: l.season, gameDate: l.gameDate }) !== 'pre',
        )
        if (mine.length === 0) continue
        const agg = aggregateWeeklyStats(mine.map((l) => l.normalizedStatMap), normalizer)
        if (agg.gamesCounted === 0 || Object.keys(agg.stats).length === 0) continue
        const pts = scorer(agg.stats, positionOf.get(gameLogId) ?? null)
        if (Number.isFinite(pts)) points.set(pk, Math.round(pts * 100) / 100)
      }
    }
  }

  const calls: SportBenchCall[] = rows.map((r) => {
    const at = `${r.league_id}|${r.season}:${r.week}|`
    return {
      withdrawn: Boolean(r.withdrawn),
      state: sportPeriodState(periods.get(`${r.season}:${r.week}`), now),
      recPts: points.get(at + spaceKey(r.platform, r.rec_key)) ?? null,
      altPts: points.get(at + spaceKey(r.platform, r.alt_key)) ?? null,
      recProjected: r.rec_projected == null ? null : Number(r.rec_projected),
      altProjected: r.alt_projected == null ? null : Number(r.alt_projected),
      givenAt: r.given_at,
    }
  })
  return gradeSportBenchCalls(calls, now)
}

/** Every sport's line, each contained: one sport's failure is logged and costs only its own line. */
export async function gradeAllSportBench(opts: { now: Date; db?: Db; leagueIds?: readonly string[] }): Promise<
  Partial<Record<SportBenchSport, { tally: BenchTally; graded: GradedSportBenchCall[] }>>
> {
  const out: Partial<Record<SportBenchSport, { tally: BenchTally; graded: GradedSportBenchCall[] }>> = {}
  for (const sport of SPORT_BENCH_SPORTS) {
    try {
      const line = await gradeSportBench(sport, opts)
      if (line) out[sport] = line
    } catch (err) {
      console.warn(`[sportBenchGrading] ${sport} bench grading failed`, err instanceof Error ? err.message : err)
    }
  }
  return out
}
