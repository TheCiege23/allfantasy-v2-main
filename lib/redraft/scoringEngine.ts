import { accumulateTeamTotals, resolveCategoryMatchup, type TeamStatTotals } from '@/lib/category-scoring'
import { resolveLeagueCategories, settingsForScoringWeek } from '@/lib/category-scoring/leagueScoringType'
import type { SportConfig } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isZombieLeagueLike } from '@/lib/zombie/isZombieLeagueLike'
import { getPlatformEvents, EVENT } from '@/lib/events'
import { calculateOfficialTeamScore, leagueUsesDevyEngine } from '@/lib/devy/scoringEligibilityEngine'
import { leagueUsesC2CEngine, updateC2CMatchupScores } from '@/lib/c2c/scoringEngine'
import { campusSport } from '@/lib/c2c/campusLineup'
import type { ScoringCategory } from '@/lib/sportConfig/types'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime'
import type { StatCategoryRow } from './types'
import { isSportsDataEnabled } from '@/lib/sports-evidence/gates'
import { CertifiedScoringIntegrationService } from '@/lib/sports-evidence/scoringIntegration'
import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { isBestBallGuillotine } from '@/lib/guillotine/guillotineBestBall'
import { computeOptimalLineup, type LineupSlotSpec, type OptimalSlotAssignment } from '@/lib/lineup-optimizer/optimalLineup'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { allowedPositionsForSlot, normalizeToken } from '@/lib/redraft/lineupValidation'
import { applyScoringPresetToRecPoints, resolveLeagueScoringRules } from './leagueScoringRules'
import { loadWeekLineups, weekSlotType } from './weekLineupSlots'
import { adjustmentFor, adjustedScore, readScoreAdjustments } from '@/lib/score-adjustments/scoreAdjustments'
import { assignExtraMatchupForWeek } from '@/lib/redraft/oddTeamExtraMatchup'
import { readExtraMatchupRecord, readExtraMatchupSettings } from '@/lib/redraft/oddTeamExtraMatchupRules'
import {
  dailySlotFor,
  dayKey,
  daysInWindow,
  daysOnRoster,
  droppedInWindow,
  loadDailyLockStarts,
  lockStartOnFor,
  isDailyLineupScoringEnabled,
  loadDailyLineups,
  loadPlayerDailyStats,
  type PlayerDailyStats,
} from './dailyLineups'
import { gamesCountActive } from './gamesCount'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { applyGamesLimits, readGamesLimits, slotSeats, type GamesLimitsSummary, type LimitLedgerEntry } from './gamesLimits'
import { capSlotKey, loadDailyGamesPlayed, loadPriorSeasonLedger, positionTokens } from './gamesLimitsScoring'
import { loadGamesCountScoring, scoreCountedGames, type GamesCountScoring } from './gamesCountStore'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { writeNativePlayerWeeklyScores, type NativePlayerPoints } from './nativePlayerWeeklyScores'

export function calculateFantasyPoints(
  rawStats: Record<string, number>,
  statCategories: SportConfig['statCategories'],
  scoringOverrides?: Record<string, number>,
): number {
  const cats = statCategories as unknown as StatCategoryRow[]
  if (!Array.isArray(cats)) return 0
  let sum = 0
  for (const cat of cats) {
    const v = rawStats[cat.key] ?? 0
    const mult = scoringOverrides?.[cat.key] ?? cat.points
    sum += v * mult
  }
  return sum
}

function bonusBaseYardsKey(catKey: string): string | null {
  if (catKey.includes('pass_') && catKey.includes('bonus')) return 'pass_yds'
  if (catKey.includes('rush_') && catKey.includes('bonus')) return 'rush_yds'
  if (catKey.includes('rec_') && catKey.includes('bonus')) return 'rec_yds'
  return null
}

export function pointsForCategory(cat: ScoringCategory, rawStats: Record<string, number>): number {
  const pts = cat.defaultPoints
  if (cat.minForBonus != null) {
    const base = bonusBaseYardsKey(cat.key)
    if (!base) return 0
    const yards = rawStats[base] ?? 0
    return yards >= cat.minForBonus ? pts : 0
  }
  // Threshold-tier categories (team-defense points/yards allowed): award the
  // tier's points when the single tier stat falls within [tierMin, tierMax].
  // The stat must be present — a real 0 (shutout) is a valid tier value, so
  // distinguish "absent" from "0" via a key check rather than `?? 0`.
  if (cat.tierStatKey != null) {
    if (!(cat.tierStatKey in rawStats)) return 0
    const value = rawStats[cat.tierStatKey]
    if (!Number.isFinite(value)) return 0
    const min = cat.tierMin ?? Number.NEGATIVE_INFINITY
    const max = cat.tierMax ?? Number.POSITIVE_INFINITY
    return value >= min && value <= max ? pts : 0
  }
  // Explicit role counts supersede the legacy aggregate conversion count.
  if (cat.sport === 'NCAAF' && cat.key === 'two_pt' && ['pass_2pt', 'rush_2pt', 'rec_2pt'].some(k => k in rawStats)) return 0
  const raw = rawStats[cat.key] ?? 0
  if (cat.unit === 'per_yard' || cat.unit === 'per_inning') {
    return raw * pts
  }
  return raw * pts
}

export { applyScoringPresetToRecPoints }

/**
 * Pure scorer: sum fantasy points for one player's raw weekly stats against a
 * resolved scoring-category list, honoring per-category commissioner overrides
 * and yardage-threshold bonuses. This is the authoritative scoring math; both
 * the live engine (`calculateScoreFromSportConfig`) and the contract tests run
 * through it so what we test is exactly what scores.
 */
export function scoreStatsWithCategories(
  categories: ScoringCategory[],
  rawStats: Record<string, number>,
  overrides: Record<string, number> = {},
): number {
  let sum = 0
  for (const cat of categories) {
    const mult = overrides[cat.key] ?? cat.defaultPoints
    sum += pointsForCategory({ ...cat, defaultPoints: mult }, rawStats)
  }
  return sum
}

/**
 * Slots that NEVER count toward a matchup score. Mirrors the non-starter set in
 * `lineupValidation` (BENCH/BN/IR/TAXI/DEVY/RESERVE) so scoring and lineup rules
 * agree: previously only bench/taxi/devy were excluded, which let an IR- or
 * reserve-slotted player's points leak into the starter total.
 */
/**
 * Scoring-side starter classification: only true starter slots count toward a
 * matchup score. Exported so the contract test can prove bench/IR/taxi/devy/
 * reserve players never contribute points.
 */
export function isScoringStarterSlot(slotType: string | null | undefined): boolean {
  return isNflRedraftScoringStarterSlot(slotType)
}

/*
 * 🛑 BEST BALL WAS SCORED LIKE A LINEUP LEAGUE. A best-ball team never sets a lineup — the
 * system starts its highest scorers each week — but matchups summed only the players sitting in
 * starter slots, which nothing ever changed after the draft auto-filled them. Bench points never
 * counted, so every best-ball matchup and standing was the score of a stale lineup.
 *
 * The optimal lineup is chosen HERE, inside matchup scoring, so the matchup, the standings and
 * the finalizer all agree without a separate job. It is never written back to `slotType`.
 */
const BEST_BALL_EXCLUDED_SLOTS = new Set(['IR', 'RESERVE', 'TAXI', 'DEVY'])

/** In a best-ball league every active player can score except IR / reserve / taxi / devy. */
export function isBestBallCandidateSlot(slotType: string | null | undefined): boolean {
  return !BEST_BALL_EXCLUDED_SLOTS.has(normalizeToken(slotType))
}

/** The players whose weekly stats decide a matchup: starters, or the whole active roster in best ball. */
export function countsTowardScore(slotType: string | null | undefined, bestBall: boolean): boolean {
  return bestBall ? isBestBallCandidateSlot(slotType) : isScoringStarterSlot(slotType)
}

/**
 * Lineups set themselves: a Best Ball league, or a Guilly league its commissioner made best ball
 * (lib/guillotine/guillotineBestBall.ts — `settings.best_ball`, which only a guillotine league's
 * scoring reads here, so an imported league carrying the provider's flag scores as before). A caller
 * that wants the Guilly half must select `settings` and `guillotineMode` too.
 */
export function leagueIsBestBall(
  league:
    | {
        bestBallMode?: boolean | null
        leagueVariant?: string | null
        leagueType?: string | null
        guillotineMode?: boolean | null
        settings?: unknown
      }
    | null
    | undefined,
): boolean {
  if (!league) return false
  return isBestBallLeague(league.leagueVariant, league.bestBallMode) || isBestBallLeague(league.leagueType) || isBestBallGuillotine(league)
}

/**
 * The league's starter slots as optimizer input: the commissioner's roster (a superflex league
 * gets its SF seat), with the same slot eligibility lineup validation enforces.
 */
export function buildBestBallSlots(sport: string, leagueSettings: unknown): LineupSlotSpec[] {
  const config = resolveRedraftRosterConfig(sport, leagueSettings)
  const slots: LineupSlotSpec[] = []
  let order = 0
  for (const [token, count] of config.starterCapacities) {
    slots.push({ slot: token, eligible: allowedPositionsForSlot(sport, token), count, slotOrder: order++ })
  }
  return slots
}

function playerPositions(position: string | null | undefined): string[] {
  return String(position ?? '')
    .split(/[/,]/)
    .map((p) => normalizeToken(p))
    .filter(Boolean)
}

/** A league's own scoring, resolved once: raw stat line (and the player's position) to fantasy points. */
export type LeagueStatScorer = (rawStats: Record<string, number>, position?: string | null) => number

/**
 * Config-driven fantasy points from raw weekly stats — uses SportConfig + league `settings.sportConfig` overrides.
 */
export async function calculateScoreFromSportConfig(
  leagueId: string,
  _playerId: string,
  _week: number,
  rawStats: Record<string, number>,
  position?: string | null,
): Promise<number> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { sport: true, settings: true },
  })
  if (!league) return 0
  const scorer = buildLeagueStatScorer(league)
  if (!scorer) return calculateFantasyPoints(rawStats, [] as unknown as SportConfig['statCategories'], undefined)
  return scorer(rawStats, position)
}

/**
 * The scoring `calculateScoreFromSportConfig` applies, resolved ONCE for a league so many stat lines can be
 * scored without re-reading the league per player — a trade grade scores a whole projection board. Null
 * when the sport has no config. `settings: null` scores on the sport's defaults (no league).
 *
 * Moved out of `calculateScoreFromSportConfig` unchanged (2026-10-09): the weekly matchup engine and the
 * trade grade must score a stat line the same way, so they share this rather than a copy.
 */
export function buildLeagueStatScorer(league: { sport: string; settings: unknown }): LeagueStatScorer | null {
  const rules = resolveLeagueScoringRules(league)
  if (!rules) return null
  const { categories: resolved, overrides } = rules
  return (rawStats, position) =>
    scoreStatsWithCategories(resolved, applyTePremiumStat(resolved, rawStats, position), overrides)
}

/**
 * TE Premium fix: the `te_premium` category scores off a `te_premium` count, but
 * the NFL stat normalizer never emits that key — so the toggle was inert. Inject
 * it (= receptions) for TEs ONLY, and only when the te_premium category is active
 * (TE_PREMIUM enabled). Non-TEs and TEP-off leagues are unaffected, so this is
 * backward-compatible. Position is supplied by the roster row at every call site.
 */
export function applyTePremiumStat(
  categories: ScoringCategory[],
  rawStats: Record<string, number>,
  position?: string | null,
): Record<string, number> {
  const isTe = String(position ?? '').trim().toUpperCase() === 'TE'
  if (!isTe) return 'te_premium' in rawStats ? { ...rawStats, te_premium: 0 } : rawStats
  if (!categories.some((c) => c.key === 'te_premium')) return rawStats
  const receptions = rawStats.rec ?? rawStats.receptions ?? 0
  return { ...rawStats, te_premium: receptions }
}

export type RosterScoreSummary = {
  rosterId: string
  starterCount: number
  scoredStarterCount: number
  points: number
  missingPlayerIds: string[]
  allFinal: boolean
  statTotals?: TeamStatTotals
  /**
   * Lineup leagues only: points the benched players scored (never IR/taxi/devy). Not part of `points`;
   * the guillotine tiebreak's `bench_points` step reads it.
   */
  benchPoints?: number
  /** Best ball only: the lineup the system started this week, and any seat nobody could fill. */
  bestBall?: { assignments: OptimalSlotAssignment[]; unfilledSlots: { slot: string; seat: number }[] }
  /** Daily-lineup leagues with games limits on only (`gamesLimits.ts`): usage against each limit. */
  gamesLimits?: GamesLimitsSummary
  /**
   * Only with `collectPlayerPoints`: each player's points as this scoring counted them, starters and
   * bench (never IR/taxi/devy). Written to `league_player_weekly_scores` by `updateMatchupScores`
   * (`nativePlayerWeeklyScores.ts`) and stripped before the summary is stored in `lineupSnapshots`.
   * Absent for the devy engine, which scores a team without a per-player breakdown.
   */
  playerPoints?: NativePlayerPoints[]
}

type BestBallScoringContext = { sport: string; slots: LineupSlotSpec[] }

export type MatchupScoreUpdateSummary = {
  matchupId: string
  week: number
  homeScore: number
  awayScore: number
  isComplete: boolean
  missingPlayerIds: string[]
}

async function scoreRosterStarters(args: {
  leagueId: string
  rosterId: string
  week: number
  seasonYear: number
  useDevyEngine: boolean
  bestBall?: BestBallScoringContext | null
  includeBench?: boolean
  /** Also return `playerPoints` (and score the bench to fill it). `updateMatchupScores` only. */
  collectPlayerPoints?: boolean
}): Promise<RosterScoreSummary> {
  if (args.bestBall && !args.useDevyEngine) return scoreRosterBestBall({ ...args, bestBall: args.bestBall })
  if (args.useDevyEngine) {
    const r = await calculateOfficialTeamScore(args.leagueId, args.rosterId, args.week, args.seasonYear)
    return {
      rosterId: args.rosterId,
      starterCount: 1,
      scoredStarterCount: 1,
      points: r.officialScore,
      missingPlayerIds: [],
      allFinal: true,
    }
  }

  const daily = await scoreRosterStartersDaily(args)
  if (daily) return daily

  const starters = await prisma.redraftRosterPlayer.findMany({
    where: {
      rosterId: args.rosterId,
      droppedAt: null,
    },
  })
  // The lineup saved for THIS week, not the current one — see `weekLineupSlots.ts`.
  const weekLineups = await loadWeekLineups(prisma, {
    redraftRosterIds: [args.rosterId],
    season: args.seasonYear,
    week: args.week,
  })
  const activeStarters = starters.filter((p: (typeof starters)[number]) =>
    isScoringStarterSlot(weekSlotType(p, weekLineups)),
  )
  // "Which games count" (lib/redraft/gamesCount.ts). Null — and no query against its tables — unless
  // the commissioner chose best-N or lock-in, so every other league scores exactly as before.
  const gamesCount = activeStarters.length > 0 ? await loadRosterGamesCount(args, activeStarters) : null

  let pts = 0
  const statMaps: TeamStatTotals[] = []
  let scoredStarterCount = 0
  let allFinal = true
  const missingPlayerIds: string[] = []
  const playerPoints: NativePlayerPoints[] = []

  for (const p of activeStarters) {
    const row = await prisma.playerWeeklyScore.findUnique({
      where: {
        playerId_week_season_sport: {
          playerId: p.playerId,
          week: args.week,
          season: args.seasonYear,
          sport: p.sport,
        },
      },
    })
    if (!row) {
      missingPlayerIds.push(p.playerId)
      allFinal = false
      continue
    }
    if (gamesCount) {
      const games = gamesCount.games.get(p.playerId)
      // A weekly row with no per-game rows: the sync has not covered him since the setting changed.
      // Scoring his whole week would silently ignore the rule, so he is missing until it does.
      if (!games?.length) {
        missingPlayerIds.push(p.playerId)
        allFinal = false
        continue
      }
      const counted = await scoreCountedGames({
        setting: gamesCount.setting,
        games,
        choice: gamesCount.choices.get(p.playerId),
        scoreStats: (stats) => calculateScoreFromSportConfig(args.leagueId, p.playerId, args.week, stats, p.position),
      })
      for (const stats of counted.countedStats) statMaps.push(stats as TeamStatTotals)
      pts += counted.points
      playerPoints.push({ playerId: p.playerId, points: counted.points, isStarter: true })
      scoredStarterCount += 1
      if (!row.isFinalized) allFinal = false
      continue
    }
    statMaps.push(row.stats as TeamStatTotals)
    const playerPts = await calculateScoreFromSportConfig(
      args.leagueId,
      p.playerId,
      args.week,
      row.stats as Record<string, number>,
      p.position,
    )
    pts += playerPts
    playerPoints.push({ playerId: p.playerId, points: playerPts, isStarter: true })
    scoredStarterCount += 1
    if (!row.isFinalized) allFinal = false
  }

  let benchPts = 0
  for (const p of args.includeBench || args.collectPlayerPoints ? starters : []) {
    const slot = weekSlotType(p, weekLineups)
    if (isScoringStarterSlot(slot) || NON_BENCH_RESERVE_SLOTS.has(String(slot ?? '').trim().toLowerCase())) continue
    const row = await prisma.playerWeeklyScore.findUnique({
      where: { playerId_week_season_sport: { playerId: p.playerId, week: args.week, season: args.seasonYear, sport: p.sport } },
    })
    if (!row) continue
    const playerPts = await calculateScoreFromSportConfig(args.leagueId, p.playerId, args.week, row.stats as Record<string, number>, p.position)
    benchPts += playerPts
    playerPoints.push({ playerId: p.playerId, points: playerPts, isStarter: false })
  }

  return {
    rosterId: args.rosterId,
    starterCount: activeStarters.length,
    scoredStarterCount,
    points: Math.round(pts * 100) / 100,
    ...(args.includeBench ? { benchPoints: Math.round(benchPts * 100) / 100 } : {}),
    statTotals: accumulateTeamTotals(statMaps),
    missingPlayerIds,
    allFinal,
    ...(args.collectPlayerPoints ? { playerPoints } : {}),
  }
}

/** The league's games-count rule for a weekly-lineup roster, or null when it counts every game. */
async function loadRosterGamesCount(
  args: { leagueId: string; rosterId: string; week: number; seasonYear: number },
  players: ReadonlyArray<{ playerId: string; sport: string }>,
): Promise<GamesCountScoring | null> {
  const league = await prisma.league.findFirst({ where: { id: args.leagueId }, select: { sport: true, settings: true } })
  if (!league) return null
  return loadGamesCountScoring({
    leagueId: args.leagueId,
    leagueSettings: league.settings,
    sport: String(league.sport ?? '').toUpperCase(),
    rosterId: args.rosterId,
    season: args.seasonYear,
    week: args.week,
    players,
  })
}

/**
 * DAILY-LINEUP LEAGUES (docs/DAILY_LINEUPS_DESIGN.md §4, lib/redraft/dailyLineups.ts): the week's score
 * is the sum over its Eastern days of each day's starters' points FOR THAT DAY. A player benched on a
 * day contributes nothing that day, however well he played. Returns `null` for every other league,
 * which then scores exactly as before.
 *
 * A player's slot on a day is that day's saved row, else his latest earlier row, else — no daily save
 * names him yet — his slot in the weekly lineup. Days before he joined the roster never count.
 * Completeness is still read from the weekly row the sync writes beside the daily ones: no weekly row
 * means the sync has not covered him (missing), and the finalizer's seal is on the weekly row.
 *
 * `inject` (the admin stat re-ingest PREVIEW, lib/admin/statReingest.ts): score the same way, but with
 * the week's per-day lines supplied in memory instead of read from `player_daily_scores` — which still
 * holds the OLD stats until the sync rewrites it. Every read then goes through `inject.db`, and nothing
 * here writes. Omitted (every production caller), the function behaves exactly as before. A player with
 * injected lines but no weekly row yet is scored, not missing: the sync that would write those lines
 * writes his weekly row in the same pass. Games-count and games-limits leagues are refused under
 * injection — both read further stored per-game state the preview cannot rebuild.
 */
export async function scoreRosterStartersDaily(
  args: {
    leagueId: string
    rosterId: string
    week: number
    seasonYear: number
    includeBench?: boolean
    collectPlayerPoints?: boolean
  },
  inject?: DailyScoringInjection,
): Promise<RosterScoreSummary | null> {
  const db = inject?.db ?? prisma
  const league = await db.league.findFirst({ where: { id: args.leagueId }, select: { sport: true, settings: true } })
  const sport = String(league?.sport ?? '').toUpperCase()
  if (!league || !isDailyLineupScoringEnabled(league.settings, sport)) return null
  const window = resolveDailySportWeekWindow(sport, args.seasonYear, args.week)
  if (!window) return null

  // Dropped this week too: the days he was here still count (`daysOnRoster`).
  const players = await db.redraftRosterPlayer.findMany({ where: { rosterId: args.rosterId, ...droppedInWindow(window) } })
  const weekLineups = await loadWeekLineups(db, { redraftRosterIds: [args.rosterId], season: args.seasonYear, week: args.week })
  const dailyLineups = await loadDailyLineups(db, { redraftRosterIds: [args.rosterId], window })
  // A drop or add day belongs to whoever held him at his game's lock (`daysOnRoster`).
  const lockStarts = await loadDailyLockStarts(db, { sport, season: args.seasonYear, week: args.week })
  const days = daysInWindow(window)
  const playerIds = players.map((p: (typeof players)[number]) => p.playerId)
  if (inject && (gamesCountActive(league.settings, sport) || readGamesLimits(league.settings, sport))) {
    throw new Error('Daily scoring with injected stats does not model games-count or games-limits rules.')
  }
  // Under injection the league's scorer is resolved once from the row read above — what
  // `calculateScoreFromSportConfig` resolves per line — so no read reaches the shared client.
  const injectedScorer = inject ? buildLeagueStatScorer(league) : null
  const scoreLine = (playerId: string, stats: Record<string, number>, position: string | null) =>
    inject
      ? Promise.resolve(injectedScorer ? injectedScorer(stats, position) : 0)
      : calculateScoreFromSportConfig(args.leagueId, playerId, args.week, stats, position)
  // "Which games count" applies across the days he STARTED: only those days' games are eligible.
  const gamesCount = await loadGamesCountScoring({
    leagueId: args.leagueId,
    leagueSettings: league.settings,
    sport,
    rosterId: args.rosterId,
    season: args.seasonYear,
    week: args.week,
    players,
  })
  const dailyStatsBySport = new Map<string, Awaited<ReturnType<typeof loadPlayerDailyStats>>>()
  for (const playerSport of new Set(players.map((p: (typeof players)[number]) => p.sport))) {
    dailyStatsBySport.set(
      playerSport,
      inject ? inject.dailyStats : await loadPlayerDailyStats(db, { playerIds, sport: playerSport, season: args.seasonYear, window }),
    )
  }
  // Games limits (off by default): every started day with a stat line is recorded here, then the
  // limits step runs AFTER the loop — see `applyDailyGamesLimits` below.
  const limits = readGamesLimits(league.settings, sport)
  const limitDays: { entry: LimitLedgerEntry; points: number; position: string | null }[] = []
  const gamesBySport = new Map<string, Awaited<ReturnType<typeof loadDailyGamesPlayed>>>()
  if (limits) {
    for (const playerSport of dailyStatsBySport.keys()) {
      gamesBySport.set(playerSport, await loadDailyGamesPlayed(prisma, { playerIds, sport: playerSport, season: args.seasonYear, window }))
    }
  }

  let pts = 0
  let benchPts = 0
  let starterCount = 0
  let scoredStarterCount = 0
  let allFinal = true
  const missingPlayerIds: string[] = []
  const statMaps: TeamStatTotals[] = []
  // Points the games-count rule already decided. The limits step re-sums only the days it was handed,
  // so these are carried past it rather than lost (the settings PATCH also refuses both rules at once).
  let gamesCountPts = 0
  const gamesCountStats: TeamStatTotals[] = []
  // Per player, for `playerPoints`: what his started days counted, and what he scored on bench days.
  const starterPtsByPlayer = new Map<string, number>()
  const benchPtsByPlayer = new Map<string, number>()
  const addTo = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v)

  for (const p of players) {
    const onRoster = daysOnRoster(p, days, lockStartOnFor(lockStarts, p))
    const slotOn = (day: Date) => dailySlotFor(dailyLineups, args.rosterId, p.playerId, day) ?? weekSlotType(p, weekLineups)
    const startedDays = onRoster.filter((d) => isScoringStarterSlot(slotOn(d)))
    const benchDays = args.includeBench || args.collectPlayerPoints
      ? onRoster.filter((d) => {
          const slot = slotOn(d)
          return !isScoringStarterSlot(slot) && !NON_BENCH_RESERVE_SLOTS.has(String(slot ?? '').trim().toLowerCase())
        })
      : []
    if (startedDays.length === 0 && benchDays.length === 0) continue

    const byDay = dailyStatsBySport.get(p.sport)?.get(p.playerId)
    const pointsFor = async (day: Date) => {
      const line = byDay?.get(dayKey(day))
      if (!line) return { points: 0, stats: null }
      return {
        points: await scoreLine(p.playerId, line.stats, p.position),
        stats: line.stats,
      }
    }

    if (startedDays.length > 0) {
      starterCount += 1
      const stored = await db.playerWeeklyScore.findUnique({
        where: {
          playerId_week_season_sport: { playerId: p.playerId, week: args.week, season: args.seasonYear, sport: p.sport },
        },
        select: { isFinalized: true },
      })
      const weekly = stored ?? (inject && byDay?.size ? { isFinalized: false } : null)
      if (!weekly) {
        missingPlayerIds.push(p.playerId)
        allFinal = false
      } else if (gamesCount && !gamesCount.games.get(p.playerId)?.length) {
        // Opted in, but no per-game rows yet (see the weekly path): missing, never scored whole-week.
        missingPlayerIds.push(p.playerId)
        allFinal = false
      } else if (gamesCount) {
        scoredStarterCount += 1
        if (!weekly.isFinalized) allFinal = false
        const started = new Set(startedDays.map((d) => dayKey(d)))
        const counted = await scoreCountedGames({
          setting: gamesCount.setting,
          games: (gamesCount.games.get(p.playerId) ?? []).filter((g) => started.has(g.day)),
          choice: gamesCount.choices.get(p.playerId),
          scoreStats: (stats) => calculateScoreFromSportConfig(args.leagueId, p.playerId, args.week, stats, p.position),
        })
        pts += counted.points
        gamesCountPts += counted.points
        addTo(starterPtsByPlayer, p.playerId, counted.points)
        for (const stats of counted.countedStats) {
          statMaps.push(stats as TeamStatTotals)
          gamesCountStats.push(stats as TeamStatTotals)
        }
      } else {
        scoredStarterCount += 1
        if (!weekly.isFinalized) allFinal = false
        for (const day of startedDays) {
          const r = await pointsFor(day)
          pts += r.points
          addTo(starterPtsByPlayer, p.playerId, r.points)
          if (r.stats) statMaps.push(r.stats as TeamStatTotals)
          if (limits && r.stats) {
            limitDays.push({
              entry: {
                day: dayKey(day),
                playerId: p.playerId,
                slot: capSlotKey(slotOn(day), p.position),
                positions: positionTokens(p.position),
                gamesPlayed: gamesBySport.get(p.sport)?.get(p.playerId)?.get(dayKey(day))?.gamesPlayed ?? 1,
                stats: r.stats,
              },
              points: r.points,
              position: p.position,
            })
          }
        }
      }
    }
    for (const day of benchDays) {
      const benchDayPts = (await pointsFor(day)).points
      benchPts += benchDayPts
      addTo(benchPtsByPlayer, p.playerId, benchDayPts)
    }
  }

  let gamesLimits: GamesLimitsSummary | undefined
  if (limits) {
    const limited = await applyDailyGamesLimits({ league, sport, rosterId: args.rosterId, seasonYear: args.seasonYear, week: args.week, limits, limitDays })
    pts = gamesCountPts + limited.points
    statMaps.splice(0, statMaps.length, ...gamesCountStats, ...limited.statMaps)
    gamesLimits = limited.summary
    // A capped day's points changed after the loop: re-attribute the limited days to their players.
    // Games-count points never pass through the limits step, so they are kept as computed.
    for (const d of limitDays) starterPtsByPlayer.set(d.entry.playerId, 0)
    limitDays.forEach((d, i) => addTo(starterPtsByPlayer, d.entry.playerId, limited.entryPoints[i] ?? 0))
  }

  return {
    rosterId: args.rosterId,
    starterCount,
    scoredStarterCount,
    points: Math.round(pts * 100) / 100,
    ...(args.includeBench ? { benchPoints: Math.round(benchPts * 100) / 100 } : {}),
    statTotals: accumulateTeamTotals(statMaps),
    missingPlayerIds,
    allFinal,
    ...(gamesLimits ? { gamesLimits } : {}),
    ...(args.collectPlayerPoints
      ? {
          playerPoints: [
            ...[...starterPtsByPlayer].map(([playerId, points]) => ({ playerId, points, isStarter: true })),
            ...[...benchPtsByPlayer]
              .filter(([playerId]) => !starterPtsByPlayer.has(playerId))
              .map(([playerId, points]) => ({ playerId, points, isStarter: false })),
          ],
        }
      : {}),
  }
}

/** What the re-ingest preview hands `scoreRosterStartersDaily` in place of stored daily rows. */
export type DailyScoringInjection = {
  /** Read-only client for the scorer's reads (default: the shared one). */
  db?: typeof prisma
  /** Each player's per-day lines, in place of `player_daily_scores` (one map for every sport on the roster). */
  dailyStats: PlayerDailyStats
}

/**
 * THE GAMES-LIMITS STEP (lib/redraft/gamesLimits.ts), kept apart from the daily loop on purpose: it takes
 * the started days whose points the loop already computed, applies the caps / goalie minimum / innings
 * limits, and re-sums. A day the limits leave alone keeps the exact points the loop computed, so a week no
 * limit touches totals byte for byte what it did before. Any other rule that decides which games count
 * (best N, lock-in) belongs BEFORE this step: caps should count only games that counted.
 */
async function applyDailyGamesLimits(args: {
  league: { sport: string; settings: unknown }
  sport: string
  rosterId: string
  seasonYear: number
  week: number
  limits: NonNullable<ReturnType<typeof readGamesLimits>>
  limitDays: { entry: LimitLedgerEntry; points: number; position: string | null }[]
}): Promise<{ points: number; statMaps: TeamStatTotals[]; summary: GamesLimitsSummary; entryPoints: number[] }> {
  const settings = args.league.settings as Record<string, any> | null
  const mode = settings?.scoring_mode ?? settings?.scoringSettings?.scoringMode ?? 'points'
  const prior = args.limits.gamesPlayedCaps
    ? await loadPriorSeasonLedger(prisma, { rosterId: args.rosterId, sport: args.sport, season: args.seasonYear, week: args.week })
    : []
  const { stats, summary } = applyGamesLimits({
    sport: args.sport,
    limits: args.limits,
    scoringMode: mode === 'h2h_category' || mode === 'roto' ? 'category' : 'points',
    seats: slotSeats(args.sport, args.league.settings),
    prior,
    week: args.limitDays.map((d) => d.entry),
  })
  const scorer = buildLeagueStatScorer(args.league)
  let points = 0
  const statMaps: TeamStatTotals[] = []
  const entryPoints: number[] = []
  args.limitDays.forEach((d, i) => {
    const line = stats[i]
    const dayPoints = line === d.entry.stats ? d.points : scorer ? scorer(line, d.position) : 0
    points += dayPoints
    entryPoints.push(dayPoints)
    statMaps.push(line as TeamStatTotals)
  })
  return { points, statMaps, summary, entryPoints }
}

/** Reserve slots that are not the bench: their players count for neither the lineup nor bench points. */
const NON_BENCH_RESERVE_SLOTS = new Set(['ir', 'taxi', 'devy', 'reserve', 'injured_reserve'])

/**
 * Best ball: score every eligible player, then start the highest-scoring legal lineup
 * (`computeOptimalLineup`, exact — a superflex seat takes a second QB when that scores more).
 * Complete only when every candidate has a stat row, which the week finalizer guarantees by
 * sealing the whole best-ball roster, not just its starters.
 */
async function scoreRosterBestBall(args: {
  leagueId: string
  rosterId: string
  week: number
  seasonYear: number
  bestBall: BestBallScoringContext
  collectPlayerPoints?: boolean
  /** Also return `benchPoints`: the scored players the optimal lineup left out (the guillotine tiebreak). */
  includeBench?: boolean
}): Promise<RosterScoreSummary> {
  const players = await prisma.redraftRosterPlayer.findMany({
    where: { rosterId: args.rosterId, droppedAt: null },
  })
  // Best ball still excludes whoever was on IR / taxi / devy in THIS week's saved lineup.
  const weekLineups = await loadWeekLineups(prisma, {
    redraftRosterIds: [args.rosterId],
    season: args.seasonYear,
    week: args.week,
  })
  const candidates = players.filter((p: (typeof players)[number]) =>
    isBestBallCandidateSlot(weekSlotType(p, weekLineups)),
  )

  let scored = 0
  let allFinal = true
  const missingPlayerIds: string[] = []
  const inputs: { playerId: string; positions: string[]; points: number; playerName: string | null }[] = []
  for (const p of candidates) {
    const row = await prisma.playerWeeklyScore.findUnique({
      where: {
        playerId_week_season_sport: { playerId: p.playerId, week: args.week, season: args.seasonYear, sport: p.sport },
      },
    })
    if (!row) {
      missingPlayerIds.push(p.playerId)
      allFinal = false
      continue
    }
    const points = await calculateScoreFromSportConfig(
      args.leagueId,
      p.playerId,
      args.week,
      row.stats as Record<string, number>,
      p.position,
    )
    inputs.push({ playerId: p.playerId, positions: playerPositions(p.position), points, playerName: p.playerName ?? null })
    scored += 1
    if (!row.isFinalized) allFinal = false
  }

  const lineup = computeOptimalLineup({ players: inputs, slots: args.bestBall.slots })
  // Best ball's "starters" are the lineup the system started; everyone else scored on the bench.
  const started = new Set(lineup.assignments.map((a) => a.playerId))
  return {
    rosterId: args.rosterId,
    starterCount: candidates.length,
    scoredStarterCount: scored,
    points: Math.round(lineup.total * 100) / 100,
    /*
     * A best ball team's bench is everyone the optimal lineup left out. Without it a best ball Guilly
     * league's `bench_points` tiebreak compared nothing with nothing and fell straight through.
     */
    ...(args.includeBench
      ? { benchPoints: Math.round(inputs.filter((i) => !started.has(i.playerId)).reduce((sum, i) => sum + i.points, 0) * 100) / 100 }
      : {}),
    missingPlayerIds,
    allFinal,
    bestBall: { assignments: lineup.assignments, unfilledSlots: lineup.unfilledSlots },
    ...(args.collectPlayerPoints
      ? { playerPoints: inputs.map((i) => ({ playerId: i.playerId, points: i.points, isStarter: started.has(i.playerId) })) }
      : {}),
  }
}

async function loadBestBallContext(leagueId: string): Promise<BestBallScoringContext | null> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { sport: true, settings: true, bestBallMode: true, leagueVariant: true, leagueType: true, guillotineMode: true },
  })
  if (!league || !leagueIsBestBall(league)) return null
  const sport = String(league.sport ?? 'NFL')
  return { sport, slots: buildBestBallSlots(sport, league.settings) }
}

/**
 * One roster's score for one week, by the same rules a matchup uses (devy engine, best ball, or
 * starter slots). For formats scored outside a head-to-head matchup — a guillotine week is every
 * surviving team against the chop line, not against an opponent.
 */
export async function scoreRosterForWeek(args: {
  leagueId: string
  rosterId: string
  week: number
  seasonYear: number
  /** Also score the bench into `benchPoints` (the guillotine tiebreak). Off by default: extra reads. */
  includeBench?: boolean
  /** Also return `playerPoints` (scripts/backfill-native-player-weekly-scores.ts). */
  collectPlayerPoints?: boolean
}): Promise<RosterScoreSummary> {
  const useDevyEngine = await leagueUsesDevyEngine(args.leagueId)
  const bestBall = useDevyEngine ? null : await loadBestBallContext(args.leagueId)
  const result = await scoreRosterStarters({ ...args, useDevyEngine, bestBall })
  if (useDevyEngine || bestBall) return result
  const league = await prisma.league.findFirst({ where: { id: args.leagueId }, select: { sport: true, platform: true, leagueVariant: true } })
  if (!league || !isNativePlatform(league.platform) || String(league.sport ?? '').toUpperCase() !== 'NBA' || !['c2c', 'merged_devy_c2c'].includes(String(league.leagueVariant ?? '').toLowerCase())) return result
  const campus = await loadCampusPoints(league, { season: args.seasonYear, week: args.week, homeRosterId: args.rosterId, awayRosterId: args.rosterId })
  if (!campus || !('window' in campus)) return result
  return { ...result, points: Math.round((result.points + campus.home.points) * 100) / 100, missingPlayerIds: [...result.missingPlayerIds, 'campus-evidence-pending'], allFinal: false }
}

/**
 * C2C (Campus to Canton): each team's campus starters score on top of its pro lineup — one total
 * (lib/c2c/campusScoring.ts). Native C2C leagues: NFL from college football weeks, NBA from the college
 * basketball games inside the week's dates. Null when no one starts a college player, so a league
 * without a campus lineup scores exactly as before. Imported lazily: the campus scorer uses this
 * module's stat scorer.
 */
async function loadCampusPoints(
  league: { platform?: string | null; sport?: string | null; leagueVariant?: string | null } | null,
  args: { season: number; week: number; homeRosterId: string; awayRosterId: string },
) {
  if (!league || !isNativePlatform(league.platform) || !campusSport(league)) return null
  const { campusBasketballPointsForMatchup, campusPointsForMatchup } = await import('@/lib/c2c/campusScoring')
  const sport = campusSport(league)
  if (sport === 'football') {
    return campusPointsForMatchup(prisma as never, { season: args.season, nflWeek: args.week, homeRosterId: args.homeRosterId, awayRosterId: args.awayRosterId })
  }
  if (sport === 'basketball') return campusBasketballPointsForMatchup(prisma as never, args)
  return null
}

export async function updateMatchupScores(matchupId: string): Promise<MatchupScoreUpdateSummary | null> {
  const m = await prisma.redraftMatchup.findFirst({
    where: { id: matchupId },
    include: {
      homeRoster: { include: { players: true } },
      awayRoster: { include: { players: true } },
    },
  })
  if (!m || !m.homeRoster) return null
  if (!m.awayRosterId) {
    await updateByeRowScore(m)
    return null
  }

  const leagueId = m.leagueId
  const week = m.week
  const homeRosterId = m.homeRosterId
  const awayRosterId = m.awayRosterId
  const seasonRowId = m.seasonId

  if (await leagueUsesC2CEngine(leagueId)) {
    await updateC2CMatchupScores(matchupId)
    return null
  }

  const season = await prisma.redraftSeason.findFirst({ where: { id: seasonRowId } })
  if (!season) return null
  const seasonYear = season.season

  const scoringLeague = await prisma.league.findFirst({ where: { id: leagueId }, select: { settings: true, platform: true, sport: true, leagueVariant: true, leagueType: true } })
  // The scoring type in force for THIS week: a mid-season switch never re-scores a week played before it.
  const scoringSettings = settingsForScoringWeek(scoringLeague?.settings as Record<string, any> | null, seasonYear, week)
  const scoringMode = scoringSettings?.scoring_mode ?? scoringSettings?.scoringSettings?.scoringMode ?? 'points'
  const categoryId = scoringSettings?.category_preset_id ?? scoringSettings?.scoringSettings?.categoryPresetId
  const categories = scoringMode === 'h2h_category' || scoringMode === 'roto' ? resolveLeagueCategories(scoringSettings, categoryId) : null
  if (scoringMode !== 'points' && !categories) throw new Error('Category scoring requires a supported native category preset.')
  const useDevyEngine = await leagueUsesDevyEngine(leagueId)
  const bestBall = useDevyEngine ? null : await loadBestBallContext(leagueId)

  // Per-player points are kept only for a points league we host (see `persistNativePlayerPoints`).
  const collectPlayerPoints = scoringMode === 'points' && isNativePlatform(scoringLeague?.platform)
  // `playerPoints` is split off here so it never lands in `lineupSnapshots` below.
  const { playerPoints: homePlayerPoints, ...home } = await scoreRosterStarters({
    leagueId,
    rosterId: homeRosterId,
    week,
    seasonYear,
    useDevyEngine,
    bestBall,
    collectPlayerPoints,
  })
  const { playerPoints: awayPlayerPoints, ...away } = await scoreRosterStarters({
    leagueId,
    rosterId: awayRosterId,
    week,
    seasonYear,
    useDevyEngine,
    bestBall,
    collectPlayerPoints,
  })
  const categoryMatchup = categories ? resolveCategoryMatchup(home.statTotals ?? {}, away.statTotals ?? {}, categories) : null
  if (categoryMatchup) {
    if (bestBall || useDevyEngine) throw new Error('Category scoring is not supported for this concept.')
    home.points = categoryMatchup.aWins
    away.points = categoryMatchup.bWins
  }
  // Commissioner score adjustments (lib/score-adjustments): points leagues only, added on top of the
  // computed score on every rescore so a stat sync can never erase one.
  const adjustments = scoringMode === 'points' ? readScoreAdjustments(scoringSettings) : []
  const commissionerAdjustment = adjustments.length
    ? { home: adjustmentFor(adjustments, matchupId, homeRosterId), away: adjustmentFor(adjustments, matchupId, awayRosterId) }
    : null
  if (commissionerAdjustment) {
    home.points = adjustedScore(home.points, adjustments, matchupId, homeRosterId)
    away.points = adjustedScore(away.points, adjustments, matchupId, awayRosterId)
  }
  const campus =
    scoringMode === 'points' && !bestBall && !useDevyEngine
      ? await loadCampusPoints(scoringLeague, { season: seasonYear, week, homeRosterId, awayRosterId })
      : null
  if (campus) {
    home.points = Math.round((home.points + campus.home.points) * 100) / 100
    away.points = Math.round((away.points + campus.away.points) * 100) / 100
  }
  const zombieBaseScores = { home: home.points, away: away.points }
  let zombieItems: import('@/lib/zombie/beta2025Items').ItemScoreReceipt | null = null
  const zombieScoring = scoringMode === 'points' && isNativePlatform(scoringLeague?.platform) && scoringLeague && isZombieLeagueLike(scoringLeague)
  const missingPlayerIds = [...home.missingPlayerIds, ...away.missingPlayerIds]
  // The current college basketball feed does not establish whether a missing line is a bye,
  // an incomplete box score, or an unpublished postseason game. Keep the score provisional.
  const campusPending = Boolean(campus && 'window' in campus)
  const isComplete =
    !campusPending &&
    missingPlayerIds.length === 0 &&
    home.starterCount > 0 &&
    away.starterCount > 0 &&
    home.scoredStarterCount === home.starterCount &&
    away.scoredStarterCount === away.starterCount

  // Existing, authoritative finalization decision — driven entirely by the existing stat inputs' own
  // per-player finalized flags. Certified game data NEVER supplies fantasy points and NEVER finalizes on its own.
  const existingFinal = isComplete && home.allFinal && away.allFinal

  // Gated (off by default), STRICTER-ONLY certified finality guard: if the existing engine would finalize but
  // TRUSTWORTHY certified game evidence says not every game is final, withhold finalization (keep 'active') so a
  // premature final can't lock in. It can only DELAY finalization, never cause it, never change scores. Fails
  // open (unavailable/stale certified data → existing decision unchanged). Corrections still re-run this fn and
  // re-finalize once conditions hold. Evidence emitted (console.info), not persisted (no migration).
  let isFinal = existingFinal
  if (existingFinal && isSportsDataEnabled('scoring') && String(season.sport ?? 'NFL').toUpperCase() === 'NFL') {
    try {
      const finality = await new CertifiedScoringIntegrationService().evaluateScoringFinalityEvidence({ season: String(seasonYear), week: String(week) })
      if (finality.trustworthy && !finality.certifiedAllGamesFinal) {
        isFinal = false
        console.info('[scoring][sports-data] finalization withheld by certified evidence', { matchupId, week, unresolvedGames: finality.unresolvedGames, snapshot: finality.snapshotVersion, reason: finality.reason })
      }
    } catch {
      isFinal = existingFinal // fail open — existing authority final
    }
  }

  const persistScores = async (db: Pick<typeof prisma, 'redraftMatchup'>) => {
    let previousSnapshots = m.lineupSnapshots
    home.points = zombieBaseScores.home
    away.points = zombieBaseScores.away
    if (zombieScoring) {
      previousSnapshots = (await db.redraftMatchup.findUniqueOrThrow({ where: { id: matchupId }, select: { lineupSnapshots: true } })).lineupSnapshots
      zombieItems = await (await import('@/lib/zombie/beta2025ItemService')).loadBetaItemScoreReceipt({ leagueId, week, season: seasonYear, homeRosterId, awayRosterId, previousSnapshots }, db as never)
      if (zombieItems) {
        home.points = Math.round((home.points + zombieItems.home.bonus) * 100) / 100
        away.points = Math.round((away.points + zombieItems.away.bonus) * 100) / 100
      }
    }
    await db.redraftMatchup.update({
      where: { id: matchupId },
      data: {
        homeScore: scoringMode === 'roto' ? 0 : home.points,
        awayScore: scoringMode === 'roto' ? 0 : away.points,
        status: isFinal ? 'final' : 'active',
        lineupSnapshots: {
          ...(previousSnapshots && typeof previousSnapshots === 'object' && !Array.isArray(previousSnapshots) ? previousSnapshots : {}),
          ...(zombieItems ? { zombieItems: { ...zombieItems, homeBaseScore: zombieBaseScores.home, awayBaseScore: zombieBaseScores.away } } : {}),
          ...(categoryMatchup ? { categoryMatchup: JSON.parse(JSON.stringify(categoryMatchup)), categoryRecordMode: scoringMode === 'roto' ? 'roto' : scoringSettings?.category_record_mode ?? scoringSettings?.scoringSettings?.categoryRecordMode ?? 'most' } : {}),
          redraftScoring: {
            scoredAt: new Date().toISOString(),
            isComplete,
            ...(campusPending ? { campusPending: true } : {}),
            ...(commissionerAdjustment ? { commissionerAdjustment } : {}),
            ...(campus ? { campus } : {}),
            home,
            away,
            missingPlayerIds,
          },
        },
      },
    })

  }
  if (zombieScoring) {
    const { itemTransaction, lockItemLeague } = await import('@/lib/zombie/beta2025ItemService')
    await itemTransaction(async tx => { await lockItemLeague(tx, leagueId); await persistScores(tx) })
  } else await persistScores(prisma)

  // G15.2b/G15.3 — best-effort, never throws.
  //  • matchup.finalized: once per matchup (deterministic key), on final result.
  //  • matchup.updated: only when the score actually CHANGED (compared to the prior
  //    persisted score) so high-frequency no-op recalcs don't flood the log. Safe to
  //    wire now that the G15.3 relay drains the outbox.
  //  • score.updated (per-player) stays DEFERRED — per-player-per-sync volume would grow
  //    the permanent domain_events log unbounded; needs coalescing/retention (G15.4+).
  if (scoringMode === 'roto') return {matchupId,week,homeScore:0,awayScore:0,isComplete,missingPlayerIds}
  const scoreChanged = home.points !== m.homeScore || away.points !== m.awayScore
  // Written when the week closes, when a score moved, and when a final week is reopened by a correction
  // (so its rows drop back to not-final) — never on the many no-op recalcs of a live sync.
  if (collectPlayerPoints && (isFinal || scoreChanged || m.status === 'final')) {
    await persistNativePlayerPoints({
      leagueId,
      seasonYear,
      week,
      isFinalized: isFinal,
      rosters: [
        { redraftRosterId: homeRosterId, players: homePlayerPoints },
        { redraftRosterId: awayRosterId, players: awayPlayerPoints },
      ],
    })
  }
  if (isFinal) {
    const winnerRosterId =
      home.points > away.points ? homeRosterId : away.points > home.points ? awayRosterId : null
    await getPlatformEvents().emit(EVENT.MATCHUP_FINALIZED, {
      leagueId,
      seasonId: seasonRowId,
      sport: season.sport ?? null,
      leagueConcept: 'redraft',
      actor: { type: 'system' },
      source: 'engine:scoring',
      period: { kind: 'week', index: week },
      idempotencyKey: `matchup.finalized:${matchupId}`,
      subjects: [{ kind: 'matchup', id: matchupId }],
      payload: { matchupId, homeScore: home.points, awayScore: away.points, winnerRosterId: winnerRosterId ?? undefined },
    })
  } else if (scoreChanged) {
    await getPlatformEvents().emit(EVENT.MATCHUP_UPDATED, {
      leagueId,
      seasonId: seasonRowId,
      sport: season.sport ?? null,
      leagueConcept: 'redraft',
      actor: { type: 'system' },
      source: 'engine:scoring',
      period: { kind: 'week', index: week },
      subjects: [{ kind: 'matchup', id: matchupId }],
      payload: { matchupId },
    })
  }

  return {
    matchupId,
    week,
    homeScore: home.points,
    awayScore: away.points,
    isComplete,
    missingPlayerIds,
  }
}

/**
 * Store a native matchup's per-player points (`nativePlayerWeeklyScores.ts`). Best-effort, like the
 * events beside it: the matchup score is already written, and a failed side table must not fail it.
 * A roster with no `players` (the devy engine) is left untouched rather than cleared.
 */
async function persistNativePlayerPoints(args: {
  leagueId: string
  seasonYear: number
  week: number
  isFinalized: boolean
  rosters: { redraftRosterId: string; players: NativePlayerPoints[] | undefined }[]
}): Promise<void> {
  for (const r of args.rosters) {
    if (!r.players) continue
    try {
      await writeNativePlayerWeeklyScores(prisma, {
        leagueId: args.leagueId,
        seasonYear: args.seasonYear,
        week: args.week,
        redraftRosterId: r.redraftRosterId,
        players: r.players,
        isFinalized: args.isFinalized,
      })
    } catch (error) {
      console.error('[scoring] native player weekly scores not written', {
        leagueId: args.leagueId,
        week: args.week,
        rosterId: r.redraftRosterId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Score the team on a bye, when its week still counts for something: league median, or the extra
 * matchup an odd-team league can play instead of the bye.
 *
 * 🛑 AN ODD-TEAM LEAGUE'S BYE TEAM LOST ITS MEDIAN GAME EVERY WEEK. A bye row has no opponent, so
 * scoring returned before writing it; `computeWeeklyMedianResults` then saw no completed score for the
 * bye team and sat it out of the median — exactly the result league median exists to give it. A bye row
 * is now scored on the home side alone, but only in a points league with league median or the extra
 * matchup on: anywhere else nothing reads the number, and the rows stay as every other reader expects.
 *
 * Returns nothing to the week's summary: a bye is not a matchup, and the counters callers read
 * (`updated`, `incomplete`) keep meaning head-to-head games.
 */
async function updateByeRowScore(row: {
  id: string
  leagueId: string
  seasonId: string
  week: number
  homeRosterId: string
  lineupSnapshots: unknown
}): Promise<void> {
  let m = row
  const [league, season] = await Promise.all([
    prisma.league.findFirst({ where: { id: m.leagueId }, select: { settings: true, medianGame: true, platform: true, sport: true, leagueVariant: true } }),
    prisma.redraftSeason.findFirst({ where: { id: m.seasonId }, select: { season: true, medianGame: true } }),
  ])
  if (!league || !season) return
  // The extra matchup (lib/redraft/oddTeamExtraMatchupRules.ts) is decided on this score too. Its pick is
  // fixed when the week opens; this is the fallback for a week no advance opened (week 1).
  let extraMatchup = readExtraMatchupRecord(m.lineupSnapshots) != null
  if (!extraMatchup && readExtraMatchupSettings(league.settings).enabled) {
    const assigned = await assignExtraMatchupForWeek({ seasonId: m.seasonId, week: m.week }).catch(() => null)
    if (assigned && assigned.status !== 'skipped') {
      extraMatchup = true
      m = { ...m, lineupSnapshots: { ...(m.lineupSnapshots && typeof m.lineupSnapshots === 'object' && !Array.isArray(m.lineupSnapshots) ? m.lineupSnapshots : {}), extraMatchup: assigned.record } }
    }
  }
  if (!(league.medianGame ?? season.medianGame) && !extraMatchup) return
  const scoringSettings = settingsForScoringWeek(league.settings as Record<string, any> | null, season.season, m.week)
  const scoringMode = scoringSettings?.scoring_mode ?? scoringSettings?.scoringSettings?.scoringMode ?? 'points'
  if (scoringMode !== 'points') return
  if (await leagueUsesC2CEngine(m.leagueId)) return

  const useDevyEngine = await leagueUsesDevyEngine(m.leagueId)
  const bestBall = useDevyEngine ? null : await loadBestBallContext(m.leagueId)
  const home = await scoreRosterStarters({
    leagueId: m.leagueId,
    rosterId: m.homeRosterId,
    week: m.week,
    seasonYear: season.season,
    useDevyEngine,
    bestBall,
  })
  const adjustments = readScoreAdjustments(scoringSettings)
  if (adjustments.length) home.points = adjustedScore(home.points, adjustments, m.id, m.homeRosterId)
  // A C2C bye team's campus starters count toward its median / extra-game score too.
  const campus = !bestBall && !useDevyEngine
    ? await loadCampusPoints(league, { season: season.season, week: m.week, homeRosterId: m.homeRosterId, awayRosterId: m.homeRosterId })
    : null
  if (campus) home.points = Math.round((home.points + campus.home.points) * 100) / 100
  const campusPending = Boolean(campus && 'window' in campus)
  const isComplete =
    !campusPending && home.missingPlayerIds.length === 0 && home.starterCount > 0 && home.scoredStarterCount === home.starterCount
  await prisma.redraftMatchup.update({
    where: { id: m.id },
    data: {
      homeScore: home.points,
      status: isComplete && home.allFinal ? 'final' : 'active',
      lineupSnapshots: {
        ...(m.lineupSnapshots && typeof m.lineupSnapshots === 'object' && !Array.isArray(m.lineupSnapshots) ? m.lineupSnapshots : {}),
        redraftScoring: {
          scoredAt: new Date().toISOString(),
          isComplete,
          ...(campusPending ? { campusPending: true } : {}),
          bye: true,
          home,
          missingPlayerIds: home.missingPlayerIds,
          ...(campus ? { campus: { ...('cfbWeeks' in campus ? { cfbWeeks: campus.cfbWeeks } : { window: campus.window }), home: campus.home } } : {}),
        },
      },
    },
  })
}

export async function recalculateMatchupsForSeasonWeek(
  seasonId: string,
  week: number,
): Promise<{ updated: number; incomplete: number; summaries: MatchupScoreUpdateSummary[] }> {
  const season = await prisma.redraftSeason.findUnique({where:{id:seasonId},include:{league:{select:{settings:true}}}})
  const settings = settingsForScoringWeek(season?.league.settings as Record<string,any> | null, season?.season, week)
  if (settings?.scoring_mode === 'roto' && season) {
    const categories=resolveLeagueCategories(settings, settings.category_preset_id)
    if(!categories) throw new Error('Rotisserie category preset is missing.')
    const rosters=await prisma.roster.findMany({where:{leagueId:season.leagueId,redraftRosterId:{not:null}},select:{id:true,redraftRosterId:true}})
    let incomplete=0
    for(const roster of rosters) {
      const result=await scoreRosterStarters({leagueId:season.leagueId,rosterId:roster.redraftRosterId!,week,seasonYear:season.season,useDevyEngine:false})
      const complete=!result.missingPlayerIds.length && result.starterCount>0 && result.allFinal
      if(!complete) incomplete++
      const data={totalPoints:0,opponentRosterId:null,winLoss:null,status:complete?'final':'active',categoryBreakdown:{teamStats:result.statTotals??{}}}
      await prisma.teamWeekResult.upsert({where:{leagueId_season_week_rosterId:{leagueId:season.leagueId,season:season.season,week,rosterId:roster.id}},create:{leagueId:season.leagueId,season:season.season,week,rosterId:roster.id,...data},update:data})
    }
    await prisma.redraftMatchup.updateMany({where:{seasonId,week},data:{homeScore:0,awayScore:0,status:incomplete?'active':'final'}})
    const {updateStandings}=await import('./standingsEngine')
    await updateStandings(seasonId,week)
    return {updated:rosters.length,incomplete,summaries:[]}
  }
  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId, week },
    select: { id: true },
  })
  const summaries: MatchupScoreUpdateSummary[] = []
  let incomplete = 0
  for (const matchup of matchups) {
    const summary = await updateMatchupScores(matchup.id)
    if (!summary) continue
    summaries.push(summary)
    if (!summary.isComplete) incomplete += 1
  }
  return { updated: summaries.length, incomplete, summaries }
}

// Lineup locking now lives in `lib/redraft/lineupLock.ts`, derived from the real
// game schedule at request time (no flag-flipping job needed). The former
// `lockPlayersAtGameStart` no-op stub was removed when G1 was implemented.
