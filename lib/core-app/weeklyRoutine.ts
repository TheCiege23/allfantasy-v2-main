import 'server-only'

import { prisma } from '@/lib/prisma'
import { claimedRosterIds, loadSeasonAdds, type ReceiptsLeague } from './decisionReceipts'
import { DEFAULT_TIME_ZONE, localParts } from './managerActivityWindow'
import { composePlayerIdentities } from './playerIdentityCompose'
import { getWeekAll, type WeekAllData } from './weekAll'
import type { WeekBoard } from './weekBoard'

/**
 * "Your week" — the weekly fantasy routine on the /core home (retention item 7, user decisions
 * 2026-09-14): Tuesday results review, Wednesday waivers, Thursday lineup check, Sunday game day,
 * Monday recap. One card; today's step is highlighted, each step says one real thing and links to
 * the screen that already does the job.
 *
 * ⚠ THE DAY IS THE READER'S FANTASY DAY IN US EASTERN, NOT THE SERVER'S. NFL slates, waivers and
 * locks run on Eastern time; a UTC Monday 02:00 is still Sunday night football. dash34 refuses to
 * print a server-zone weekday for the same reason.
 *
 * ⚠ "DONE" IS ONLY EVER OBSERVED (user decision: derived, no table):
 *   results  the last fully played week has scored results of yours
 *   waivers  your Sleeper transaction facts show an add this week
 *   lineups  no starter of yours is in doubt (the home triage's own rule)
 * Anything that cannot be observed is `unknown` and says so — never a check mark. Game day and the
 * recap are events, not chores: they are never "done".
 *
 * 🛑 NO WAIVER PROCESS TIMES. `League.waiverProcessTime` and `LeagueWaiverSettings` hold our own
 * defaults, not the provider's (see todayStrip.ts), so the waivers step names no deadline.
 */

export type RoutineStepKey = 'results' | 'waivers' | 'lineups' | 'gameday' | 'recap'

export type RoutineStep = {
  key: RoutineStepKey
  day: 'Tue' | 'Wed' | 'Thu' | 'Sun' | 'Mon'
  title: string
  href: string
  today: boolean
  state: 'done' | 'open' | 'unknown'
  summary: string | null
}

export type WeeklyRecap = {
  season: number
  week: number
  wins: number
  losses: number
  biggestWin: { leagueName: string; margin: number } | null
  closestLoss: { leagueName: string; margin: number } | null
  /** Your highest-scoring STARTER that week, from the platform's own weekly scores. */
  topScorer: { name: string; points: number; leagueName: string } | null
}

export type WeeklyRoutineData = {
  today: RoutineStepKey
  /** "Friday" — the Eastern weekday the highlight was chosen for. */
  todayLabel: string
  steps: RoutineStep[]
  recap: WeeklyRecap | null
}

const STEP_ORDER: ReadonlyArray<Pick<RoutineStep, 'key' | 'day' | 'title' | 'href'>> = [
  { key: 'results', day: 'Tue', title: 'Results review', href: '/core/week' },
  { key: 'waivers', day: 'Wed', title: 'Waivers', href: '/core/waivers' },
  { key: 'lineups', day: 'Thu', title: 'Lineup check', href: '/core/my-team' },
  { key: 'gameday', day: 'Sun', title: 'Game day', href: '/core/matchup' },
  { key: 'recap', day: 'Mon', title: 'Recap', href: '/core/week' },
]

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Sunday game day, Monday recap, Tuesday results, Wednesday waivers, Thursday–Saturday lineups. */
export function routineDayFor(now: Date, timeZone: string = DEFAULT_TIME_ZONE): { key: RoutineStepKey; label: string } {
  const { weekday } = localParts(now, timeZone)
  const key: RoutineStepKey =
    weekday === 0 ? 'gameday' : weekday === 1 ? 'recap' : weekday === 2 ? 'results' : weekday === 3 ? 'waivers' : 'lineups'
  return { key, label: DAY_NAMES[weekday] ?? 'Today' }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const round1 = (n: number) => Math.round(n * 10) / 10

/** The recap of a played week, from your scored results plus the week's top starter. */
export function recapFrom(week: WeekAllData | null, topScorer: WeeklyRecap['topScorer']): WeeklyRecap | null {
  if (!week || week.rows.length === 0 || week.season == null || week.week == null) return null
  const wins = week.rows.filter((r) => r.won)
  const losses = week.rows.filter((r) => !r.won)
  const margin = (r: (typeof week.rows)[number]) => round1(Math.abs(r.pointsFor - r.pointsAgainst))
  const biggest = [...wins].sort((a, b) => margin(b) - margin(a))[0]
  const closest = [...losses].sort((a, b) => margin(a) - margin(b))[0]
  return {
    season: week.season,
    week: week.week,
    wins: wins.length,
    losses: losses.length,
    biggestWin: biggest ? { leagueName: biggest.leagueName, margin: margin(biggest) } : null,
    closestLoss: closest ? { leagueName: closest.leagueName, margin: margin(closest) } : null,
    topScorer,
  }
}

export function buildWeeklyRoutine(input: {
  now: Date
  timeZone?: string
  /** The last fully played week (`getWeekAll(…, { previous: true })`). Null = not read. */
  lastWeek: WeekAllData | null
  topScorer: WeeklyRecap['topScorer']
  /** Your adds this week in Sleeper leagues. Null = could not be read. */
  addsThisWeek: number | null
  /** Starters of yours who may not play. Null = the injury book was not read. */
  startersInDoubt: number | null
  schedule: Pick<WeekBoard, 'coinFlips' | 'leaning' | 'unprojected'> | null
}): WeeklyRoutineData {
  const today = routineDayFor(input.now, input.timeZone)
  const recap = recapFrom(input.lastWeek, input.topScorer)

  const detail: Record<RoutineStepKey, Pick<RoutineStep, 'state' | 'summary'>> = {
    results: recap
      ? {
          state: 'done',
          summary: `${recap.season} week ${recap.week}: ${recap.wins}-${recap.losses} across ${plural(recap.wins + recap.losses, 'league')}`,
        }
      : { state: 'unknown', summary: 'No scored results of yours on file yet.' },
    waivers:
      input.addsThisWeek == null
        ? { state: 'unknown', summary: null }
        : input.addsThisWeek > 0
          ? { state: 'done', summary: `You made ${plural(input.addsThisWeek, 'add')} this week.` }
          : { state: 'open', summary: 'No adds of yours on file this week.' },
    lineups:
      input.startersInDoubt == null
        ? { state: 'unknown', summary: null }
        : input.startersInDoubt > 0
          ? { state: 'open', summary: `${plural(input.startersInDoubt, 'starter')} may not play.` }
          : { state: 'done', summary: 'No starters of yours in doubt.' },
    gameday: (() => {
      const s = input.schedule
      const games = s ? s.coinFlips.length + s.leaning.length + s.unprojected.length : 0
      if (!s || games === 0) return { state: 'unknown' as const, summary: null }
      return {
        state: 'open' as const,
        summary: `${plural(games, 'matchup')} this week${s.coinFlips.length > 0 ? ` · ${plural(s.coinFlips.length, 'coin flip')}` : ''}.`,
      }
    })(),
    recap: recap
      ? {
          state: 'unknown',
          summary: [
            `${recap.wins}-${recap.losses} in week ${recap.week}`,
            recap.topScorer ? `top scorer ${recap.topScorer.name} ${recap.topScorer.points.toFixed(1)}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }
      : { state: 'unknown', summary: null },
  }

  return {
    today: today.key,
    todayLabel: today.label,
    steps: STEP_ORDER.map((s) => ({ ...s, today: s.key === today.key, ...detail[s.key] })),
    recap,
  }
}

/** Leagues read for the routine per render — the same cap as the receipts. */
const MAX_ROUTINE_LEAGUES = 12

/** Your top-scoring STARTER in the given played week, across your Sleeper leagues. */
async function topStarterFor(
  userId: string,
  leagues: readonly ReceiptsLeague[],
  week: WeekAllData,
): Promise<WeeklyRecap['topScorer']> {
  if (week.rows.length === 0 || week.season == null || week.week == null) return null
  const played = new Set(week.rows.map((r) => r.leagueId))
  const sleeper = leagues
    .filter((l) => played.has(l.id) && String(l.platform ?? '').toLowerCase() === 'sleeper' && l.platformLeagueId)
    .slice(0, MAX_ROUTINE_LEAGUES)
  if (sleeper.length === 0) return null

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: { in: sleeper.map((l) => l.id) }, claimedByUserId: userId },
    select: { leagueId: true, externalId: true },
  })
  const rosterByLeague = claimedRosterIds(teams)
  const mine = sleeper.filter((l) => rosterByLeague.has(l.id))
  if (mine.length === 0) return null

  const [top] = await prisma.leaguePlayerWeeklyScore.findMany({
    where: {
      OR: mine.map((l) => ({
        leagueId: l.platformLeagueId as string,
        seasonYear: week.season as number,
        week: week.week as number,
        rosterId: rosterByLeague.get(l.id)!,
        isStarter: true,
      })),
    },
    orderBy: { points: 'desc' },
    take: 1,
    select: { leagueId: true, playerId: true, points: true },
  })
  if (!top) return null
  const who = composePlayerIdentities(
    await prisma.sportsPlayer.findMany({
      where: { sleeperId: top.playerId },
      select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
    }),
  ).get(top.playerId)
  // An unnamed top scorer is left out rather than replaced by the next NAMED one, which would not be the top.
  if (!who?.name) return null
  return {
    name: who.name,
    points: round1(top.points),
    leagueName: mine.find((l) => l.platformLeagueId === top.leagueId)?.name ?? 'Your league',
  }
}

/**
 * The routine's database reads, run beside the home's other loaders: the last played week, its top
 * starter, and this week's adds. Each fails on its own, to `null` (unknown), never to "none".
 */
export async function getRoutineFacts(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  currentWeek: number | null
}): Promise<{ lastWeek: WeekAllData | null; topScorer: WeeklyRecap['topScorer']; addsThisWeek: number | null }> {
  const [lastWeek, addsThisWeek] = await Promise.all([
    getWeekAll(args.userId, [...args.leagues], { previous: true }).catch(() => null),
    args.currentWeek == null
      ? Promise.resolve(null)
      : loadSeasonAdds({ userId: args.userId, leagues: args.leagues.slice(0, MAX_ROUTINE_LEAGUES) })
          .then((loaded) => (loaded ? loaded.adds.filter((a) => a.week === args.currentWeek).length : null))
          .catch(() => null),
  ])
  const topScorer = lastWeek ? await topStarterFor(args.userId, args.leagues, lastWeek).catch(() => null) : null
  return { lastWeek, topScorer, addsThisWeek }
}
