/**
 * Re-checks a season's latest SEALED week against a fresh pull of its stats, for a few days after the
 * seal — NFL stat corrections land the Thursday after the games — and records what would change.
 *
 * 🛑 READ-ONLY WITH RESPECT TO SCORING. It never writes `PlayerWeeklyScore`, a matchup or standings.
 * That is not caution for its own sake: the stat sync's upserts write `isFinalized: false`, so routing
 * a correction through it would un-seal the week, drop its matchups to 'active' and pull the week out
 * of the standings until the finalizer sealed it again. The fresh stats are compared in memory only.
 *
 * What it writes: the latest review to `sportsDataCache` (one key per season and week, overwritten,
 * read by the commissioner card), and a `stat_correction_detected` league-log row the first time
 * each distinct set of corrections is seen.
 *
 * Scope, deliberately narrow: native NFL and NBA points leagues with ordinary weekly lineups. Best ball,
 * devy, C2C, category, games-count, daily-lineup and imported leagues score differently or are scored by
 * their platform, and team defenses are scored from game results rather than this stat line — all are
 * reported as not covered rather than guessed at.
 *
 * Where the fresh stats come from differs by sport. NFL: a provider pull (corrections never reach a
 * table on their own). NBA: the week re-summed from `player_game_stats`, which the scheduled import
 * re-sweeps for recent days (./dailyWeekStats.ts) — DB-first, and summed by the sync's own rules.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { readScoringType, settingsForScoringWeek } from '@/lib/category-scoring/leagueScoringType'
import { leagueUsesDevyEngine } from '@/lib/devy/scoringEligibilityEngine'
import { leagueUsesC2CEngine } from '@/lib/c2c/scoringEngine'
import { gamesCountActive } from '@/lib/redraft/gamesCount'
import { isSealedWeek } from '@/lib/redraft/weekSealed'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { buildLeagueStatScorer, isScoringStarterSlot, leagueIsBestBall } from '@/lib/redraft/scoringEngine'
import { isTeamDefenseRow } from '@/lib/scoring-runtime/nflStatNormalization'
import type { NflWeekStatsFetcher } from '@/lib/redraft/playerWeeklyScoreService'
import { readScoreAdjustments, statCorrectionApplied } from '@/lib/score-adjustments/scoreAdjustments'
import { reviewStatCorrections, type StatCorrectionReview } from './statCorrectionReview'
import {
  EXTENDED_CORRECTION_WEEKS,
  EXTENDED_CORRECTION_WINDOW_DAYS,
  FREE_CORRECTION_WINDOW_DAYS,
  readExtendedCorrections,
} from './extendedCorrections'
import { applyStatCorrections, ownerHasAfCommissionerPlan } from './applyStatCorrections'
import { loadDailyWeekStats, type DailyWeekStatsFetcher } from './dailyWeekStats'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'

/** Sports whose weekly-lineup points leagues are checked. NBA's fresh stats come from the game table. */
export const STAT_CORRECTION_SPORTS: ReadonlySet<string> = new Set(['NFL', 'NBA'])

/** How long after a week's seal it is still re-checked (free leagues). Corrections land within the week. */
export const STAT_CORRECTION_WINDOW_MS = FREE_CORRECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
/** The cron runs every five minutes; the provider is asked about a week at most this often. */
export const STAT_CORRECTION_RECHECK_MS = 60 * 60 * 1000
/** The stored review outlives the window so the card can still show it. */
const REVIEW_TTL_MS = 21 * 24 * 60 * 60 * 1000

export const STAT_CORRECTION_ACTION = 'stat_correction_detected'

export function statCorrectionCacheKeyPrefix(seasonId: string): string {
  return `stat-correction-review:${seasonId}:`
}

export function statCorrectionCacheKey(seasonId: string, week: number): string {
  return `${statCorrectionCacheKeyPrefix(seasonId)}${week}`
}

export type StoredStatCorrectionReview = {
  seasonId: string
  leagueId: string
  season: number
  week: number
  sealedAt: string
  checkedAt: string
  review: StatCorrectionReview
}

export type StatCorrectionCheckOutcome =
  | 'not_supported'
  | 'no_sealed_week'
  | 'outside_window'
  | 'throttled'
  | 'no_starters'
  | 'provider_empty'
  | 'no_change'
  | 'changes_seen'
  | 'changes_logged'

/** Same fetcher the stat sync uses, so the comparison runs through one normalizer. */
const defaultFetch: NflWeekStatsFetcher = async ({ season, week, playerIds }) => {
  const { NflLiveStatsProvider } = await import('@/lib/live-scoring/nflLiveStatsProvider')
  return new NflLiveStatsProvider(prisma as never).fetchPlayerStatsForGames({ sport: 'NFL', season, week, games: [], playerIds })
}

function asStats(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n
  return out
}

function scoredAt(snapshot: unknown): number | null {
  const at = (snapshot as { redraftScoring?: { scoredAt?: unknown } } | null)?.redraftScoring?.scoredAt
  const t = typeof at === 'string' ? Date.parse(at) : NaN
  return Number.isFinite(t) ? t : null
}

export function readStoredReview(data: unknown): StoredStatCorrectionReview | null {
  const d = data as StoredStatCorrectionReview | null
  if (!d || typeof d !== 'object' || typeof d.week !== 'number' || !d.review || !Array.isArray(d.review.changes)) return null
  return d
}

export async function checkStatCorrectionsForSeason(
  seasonId: string,
  deps: {
    now?: number
    fetchStats?: NflWeekStatsFetcher
    fetchDailyStats?: DailyWeekStatsFetcher
    ownerHasPlan?: (userId: string | null) => Promise<boolean>
    applyCorrections?: typeof applyStatCorrections
  } = {},
): Promise<StatCorrectionCheckOutcome> {
  const now = deps.now ?? Date.now()
  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: {
      id: true,
      leagueId: true,
      season: true,
      sport: true,
      status: true,
      league: { select: { platform: true, sport: true, settings: true, bestBallMode: true, leagueVariant: true, leagueType: true, guillotineMode: true, userId: true } },
    },
  })
  const league = season?.league
  if (!season || !league) return 'not_supported'
  const sport = String(season.sport ?? league.sport ?? '').toUpperCase()
  if (!STAT_CORRECTION_SPORTS.has(sport)) return 'not_supported'
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return 'not_supported'
  if (leagueIsBestBall(league) || gamesCountActive(league.settings, sport)) return 'not_supported'
  // A daily-lineup league is scored day by day on that day's starters; a weekly re-sum cannot match it.
  if (sport !== 'NFL' && isDailyLineupScoringEnabled(league.settings, sport)) return 'not_supported'

  // Extended scoring corrections (./extendedCorrections.ts): AF Commissioner leagues that switched it
  // on re-check the last two finished weeks for 14 days and APPLY what they find. Everyone else: the
  // latest finished week, 6 days, shown to the commissioner only — exactly as before.
  const extended = readExtendedCorrections(league.settings) && (await (deps.ownerHasPlan ?? ownerHasAfCommissionerPlan)(league.userId))
  const windowMs = (extended ? EXTENDED_CORRECTION_WINDOW_DAYS : FREE_CORRECTION_WINDOW_DAYS) * 24 * 60 * 60 * 1000

  const weeks = extended
    ? (await prisma.redraftMatchup.findMany({ where: { seasonId, status: 'final' }, distinct: ['week'], orderBy: { week: 'desc' }, take: EXTENDED_CORRECTION_WEEKS, select: { week: true } })).map((r) => r.week)
    : [(await prisma.redraftMatchup.findFirst({ where: { seasonId, status: 'final' }, orderBy: { week: 'desc' }, select: { week: true } }))?.week].filter((w): w is number => typeof w === 'number')
  if (weeks.length === 0) return 'no_sealed_week'

  const checkWeek = async (week: number): Promise<StatCorrectionCheckOutcome> => {
  const rows = await prisma.redraftMatchup.findMany({
    where: { seasonId, week },
    select: { id: true, status: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, lineupSnapshots: true },
  })
  if (!isSealedWeek(rows)) return 'no_sealed_week'
  const sealedAt = Math.max(0, ...rows.map((r) => scoredAt(r.lineupSnapshots) ?? 0))
  if (!sealedAt || now - sealedAt > windowMs) return 'outside_window'

  // Checked after the cheap gates: these two each read the league again.
  const weekSettings = settingsForScoringWeek(league.settings, season.season, week)
  if (readScoringType(weekSettings).mode !== 'points') return 'not_supported'
  if ((await leagueUsesDevyEngine(season.leagueId)) || (await leagueUsesC2CEngine(season.leagueId))) return 'not_supported'

  const key = statCorrectionCacheKey(seasonId, week)
  const previous = readStoredReview((await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } }))?.data)
  if (previous && now - Date.parse(previous.checkedAt) < STAT_CORRECTION_RECHECK_MS) return 'throttled'

  /*
   * ⚠ MEASURED FROM THE SEALED SCORE, NOT THE STORED ONE. Applying a correction (the commissioner's
   * Apply, via applyStatCorrectionAdjustment) moves the stored score by the correction. Comparing the
   * next re-check against that would add the same correction twice. Taking the applied part back out
   * keeps "before" the sealed result and "after" the fully corrected one on every check.
   */
  const adjustments = readScoreAdjustments(league.settings)
  const matchups = rows.flatMap((r) =>
    r.awayRosterId
      ? [{
          matchupId: r.id,
          homeRosterId: r.homeRosterId,
          awayRosterId: r.awayRosterId,
          homeScore: r.homeScore - statCorrectionApplied(adjustments, r.id, r.homeRosterId),
          awayScore: r.awayScore - statCorrectionApplied(adjustments, r.id, r.awayRosterId),
        }]
      : [],
  )
  const rosterIds = [...new Set(matchups.flatMap((m) => [m.homeRosterId, m.awayRosterId]))]
  // The same starter set the scorer uses: current roster rows, placed by the lineup saved for THAT week.
  const players = await prisma.redraftRosterPlayer.findMany({
    where: { rosterId: { in: rosterIds }, droppedAt: null },
    select: { rosterId: true, playerId: true, playerName: true, position: true, slotType: true, sport: true },
  })
  const lineups = await loadWeekLineups(prisma, { redraftRosterIds: rosterIds, season: season.season, week })
  const starters = players.filter(
    (p) => isScoringStarterSlot(weekSlotType(p, lineups)) && !isTeamDefenseRow(p.playerId, p.position),
  )
  if (starters.length === 0) return 'no_starters'
  const playerIds = [...new Set(starters.map((p) => p.playerId))]

  const stored = await prisma.playerWeeklyScore.findMany({
    where: { playerId: { in: playerIds }, week, season: season.season, sport },
    select: { playerId: true, stats: true },
  })
  const storedBy = new Map(stored.map((r) => [r.playerId, asStats(r.stats)]))

  let fresh: Map<string, Record<string, number>>
  try {
    fresh =
      sport === 'NFL'
        ? await (deps.fetchStats ?? defaultFetch)({ season: season.season, week, playerIds })
        : await (deps.fetchDailyStats ?? loadDailyWeekStats)({
            sport,
            season: season.season,
            week,
            players: playerIds.map((id) => ({ playerId: id, playerName: starters.find((p) => p.playerId === id)?.playerName ?? null })),
          })
  } catch {
    fresh = new Map()
  }
  const at = new Date(now).toISOString()
  const write = (review: StatCorrectionReview) => {
    const data: StoredStatCorrectionReview = {
      seasonId,
      leagueId: season.leagueId,
      season: season.season,
      week,
      sealedAt: new Date(sealedAt).toISOString(),
      checkedAt: at,
      review,
    }
    const json = JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue
    const expiresAt = new Date(sealedAt + REVIEW_TTL_MS)
    return prisma.sportsDataCache.upsert({
      where: { cacheKey: key },
      create: { cacheKey: key, data: json, expiresAt },
      update: { data: json, expiresAt },
    })
  }
  // An empty pull is a refusal or an outage, never "every correction was reverted": keep the last
  // review, only stamp the check so the provider is not asked again every five minutes.
  if (fresh.size === 0) {
    if (previous) await write(previous.review)
    return 'provider_empty'
  }

  const scorer = buildLeagueStatScorer({ sport, settings: league.settings })
  if (!scorer) return 'not_supported'
  const review = reviewStatCorrections({
    starters: starters.map((p) => ({
      rosterId: p.rosterId,
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      storedStats: storedBy.get(p.playerId) ?? null,
      freshStats: fresh.get(p.playerId) ?? null,
    })),
    matchups,
    score: scorer,
  })
  await write(review)
  if (review.changes.length === 0) return 'no_change'
  // Applied on every check that sees changes, not only the first: it adds only what is still owed,
  // so a repeat is a no-op and a second correction to the same week adds only itself.
  if (extended) await (deps.applyCorrections ?? applyStatCorrections)({ leagueId: season.leagueId, seasonStatus: season.status, league, week, review })
  if (previous?.review.fingerprint === review.fingerprint) return 'changes_seen'

  await prisma.leagueAuditLog.create({
    data: {
      leagueId: season.leagueId,
      userId: null,
      actionType: STAT_CORRECTION_ACTION,
      entityType: 'redraft_week',
      entityId: `${seasonId}:${week}`,
      afterState: JSON.parse(
        JSON.stringify({
          changes: review.changes,
          matchups: review.matchups,
          fingerprint: review.fingerprint,
        }),
      ) as Prisma.InputJsonValue,
      metadata: { season: season.season, week, flipped: review.matchups.filter((m) => m.resultFlipped).length },
    },
  })
  return 'changes_logged'
  }

  // The outcome reported is the latest week's; an older week is checked for its late corrections only.
  let latestOutcome: StatCorrectionCheckOutcome | null = null
  for (const week of weeks) {
    const outcome = await checkWeek(week)
    latestOutcome ??= outcome
  }
  return latestOutcome ?? 'no_sealed_week'
}
