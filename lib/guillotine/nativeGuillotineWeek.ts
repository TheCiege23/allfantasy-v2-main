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
import { prisma } from '@/lib/prisma'
import { getGuillotineConfig, isGuillotineLeague } from '@/lib/guillotine/GuillotineLeagueConfig'
import { isPastCorrectionCutoff, savePeriodScores } from '@/lib/guillotine/GuillotineWeekEvaluator'
import { runElimination } from '@/lib/guillotine/GuillotineEliminationEngine'
import { ensureGuillotineSeason } from '@/lib/guillotine/ensureGuillotineSeason'
import { finalizeRedraftWeek, readWeekSlate, WEEK_KEYED_SPORTS } from '@/lib/redraft/weekFinalizer'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { seasonSportToLeagueSport } from '@/lib/season-week/standardSeasonScope'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'

export type NativeGuillotineOutcome =
  | 'not_guillotine'
  | 'season_complete'
  | 'waiting'
  | 'past_elimination_window'
  | 'already_chopped'
  | 'locked'
  | 'refused'
  | 'chopped'

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
}

const LOCK_TTL_MS = 5 * 60 * 1000

/** A season roster's owner -> the league roster: `roster:<id>` names it, a user id is its manager. */
function rosterIdForOwner(ownerId: string, rosters: Array<{ id: string; platformUserId: string | null }>): string | null {
  if (ownerId.startsWith('roster:')) {
    const id = ownerId.slice('roster:'.length)
    return rosters.some((r) => r.id === id) ? id : null
  }
  return rosters.find((r) => r.platformUserId === ownerId)?.id ?? null
}

export async function runNativeGuillotineWeek(
  input: { seasonId: string; currentFantasyWeek: number },
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

  const active = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id, isEliminated: false },
    select: { id: true, ownerId: true },
  })
  if (active.length <= 1) return completeSeason(season.id, gSeason, base)

  const lastChop = await prisma.guillotineRosterState.findFirst({
    where: { leagueId: season.leagueId, choppedInPeriod: { not: null } },
    orderBy: { choppedInPeriod: 'desc' },
    select: { choppedInPeriod: true },
  })
  const week = Math.max((lastChop?.choppedInPeriod ?? 0) + 1, config.eliminationStartWeek)
  if (config.eliminationEndWeek != null && week > config.eliminationEndWeek) {
    return { ...base, outcome: 'past_elimination_window', week }
  }
  if (week >= input.currentFantasyWeek) return { ...base, outcome: 'waiting', week, reason: 'week_in_progress' }

  // Seal the week: every game final, the grace period passed, stat coverage clears the floor.
  let sealed = await finalizeRedraftWeek({ seasonId: season.id, week })
  if (sealed.refusal === 'stat_coverage_below_floor' && deps.syncWeekStats) {
    await deps.syncWeekStats({ seasonId: season.id, week })
    sealed = await finalizeRedraftWeek({ seasonId: season.id, week })
  }
  if (sealed.refusal) return { ...base, outcome: 'waiting', week, reason: sealed.refusal }

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
    if (already) return { ...base, outcome: 'already_chopped', week }

    // Every surviving team, scored from the sealed week. Bench/IR never count; best ball starts its best.
    const points = new Map<string, number>()
    for (const r of active) {
      const s = await scoreRosterForWeek({ leagueId: season.leagueId, rosterId: r.id, week, seasonYear: season.season })
      points.set(r.id, s.points)
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

    const previous = await prisma.guillotinePeriodScore.findMany({
      where: { leagueId: season.leagueId, weekOrPeriod: { lt: week } },
      select: { rosterId: true, periodPoints: true },
    })
    const cumulBefore = new Map<string, number>()
    for (const p of previous) cumulBefore.set(p.rosterId, (cumulBefore.get(p.rosterId) ?? 0) + p.periodPoints)
    const periodScores = active.map((r) => {
      const rosterId = rosterForRedraft.get(r.id)!
      const periodPoints = points.get(r.id) ?? 0
      return { rosterId, periodPoints, seasonPointsCumul: Math.round(((cumulBefore.get(rosterId) ?? 0) + periodPoints) * 100) / 100 }
    })
    await savePeriodScores({ leagueId: season.leagueId, weekOrPeriod: week, season: season.season, scores: periodScores })

    const result = await runElimination({
      leagueId: season.leagueId,
      weekOrPeriod: week,
      season: season.season,
      periodEndedAt,
      periodScores,
      skipChat: true,
    })
    const choppedRedraft = result?.eliminationFlagged?.marked ?? []
    if (!result || result.choppedRosterIds.length === 0) {
      return { ...base, outcome: 'refused', week, reason: result?.reason ?? 'engine_returned_nothing' }
    }

    // Release: the chopped team's players become free agents for the next waiver run.
    if (choppedRedraft.length > 0) {
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
  await prisma.redraftSeason.updateMany({ where: { id: seasonId, status: { not: 'complete' } }, data: { status: 'complete' } })
  if (gSeason.ok) {
    await prisma.guillotineSeason.updateMany({ where: { id: gSeason.seasonId, status: { not: 'complete' } }, data: { status: 'complete' } })
  }
  return { ...base, outcome: 'season_complete' }
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
