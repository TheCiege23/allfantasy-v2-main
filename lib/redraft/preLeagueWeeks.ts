/**
 * Loads the weeks a late-starting league missed (see `preLeagueWeeksRules.ts` for the rules).
 *
 * For each week before the league's first week: schedule a round of `pre_league` matchups, pull that
 * week's real stats for every rostered player, score the drafted rosters, and seal the week as final —
 * those games are over, and an open pre-league week must never look like a week still to settle.
 *
 * Idempotent: a week that already has any matchup is left alone, so a re-run only fills gaps. A week
 * whose stats cannot be fetched is still sealed with what was found and reported, never retried in a
 * request path.
 */
import { prisma } from '@/lib/prisma'
import { generateSchedule } from '@/lib/redraft/scheduleEngine'
import { recalculateMatchupsForSeasonWeek } from '@/lib/redraft/scoringEngine'
import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import type { Prisma } from '@prisma/client'
import {
  PRE_LEAGUE_MATCHUP_TYPE,
  PRE_LEAGUE_WEEKS_LOADED_SETTINGS_KEY,
  preLeagueWeekNumbers,
  readPreLeagueWeeksLoaded,
} from '@/lib/redraft/preLeagueWeeksRules'

export type PreLeagueBackfillResult = {
  seasonId: string
  weeks: number[]
  /** Weeks this run created and scored (a re-run skips weeks already present). */
  created: number[]
  failures: Array<{ week: number; step: 'stats' | 'score'; error: string }>
}

export async function backfillPreLeagueWeeks(params: {
  seasonId: string
  /** The league's first real week; every week before it is pre-league. */
  firstLeagueWeek: number
}): Promise<PreLeagueBackfillResult> {
  const weeks = preLeagueWeekNumbers(params.firstLeagueWeek)
  const result: PreLeagueBackfillResult = { seasonId: params.seasonId, weeks, created: [], failures: [] }
  if (weeks.length === 0) return result

  const season = await prisma.redraftSeason.findUnique({
    where: { id: params.seasonId },
    select: { id: true, leagueId: true, sport: true, currentWeek: true },
  })
  if (!season) return result

  // Same deterministic roster order as the regular schedule (ensureScheduleForNewSeason).
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  if (rosters.length < 2) return result

  const existing = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week: { in: weeks } },
    select: { week: true },
  })
  const taken = new Set(existing.map((m) => m.week))
  const missing = weeks.filter((w) => !taken.has(w))
  if (missing.length === 0) {
    await markPreLeagueWeeksLoaded(season.leagueId, weeks.length)
    return result
  }

  // A plain round-robin over the missed weeks: no median slot (the median is a standings rule, not a
  // matchup row) and no divisions — these weeks predate the league's own structure.
  const slots = generateSchedule(rosters, weeks.length, weeks.length + 1, season.sport).filter(
    (slot) => slot.type !== 'median' && missing.includes(slot.week),
  )
  if (slots.length > 0) {
    await prisma.redraftMatchup.createMany({
      data: slots.map((slot) => ({
        seasonId: season.id,
        leagueId: season.leagueId,
        week: slot.week,
        type: PRE_LEAGUE_MATCHUP_TYPE,
        homeRosterId: slot.home,
        awayRosterId: slot.away,
        isMedianMatchup: false,
      })),
    })
  }

  for (const week of missing) {
    try {
      await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: season.id, week })
    } catch (err) {
      result.failures.push({ week, step: 'stats', error: err instanceof Error ? err.message : String(err) })
    }
    try {
      await recalculateMatchupsForSeasonWeek(season.id, week)
    } catch (err) {
      result.failures.push({ week, step: 'score', error: err instanceof Error ? err.message : String(err) })
    }
    // Played before the league existed: final, whatever coverage the stats had.
    await prisma.redraftMatchup.updateMany({
      where: { seasonId: season.id, week, type: PRE_LEAGUE_MATCHUP_TYPE },
      data: { status: 'final' },
    })
    result.created.push(week)
  }

  await markPreLeagueWeeksLoaded(season.leagueId, weeks.length)

  // Only changes anything when the commissioner counts these weeks; harmless otherwise.
  await updateStandings(season.id, Math.max(1, season.currentWeek ?? 1)).catch(() => undefined)
  return result
}

/**
 * Tell the settings screens there is something for the "count these weeks" toggle to act on. Read fresh
 * and merged, so a commissioner edit made while the backfill ran is kept. Only ever raises the number.
 */
async function markPreLeagueWeeksLoaded(leagueId: string, weekCount: number): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const prev =
    league?.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
  if (readPreLeagueWeeksLoaded(prev) >= weekCount) return
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...prev, [PRE_LEAGUE_WEEKS_LOADED_SETTINGS_KEY]: weekCount } as Prisma.InputJsonValue },
  })
}

/** Re-run standings for every running season of a league — after the commissioner flips the toggle. */
export async function recomputeStandingsForLeague(leagueId: string): Promise<number> {
  const seasons = await prisma.redraftSeason.findMany({
    where: { leagueId, status: { not: 'setup' } },
    select: { id: true, currentWeek: true, totalWeeks: true, status: true },
  })
  let done = 0
  for (const s of seasons) {
    const through = s.status === 'complete' ? s.totalWeeks : Math.max(1, s.currentWeek ?? 1)
    await updateStandings(s.id, through)
    done += 1
  }
  return done
}
