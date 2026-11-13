/**
 * Chop a native guillotine league's lowest-scoring team, once per finished week.
 *
 * 🛑 A NATIVE GUILLOTINE LEAGUE NEVER ELIMINATED ANYONE. The engine (`runElimination`) was only
 * reachable by hand; the scheduled sweep that once called it was deleted. And even when it was
 * called it could not chop: nobody passed `periodEndedAt`, so the stat-correction cutoff was never
 * "past", and it read `GuillotinePeriodScore`, which nothing but a seed script ever wrote. The
 * season's own scores live in `RedraftRosterPlayer` / `PlayerWeeklyScore`, in a different roster
 * id space from the engine's.
 *
 * This pass, run from score-sync every five minutes, closes that gap without a second engine:
 *   1. the league week pointer follows the real calendar (the hourly roll skips guillotine);
 *   2. the next unchopped week is sealed by the week finalizer (stats final, grace passed);
 *   3. once that week's stat-correction cutoff has passed, every surviving team is scored from the
 *      sealed stats, the scores are written as `GuillotinePeriodScore` (the engine's own input),
 *      and `runElimination` chops — its tiebreak, audit, survival log and standings flag intact;
 *   4. the chopped team's players are dropped so they reach waivers, and it can claim no more.
 *
 * ⚠ ONE CHOP PER WEEK, EVER. Re-running the engine for a week would chop the NEXT-lowest team —
 * it drops already-chopped rosters before choosing — so the week is claimed with a lock and
 * checked against `GuillotineRosterState.choppedInPeriod` before anything is written.
 */
import { resumeAuditedRosterRelease } from './resumeAuditedRosterRelease'
import { determineFinalChampion } from './endgameEngine'
import { resolveGuillotineEndgame } from './endgameRules'
import { prisma } from '@/lib/prisma'
import { getGuillotineConfig, isGuillotineLeague } from '@/lib/guillotine/GuillotineLeagueConfig'
import { isPastCorrectionCutoff, savePeriodScores } from '@/lib/guillotine/GuillotineWeekEvaluator'
import { runElimination } from '@/lib/guillotine/GuillotineEliminationEngine'
import { ensureGuillotineSeason } from '@/lib/guillotine/ensureGuillotineSeason'
import { finalizeRedraftWeek, readWeekSlate, WEEK_KEYED_SPORTS } from '@/lib/redraft/weekFinalizer'
import { scoreRosterForWeek, type DailyBestBallDetail } from '@/lib/redraft/scoringEngine'
import { seasonSportToLeagueSport } from '@/lib/season-week/standardSeasonScope'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'
import { finishGuillotineSeason, rosterIdForOwner } from '@/lib/guillotine/finishGuillotineSeason'
import { recordChoppedReleases } from '@/lib/guillotine/choppedReleases'
import { firstChopWeekAfterDraft } from '@/lib/guillotine/draftWeekFloor'
import { recordGuillotineCorrectionBaseline } from '@/lib/guillotine/statCorrectionHandler'
import { periodEndWeek, previousPeriodEnd, readPeriodWeeks, weeksInPeriod } from '@/lib/guillotine/eliminationPeriods'

export type NativeGuillotineOutcome =
  | 'not_guillotine'
  | 'season_complete'
  | 'waiting'
  | 'past_elimination_window'
  | 'already_chopped'
  | 'locked'
  | 'refused'
  | 'chopped'
  | 'final_stage_scored'
  /** The commissioner's schedule skips this week (lib/guillotine/chopSchedule.ts); the season moved past it. */
  | 'no_chop'

export type NativeGuillotineResult = {
  seasonId: string
  outcome: NativeGuillotineOutcome
  week?: number
  reason?: string
  choppedRedraftRosterIds?: string[]
}

export type NativeGuillotineDeps = {
  now?: () => Date
  /** Refills a past week's stats when the finalizer refuses it for coverage (same as the sweep). */
  syncWeekStats?: (args: { seasonId: string; week: number }) => Promise<unknown>
  /** The week after the league's draft (./draftWeekFloor.ts); injectable for tests. */
  firstChopWeekAfterDraft?: typeof firstChopWeekAfterDraft
}

const LOCK_TTL_MS = 5 * 60 * 1000

export async function runNativeGuillotineWeek(
  input: {
    seasonId: string
    currentFantasyWeek: number
    /**
     * Every game of `currentFantasyWeek` is final. Without it the last week of a season could never
     * close: a week is otherwise only chopped once the NEXT week has started, and NFL week 19 never
     * starts (the week signal reads the regular season only).
     */
    currentWeekComplete?: boolean
  },
  deps: NativeGuillotineDeps = {},
): Promise<NativeGuillotineResult> {
  const now = deps.now?.() ?? new Date()
  const base = { seasonId: input.seasonId }

  const season = await prisma.redraftSeason.findFirst({
    where: { id: input.seasonId },
    select: { id: true, leagueId: true, sport: true, season: true, status: true, currentWeek: true, totalWeeks: true },
  })
  if (!season || !(await isGuillotineLeague(season.leagueId))) return { ...base, outcome: 'not_guillotine' }
  const config = await getGuillotineConfig(season.leagueId)
  if (!config) return { ...base, outcome: 'not_guillotine' }

  // The hourly roll skips guillotine, so the pointer the live tick and the UI read would sit at 1.
  if (input.currentFantasyWeek > season.currentWeek) {
    await prisma.redraftSeason.update({ where: { id: season.id }, data: { currentWeek: input.currentFantasyWeek } })
  }

  const gSeason = await ensureGuillotineSeason({ leagueId: season.leagueId, redraftSeasonId: season.id })
  // score-sync re-offers a finished season until it is archived; nothing is left to chop.
  if (season.status === 'complete') return completeSeason(season.id, gSeason, base)

  const active = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id, isEliminated: false },
    select: { id: true, ownerId: true },
  })
  const endgameLeague = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { settings: true, guillotineEndgame: true } })
  const lastTeamStanding = resolveGuillotineEndgame(endgameLeague ?? {}).format === 'last_team_standing'
  // One week, or two (MLB, ./eliminationPeriods.ts). A period is keyed by its last week, so `week` below
  // is always a period's last week and everything keyed by it is unchanged for a one-week league.
  const periodWeeks = readPeriodWeeks(endgameLeague?.settings)

  const finalSeason = gSeason.ok ? await prisma.guillotineSeason.findUnique({ where: { id: gSeason.seasonId }, select: { currentScoringPeriod: true, status: true } }) : null
  const lastChop = await prisma.guillotineRosterState.findFirst({
    where: { leagueId: season.leagueId, choppedInPeriod: { not: null } },
    orderBy: { choppedInPeriod: 'desc' },
    select: { choppedInPeriod: true },
  })
  if (gSeason.ok && lastChop?.choppedInPeriod != null && (finalSeason?.currentScoringPeriod ?? 0) >= lastChop.choppedInPeriod) await resumeAuditedRosterRelease(season.leagueId, gSeason.seasonId, lastChop.choppedInPeriod)
  if (finalSeason?.status === 'complete') return completeSeason(season.id, gSeason, base)
  // Recover a failure after final scores were saved but before completion was marked.
  if (gSeason.ok && finalSeason?.status === 'final_stage' && await determineFinalChampion(gSeason.seasonId)) return completeSeason(season.id, gSeason, base)
  const recoveryWeek = gSeason.ok && (lastChop?.choppedInPeriod ?? 0) > (finalSeason?.currentScoringPeriod ?? 0) ? lastChop!.choppedInPeriod : null
  if (active.length <= 1 && lastTeamStanding && recoveryWeek == null) return completeSeason(season.id, gSeason, base)
  // Before the first chop, never a week the league had not drafted for (./draftWeekFloor.ts). Saved
  // as the first chop week, so the engine, the settings page and the rules page all say the same.
  let startWeek = config.eliminationStartWeek
  if (lastChop?.choppedInPeriod == null && (finalSeason?.currentScoringPeriod ?? 0) === 0) {
    const afterDraft = await (deps.firstChopWeekAfterDraft ?? firstChopWeekAfterDraft)({ leagueId: season.leagueId, sport: season.sport, season: season.season }).catch(() => null)
    if (afterDraft != null && afterDraft > startWeek) {
      startWeek = afterDraft
      await prisma.guillotineLeagueConfig.updateMany({ where: { leagueId: season.leagueId, eliminationStartWeek: { lt: afterDraft } }, data: { eliminationStartWeek: afterDraft } })
    }
  }
  const nextWeek = Math.max(recoveryWeek ?? Math.max(lastChop?.choppedInPeriod ?? 0, finalSeason?.currentScoringPeriod ?? 0) + 1, startWeek)
  const week = recoveryWeek != null ? nextWeek : periodEndWeek(nextWeek, startWeek, periodWeeks)
  const periodWeekList = weeksInPeriod(week, periodWeeks)
  /*
   * 🛑 PAST THE LAST CHOP WEEK WITH TEAMS STILL STANDING WAS A DEAD END: no chop, no champion, no
   * archive, forever. It happens to a league with more teams than chop weeks, to no-chop weeks that
   * push the last chop past the end, and to a final stage that runs out of season. Nothing more can
   * be scored, so the season ends here, ranked by survival (finishGuillotineSeason.ts).
   */
  if (config.eliminationEndWeek != null && week > config.eliminationEndWeek) {
    if (recoveryWeek != null) return { ...base, outcome: 'past_elimination_window', week }
    const done = await completeSeason(season.id, gSeason, base)
    return { ...done, week, reason: done.reason ?? 'elimination_window_ended' }
  }
  const weekStillOpen = week > input.currentFantasyWeek || (week === input.currentFantasyWeek && input.currentWeekComplete !== true)
  if (weekStillOpen) return { ...base, outcome: 'waiting', week, reason: 'week_in_progress' }

  /*
   * Seal the week: every game final, the grace period passed, stat coverage clears the floor, and no
   * team's game is missing its box score (weekStatEvidence.ts). A team must never be chopped on zeros
   * the feed never sent, so either stat refusal gets one backfill and then waits.
   */
  // A two-week period seals both of its weeks; the period's last week supplies the chop's end time.
  let sealed!: Awaited<ReturnType<typeof finalizeRedraftWeek>>
  for (const w of periodWeekList) {
    sealed = await finalizeRedraftWeek({ seasonId: season.id, week: w })
    const backfillable = ['stat_coverage_below_floor', 'game_stats_missing', 'game_stats_missing_escalated'].includes(String(sealed.refusal))
    if (backfillable && deps.syncWeekStats) {
      await deps.syncWeekStats({ seasonId: season.id, week: w })
      sealed = await finalizeRedraftWeek({ seasonId: season.id, week: w })
    }
    if (sealed.refusal) return { ...base, outcome: 'waiting', week, reason: sealed.refusal }
  }

  const lastStart = sealed.slate?.lastStartTime ?? (await lastKickoff(season, week, now))
  if (!lastStart) return { ...base, outcome: 'waiting', week, reason: 'period_end_unknown' }
  const periodEndedAt = new Date(lastStart)
  const pastCutoff = isPastCorrectionCutoff({
    correctionWindow: config.correctionWindow,
    periodEndedAt,
    statCorrectionHours: config.statCorrectionHours,
    customCutoffDayOfWeek: config.customCutoffDayOfWeek,
    customCutoffTimeUtc: config.customCutoffTimeUtc,
    now,
  })
  if (!pastCutoff) return { ...base, outcome: 'waiting', week, reason: 'stat_correction_window' }

  const lockKey = `guillotine-chop:${season.leagueId}:${week}`
  const owner = `native-guillotine:${season.id}:${now.getTime()}`
  const lock = await acquireAutomationLock(lockKey, { ttlMs: LOCK_TTL_MS, owner })
  if (!lock.ok) return { ...base, outcome: 'locked', week, reason: lock.reason }
  try {
    const already = await prisma.guillotineRosterState.findFirst({
      where: { leagueId: season.leagueId, choppedInPeriod: week },
      select: { rosterId: true },
    })
    if (already) {
      if (recoveryWeek == null) return { ...base, outcome: 'already_chopped', week }
      const repair = await runElimination({ leagueId: season.leagueId, weekOrPeriod: week, season: season.season, periodEndedAt, skipChat: true })
      const repairedIds = repair?.eliminationFlagged?.marked ?? []
      if (!repairedIds.length) return { ...base, outcome: 'refused', week, reason: repair?.reason ?? 'audit recovery required' }
      await prisma.redraftRosterPlayer.updateMany({ where: { rosterId: { in: repairedIds }, droppedAt: null }, data: { droppedAt: now } })
      return { ...base, outcome: 'chopped', week, choppedRedraftRosterIds: repairedIds, reason: 'recovered previously selected chop' }
    }

    /*
     * ⚠ THE CORRECTION WINDOW WAITED FOR NOTHING. The chop is held until the stat-correction cutoff so
     * a late correction can still decide who goes — but score-sync only pulls the CURRENT week, so the
     * sealed week's stats were never fetched again and every chop ran on the numbers as they stood at
     * the seal. Pull the week once more now, past the cutoff, and re-seal it from the corrected stats.
     * The stat sync writes `isFinalized: false`, so the re-seal is what makes the week chop-ready again;
     * a re-seal that refuses (a refresh that came back short) waits rather than chop on half a week.
     * A refresh that throws chops on the sealed stats, exactly as before, rather than stall the season.
     */
    if (config.correctionWindow !== 'immediate' && deps.syncWeekStats) {
      for (const w of periodWeekList) {
        let refreshed = false
        try {
          await deps.syncWeekStats({ seasonId: season.id, week: w })
          refreshed = true
        } catch (error) {
          console.error('[native-guillotine] pre-chop stat refresh failed; chopping on the sealed stats', { seasonId: season.id, week: w, error })
        }
        if (refreshed) {
          const resealed = await finalizeRedraftWeek({ seasonId: season.id, week: w })
          if (resealed.refusal) return { ...base, outcome: 'waiting', week, reason: `pre_chop_refresh:${resealed.refusal}` }
        }
      }
    }

    /*
     * Every surviving team, scored from the sealed week. Bench/IR never count; best ball starts its best.
     * A two-week period is the sum of its two weekly scores — each week scored on its own, so a best ball
     * team plays its best lineup of EACH week under the weekly ownership rule — and so are bench points.
     */
    const points = new Map<string, number>()
    const benchPoints = new Map<string, number>()
    // Each counted player's points too: the baseline a later stat correction is measured against.
    const playerPoints = new Map<string, Array<{ playerId: string; points: number; isStarter: boolean }>>()
    // A two-week period's baseline is kept per week: each week is re-scored and re-seated on its own.
    const weekPlayerPoints = new Map<string, Array<{ week: number; playerPoints: Array<{ playerId: string; points: number; isStarter: boolean }> }>>()
    /*
     * A DAILY best ball league (lib/bestball/scoringPeriod.ts) is scored as the sum of each day's optimal
     * lineup, so per-player weekly sums cannot be re-seated: the baseline keeps each day's inputs too, and
     * a correction re-runs the same daily optimizer over them. Absent for every weekly league.
     */
    const dailyWeeks = new Map<string, Array<{ week: number } & DailyBestBallDetail>>()
    const keepDaily = (rosterId: string, w: number, detail: DailyBestBallDetail | undefined) => {
      if (!detail) return
      dailyWeeks.set(rosterId, [...(dailyWeeks.get(rosterId) ?? []), { week: w, ...detail }])
    }
    for (const r of active) {
      if (periodWeeks === 1) {
        const s = await scoreRosterForWeek({ leagueId: season.leagueId, rosterId: r.id, week, seasonYear: season.season, includeBench: true, collectPlayerPoints: true, collectDailyBestBallDetail: true })
        points.set(r.id, s.points)
        if (typeof s.benchPoints === 'number') benchPoints.set(r.id, s.benchPoints)
        playerPoints.set(r.id, s.playerPoints ?? [])
        keepDaily(r.id, week, s.dailyBestBall)
        continue
      }
      let total = 0
      let bench: number | null = null
      const perWeek: Array<{ week: number; playerPoints: Array<{ playerId: string; points: number; isStarter: boolean }> }> = []
      for (const w of periodWeekList) {
        const s = await scoreRosterForWeek({ leagueId: season.leagueId, rosterId: r.id, week: w, seasonYear: season.season, includeBench: true, collectPlayerPoints: true, collectDailyBestBallDetail: true })
        keepDaily(r.id, w, s.dailyBestBall)
        total += s.points
        if (typeof s.benchPoints === 'number') bench = (bench ?? 0) + s.benchPoints
        perWeek.push({ week: w, playerPoints: s.playerPoints ?? [] })
      }
      points.set(r.id, Math.round(total * 100) / 100)
      if (bench !== null) benchPoints.set(r.id, Math.round(bench * 100) / 100)
      weekPlayerPoints.set(r.id, perWeek)
    }

    // Into the engine's id space. A team that cannot be placed would silently escape the chop.
    const rosters = await prisma.roster.findMany({
      where: { leagueId: season.leagueId },
      select: { id: true, platformUserId: true, redraftRosterId: true },
    })
    const chopped = new Set(
      (await prisma.guillotineRosterState.findMany({
        where: { leagueId: season.leagueId, choppedAt: { not: null } },
        select: { rosterId: true },
      })).map((c) => c.rosterId),
    )
    const rosterForRedraft = new Map<string, string>()
    for (const r of active) {
      const direct = rosters.find((x) => x.redraftRosterId === r.id)?.id
      const byOwner = rosterIdForOwner(r.ownerId, rosters)
      const id = direct ?? byOwner
      if (id) rosterForRedraft.set(r.id, id)
    }
    const unplaced = active.filter((r) => !rosterForRedraft.has(r.id)).map((r) => r.id)
    const covered = new Set(rosterForRedraft.values())
    const unscored = rosters.filter((r) => !chopped.has(r.id) && !covered.has(r.id)).map((r) => r.id)
    if (unplaced.length > 0 || unscored.length > 0) {
      console.warn('[guillotine] chop refused: rosters do not line up', JSON.stringify({ leagueId: season.leagueId, week, unplaced, unscored }))
      return { ...base, outcome: 'refused', week, reason: 'roster_mapping_incomplete' }
    }

    // This season only: `GuillotinePeriodScore` is keyed by league, so last year's weeks are here too.
    const previous = await prisma.guillotinePeriodScore.findMany({
      where: { leagueId: season.leagueId, season: season.season, weekOrPeriod: { lt: week } },
      select: { rosterId: true, periodPoints: true, weekOrPeriod: true },
    })
    const cumulBefore = new Map<string, number>()
    const lastWeek = new Map<string, number>()
    for (const p of previous) {
      cumulBefore.set(p.rosterId, (cumulBefore.get(p.rosterId) ?? 0) + p.periodPoints)
      if (p.weekOrPeriod === previousPeriodEnd(week, periodWeeks)) lastWeek.set(p.rosterId, p.periodPoints)
    }
    /*
     * The tiebreak's `bench_points` and `previous_period` steps read these. They were never filled on the
     * native path, so both compared 0 with 0 and every tie fell through to season points.
     */
    const periodScores = active.map((r) => {
      const rosterId = rosterForRedraft.get(r.id)!
      const periodPoints = points.get(r.id) ?? 0
      return {
        rosterId,
        periodPoints,
        seasonPointsCumul: Math.round(((cumulBefore.get(rosterId) ?? 0) + periodPoints) * 100) / 100,
        ...(benchPoints.has(r.id) ? { benchPoints: benchPoints.get(r.id) } : {}),
        ...(lastWeek.has(rosterId) ? { previousPeriodPoints: lastWeek.get(rosterId) } : {}),
      }
    })
    await savePeriodScores({ leagueId: season.leagueId, weekOrPeriod: week, season: season.season, scores: periodScores })
    /*
     * The stat-correction baseline (./statCorrectionHandler.ts): the exact numbers this chop is decided
     * on, per player, while every roster — the one about to be chopped included — still holds them. A
     * correction after the chop updates the scores against it; it never reverses the chop. Best-effort:
     * without it that week is simply never corrected, and the chop must not wait on bookkeeping.
     */
    /*
     * A two-week period is baselined PER WEEK (`weekPlayerPoints`), keyed by its last week like everything
     * else: the handler re-scores and re-seats each week on its own and adds both deltas to the period
     * score the chop used, so a correction to either week moves the period total.
     */
    try {
      await recordGuillotineCorrectionBaseline({
        seasonId: season.id,
        leagueId: season.leagueId,
        season: season.season,
        week,
        capturedAt: now,
        teams: active.map((r) => ({
          redraftRosterId: r.id,
          engineRosterId: rosterForRedraft.get(r.id)!,
          recordedPoints: points.get(r.id) ?? 0,
          playerPoints: playerPoints.get(r.id) ?? [],
          ...(periodWeeks > 1 ? { weekPlayerPoints: weekPlayerPoints.get(r.id) ?? [] } : {}),
          ...(dailyWeeks.has(r.id) ? { dailyWeeks: dailyWeeks.get(r.id) } : {}),
        })),
      })
    } catch (error) {
      console.warn('[native-guillotine] stat-correction baseline not recorded; the chop proceeds', {
        seasonId: season.id,
        week,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // The chop is announced in league chat, authored by the league owner (there is no system user);
    // a league with no owner goes unannounced rather than unchopped.
    const owner = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { userId: true } })
    const result = await runElimination({
      leagueId: season.leagueId,
      weekOrPeriod: week,
      season: season.season,
      periodEndedAt,
      periodScores,
      skipChat: !owner?.userId,
      systemUserId: owner?.userId ?? undefined,
    })
    const choppedRedraft = result?.eliminationFlagged?.marked ?? []
    // The engine marked the season complete itself; it still has to be crowned and archived here,
    // because score-sync only re-offers it while the league is unarchived.
    if (result?.reason === 'final stage complete') return { ...(await completeSeason(season.id, gSeason, base)), week }
    if (result?.reason === 'final stage scored') return { ...base, outcome: 'final_stage_scored', week }
    if (result?.reason === 'no chop scheduled') return { ...base, outcome: 'no_chop', week }
    if (!result || result.choppedRosterIds.length === 0) {
      return { ...base, outcome: 'refused', week, reason: result?.reason ?? 'engine_returned_nothing' }
    }

    // Release: the chopped team's players become free agents for the next waiver run.
    if (choppedRedraft.length > 0) {
      /*
       * Listed first, while the roster still holds them: the home's chop moment and the war room show
       * these players with a Bid button (lib/guillotine/choppedReleases.ts). Best-effort — the chop has
       * happened, and a failed list must not stop the players reaching waivers.
       */
      if (gSeason.ok) {
        try {
          await recordChoppedReleases({ leagueId: season.leagueId, guillotineSeasonId: gSeason.seasonId, week, redraftRosterIds: choppedRedraft, availableAt: now })
        } catch (error) {
          console.warn('[native-guillotine] released players not listed; the chop stands', { seasonId: season.id, week, error: error instanceof Error ? error.message : String(error) })
        }
      }
      await prisma.redraftRosterPlayer.updateMany({
        where: { rosterId: { in: choppedRedraft }, droppedAt: null },
        data: { droppedAt: now },
      })
    }
    if (gSeason.ok) {
      await prisma.guillotineSeason.updateMany({ where: { id: gSeason.seasonId, status: 'setup' }, data: { status: 'active' } })
    }
    if (active.length - result.choppedRosterIds.length <= 1) await completeSeason(season.id, gSeason, base)

    return { ...base, outcome: 'chopped', week, choppedRedraftRosterIds: choppedRedraft }
  } finally {
    await releaseAutomationLock(lockKey, owner).catch(() => undefined)
  }
}

async function completeSeason(
  seasonId: string,
  gSeason: Awaited<ReturnType<typeof ensureGuillotineSeason>>,
  base: { seasonId: string },
): Promise<NativeGuillotineResult> {
  const finished = await finishGuillotineSeason({ seasonId, guillotineSeasonId: gSeason.ok ? gSeason.seasonId : null })
  return { ...base, outcome: 'season_complete', ...(finished.archived ? {} : { reason: finished.reason }) }
}

/** The week's last kickoff, for a week the finalizer reported as already closed (no slate in hand). */
async function lastKickoff(
  season: { sport: string; season: number },
  week: number,
  now: Date,
): Promise<string | null> {
  const sport = seasonSportToLeagueSport(season.sport)
  if (!WEEK_KEYED_SPORTS.includes(sport)) return null
  const slate = await readWeekSlate(prisma as never, { sport, season: season.season, week, seasonType: 'regular', now })
  return slate.lastStartTime
}
