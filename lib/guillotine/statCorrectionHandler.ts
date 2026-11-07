/**
 * Stat corrections that land AFTER a Guilly week has been chopped.
 *
 * THE PUBLISHED POLICY, implemented here:
 *   - a correction after the week is final UPDATES that week's scores: the `GuillotinePeriodScore`
 *     row (the Guilly standings read its `seasonPointsCumul`, so every later week's running total is
 *     rebuilt too) and the survival history (`GuillotineSurvivalLog.totalScore`);
 *   - it NEVER reverses a chop or a crowned champion: nothing here touches `GuillotineRosterState`,
 *     `GuillotineElimination`, a roster's players or the season's status;
 *   - when the corrected scores would have chopped a different team, that is recorded on the Guilly
 *     event log (`stat_correction`, ./GuillotineEventLog.ts) and the commissioner is told through the
 *     path every other correction uses — a commissioner-only league-log row
 *     (`guillotine_stat_correction`, lib/league-log/leagueLog.ts), beside `stat_correction_detected`.
 *
 * 🛑 BEFORE THIS, A CHOPPED WEEK WAS NEVER LOOKED AT AGAIN. Score-sync re-pulls only the current week;
 * the stat-correction detector covers head-to-head weeks only (a Guilly league has no matchups, so it
 * reads `no_sealed_week`) and refuses to apply anything in an elimination format. This stub returned
 * `reversed: false` and did nothing else.
 *
 * ── HOW A CORRECTED SCORE IS COMPUTED, AND WHY NOT BY RE-SCORING THE TEAM ───────────────────
 * Re-running `scoreRosterForWeek` days later reads TODAY's roster: the chopped team's players were
 * released at the chop, and survivors have since dropped players who played that week. A plain re-score
 * would therefore move scores for reasons that have nothing to do with a correction — the chopped team
 * would read 0. So at the chop, `nativeGuillotineWeek` records a BASELINE: every counted player of every
 * team with the points he scored, from the same `scoreRosterForWeek` call the chop used. A correction is
 * then measured per player against that baseline, and the team's corrected score is
 *
 *     recorded period points + (corrected lineup − baseline lineup)
 *
 * where "lineup" is the starters' sum, or, in best ball, the optimal lineup re-solved over the same
 * players (a corrected bench player can enter it). Every write is ABSOLUTE (recorded + delta-from-a-
 * fixed-baseline), never an increment, so a retry, a repeated check or a crash between writes lands the
 * same numbers; the event and the log row are deduped on a fingerprint of the corrected scores.
 *
 * ── TWO-WEEK PERIODS (MLB, ./eliminationPeriods.ts) ─────────────────────────────────────────
 * The baseline is keyed by the period's last week, like every other period row, and keeps each week's
 * players separately (`periodWeeks`, `teams[].weeks`). Both weeks are refreshed and re-sealed, each is
 * re-scored and re-seated on its own, and the corrected period score is the recorded period score plus
 * BOTH weeks' deltas. A one-week baseline carries neither field and is read exactly as before.
 *
 * ⚠ NEVER TREATS UNAVAILABLE DATA AS ZERO. A player whose row is gone keeps his baseline points; a
 * refresh that throws, or a re-seal the finalizer refuses (a missing box score, coverage below the
 * floor), applies nothing and waits for the next hourly check.
 */
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { appendEvent } from './GuillotineEventLog'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'
import { finalizeRedraftWeek } from '@/lib/redraft/weekFinalizer'
import { DATE_WINDOWED_SPORTS } from '@/lib/redraft/weekGames'
import { buildBestBallSlots, calculateScoreFromSportConfig, leagueIsBestBall } from '@/lib/redraft/scoringEngine'
import { computeOptimalLineup } from '@/lib/lineup-optimizer/optimalLineup'
import { playerPositions } from '@/lib/rookie-order/nativeMaxPf'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { gamesCountActive } from '@/lib/redraft/gamesCount'
import { readGamesLimits } from '@/lib/redraft/gamesLimits'
import { seasonSportToLeagueSport } from '@/lib/season-week/standardSeasonScope'
import { OPTIMAL_LINEUP_ALGORITHM } from '@/lib/lineup-optimizer/optimalLineup'
import { readStoredSlots, scoringRulesFingerprint, toStoredSlots, type StoredSlot } from '@/lib/bestball/resultRuleStamp'

/** How long after a chop its week is re-checked. Matches the free correction window (6 days). */
export const GUILLOTINE_CORRECTION_WINDOW_MS = 6 * 24 * 60 * 60 * 1000
/** Score-sync runs every five minutes; a chopped week's stats are re-pulled at most this often. */
export const GUILLOTINE_CORRECTION_RECHECK_MS = 60 * 60 * 1000
/** Weeks re-checked per tick, newest first. */
const WEEKS_PER_CHECK = 2
const BASELINE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LOCK_TTL_MS = 5 * 60 * 1000

export const GUILLOTINE_STAT_CORRECTION_ACTION = 'guillotine_stat_correction'
export const GUILLOTINE_STAT_CORRECTION_EVENT = 'stat_correction'

export function guillotineCorrectionKeyPrefix(seasonId: string): string {
  return `guillotine-correction:${seasonId}:`
}
export function guillotineCorrectionKey(seasonId: string, week: number): string {
  return `${guillotineCorrectionKeyPrefix(seasonId)}${week}`
}

export type BaselinePlayer = { playerId: string; sport: string; position: string | null; points: number; isStarter: boolean }
export type BaselineTeam = {
  redraftRosterId: string
  /** The `Roster.id` the engine and `GuillotinePeriodScore` use. */
  engineRosterId: string
  /** The period points the chop was decided on (a two-week period: both weeks added). */
  recordedPoints: number
  /** A one-week period's players. Empty on a multi-week baseline, which keeps them per week in `weeks`. */
  players: BaselinePlayer[]
  /**
   * Multi-week periods only (MLB two-week periods, ./eliminationPeriods.ts): each week's counted players,
   * oldest first. Each week is re-scored and re-seated on its own, exactly as the chop scored it.
   */
  weeks?: Array<{ week: number; players: BaselinePlayer[] }>
}
export type CorrectionBaseline = {
  v: 1
  seasonId: string
  leagueId: string
  season: number
  /** The period's key: its last week (a one-week period: the week). */
  week: number
  /**
   * Multi-week periods only: every week the period scored, oldest first, ending at `week`. Absent on a
   * one-week baseline, which is byte-for-byte what it was before periods existed.
   */
  periodWeeks?: number[]
  capturedAt: string
  teams: BaselineTeam[]
  lastCheckedAt?: string
  lastFingerprint?: string
  /**
   * Best ball Guilly only: the rules the chop's lineups were seated under (lib/bestball/resultRuleStamp.ts).
   * A correction re-solves the lineup over these SAME slots, so a commissioner who changes the roster seats
   * after the chop cannot move a closed week's scores. Absent on a baseline recorded before this existed
   * (or for a lineup league): the correction then reads the league's current slots, as before.
   */
  bestBallRules?: { algorithm: string; slots: StoredSlot[]; scoringFingerprint: string | null }
}

const round2 = (n: number) => Math.round(n * 100) / 100

function readBaseline(data: unknown): CorrectionBaseline | null {
  const d = data as CorrectionBaseline | null
  if (!d || typeof d !== 'object' || d.v !== 1 || typeof d.week !== 'number' || !Array.isArray(d.teams)) return null
  return d
}

async function writeBaseline(b: CorrectionBaseline): Promise<void> {
  const key = guillotineCorrectionKey(b.seasonId, b.week)
  const data = JSON.parse(JSON.stringify(b)) as Prisma.InputJsonValue
  const expiresAt = new Date(Date.parse(b.capturedAt) + BASELINE_TTL_MS)
  await prisma.sportsDataCache.upsert({ where: { cacheKey: key }, create: { cacheKey: key, data, expiresAt }, update: { data, expiresAt } })
}

/**
 * Recorded by `nativeGuillotineWeek` at the chop, from the very scores it chops on. Best-effort by
 * design — a chop must never fail because its correction bookkeeping could not be written — so the
 * caller wraps it; without a baseline that week is simply never corrected (`no_baseline`).
 */
export async function recordGuillotineCorrectionBaseline(args: {
  seasonId: string
  leagueId: string
  season: number
  week: number
  capturedAt: Date
  teams: Array<{
    redraftRosterId: string
    engineRosterId: string
    recordedPoints: number
    /** A one-week period's counted players. */
    playerPoints: Array<{ playerId: string; points: number; isStarter: boolean }>
    /**
     * A multi-week period (MLB two-week periods): each week's counted players, oldest first, the last
     * week being `week`. When given, `playerPoints` is ignored and the period is corrected week by week.
     */
    weekPlayerPoints?: Array<{ week: number; playerPoints: Array<{ playerId: string; points: number; isStarter: boolean }> }>
  }>
}): Promise<void> {
  const multiWeek = args.teams.some((t) => (t.weekPlayerPoints?.length ?? 0) > 1)
  const pointsOf = (t: (typeof args.teams)[number]) => (multiWeek ? (t.weekPlayerPoints ?? []).flatMap((w) => w.playerPoints) : t.playerPoints)
  const ids = [...new Set(args.teams.flatMap((t) => pointsOf(t).map((p) => p.playerId)))]
  const rows = ids.length
    ? await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: { in: args.teams.map((t) => t.redraftRosterId) }, playerId: { in: ids } },
        select: { rosterId: true, playerId: true, sport: true, position: true },
      })
    : []
  const meta = new Map(rows.map((r) => [`${r.rosterId}|${r.playerId}`, r]))
  const toBaseline = (redraftRosterId: string, list: Array<{ playerId: string; points: number; isStarter: boolean }>): BaselinePlayer[] =>
    list.flatMap((p) => {
      const m = meta.get(`${redraftRosterId}|${p.playerId}`)
      // A player whose sport cannot be read cannot be re-read later; he keeps his points (delta 0).
      return m ? [{ playerId: p.playerId, sport: m.sport, position: m.position ?? null, points: p.points, isStarter: p.isStarter }] : []
    })
  const bestBallRules = await chopBestBallRules(args.leagueId)
  // Every week the period scored, from any team that reports them (all teams score the same weeks).
  const periodWeeks = multiWeek
    ? [...new Set(args.teams.flatMap((t) => (t.weekPlayerPoints ?? []).map((w) => w.week)))].sort((a, b) => a - b)
    : null
  await writeBaseline({
    v: 1,
    seasonId: args.seasonId,
    leagueId: args.leagueId,
    season: args.season,
    week: args.week,
    ...(periodWeeks ? { periodWeeks } : {}),
    capturedAt: args.capturedAt.toISOString(),
    teams: args.teams.map((t) => ({
      redraftRosterId: t.redraftRosterId,
      engineRosterId: t.engineRosterId,
      recordedPoints: round2(t.recordedPoints),
      players: multiWeek ? [] : toBaseline(t.redraftRosterId, t.playerPoints),
      ...(periodWeeks
        ? {
            weeks: periodWeeks.map((week) => ({
              week,
              players: toBaseline(t.redraftRosterId, t.weekPlayerPoints?.find((w) => w.week === week)?.playerPoints ?? []),
            })),
          }
        : {}),
    })),
    ...(bestBallRules ? { bestBallRules } : {}),
  })
}

/** The weeks a baseline's period scored, oldest first: the week itself for a one-week period. */
function baselineWeeks(b: CorrectionBaseline): number[] {
  return Array.isArray(b.periodWeeks) && b.periodWeeks.length > 0 ? b.periodWeeks : [b.week]
}

/** A team's counted players for one week of its period. */
function teamPlayersForWeek(b: CorrectionBaseline, team: BaselineTeam, week: number): BaselinePlayer[] {
  if (Array.isArray(b.periodWeeks) && b.periodWeeks.length > 0) return team.weeks?.find((w) => w.week === week)?.players ?? []
  return week === b.week ? team.players : []
}

/**
 * The slots and scoring a best ball Guilly chop was just scored on — read the way `scoreRosterForWeek`
 * read them moments earlier (`buildBestBallSlots` over the league's settings). Null for a lineup league,
 * or when the league cannot be read: the baseline is then written exactly as before.
 */
async function chopBestBallRules(leagueId: string): Promise<CorrectionBaseline['bestBallRules'] | null> {
  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { sport: true, settings: true, bestBallMode: true, leagueVariant: true, leagueType: true, guillotineMode: true },
    })
    .catch(() => null)
  if (!league || !leagueIsBestBall(league)) return null
  const sport = String(league.sport ?? 'NFL')
  return {
    algorithm: OPTIMAL_LINEUP_ALGORITHM,
    slots: toStoredSlots(buildBestBallSlots(sport, league.settings)),
    scoringFingerprint: scoringRulesFingerprint({ sport, settings: league.settings }),
  }
}

export type GuillotineCorrectionOutcome =
  | 'not_guillotine'
  | 'no_baseline'
  | 'outside_window'
  | 'throttled'
  | 'not_supported'
  | 'locked'
  | 'provider_failed'
  | 'waiting'
  | 'no_change'
  | 'applied'

export type GuillotineCorrectionResult = {
  outcome: GuillotineCorrectionOutcome
  week?: number
  reason?: string
  changes?: Array<{ redraftRosterId: string; engineRosterId: string; before: number; after: number }>
  choppedRosterIds?: string[]
  /** The teams the corrected scores rank lowest — the ones that would have gone, had the chop run now. */
  wouldHaveChoppedRosterIds?: string[]
  /** The corrected scores would have chopped someone else. The chop stands regardless. */
  chopDisputed?: boolean
}

export type GuillotineCorrectionDeps = {
  now?: () => Date
  /** Re-pulls a past week's stats (score-sync passes `syncPlayerWeeklyScoresForRedraftSeason`). */
  syncWeekStats?: (args: { seasonId: string; week: number }) => Promise<unknown>
  /** Re-seals the week after the refresh. Defaults to the week finalizer. */
  finalizeWeek?: typeof finalizeRedraftWeek
  /** One player's points from his stat line, by the league's own scoring. */
  scorePlayer?: (args: { leagueId: string; playerId: string; week: number; stats: Record<string, number>; position: string | null }) => Promise<number>
}

function lineupTotal(players: Array<{ playerId: string; position: string | null; points: number; isStarter: boolean }>, slots: ReturnType<typeof buildBestBallSlots> | null): number {
  if (!slots) return players.filter((p) => p.isStarter).reduce((sum, p) => sum + p.points, 0)
  return computeOptimalLineup({ players: players.map((p) => ({ playerId: p.playerId, positions: playerPositions(p.position), points: p.points })), slots }).total
}

function fingerprintOf(week: number, scores: Array<[string, number]>): string {
  const body = JSON.stringify([week, [...scores].sort((a, b) => a[0].localeCompare(b[0]))])
  return createHash('sha256').update(body).digest('hex').slice(0, 32)
}

/** The lowest `k` by corrected score; a tie across the line is reported as disputed, never resolved here. */
function lowest(scores: Array<{ id: string; points: number }>, k: number): { ids: string[]; tieAtLine: boolean } {
  const sorted = [...scores].sort((a, b) => a.points - b.points || a.id.localeCompare(b.id))
  const line = sorted[k - 1]?.points
  const next = sorted[k]?.points
  return { ids: sorted.slice(0, k).map((s) => s.id), tieAtLine: line != null && next != null && round2(line) === round2(next) }
}

/**
 * Re-check one chopped week of one season and apply what a correction changed. `force` skips the
 * window and the hourly throttle (the cron route's manual trigger); it never skips the lock.
 */
export async function applyGuillotineStatCorrectionsForWeek(
  input: { seasonId: string; week: number; force?: boolean },
  deps: GuillotineCorrectionDeps = {},
): Promise<GuillotineCorrectionResult> {
  const now = deps.now?.() ?? new Date()
  const week = input.week
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey: guillotineCorrectionKey(input.seasonId, week) } })
  const baseline = readBaseline(cached?.data)
  if (!baseline) return { outcome: 'no_baseline', week }
  if (!input.force) {
    if (now.getTime() - Date.parse(baseline.capturedAt) > GUILLOTINE_CORRECTION_WINDOW_MS) return { outcome: 'outside_window', week }
    if (baseline.lastCheckedAt && now.getTime() - Date.parse(baseline.lastCheckedAt) < GUILLOTINE_CORRECTION_RECHECK_MS) return { outcome: 'throttled', week }
  }

  const league = await prisma.league.findUnique({
    where: { id: baseline.leagueId },
    select: { sport: true, settings: true, bestBallMode: true, leagueVariant: true, leagueType: true, guillotineMode: true, userId: true },
  })
  if (!league) return { outcome: 'not_guillotine', week }
  const sport = seasonSportToLeagueSport(String(league.sport ?? 'NFL')) || 'NFL'
  const bestBall = leagueIsBestBall(league)
  /*
   * Supported where a player's WEEKLY row decides his points: daily lineups, games-count and
   * games-limits score per day or per game, and best ball in a daily sport is moving to per-day
   * scoring. Those are reported, never re-scored on the wrong unit.
   */
  if (
    isDailyLineupScoringEnabled(league.settings, sport) ||
    gamesCountActive(league.settings, sport) ||
    readGamesLimits(league.settings, sport) ||
    (bestBall && DATE_WINDOWED_SPORTS.includes(sport))
  ) {
    return { outcome: 'not_supported', week }
  }

  const stamp = (fingerprint?: string) =>
    writeBaseline({ ...baseline, lastCheckedAt: now.toISOString(), ...(fingerprint ? { lastFingerprint: fingerprint } : {}) })

  const lockKey = `guillotine-correction:${baseline.leagueId}:${week}`
  const owner = `guillotine-correction:${input.seasonId}:${now.getTime()}`
  const lock = await acquireAutomationLock(lockKey, { ttlMs: LOCK_TTL_MS, owner })
  if (!lock.ok) return { outcome: 'locked', week, reason: lock.reason }
  try {
    /*
     * Every week of the period: one for a one-week league, both for an MLB two-week period. Each is
     * refreshed and re-sealed on its own; a failure or refusal on EITHER applies nothing, because half a
     * period's correction would move the score on one week's evidence while the other is in doubt.
     */
    const weeks = baselineWeeks(baseline)
    for (const w of weeks) {
      if (deps.syncWeekStats) {
        try {
          await deps.syncWeekStats({ seasonId: input.seasonId, week: w })
        } catch (error) {
          await stamp()
          return { outcome: 'provider_failed', week, reason: error instanceof Error ? error.message : String(error) }
        }
      }
      // The refresh writes `isFinalized: false`; re-seal, and never apply over a refusal.
      const resealed = await (deps.finalizeWeek ?? finalizeRedraftWeek)({ seasonId: input.seasonId, week: w })
      if (resealed.refusal) {
        await stamp()
        return { outcome: 'waiting', week, reason: resealed.refusal }
      }
    }

    const score =
      deps.scorePlayer ??
      ((a: { leagueId: string; playerId: string; week: number; stats: Record<string, number>; position: string | null }) =>
        calculateScoreFromSportConfig(a.leagueId, a.playerId, a.week, a.stats, a.position))
    // The chop's own slots when the baseline kept them; a baseline from before that reads today's.
    const slots = bestBall ? readStoredSlots(baseline.bestBallRules?.slots) ?? buildBestBallSlots(sport, league.settings) : null

    // Each week's stat lines, read once for every team.
    const statsByWeek = new Map<number, Map<string, Record<string, number>>>()
    for (const w of weeks) {
      const all = baseline.teams.flatMap((t) => teamPlayersForWeek(baseline, t, w))
      const sports = [...new Set(all.map((p) => p.sport))]
      const rows = all.length
        ? await prisma.playerWeeklyScore.findMany({
            where: { week: w, season: baseline.season, sport: { in: sports }, playerId: { in: [...new Set(all.map((p) => p.playerId))] } },
            select: { playerId: true, sport: true, stats: true },
          })
        : []
      statsByWeek.set(w, new Map(rows.map((r) => [`${r.sport}::${r.playerId}`, r.stats as Record<string, number>])))
    }

    /*
     * A period's corrected score is the chop's period score plus each week's own lineup delta: each week
     * is re-seated on its own (best ball plays its best lineup of EACH week), exactly as the chop scored it.
     */
    const corrected: Array<{ team: BaselineTeam; points: number }> = []
    for (const team of baseline.teams) {
      let delta = 0
      for (const w of weeks) {
        const recorded = teamPlayersForWeek(baseline, team, w)
        const statsOf = statsByWeek.get(w)!
        const current: BaselinePlayer[] = []
        for (const p of recorded) {
          const stats = statsOf.get(`${p.sport}::${p.playerId}`)
          // No row now: keep what he was scored at the chop. Unavailable data is never a 0.
          const points = stats ? await score({ leagueId: baseline.leagueId, playerId: p.playerId, week: w, stats, position: p.position }) : p.points
          current.push({ ...p, points })
        }
        delta += lineupTotal(current, slots) - lineupTotal(recorded, slots)
      }
      corrected.push({ team, points: round2(team.recordedPoints + delta) })
    }

    const stored = await prisma.guillotinePeriodScore.findMany({
      where: { leagueId: baseline.leagueId, weekOrPeriod: week, rosterId: { in: baseline.teams.map((t) => t.engineRosterId) } },
      select: { rosterId: true, periodPoints: true },
    })
    const storedBy = new Map(stored.map((s) => [s.rosterId, s.periodPoints]))
    const changes = corrected
      .filter((c) => storedBy.has(c.team.engineRosterId) && Math.abs((storedBy.get(c.team.engineRosterId) ?? 0) - c.points) >= 0.005)
      .map((c) => ({
        redraftRosterId: c.team.redraftRosterId,
        engineRosterId: c.team.engineRosterId,
        before: round2(storedBy.get(c.team.engineRosterId) ?? 0),
        after: c.points,
      }))

    // Scores first, every write absolute: a crash here is repaired by the next check, not doubled.
    for (const c of changes) {
      await prisma.guillotinePeriodScore.updateMany({
        where: { leagueId: baseline.leagueId, rosterId: c.engineRosterId, weekOrPeriod: week },
        data: { periodPoints: c.after },
      })
      await prisma.guillotineSurvivalLog.updateMany({
        where: { leagueId: baseline.leagueId, rosterId: c.redraftRosterId, scoringPeriod: week },
        data: { totalScore: c.after },
      })
    }
    if (changes.length > 0) await rebuildRunningTotals(baseline.leagueId, baseline.season, changes.map((c) => c.engineRosterId))

    // The week's chop, as it happened. Read, never written.
    const chopped = (
      await prisma.guillotineRosterState.findMany({ where: { leagueId: baseline.leagueId, choppedInPeriod: week }, select: { rosterId: true } })
    ).map((r) => r.rosterId)
    const finalScores = corrected.map((c) => ({ id: c.team.engineRosterId, points: c.points }))
    const line = chopped.length > 0 ? lowest(finalScores, chopped.length) : null
    const wouldHave = line?.ids ?? []
    const chopDisputed = !!line && (line.tieAtLine || wouldHave.some((id) => !chopped.includes(id)))

    const fingerprint = fingerprintOf(week, finalScores.map((s) => [s.id, s.points]))
    const result: GuillotineCorrectionResult = {
      outcome: changes.length > 0 ? 'applied' : 'no_change',
      week,
      changes,
      choppedRosterIds: chopped,
      wouldHaveChoppedRosterIds: wouldHave,
      chopDisputed,
    }
    /*
     * Logged when the corrected scores differ from the last ones logged (or, the first time, from the
     * scores the chop used). Keyed on the scores, not on `changes`, so a run that wrote the scores and
     * died before logging still logs on the retry, when `changes` is already empty.
     */
    const original = fingerprintOf(week, baseline.teams.map((t) => [t.engineRosterId, t.recordedPoints]))
    if (fingerprint !== (baseline.lastFingerprint ?? original)) {
      await recordCorrection({ baseline, week, fingerprint, result })
    }
    await stamp(fingerprint)
    return result
  } finally {
    await releaseAutomationLock(lockKey, owner).catch(() => undefined)
  }
}

/** `seasonPointsCumul` is a running total, so one corrected week moves every later week's total too. */
async function rebuildRunningTotals(leagueId: string, season: number, engineRosterIds: string[]): Promise<void> {
  const rows = await prisma.guillotinePeriodScore.findMany({
    where: { leagueId, season, rosterId: { in: engineRosterIds } },
    select: { rosterId: true, weekOrPeriod: true, periodPoints: true, seasonPointsCumul: true },
    orderBy: { weekOrPeriod: 'asc' },
  })
  const running = new Map<string, number>()
  for (const r of rows) {
    const total = round2((running.get(r.rosterId) ?? 0) + r.periodPoints)
    running.set(r.rosterId, total)
    if (Math.abs(total - r.seasonPointsCumul) >= 0.005) {
      await prisma.guillotinePeriodScore.updateMany({
        where: { leagueId, rosterId: r.rosterId, weekOrPeriod: r.weekOrPeriod },
        data: { seasonPointsCumul: total },
      })
    }
  }
}

/**
 * The Guilly event and the commissioner's league-log row, once per distinct set of corrected scores.
 * Deduped on the fingerprint in the event's own metadata, so a crash between this and the baseline
 * stamp cannot write it twice.
 */
async function recordCorrection(args: {
  baseline: CorrectionBaseline
  week: number
  fingerprint: string
  result: GuillotineCorrectionResult
}): Promise<void> {
  const { baseline, week, fingerprint, result } = args
  const seen = await prisma.guillotineEventLog.findFirst({
    where: { leagueId: baseline.leagueId, eventType: GUILLOTINE_STAT_CORRECTION_EVENT, metadata: { path: ['fingerprint'], equals: fingerprint } },
    select: { id: true },
  })
  if (seen) return
  const body = {
    fingerprint,
    seasonId: baseline.seasonId,
    season: baseline.season,
    week,
    changes: result.changes ?? [],
    choppedRosterIds: result.choppedRosterIds ?? [],
    wouldHaveChoppedRosterIds: result.wouldHaveChoppedRosterIds ?? [],
    chopDisputed: result.chopDisputed === true,
    chopStands: true,
  }
  await appendEvent(baseline.leagueId, GUILLOTINE_STAT_CORRECTION_EVENT, body)
  const byEngine = new Map(baseline.teams.map((t) => [t.engineRosterId, t.redraftRosterId]))
  await prisma.leagueAuditLog.create({
    data: {
      leagueId: baseline.leagueId,
      userId: null,
      actionType: GUILLOTINE_STAT_CORRECTION_ACTION,
      entityType: 'guillotine_week',
      entityId: `${baseline.seasonId}:${week}`,
      afterState: JSON.parse(
        JSON.stringify({
          ...body,
          // The league log names teams by redraft roster id.
          choppedRedraftRosterIds: body.choppedRosterIds.map((id) => byEngine.get(id) ?? id),
          wouldHaveChoppedRedraftRosterIds: body.wouldHaveChoppedRosterIds.map((id) => byEngine.get(id) ?? id),
        }),
      ) as Prisma.InputJsonValue,
      metadata: { season: baseline.season, week, changed: body.changes.length, chopDisputed: body.chopDisputed },
    },
  })
}

/**
 * Score-sync's entry: the newest chopped weeks still inside the correction window, each at most hourly.
 * Returns the newest week's outcome.
 */
export async function checkGuillotineStatCorrectionsForSeason(
  seasonId: string,
  deps: GuillotineCorrectionDeps = {},
): Promise<GuillotineCorrectionResult> {
  const now = deps.now?.() ?? new Date()
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: guillotineCorrectionKeyPrefix(seasonId) } },
    select: { data: true },
  })
  const due = rows
    .map((r) => readBaseline(r.data))
    .filter((b): b is CorrectionBaseline => b !== null && b.seasonId === seasonId)
    .filter((b) => now.getTime() - Date.parse(b.capturedAt) <= GUILLOTINE_CORRECTION_WINDOW_MS)
    .sort((a, b) => b.week - a.week)
    .slice(0, WEEKS_PER_CHECK)
  if (due.length === 0) return { outcome: 'no_baseline' }
  let latest: GuillotineCorrectionResult | null = null
  for (const b of due) {
    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId, week: b.week }, deps)
    latest ??= r
  }
  return latest!
}

/**
 * The period a week belongs to, read from the baselines themselves: the week's own baseline when there is
 * one (every one-week league), else the multi-week baseline that scored it. No baseline: the week as given.
 */
async function correctionPeriodFor(seasonId: string, week: number): Promise<{ week: number; weeks: number[] }> {
  const own = readBaseline((await prisma.sportsDataCache.findUnique({ where: { cacheKey: guillotineCorrectionKey(seasonId, week) } }))?.data)
  if (own) return { week: own.week, weeks: baselineWeeks(own) }
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: guillotineCorrectionKeyPrefix(seasonId) } },
    select: { data: true },
  })
  const containing = rows
    .map((r) => readBaseline(r.data))
    .find((b): b is CorrectionBaseline => b !== null && b.seasonId === seasonId && baselineWeeks(b).includes(week))
  return containing ? { week: containing.week, weeks: baselineWeeks(containing) } : { week, weeks: [week] }
}

export type CorrectionResult = {
  /** Always false: the published policy never reverses a chop or a crowned champion. */
  reversed: false
  summary: string
  newEliminatedRosterId?: string
  correction?: GuillotineCorrectionResult
}

/**
 * The cron route's manual trigger (`POST /api/guillotine/stat-correction`): `seasonId` is the
 * `GuillotineSeason` id. Runs the same pass as score-sync for that period, past the window and the
 * throttle. `correctedPlayerIds` is accepted for the route's contract; every baseline player is
 * re-read anyway, because a correction the caller did not name still counts.
 */
export async function handleStatCorrection(
  seasonId: string,
  scoringPeriod: number,
  correctedPlayerIds: string[],
  deps: GuillotineCorrectionDeps = {},
): Promise<CorrectionResult> {
  void correctedPlayerIds
  const g = await prisma.guillotineSeason.findFirst({ where: { id: seasonId }, select: { redraftSeasonId: true } })
  if (!g) return { reversed: false, summary: 'Season not found' }
  if (!g.redraftSeasonId) return { reversed: false, summary: 'This Guilly season has no native season to re-score.' }
  // A two-week period is keyed by its last week; a caller naming its FIRST week means the same period.
  const period = await correctionPeriodFor(g.redraftSeasonId, scoringPeriod)
  const correction = await applyGuillotineStatCorrectionsForWeek({ seasonId: g.redraftSeasonId, week: period.week, force: true }, deps)
  const n = correction.changes?.length ?? 0
  const label = period.weeks.length > 1 ? `Weeks ${period.weeks[0]}–${period.week}` : `Week ${scoringPeriod}`
  const summary =
    correction.outcome === 'applied'
      ? `${label}: ${n} team score${n === 1 ? '' : 's'} corrected. The chop stands` +
        (correction.chopDisputed ? '; the corrected scores would have chopped a different team, and the commissioner was told.' : '.')
      : `${label}: ${correction.outcome}${correction.reason ? ` (${correction.reason})` : ''}. Nothing was reversed.`
  const newEliminatedRosterId = correction.chopDisputed
    ? correction.wouldHaveChoppedRosterIds?.find((id) => !(correction.choppedRosterIds ?? []).includes(id))
    : undefined
  return { reversed: false, summary, ...(newEliminatedRosterId ? { newEliminatedRosterId } : {}), correction }
}
