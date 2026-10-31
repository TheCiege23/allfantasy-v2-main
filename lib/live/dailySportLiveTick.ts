import 'server-only'

import { createHash } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { loadRiIdentityMap, writeRiGameRows, type GameLogIngestResult } from '@/lib/sports-data/rollingInsightsGameLogs'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'
import { recalculateMatchupsForSeasonWeek } from '@/lib/redraft/scoringEngine'
import { resolveSeasonWeekForRedraftSeason } from '@/lib/season-week'
import { isRedraftWeekSealed } from '@/lib/redraft/weekSealed'
import { REDRAFT_SEASON_STATUS, SCORING_SEASON_STATUSES, engineSeasonScope } from '@/lib/redraft/seasonStatus'
import { rotatingBatch } from '@/lib/redraft/scoreSyncBatch'

/**
 * In-game scoring for the DAILY sports — NBA, NHL, MLB (Phase 3.3d).
 *
 * WHY THIS EXISTS. NFL moves during games: `live-score-tick` polls the live provider every two
 * minutes and rescoring follows. The daily sports never had that. Their fantasy score is built by
 * `syncPlayerWeeklyScoresForRedraftSeason` from `player_game_stats`, and the only scheduled writer
 * of that table for them is the 07:00 UTC `import-player-game-stats?multiSport=1` sweep — which
 * covers YESTERDAY. So the 5-minute `/api/redraft/score-sync` re-ran faithfully all evening against
 * rows that could not change until the next morning. Matchups moved once a day.
 *
 * WHAT IT DOES, per enabled sport, inside the existing `live-score-tick` invocation:
 *   1. Window — from `SportsGame` (the schedule in the DB), never from the clock: a game counts as
 *      live once its start time has passed and until its sport's maximum game length has, unless
 *      its stored status already says final/postponed/cancelled. No live game, no request.
 *   2. Cadence — at most one `/live` poll per sport per Eastern date per `intervalMs`, with the
 *      last-poll time kept in `sports_data_cache`. In the DB rather than in memory because the
 *      worker runs TWO replicas and a fresh invocation every two minutes.
 *   3. Fetch — `/live/{US Eastern date}/{SPORT}` through `riFetchRows`, which owns the 304 rule
 *      (no-cache headers, a fresh millisecond buster, one busted retry) and iterates BOTH Rolling
 *      Insights accounts (`riCredentialsFor`): NBA/NHL/MLB are on TOKEN2, and a single-credential
 *      call would read them as unavailable. The token is a query parameter, so nothing here logs a
 *      URL, and any error text is stripped of URLs before it is reported.
 *   4. Change detection by PAYLOAD HASH, never by status — a whole-slate hash first (identical
 *      body: no write, no rescore), then a per-line hash so only box lines that moved are upserted.
 *      A 304 that survives the transport's retries writes nothing and leaves the stored hashes as
 *      they were: "unchanged or unknown", never "no games".
 *   5. Write — through `writeRiGameRows`, the SAME parser and row shape the daily sweep uses, so
 *      the 07:00 sweep remains the reconciliation pass and simply re-covers the same keys.
 *   6. Rescore — only for a sport whose rows changed: `syncPlayerWeeklyScoresForRedraftSeason`
 *      (which also writes `player_daily_scores` for daily-lineup leagues) then
 *      `recalculateMatchupsForSeasonWeek`. A sealed week is never reopened, and playoff seasons are
 *      left to the bracket scorer in `/api/redraft/score-sync`. Standings are not rebuilt here —
 *      that 5-minute reconciliation still does it.
 *
 * Every step checks `shouldStop` (the invocation's shared run budget) before starting the next
 * unit of work, so a slow night cannot run the tick past its cron interval.
 *
 * NBA, NHL and MLB run by default; an explicit off value issues no query at all.
 */

export const DAILY_LIVE_SPORTS = ['NBA', 'NHL', 'MLB'] as const
export type DailyLiveSport = (typeof DAILY_LIVE_SPORTS)[number]

/** Persisted per-(sport, Eastern date) poll state lives under this `sports_data_cache` key prefix. */
export const DAILY_LIVE_STATE_PREFIX = 'daily-live-tick:v1:'

/** Default cadence between polls of one sport's slate. Clamped to [2, 10] minutes. */
export const DAILY_LIVE_DEFAULT_INTERVAL_MS = 3 * 60_000
const MIN_INTERVAL_MS = 2 * 60_000
const MAX_INTERVAL_MS = 10 * 60_000

/**
 * How long after its start a game may still be running. Generous on purpose: a game still listed
 * as live after it ended costs one cheap `/live` call per cadence and, once the box stops moving, a
 * hash no-op; a game dropped while still running costs live scoring for its finish.
 */
export const MAX_GAME_LENGTH_MS: Record<DailyLiveSport, number> = {
  MLB: 5 * 3_600_000, // extra innings and rain delays
  NBA: 3.25 * 3_600_000,
  NHL: 3.5 * 3_600_000, // overtime + shootout
}

/** Most seasons one pass will rescore per sport; the 5-minute score-sync still reconciles every one. */
export const DAILY_LIVE_MAX_SEASONS_PER_SPORT = 25

/**
 * The flag. Unset / empty → all supported sports. Explicit `0` / `false` / `off` → nothing enabled.
 * `1` / `true` / `on` / `all` → NBA, NHL and MLB. Otherwise a comma list of those three.
 */
export function resolveDailyLiveSports(env: Record<string, string | undefined> = process.env): DailyLiveSport[] {
  const raw = env.DAILY_SPORT_LIVE_SCORING?.trim().toLowerCase() ?? ''
  if (!raw) return [...DAILY_LIVE_SPORTS]
  if (['0', 'false', 'off', 'no'].includes(raw)) return []
  if (['1', 'true', 'on', 'yes', 'all'].includes(raw)) return [...DAILY_LIVE_SPORTS]
  const wanted = new Set(raw.split(',').map((s) => s.trim().toUpperCase()))
  return DAILY_LIVE_SPORTS.filter((s) => wanted.has(s))
}

/** `DAILY_SPORT_LIVE_INTERVAL_SECONDS`, clamped; the default otherwise. */
export function resolveDailyLiveIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const seconds = Number(env.DAILY_SPORT_LIVE_INTERVAL_SECONDS)
  if (!Number.isFinite(seconds) || seconds <= 0) return DAILY_LIVE_DEFAULT_INTERVAL_MS
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(seconds * 1000)))
}

/** Rotate the first sport each cadence so a busy slate cannot repeatedly exhaust the shared budget. */
export function rotateDailyLiveSports(sports: readonly DailyLiveSport[], nowMs: number, intervalMs: number): DailyLiveSport[] {
  if (sports.length < 2) return [...sports]
  const first = Math.floor(nowMs / Math.max(1, intervalMs)) % sports.length
  return [...sports.slice(first), ...sports.slice(0, first)]
}

const NOT_LIVE_STATUS = /final|complete|postpon|cancel|abandon|forfeit/i

/**
 * The US Eastern dates `/live` must be asked for, given the schedule rows of the games in window.
 *
 * Rolling Insights keys `/live/{date}` on the EASTERN day (GAPS: a UTC date 404s through a night
 * slate), and the game's day is its START's Eastern day — so a 10pm tip still polled at 12:30am
 * is asked for under yesterday's date. A slate straddling midnight yields both days.
 */
export function liveGameEasternDates(games: Array<{ startTime: Date | null; status: string | null }>): string[] {
  const days = new Set<string>()
  for (const g of games) {
    if (!g.startTime || NOT_LIVE_STATUS.test(g.status ?? '')) continue
    const day = easternCalendarDay(g.startTime)
    if (day) days.add(day.toISOString().slice(0, 10))
  }
  return [...days].sort()
}

function sportKeys(sport: string): string[] {
  return [sport.toUpperCase(), sport.toLowerCase()]
}

async function liveDatesFor(sport: DailyLiveSport, now: Date): Promise<string[]> {
  const rows = await prisma.sportsGame.findMany({
    where: {
      sport: { in: sportKeys(sport) },
      startTime: { gte: new Date(now.getTime() - MAX_GAME_LENGTH_MS[sport]), lte: now },
    },
    select: { startTime: true, status: true },
    take: 200,
  })
  return liveGameEasternDates(rows)
}

type PollState = {
  payloadHash: string | null
  /** `playerId|gameId` -> hash of that box line as last written. */
  lineHashes: Record<string, string>
  polledAt: string | null
}

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const stateKey = (sport: string, date: string) => `${DAILY_LIVE_STATE_PREFIX}${sport}:${date}`

async function readState(key: string): Promise<PollState> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } })
  const d = (row?.data ?? null) as Partial<PollState> | null
  return {
    payloadHash: typeof d?.payloadHash === 'string' ? d.payloadHash : null,
    lineHashes: d?.lineHashes && typeof d.lineHashes === 'object' ? (d.lineHashes as Record<string, string>) : {},
    polledAt: typeof d?.polledAt === 'string' ? d.polledAt : null,
  }
}

async function writeState(key: string, state: PollState, now: Date): Promise<void> {
  // Two days: long enough to outlive a slate that runs past Eastern midnight, short enough that
  // the table does not accumulate a row per sport per day forever.
  const expiresAt = new Date(now.getTime() + 2 * 86_400_000)
  const data = toPrismaJsonInput(state)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, data, expiresAt },
    update: { data, expiresAt },
  })
}

/** Error text for a report: no URL of any kind (redacted or not), bounded. */
function safeError(raw: unknown): string {
  return String(raw ?? 'unknown error')
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/RSC_?token\S*/gi, 'RSC_token=***')
    .slice(0, 200)
}

/** Identity maps are thousands of rows per sport; reloading one every poll would dominate a pass. */
const IDENTITY_TTL_MS = 15 * 60_000
const identityCache = new Map<string, { at: number; map: Map<string, string> }>()

async function identityMapFor(sport: string, nowMs: number): Promise<Map<string, string>> {
  const hit = identityCache.get(sport)
  if (hit && nowMs - hit.at < IDENTITY_TTL_MS && hit.map.size > 0) return hit.map
  const map = await loadRiIdentityMap(sport)
  identityCache.set(sport, { at: nowMs, map })
  return map
}

/** Test seam: forget cached identity maps. */
export function __resetDailyLiveIdentityCache(): void {
  identityCache.clear()
}

export type DailySportOutcome = {
  status: 'no-live-games' | 'cadence' | 'not_modified' | 'unchanged' | 'written' | 'error' | 'deferred'
  dates: string[]
  requests: number
  linesWritten: number
  linesUnchanged: number
  unresolved: number
  credential?: 'primary' | 'secondary'
  error?: string
}

export type DailyLiveTickResult = {
  enabled: DailyLiveSport[]
  sports: Partial<Record<DailyLiveSport, DailySportOutcome>>
  seasonsRescored: number
  matchupsRecalculated: number
  rescoreErrors: number
}

const RANK: Record<DailySportOutcome['status'], number> = {
  deferred: 0,
  'no-live-games': 1,
  cadence: 2,
  not_modified: 3,
  unchanged: 4,
  error: 5,
  written: 6,
}

/**
 * One pass. Safe to call on every `live-score-tick` iteration: outside a game window it is one
 * indexed `SportsGame` read per enabled sport, and inside one the persisted cadence decides.
 */
export async function runDailySportLiveTick(opts: {
  sports: readonly DailyLiveSport[]
  now?: Date
  fetchImpl?: typeof fetch
  /** Epoch-ms source for the transport's cache-buster (test seam). */
  clock?: () => number
  shouldStop?: () => boolean
  intervalMs?: number
}): Promise<DailyLiveTickResult> {
  const now = opts.now ?? new Date()
  const shouldStop = opts.shouldStop ?? (() => false)
  const intervalMs = opts.intervalMs ?? resolveDailyLiveIntervalMs()
  const result: DailyLiveTickResult = {
    enabled: [...opts.sports],
    sports: {},
    seasonsRescored: 0,
    matchupsRecalculated: 0,
    rescoreErrors: 0,
  }
  const changed: DailyLiveSport[] = []

  for (const sport of rotateDailyLiveSports(opts.sports, now.getTime(), intervalMs)) {
    const outcome: DailySportOutcome = {
      status: 'deferred',
      dates: [],
      requests: 0,
      linesWritten: 0,
      linesUnchanged: 0,
      unresolved: 0,
    }
    result.sports[sport] = outcome
    if (shouldStop()) continue

    const bump = (s: DailySportOutcome['status']) => {
      if (RANK[s] > RANK[outcome.status] || outcome.status === 'deferred') outcome.status = s
    }

    let dates: string[]
    try {
      dates = await liveDatesFor(sport, now)
    } catch (e) {
      outcome.status = 'error'
      outcome.error = safeError(e instanceof Error ? e.message : e)
      continue
    }
    outcome.dates = dates
    if (dates.length === 0) {
      outcome.status = 'no-live-games'
      continue
    }

    for (const date of dates) {
      if (shouldStop()) break
      const key = stateKey(sport, date)
      const state = await readState(key)
      if (state.polledAt && now.getTime() - Date.parse(state.polledAt) < intervalMs) {
        bump('cadence')
        continue
      }

      /*
       * Counted by attempts the transport COULD make, for telemetry only. The real number is
       * 1 in the normal case and at most 4 (two accounts x one busted retry) on a stubborn 304.
       */
      outcome.requests += 1
      const fetched = await riFetchRows('live', {
        sport,
        date,
        fetchImpl: opts.fetchImpl,
        ...(opts.clock ? { now: opts.clock } : {}),
      })
      // Stamped on EVERY outcome, failures included: a provider that is down is retried at the
      // cadence, not hammered on each 10-second loop iteration.
      state.polledAt = now.toISOString()

      if (fetched.notModified) {
        bump('not_modified')
        await writeState(key, state, now)
        continue
      }
      if (fetched.error || fetched.unsupported) {
        bump('error')
        outcome.error = safeError(fetched.error ?? 'unsupported')
        await writeState(key, state, now)
        continue
      }
      if (fetched.credential) outcome.credential = fetched.credential

      const payloadHash = sha(fetched.rows)
      if (payloadHash === state.payloadHash) {
        bump('unchanged')
        await writeState(key, state, now)
        continue
      }

      let identityByRiId: Map<string, string>
      try {
        identityByRiId = await identityMapFor(sport, now.getTime())
      } catch (e) {
        bump('error')
        outcome.error = safeError(e instanceof Error ? e.message : e)
        await writeState(key, state, now)
        continue
      }

      const counts: Pick<GameLogIngestResult, 'games' | 'lines' | 'written' | 'unresolved' | 'unrecognizedSeasonTypes' | 'errors'> = {
        games: 0,
        lines: 0,
        written: 0,
        unresolved: 0,
        unrecognizedSeasonTypes: [],
        errors: [],
      }
      const nextLineHashes: Record<string, string> = { ...state.lineHashes }
      const pending = new Map<string, string>()
      await writeRiGameRows({
        sport,
        rows: fetched.rows,
        identityByRiId,
        now,
        result: counts,
        persistSchedule: true,
        shouldWriteLine: ({ playerId, gameId }, line) => {
          const lineKey = `${playerId}|${gameId}`
          // 16 hex chars is ample to detect a change and keeps the stored state small (~600 MLB lines).
          const h = sha(line.raw).slice(0, 16)
          if (state.lineHashes[lineKey] === h) {
            outcome.linesUnchanged += 1
            return false
          }
          pending.set(lineKey, h)
          return true
        },
      })
      // Only lines that were attempted are remembered; a failed upsert is retried next poll
      // because its hash is not recorded (errors are counted in `counts.errors`).
      if (counts.errors.length === 0) for (const [k, v] of pending) nextLineHashes[k] = v
      outcome.linesWritten += counts.written
      outcome.unresolved += counts.unresolved
      if (counts.errors.length) outcome.error = safeError(counts.errors[0])

      await writeState(
        key,
        {
          // A partially failed write must not let the whole-slate hash short-circuit the retry.
          payloadHash: counts.errors.length === 0 ? payloadHash : null,
          lineHashes: nextLineHashes,
          polledAt: state.polledAt,
        },
        now,
      )

      if (counts.written > 0) {
        bump('written')
        if (!changed.includes(sport)) changed.push(sport)
      } else {
        bump(counts.errors.length ? 'error' : 'unchanged')
      }
    }
  }

  for (const sport of changed) {
    if (shouldStop()) break
    await rescoreSport(sport, now, shouldStop, result)
  }

  return result
}

async function rescoreSport(
  sport: DailyLiveSport,
  now: Date,
  shouldStop: () => boolean,
  result: DailyLiveTickResult,
): Promise<void> {
  let seasons: Array<{ id: string; status: string }>
  try {
    seasons = await prisma.redraftSeason.findMany({
      where: {
        AND: [engineSeasonScope({ statuses: [...SCORING_SEASON_STATUSES] }), { sport: { in: sportKeys(sport) } }],
      },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
    })
  } catch {
    result.rescoreErrors += 1
    return
  }

  // Rotated by the same rule score-sync uses, so a large sport's seasons all get their turn.
  for (const season of rotatingBatch(seasons, DAILY_LIVE_MAX_SEASONS_PER_SPORT, now.getTime())) {
    if (shouldStop()) break
    // A playoff week is scored by the bracket in /api/redraft/score-sync, not by this pipeline.
    if (season.status === REDRAFT_SEASON_STATUS.PLAYOFFS) continue
    try {
      const resolved = await resolveSeasonWeekForRedraftSeason(season.id)
      if (!resolved.ok || resolved.phase === 'preseason') continue
      const week = resolved.fantasyWeek
      // A sealed week is never reopened by a cron — same rule as score-sync.
      if (await isRedraftWeekSealed(prisma as never, season.id, week)) continue
      const summary = await syncPlayerWeeklyScoresForRedraftSeason({
        seasonId: season.id,
        week,
        actorId: 'system:daily-live-tick',
      })
      const matchups = await recalculateMatchupsForSeasonWeek(summary.seasonId, summary.week)
      result.seasonsRescored += 1
      result.matchupsRecalculated += matchups.updated
    } catch {
      // One league's gap must not end the pass; score-sync reconciles it within five minutes.
      result.rescoreErrors += 1
    }
  }
}
