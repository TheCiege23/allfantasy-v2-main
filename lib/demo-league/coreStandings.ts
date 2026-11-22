/**
 * The demo league in the shape the REAL Standings screen (`components/core-app/screens/Standings.tsx`)
 * reads. The board — official order, playoff line, power table — is computed by the app's own
 * `standingsModel` from the demo's weekly scores, exactly as the app's DB-free standings harness does,
 * so the demo shows the real arithmetic rather than a table typed to look like it.
 *
 * 🛑 ONLY `DemoLeagueView` GOES IN (see `coreHome.ts`): ids are `demo-<slot>`, names are aliases, and
 * nothing is "yours" — so the personal panels (your trend, your recent weeks, your projection) are
 * empty or withheld, which is the path the screen already takes for a league with no team of yours.
 */
import type { LeagueStandingsResult, StandingRow } from '@/lib/core-app/leagueStandings'
import {
  advanceWeek,
  buildStandingsBoard,
  type RemainingGame,
  type StandingsRules,
  type TeamMeta,
  type WeekRow,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'
import type { DemoLeagueView } from './types'

const idOf = (slot: number) => `demo-${slot}`

/** One week of demo scores as standings rows: a seat's opponent is the other seat with its game number. */
function weekRows(week: number, scores: DemoLeagueView['weeklyScores'][number]['scores'], pointsOnly: boolean): WeekRow[] {
  return scores.map((s) => {
    const opp = !pointsOnly && s.matchupId != null ? scores.find((o) => o !== s && o.matchupId === s.matchupId) : undefined
    return {
      week,
      rosterId: idOf(s.slot),
      matchupId: opp ? s.matchupId! : null,
      pointsFor: s.points,
      pointsAgainst: opp ? opp.points : 0,
    }
  })
}

/**
 * `pointsOnly`: a format with no weekly opponent (Guilly, Survivor, Survivor Guilly). The sample data
 * still pairs seats into games, but a win-loss record there would be invented, so the pairings are
 * dropped and the board ranks by points — its own path for a league with no head-to-head.
 */
export function demoLeagueStandings(view: DemoLeagueView, opts: { id: string; name: string; pointsOnly?: boolean }): LeagueStandingsResult {
  const pointsOnly = opts.pointsOnly === true
  const season = view.settings.season
  const ids = view.teams.map((t) => idOf(t.slot))
  const weeks = [...view.weeklyScores].sort((a, b) => a.week - b.week)
  if (weeks.length === 0) return { available: false, reason: 'No games have been played yet.' } as unknown as LeagueStandingsResult

  const snapshots: WeekSnapshot[] = []
  for (const w of weeks) {
    snapshots.push(advanceWeek(snapshots[snapshots.length - 1] ?? null, season, w.week, weekRows(w.week, w.scores, pointsOnly), ids, `demo-${opts.id}-${w.week}`))
  }

  // Every regular-season game nobody has scored in is a "game left" — what clinching is measured against.
  const end = view.settings.playoffStartWeek != null ? view.settings.playoffStartWeek - 1 : Infinity
  const unplayed: RemainingGame[] = pointsOnly ? [] : (view.upcoming ?? [])
    .filter((u) => u.week <= end)
    .flatMap((u) => u.pairs.map(([a, b]) => ({ week: u.week, a: idOf(a), b: idOf(b) })))

  const teams: TeamMeta[] = view.teams.map((t) => ({ rosterId: idOf(t.slot), name: t.teamName, avatarUrl: null, isYou: false, division: null, reported: null }))
  const s = view.settings
  const rules: StandingsRules = {
    playoffTeams: s.playoffTeams ?? 6,
    playoffTeamsSource: s.playoffTeams != null ? 'league' : 'assumed',
    byes: 0,
    regularSeasonEnd: s.playoffStartWeek != null ? s.playoffStartWeek - 1 : null,
    tiebreakers: ['points_for'],
    tiebreakerSource: 'assumed',
    coinSeed: `${opts.id}:${season}`,
    rankIsOfficial: false,
    platformLabel: 'AllFantasy',
  }
  const board = buildStandingsBoard({ season, snapshots, unplayed, teams, rules })

  const rows: StandingRow[] = board.teams.map((t) => ({
    rosterId: t.rosterId,
    name: t.name,
    avatarUrl: null,
    isYou: false,
    rank: t.pfRank,
    pointsFor: t.pointsFor,
    average: t.average,
    weeksPlayed: weeks.length,
    wins: t.record.wins,
    losses: t.record.losses,
    ties: t.record.ties,
    movement: t.seedMove,
  }))

  return {
    available: true,
    league: { id: opts.id, name: opts.name, platform: 'allfantasy' },
    season,
    week: view.currentWeek ?? weeks[weeks.length - 1]!.week + 1,
    seasonComplete: false,
    teams: rows,
    you: null,
    trend: [],
    recent: [],
    projection: { available: false, reason: 'The demo has no team of yours to project.' },
    scoredWeeks: weeks.length,
    history: [],
    board,
    live: null,
  }
}
