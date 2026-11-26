/**
 * Which week a guillotine league is in, and which roster is the viewer's — one rule for every
 * surface that needs them.
 *
 * Before this the summary route defaulted to WEEK 1 whenever no `?week=` was passed, so the
 * Guillotine tab (`GuillotineHome`, whose week state was never advanced) and the since-deleted `GuillotineFormatTab`
 * both showed week 1's danger tiers all season. The war room already resolved the week properly;
 * that rule now lives here and both use it.
 */
import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { periodEndWeek, readPeriodWeeks } from './eliminationPeriods'

/**
 * Latest scored period, else the configured first chop week, else 1 — plus when that latest score
 * was written (the war room shows it as "scores as of").
 */
export async function resolveGuillotineWeekState(
  leagueId: string,
  config?: { eliminationStartWeek?: number | null } | null,
): Promise<{ week: number; latestScoredAt: Date | null }> {
  const latest = await prisma.guillotinePeriodScore
    .findFirst({ where: { leagueId }, orderBy: { weekOrPeriod: 'desc' }, select: { weekOrPeriod: true, createdAt: true } })
    .catch(() => null)
  return { week: latest?.weekOrPeriod ?? config?.eliminationStartWeek ?? 1, latestScoredAt: latest?.createdAt ?? null }
}

/**
 * PURE: the week a member is watching. `latestScored` is the last week whose chop is settled.
 *
 * 🛑 AFTER THE FIRST CHOP EVERY MEMBER WATCHED LAST WEEK, ALL SEASON. The summary defaulted to the
 * latest SCORED week, and a week is scored only when it is chopped. So once week 1 was chopped the
 * Guilly tab sat on week 1 while week 2 was played: the settled line, no live scores, and Chop Watch
 * (which previews the week still to chop) answering null because it was asked about the wrong week.
 * The live chop line worked in week 1 only. Seen walking a league locally, 2026-11-20: week 1 chopped,
 * the sport on week 5, summary `weekOrPeriod: 1`, `chopWatch: null`.
 *
 * The week being watched is the one after the last settled chop. It stays on the last settled week
 * when there is nothing after it: the season is finished, or the chop weeks have run out.
 *
 * 🛑 IN A TWO-WEEK LEAGUE THIS WAS THE PERIOD'S FIRST WEEK FOR BOTH OF ITS WEEKS. Every chop, score and
 * preview is keyed by a period's LAST week (./eliminationPeriods.ts), but "one past the last chop" is the
 * period's first week, and it stayed there until the period was chopped. So during the second week the
 * outlook read the first week's slate (every game final, nothing left), the next-chop time was a week early,
 * and the board said "Week 3" for a chop that lands after week 4. With `periodWeeks` the answer is the
 * period's key, the week that actually chops.
 */
export function guillotineLiveWeek(args: {
  latestScored: number | null
  startWeek?: number | null
  endWeek?: number | null
  seasonComplete?: boolean
  /** Weeks per elimination period (./eliminationPeriods.ts). Absent = 1. */
  periodWeeks?: number
}): number {
  const start = args.startWeek != null && args.startWeek >= 1 ? args.startWeek : 1
  const key = (w: number) => periodEndWeek(w, start, args.periodWeeks ?? 1)
  if (args.latestScored == null) return key(start)
  if (args.seasonComplete) return args.latestScored
  const next = key(Math.max(args.latestScored + 1, start))
  return args.endWeek != null && next > args.endWeek ? args.latestScored : next
}

/** The week the league is playing now: what the Guilly, Matchup and Standings tabs open on. */
export async function resolveGuillotineLiveWeek(
  leagueId: string,
  config?: { eliminationStartWeek?: number | null; eliminationEndWeek?: number | null } | null,
): Promise<number> {
  const [latest, season, league] = await Promise.all([
    prisma.guillotinePeriodScore
      .findFirst({ where: { leagueId }, orderBy: { weekOrPeriod: 'desc' }, select: { weekOrPeriod: true } })
      .catch(() => null),
    prisma.guillotineSeason
      .findFirst({ where: { redraftSeason: { leagueId } }, orderBy: { createdAt: 'desc' }, select: { status: true } })
      .catch(() => null),
    // A settings read that fails leaves a one-week league's answer: unchanged from before two-week periods.
    Promise.resolve().then(() => prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })).catch(() => null),
  ])
  return guillotineLiveWeek({
    latestScored: latest?.weekOrPeriod ?? null,
    startWeek: config?.eliminationStartWeek ?? null,
    endWeek: config?.eliminationEndWeek ?? null,
    seasonComplete: season?.status === 'complete',
    periodWeeks: readPeriodWeeks(league?.settings),
  })
}

export async function resolveGuillotineCurrentWeek(
  leagueId: string,
  config?: { eliminationStartWeek?: number | null } | null,
): Promise<number> {
  return (await resolveGuillotineWeekState(leagueId, config)).week
}

/** The viewer's roster in a hosted league: the roster their user id owns (same rule as the war room). */
export async function findViewerRosterId(leagueId: string, userId: string): Promise<string | null> {
  const row = await prisma.roster
    .findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } })
    .catch(() => null)
  return row?.id ?? await acceptedCoOwnerRosterId(leagueId, userId)
}

/**
 * The league's calendar week: the season's `currentWeek`, which the native runner moves with the sport
 * (./nativeGuillotineWeek.ts). Before chops start it is behind `resolveGuillotineLiveWeek` (the first chop
 * week), and that gap is how a surface says "this week does not count". Null when there is no season yet
 * or the read fails.
 */
export async function resolveGuillotineCalendarWeek(leagueId: string): Promise<number | null> {
  const season = await prisma.redraftSeason
    .findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { currentWeek: true } })
    .catch(() => null)
  return typeof season?.currentWeek === 'number' && season.currentWeek >= 1 ? season.currentWeek : null
}
