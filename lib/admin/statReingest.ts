/**
 * ADMIN STAT RE-INGEST + WEEK RESCORE — the owner's way to re-read a date range of player game
 * stats and rescore finished native redraft weeks, without the cron secret.
 *
 * Nothing here is a new rule. Every step is the existing tool, called the way its own caller does:
 *
 *   ingest   `ingestRollingInsightsGameLogs` — what `/api/cron/import-player-game-stats?multiSport=1
 *            &sport=X&from&to` calls for each sport. Same function, same `player_game_stats` upsert
 *            key (playerId, sportType, gameId), so re-covering a date is idempotent.
 *   preview  `loadDailyWeekStats` + `reviewStatCorrections` — the stat-correction detector's own
 *            read-only comparison: the week re-summed from `player_game_stats` by the sync's rules,
 *            scored by the league's scorer, against the `PlayerWeeklyScore` lines the week was
 *            scored on. Starters are chosen exactly as the detector chooses them.
 *   write    `syncPlayerWeeklyScoresForRedraftSeason` → `recalculateMatchupsForSeasonWeek` →
 *            `updateStandings` — what the admin POST /api/redraft/score-sync runs for a
 *            league+week — and, for a week that WAS sealed, `finalizeRedraftWeek` to seal it again.
 *
 * 🛑 WHY THE RE-SEAL. The stat sync's upserts write `isFinalized: false` (see the sealed-week note
 * in app/api/redraft/score-sync/route.ts), so rescoring a sealed week drops its matchups to
 * 'active'. Left there, a week outside the finalizer's lookback would stay open for good and block
 * `advance_week`. The re-seal runs the normal finalizer checks; if it refuses, the refusal is
 * returned rather than forced. Its "week N final" push is suppressed — those results were already
 * announced once.
 *
 * WHY IT IS GUARDED. A rescore of a finished week can change who won. The preview reports every
 * matchup's before/after, and nothing is written unless the caller sends `confirm: true` — or
 * `confirm: "allow-flips"` when any result would flip, or when the preview could not be computed
 * for this league's format (best ball, devy, category, daily lineups…), because then no flip can
 * be ruled out.
 *
 * ⚠ NFL is accepted but neither step applies: NFL game stats are week-ingested from Sleeper by the
 * default mode of the same cron, not swept by date, and its fresh week stats need a provider pull.
 * Use POST /api/redraft/score-sync for an NFL rescore.
 */
import type { Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { createRunBudget } from '@/lib/cron/runBudget'
import { dateRange, ingestRollingInsightsGameLogs } from '@/lib/sports-data/rollingInsightsGameLogs'
import { normalizeNhlGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { readScoringType, settingsForScoringWeek } from '@/lib/category-scoring/leagueScoringType'
import { leagueUsesDevyEngine } from '@/lib/devy/scoringEligibilityEngine'
import { leagueUsesC2CEngine } from '@/lib/c2c/scoringEngine'
import { gamesCountActive } from '@/lib/redraft/gamesCount'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { isSealedWeek } from '@/lib/redraft/weekSealed'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import {
  buildLeagueStatScorer,
  isScoringStarterSlot,
  leagueIsBestBall,
  recalculateMatchupsForSeasonWeek,
} from '@/lib/redraft/scoringEngine'
import { isTeamDefenseRow } from '@/lib/scoring-runtime/nflStatNormalization'
import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { finalizeRedraftWeek } from '@/lib/redraft/weekFinalizer'
import { loadDailyWeekStats, type DailyWeekStatsFetcher } from '@/lib/stat-corrections/dailyWeekStats'
import { reviewStatCorrections, type PlayerCorrection } from '@/lib/stat-corrections/statCorrectionReview'

// ---------------------------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------------------------

export const STAT_REINGEST_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const
export type StatReingestSport = (typeof STAT_REINGEST_SPORTS)[number]
/** Sports whose game stats the cron's multi-sport mode sweeps by date. */
const DATE_INGEST_SPORTS: ReadonlySet<string> = new Set(['NBA', 'NHL', 'MLB'])
export const STAT_REINGEST_MAX_DAYS = 31
export const STAT_REINGEST_MAX_WEEKS = 8
/** Same run budget the cron's multi-sport sweep uses; checked between dates. */
const INGEST_BUDGET_MS = 240_000

export type StatReingestRequest = {
  sport: StatReingestSport
  from: string
  to: string
  leagueId: string | null
  weeks: number[]
  dryRun: boolean
  confirm: true | 'allow-flips' | null
  skipIngest: boolean
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function isRealDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function parseStatReingestBody(
  body: unknown,
): { ok: true; value: StatReingestRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object.' }
  const b = body as Record<string, unknown>

  const sport = String(b.sport ?? '').trim().toUpperCase()
  if (!(STAT_REINGEST_SPORTS as readonly string[]).includes(sport)) {
    return { ok: false, error: `sport must be one of ${STAT_REINGEST_SPORTS.join(', ')}.` }
  }
  const from = String(b.from ?? '').trim()
  const to = String(b.to ?? '').trim()
  if (!isRealDay(from) || !isRealDay(to)) return { ok: false, error: 'from and to must be YYYY-MM-DD dates.' }
  if (from > to) return { ok: false, error: 'from must be on or before to.' }
  const days = dateRange(from, to).length
  if (days > STAT_REINGEST_MAX_DAYS) {
    return { ok: false, error: `Range is ${days} days; the limit is ${STAT_REINGEST_MAX_DAYS}.` }
  }

  const leagueIdRaw = b.leagueId == null ? '' : String(b.leagueId).trim()
  const leagueId = leagueIdRaw || null
  let weeks: number[] = []
  if (b.weeks != null) {
    const list = Array.isArray(b.weeks) ? b.weeks : [b.weeks]
    for (const w of list) {
      const n = Number(w)
      if (!Number.isInteger(n) || n < 1 || n > 30) return { ok: false, error: 'weeks must be whole numbers from 1 to 30.' }
      if (!weeks.includes(n)) weeks.push(n)
    }
    weeks = weeks.sort((a, z) => a - z)
    if (weeks.length > STAT_REINGEST_MAX_WEEKS) return { ok: false, error: `At most ${STAT_REINGEST_MAX_WEEKS} weeks per call.` }
  }
  if (weeks.length > 0 && !leagueId) return { ok: false, error: 'weeks requires leagueId.' }
  if (leagueId && weeks.length === 0) return { ok: false, error: 'leagueId requires weeks.' }

  if (b.dryRun != null && typeof b.dryRun !== 'boolean') return { ok: false, error: 'dryRun must be a boolean.' }
  const dryRun = b.dryRun !== false
  let confirm: StatReingestRequest['confirm'] = null
  if (b.confirm === true) confirm = true
  else if (b.confirm === 'allow-flips') confirm = 'allow-flips'
  else if (b.confirm != null && b.confirm !== false) return { ok: false, error: 'confirm must be true or "allow-flips".' }
  if (b.skipIngest != null && typeof b.skipIngest !== 'boolean') return { ok: false, error: 'skipIngest must be a boolean.' }

  return { ok: true, value: { sport: sport as StatReingestSport, from, to, leagueId, weeks, dryRun, confirm, skipIngest: b.skipIngest === true } }
}

// ---------------------------------------------------------------------------------------------
// Dependencies (injectable for tests; defaults are the production tools named in the header)
// ---------------------------------------------------------------------------------------------

type Db = typeof defaultPrisma

export type StatReingestDeps = {
  prisma?: Db
  ingest?: typeof ingestRollingInsightsGameLogs
  loadWeekStats?: DailyWeekStatsFetcher
  syncWeek?: typeof syncPlayerWeeklyScoresForRedraftSeason
  recalcWeek?: typeof recalculateMatchupsForSeasonWeek
  standings?: typeof updateStandings
  finalizeWeek?: typeof finalizeRedraftWeek
  /** Format checks that each read the league again; injectable so a test need not mock their modules. */
  usesDevyEngine?: (leagueId: string) => Promise<boolean>
  usesC2CEngine?: (leagueId: string) => Promise<boolean>
  buildScorer?: typeof buildLeagueStatScorer
}

// ---------------------------------------------------------------------------------------------
// Goalie W / SO tally (NHL) — what PR #2759's derivation awards over the range
// ---------------------------------------------------------------------------------------------

export type GoalieTally = {
  goalieLines: number
  /** Lines carrying the context the ingest now stores (`teamGoaliesUsed`); older rows lack it. */
  linesWithGameContext: number
  wins: number
  shutouts: number
}

export async function tallyNhlGoalieResults(db: Db, from: string, to: string): Promise<GoalieTally> {
  const rows = await db.playerGameStat.findMany({
    where: {
      sportType: { in: ['NHL', 'nhl'] },
      gameDate: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) },
    },
    select: { normalizedStatMap: true },
  })
  const tally: GoalieTally = { goalieLines: 0, linesWithGameContext: 0, wins: 0, shutouts: 0 }
  for (const row of rows) {
    const map = row.normalizedStatMap as Record<string, unknown> | null
    if (!map || map.group !== 'goalies') continue
    tally.goalieLines += 1
    if (typeof map.teamGoaliesUsed === 'number') tally.linesWithGameContext += 1
    const stats = normalizeNhlGameStats(map).stats
    if ((stats.g_win ?? 0) > 0) tally.wins += 1
    if ((stats.g_so ?? 0) > 0) tally.shutouts += 1
  }
  return tally
}

// ---------------------------------------------------------------------------------------------
// Rescore preview
// ---------------------------------------------------------------------------------------------

export type MatchupPreview = {
  matchupId: string
  status: string | null
  home: { rosterId: string; before: number; after: number }
  away: { rosterId: string; before: number; after: number }
  resultFlipped: boolean
}

export type WeekPreview = {
  week: number
  sealed: boolean
  /** False when the before/after could not be computed for this league's format; see `reason`. */
  supported: boolean
  reason?: string
  matchups: MatchupPreview[]
  flips: number
  startersConsidered: number
  /** Starters with no stored line or no fresh line — they cannot be compared. */
  unchecked: number
  /** Largest per-player point changes (top 25). */
  changes: PlayerCorrection[]
}

type SeasonRow = {
  id: string
  leagueId: string
  season: number
  sport: string | null
  status: string | null
  league: {
    platform: string | null
    sport: string | null
    settings: unknown
    bestBallMode: boolean | null
    leagueVariant: string | null
    leagueType: string | null
  } | null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const outcome = (h: number, a: number) => (h > a ? 'home' : a > h ? 'away' : 'tie')

async function formatRefusal(season: SeasonRow, sport: string, week: number, deps: StatReingestDeps): Promise<string | null> {
  const league = season.league
  if (!league) return 'league_not_found'
  if (sport === 'NFL') return 'nfl_preview_needs_provider_pull'
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return 'not_native_league'
  if (leagueIsBestBall(league)) return 'best_ball'
  if (gamesCountActive(league.settings, sport)) return 'games_count_scoring'
  if (isDailyLineupScoringEnabled(league.settings, sport)) return 'daily_lineup_scoring'
  if (readScoringType(settingsForScoringWeek(league.settings, season.season, week)).mode !== 'points') return 'not_points_scoring'
  if (await (deps.usesDevyEngine ?? leagueUsesDevyEngine)(season.leagueId)) return 'devy_engine'
  if (await (deps.usesC2CEngine ?? leagueUsesC2CEngine)(season.leagueId)) return 'c2c_engine'
  return null
}

export async function previewWeekRescore(season: SeasonRow, sport: string, week: number, deps: StatReingestDeps = {}): Promise<WeekPreview> {
  const db = deps.prisma ?? defaultPrisma
  const rows = await db.redraftMatchup.findMany({
    where: { seasonId: season.id, week },
    select: { id: true, status: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true },
  })
  const pairs = rows.filter((r) => r.awayRosterId)
  const unchanged = (): MatchupPreview[] =>
    pairs.map((r) => ({
      matchupId: r.id,
      status: r.status,
      home: { rosterId: r.homeRosterId, before: round2(r.homeScore), after: round2(r.homeScore) },
      away: { rosterId: r.awayRosterId!, before: round2(r.awayScore), after: round2(r.awayScore) },
      resultFlipped: false,
    }))
  const base = { week, sealed: isSealedWeek(rows), flips: 0, startersConsidered: 0, unchecked: 0, changes: [] as PlayerCorrection[] }
  if (pairs.length === 0) return { ...base, supported: false, reason: 'no_matchups', matchups: [] }

  const refusal = await formatRefusal(season, sport, week, deps)
  if (refusal) return { ...base, supported: false, reason: refusal, matchups: unchanged() }

  // The detector's starter set: current roster rows, placed by the lineup saved for THAT week.
  const rosterIds = [...new Set(pairs.flatMap((m) => [m.homeRosterId, m.awayRosterId!]))]
  const players = await db.redraftRosterPlayer.findMany({
    where: { rosterId: { in: rosterIds }, droppedAt: null },
    select: { rosterId: true, playerId: true, playerName: true, position: true, slotType: true, sport: true },
  })
  const lineups = await loadWeekLineups(db, { redraftRosterIds: rosterIds, season: season.season, week })
  const starters = players.filter(
    (p) => isScoringStarterSlot(weekSlotType(p, lineups)) && !isTeamDefenseRow(p.playerId, p.position),
  )
  if (starters.length === 0) return { ...base, supported: false, reason: 'no_starters', matchups: unchanged() }
  const playerIds = [...new Set(starters.map((p) => p.playerId))]

  const stored = await db.playerWeeklyScore.findMany({
    where: { playerId: { in: playerIds }, week, season: season.season, sport },
    select: { playerId: true, stats: true },
  })
  const storedBy = new Map(stored.map((r) => [r.playerId, (r.stats ?? {}) as Record<string, number>]))
  const fresh = await (deps.loadWeekStats ?? loadDailyWeekStats)({
    sport,
    season: season.season,
    week,
    players: playerIds.map((id) => ({ playerId: id, playerName: starters.find((p) => p.playerId === id)?.playerName ?? null })),
  })
  const scorer = (deps.buildScorer ?? buildLeagueStatScorer)({ sport, settings: season.league!.settings })
  if (!scorer) return { ...base, supported: false, reason: 'no_scoring_rules', matchups: unchanged() }

  const review = reviewStatCorrections({
    starters: starters.map((p) => ({
      rosterId: p.rosterId,
      playerId: p.playerId,
      playerName: p.playerName ?? p.playerId,
      position: p.position,
      storedStats: storedBy.get(p.playerId) ?? null,
      freshStats: fresh.get(p.playerId) ?? null,
    })),
    matchups: pairs.map((r) => ({
      matchupId: r.id,
      homeRosterId: r.homeRosterId,
      awayRosterId: r.awayRosterId!,
      homeScore: r.homeScore,
      awayScore: r.awayScore,
    })),
    score: scorer,
  })
  const changed = new Map(review.matchups.map((m) => [m.matchupId, m]))
  const matchups = unchanged().map((m) => {
    const c = changed.get(m.matchupId)
    return c ? { ...m, home: c.home, away: c.away, resultFlipped: c.resultFlipped } : m
  })
  return {
    ...base,
    supported: true,
    matchups,
    flips: matchups.filter((m) => m.resultFlipped).length,
    startersConsidered: starters.length,
    unchecked: review.unchecked,
    changes: review.changes.slice(0, 25),
  }
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

export type WriteRefusal =
  | 'dry_run'
  | 'confirm_required'
  | 'flips_require_allow_flips'
  | 'preview_unsupported_requires_allow_flips'
  | 'nfl_use_score_sync'

export type AppliedWeek = {
  week: number
  matchups: Array<{
    matchupId: string
    before: { home: number; away: number; status: string | null }
    after: { home: number; away: number; status: string | null }
    resultFlipped: boolean
  }>
  scoresUpserted: number
  reSeal: null | { finalized: boolean; alreadyFinal: boolean; refusal: string | null }
  error?: string
}

export type StatReingestResult = {
  ok: boolean
  dryRun: boolean
  sport: string
  from: string
  to: string
  days: number
  ingest:
    | { ran: false; reason: string; wouldFetchDates?: number }
    | { ran: true; result: unknown }
  goalies: { before: GoalieTally; after: GoalieTally | null } | null
  rescore: null | {
    leagueId: string
    seasonId: string
    season: number
    weeks: WeekPreview[]
    flips: number
    wrote: boolean
    writeRefusal: WriteRefusal | null
    applied: AppliedWeek[]
  }
}

export class StatReingestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function runStatReingest(
  req: StatReingestRequest,
  actorId: string,
  deps: StatReingestDeps = {},
): Promise<StatReingestResult> {
  const db = deps.prisma ?? defaultPrisma
  const dates = dateRange(req.from, req.to)

  // Resolve the league first so a wrong id costs no provider call.
  let season: SeasonRow | null = null
  if (req.leagueId) {
    season = (await db.redraftSeason.findFirst({
      where: { leagueId: req.leagueId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        leagueId: true,
        season: true,
        sport: true,
        status: true,
        league: { select: { platform: true, sport: true, settings: true, bestBallMode: true, leagueVariant: true, leagueType: true } },
      },
    })) as SeasonRow | null
    if (!season) throw new StatReingestError('No redraft season found for that leagueId.', 404)
    const seasonSport = String(season.sport ?? season.league?.sport ?? '').toUpperCase()
    if (seasonSport !== req.sport) {
      throw new StatReingestError(`League ${req.leagueId} is ${seasonSport || 'an unknown sport'}, not ${req.sport}.`, 400)
    }
  }

  const goaliesBefore = req.sport === 'NHL' ? await tallyNhlGoalieResults(db, req.from, req.to) : null

  // ---- Step A: ingest ------------------------------------------------------------------------
  let ingest: StatReingestResult['ingest']
  if (!DATE_INGEST_SPORTS.has(req.sport)) {
    ingest = { ran: false, reason: 'nfl_is_week_ingested_from_sleeper_by_the_default_cron_mode' }
  } else if (req.dryRun) {
    // The ingest has no read-only mode — it upserts as it fetches — so a dry run does not call it.
    ingest = { ran: false, reason: 'dry_run', wouldFetchDates: dates.length }
  } else if (req.skipIngest) {
    ingest = { ran: false, reason: 'skip_ingest' }
  } else {
    const budget = createRunBudget(INGEST_BUDGET_MS)
    const result = await (deps.ingest ?? ingestRollingInsightsGameLogs)({
      sport: req.sport,
      dates,
      shouldStop: () => budget.exhausted(),
    })
    ingest = { ran: true, result }
  }
  const goaliesAfter =
    goaliesBefore && ingest.ran ? await tallyNhlGoalieResults(db, req.from, req.to) : null

  const base: StatReingestResult = {
    ok: true,
    dryRun: req.dryRun,
    sport: req.sport,
    from: req.from,
    to: req.to,
    days: dates.length,
    ingest,
    goalies: goaliesBefore ? { before: goaliesBefore, after: goaliesAfter } : null,
    rescore: null,
  }
  if (!season) return base

  // ---- Step B: preview, then (maybe) write ---------------------------------------------------
  const previews: WeekPreview[] = []
  for (const week of req.weeks) previews.push(await previewWeekRescore(season, req.sport, week, deps))
  const flips = previews.reduce((n, p) => n + p.flips, 0)
  const anyUnsupported = previews.some((p) => !p.supported && p.reason !== 'no_matchups')

  let writeRefusal: WriteRefusal | null = null
  if (req.sport === 'NFL') writeRefusal = 'nfl_use_score_sync'
  else if (req.dryRun) writeRefusal = 'dry_run'
  else if (!req.confirm) writeRefusal = 'confirm_required'
  else if (flips > 0 && req.confirm !== 'allow-flips') writeRefusal = 'flips_require_allow_flips'
  else if (anyUnsupported && req.confirm !== 'allow-flips') writeRefusal = 'preview_unsupported_requires_allow_flips'

  const applied: AppliedWeek[] = []
  if (!writeRefusal) {
    const syncWeek = deps.syncWeek ?? syncPlayerWeeklyScoresForRedraftSeason
    const recalcWeek = deps.recalcWeek ?? recalculateMatchupsForSeasonWeek
    const standings = deps.standings ?? updateStandings
    const finalizeWeek = deps.finalizeWeek ?? finalizeRedraftWeek
    for (const week of req.weeks) {
      const readRows = () =>
        db.redraftMatchup.findMany({
          where: { seasonId: season!.id, week },
          select: { id: true, status: true, awayRosterId: true, homeScore: true, awayScore: true },
        })
      const beforeRows = await readRows()
      const wasSealed = isSealedWeek(beforeRows)
      const entry: AppliedWeek = { week, matchups: [], scoresUpserted: 0, reSeal: null }
      try {
        const sync = await syncWeek({ seasonId: season.id, week, actorId })
        entry.scoresUpserted = sync.scoresUpserted
        await recalcWeek(season.id, week)
        if (wasSealed) {
          const sealed = await finalizeWeek(
            { seasonId: season.id, week },
            // Already announced once when the week first closed.
            { notifyResults: async () => undefined, resolvePredictions: async () => undefined },
          )
          entry.reSeal = { finalized: sealed.finalized, alreadyFinal: sealed.alreadyFinal, refusal: sealed.refusal }
        }
        await standings(season.id, week)
      } catch (e) {
        entry.error = (e instanceof Error ? e.message : String(e)).slice(0, 300)
      }
      const afterRows = new Map((await readRows()).map((r) => [r.id, r]))
      for (const b of beforeRows) {
        if (!b.awayRosterId) continue
        const a = afterRows.get(b.id) ?? b
        entry.matchups.push({
          matchupId: b.id,
          before: { home: round2(b.homeScore), away: round2(b.awayScore), status: b.status },
          after: { home: round2(a.homeScore), away: round2(a.awayScore), status: a.status },
          resultFlipped: outcome(b.homeScore, b.awayScore) !== outcome(a.homeScore, a.awayScore),
        })
      }
      applied.push(entry)
    }
    await db.leagueAuditLog
      .create({
        data: {
          leagueId: season.leagueId,
          userId: null,
          actionType: 'admin_stat_reingest_rescore',
          entityType: 'redraft_week',
          entityId: `${season.id}:${req.weeks.join(',')}`,
          afterState: JSON.parse(JSON.stringify({ applied })) as Prisma.InputJsonValue,
          metadata: { actorId, sport: req.sport, from: req.from, to: req.to, confirm: String(req.confirm) },
        },
      })
      .catch(() => undefined)
  }

  return {
    ...base,
    ok: applied.every((a) => !a.error),
    rescore: {
      leagueId: season.leagueId,
      seasonId: season.id,
      season: season.season,
      weeks: previews,
      flips,
      wrote: !writeRefusal,
      writeRefusal,
      applied,
    },
  }
}
