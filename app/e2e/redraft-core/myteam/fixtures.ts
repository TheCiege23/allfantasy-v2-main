/**
 * HARNESS FIXTURES ONLY (app/e2e is 404 in production). Fictional managers and players, shaped like the
 * real loader outputs the three /core screens read — MyTeamData (lib/core-app/myTeam.ts), LeagueWeekBoard
 * (lib/core-app/weekBoard.ts) and DefenseHubPayload (lib/idp-projections/defenseHub.ts) — so the screens
 * render through their own code with no database. Nothing here is imported by product code.
 *
 * Each sport carries its own slot template, cadence (weekly vs daily) and designations, so a capture
 * shows the sport differences the screens must handle: C as centre vs catcher, G as guard vs goalie,
 * soccer's DEF as a defender, a football bye vs a daily off day, DTD / GTD / IL beside Q / O.
 */
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'
import type { LeagueWeekBoard } from '@/lib/core-app/weekBoard'
import type { DefenseHubPayload } from '@/lib/idp-projections/defenseHub'

export const HARNESS_SCREENS = ['my-team', 'week', 'defense-hub'] as const
export type HarnessScreen = (typeof HARNESS_SCREENS)[number]

export type HarnessSport = 'NFL' | 'NBA' | 'NHL' | 'MLB' | 'NCAAF' | 'NCAAB' | 'SOCCER'
export const HARNESS_SPORTS: HarnessSport[] = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']

type Cfg = {
  week: number
  /** Daily-lineup sport: the outlook priced ONE day, and a team without a game that day is off. */
  daily: boolean
  slots: string[]
  /** The concrete position each slot is filled from. */
  fill: string[]
  bench: string[]
  teams: string[]
  pts: number
  /** Designations this sport's feed actually sends. */
  statuses: string[]
}

const SPORTS: Record<HarnessSport, Cfg> = {
  NFL: { week: 9, daily: false, slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'], fill: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'K', 'DEF'], bench: ['RB', 'WR', 'QB', 'TE'], teams: ['KC', 'BUF', 'PHI', 'SF', 'DET', 'MIA', 'DAL', 'CIN', 'BAL'], pts: 14, statuses: ['Questionable', 'Out', 'Doubtful'] },
  NCAAF: { week: 6, daily: false, slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K'], fill: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'RB', 'K'], bench: ['QB', 'RB', 'WR'], teams: ['UGA', 'OSU', 'TEX', 'ORE', 'BAMA', 'MICH', 'LSU', 'PSU', 'USC'], pts: 15, statuses: ['Questionable', 'Out'] },
  NBA: { week: 4, daily: true, slots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL'], fill: ['PG', 'SG', 'PG', 'SF', 'PF', 'SF', 'C', 'C', 'PF'], bench: ['PG', 'C', 'SF'], teams: ['BOS', 'DEN', 'OKC', 'MIL', 'LAL', 'NYK', 'PHX', 'MIN', 'DAL'], pts: 34, statuses: ['Day-To-Day', 'Out', 'Game-Time Decision'] },
  NCAAB: { week: 8, daily: true, slots: ['G', 'G', 'F', 'F', 'C', 'UTIL'], fill: ['G', 'G', 'F', 'F', 'C', 'G'], bench: ['G', 'F', 'C'], teams: ['DUKE', 'UK', 'UNC', 'KU', 'GONZ', 'HOU'], pts: 26, statuses: ['Questionable', 'Out'] },
  NHL: { week: 5, daily: true, slots: ['C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'D', 'G', 'G'], fill: ['C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'D', 'G', 'G'], bench: ['C', 'D', 'G'], teams: ['EDM', 'COL', 'TOR', 'BOS', 'NYR', 'VGK', 'FLA', 'DAL', 'TBL', 'WPG', 'CAR'], pts: 9, statuses: ['Day-To-Day', 'Out', 'Injured Reserve'] },
  MLB: { week: 7, daily: true, slots: ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL', 'SP', 'SP', 'RP', 'RP'], fill: ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', '1B', 'SP', 'SP', 'RP', 'RP'], bench: ['OF', 'SP', 'SS'], teams: ['LAD', 'NYY', 'ATL', 'HOU', 'PHI', 'BAL', 'SEA', 'TEX', 'SD', 'CLE', 'MIL', 'TOR', 'NYM'], pts: 8, statuses: ['Day-To-Day', '10-Day IL', 'Out'] },
  SOCCER: { week: 11, daily: false, slots: ['GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'], fill: ['GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'], bench: ['GKP', 'DEF', 'MID'], teams: ['ARS', 'MCI', 'LIV', 'CHE', 'TOT', 'NEW', 'AVL', 'MUN', 'BHA', 'WHU', 'FUL'], pts: 6, statuses: ['Questionable', 'Out'] },
}

const FIRST = ['Avery', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Quinn', 'Rowan', 'Emerson', 'Dakota', 'Sawyer', 'Hayden', 'Reese', 'Parker', 'Logan', 'Kendall', 'Skyler', 'Blake', 'Drew']
const LAST = ['Calloway', 'Brightwater', 'Okafor', 'Lindqvist', 'Marchetti', 'Holloway', 'Sutherland', 'Vance', 'Amari', 'Kowalski', 'Delacroix', 'Whitfield', 'Nakamura', 'Ferreira', 'Ashby', 'Montoya', 'Rourke']
const name = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`
export const MANAGERS = ['Fourth & Forever', 'Gridiron Ghosts', 'Waiver Wire Wizards', 'Bench Mob', 'Late Round Legends', 'Sunday Scaries', 'The Comeback Kids', 'Bye Week Blues', 'Draft Day Darlings', 'Trade Deadline Thieves']

/** 2026-10-30 (a Friday): the day the daily-sport fixtures were "priced" for. */
export const HARNESS_DAY = '2026-10-30'

function player(sport: HarnessSport, i: number, position: string, opts: Partial<LineupPlayer> = {}): LineupPlayer {
  const cfg = SPORTS[sport]
  const team = cfg.teams[i % cfg.teams.length]
  const opp = cfg.teams[(i + 4) % cfg.teams.length]
  const proj = Math.round(cfg.pts * (0.7 + ((i * 37) % 60) / 100) * 10) / 10
  return {
    sleeperId: `fx-${sport}-${i}`,
    name: name(i + sport.length * 3),
    position,
    team,
    sport,
    imageUrl: null,
    logoUrl: null,
    gameContext: cfg.daily ? `${team} ${i % 2 ? '@' : 'vs'} ${opp}` : `${team} ${i % 2 ? '@' : 'vs'} ${opp} · ${sport === 'NCAAF' ? 'Sat' : 'Sun'} 1:00p ET`,
    kickoff: null,
    preseason: false,
    venue: null,
    injuryStatus: null,
    ruledOut: false,
    afProjectedPoints: proj,
    afEngineProjectedPoints: Math.round(proj * 0.94 * 10) / 10,
    indoors: null,
    market: { ownPct: 0.5 + ((i * 13) % 50) / 100, startPct: 0.3 + ((i * 17) % 60) / 100 },
    weather: null,
    onBye: false,
    projectedPoints: Math.round(proj * 1.03 * 10) / 10,
    ...opts,
  }
}

/**
 * One fixture team for a sport. Starter 3 carries the sport's first designation, starter 5 the second;
 * in a weekly football league starter 4 is on BYE, in a daily one starter 4's team is OFF today; one
 * NFL slot is empty so the hole state shows; the bench carries one more designation.
 */
export function myTeamFixture(sport: HarnessSport): MyTeamData {
  const cfg = SPORTS[sport]
  const football = sport === 'NFL' || sport === 'NCAAF'
  const starters: LineupSlot[] = cfg.slots.map((slotLabel, i) => {
    if (sport === 'NFL' && i === cfg.slots.length - 2) return { slotLabel, player: null, empty: true, unresolvedId: null, benchCheck: null }
    const opts: Partial<LineupPlayer> = {}
    if (i === 2) opts.injuryStatus = cfg.statuses[0]
    if (i === 5) opts.injuryStatus = cfg.statuses[1] ?? null
    if (i === 4) {
      if (cfg.daily) Object.assign(opts, { noGamePeriod: 'day', gameContext: 'no game today', afProjectedPoints: 0 })
      else Object.assign(opts, { onBye: true, gameContext: 'BYE', afProjectedPoints: 0 })
    }
    if (i === 0) opts.gameDay = { state: 'live', points: Math.round(cfg.pts * 0.6 * 10) / 10 } as never
    if (i === 1) opts.gameDay = { state: 'final', points: Math.round(cfg.pts * 1.1 * 10) / 10 } as never
    return { slotLabel, player: player(sport, i, cfg.fill[i], opts), empty: false, unresolvedId: null, benchCheck: null }
  })
  if (football) starters[3] = { ...starters[3], benchCheck: { verdict: 'swap', benchName: name(40), benchProjected: 15.8, starterName: starters[3].player!.name, starterProjected: 11.2 } }
  const bench = cfg.bench.map((pos, j) => player(sport, 30 + j, pos, j === 1 ? { injuryStatus: cfg.statuses[2] ?? cfg.statuses[0] } : {}))
  const ir = [player(sport, 60, cfg.fill[1], { injuryStatus: sport === 'MLB' ? '60-Day IL' : 'Injured Reserve', ruledOut: true, afProjectedPoints: 0 })]
  const priced = starters.filter((s) => s.player).length
  const total = Math.round(starters.reduce((t, s) => t + (s.player?.afProjectedPoints ?? 0), 0) * 10) / 10
  const lockAt = new Date('2026-11-01T17:00:00Z')
  return {
    league: { id: 'e2e-redraft-core', name: 'Sunday Night Redraft', platform: 'allfantasy', sport, format: 'redraft', sourceLink: null, lineupMode: 'manual' },
    nativeLineup: null,
    lineupPeriod: cfg.daily ? { kind: 'day', day: HARNESS_DAY, week: cfg.week } : null,
    team: { available: true, data: { teamName: 'Fourth & Forever', ownerName: 'Ciege', managerAvatarUrl: null, record: '6-2', recordKnown: true, rank: 2, pointsFor: 812.4, pointsAgainst: 744.1, teamCount: 10 } },
    starters: { available: true, data: starters },
    identityNote: null,
    bench: { available: true, data: bench },
    ir: { available: true, data: ir },
    taxi: { available: false, reason: 'this league has no taxi squad' },
    lock: { available: true, data: { at: lockAt, anyEmptySlot: sport === 'NFL', week: cfg.week, season: 2026, daysAway: 1, asOf: Date.parse('2026-10-31T12:00:00Z') } },
    projections: { available: true, data: { total: Math.round(total * 1.03 * 10) / 10, projected: priced, unprojected: 0, season: '2026', week: cfg.week, afTotal: total, afProjected: priced, afEngineTotal: Math.round(total * 0.94 * 10) / 10, afEngineProjected: priced, standardComparable: true } },
    projectionBasis: { notes: football ? ['Pass TDs are worth 6 here, not 4.'] : [], scoringKnown: true },
    nextMatchup: {
      available: true,
      data: {
        seasonYear: 2026,
        week: cfg.week,
        you: { rosterId: 'r1', teamName: 'Fourth & Forever', managerName: 'Ciege', avatarUrl: null, projected: total, projectedFrom: priced, starterCount: priced },
        opponent: { rosterId: 'r2', teamName: 'Gridiron Ghosts', managerName: 'Morgan', avatarUrl: null, projected: Math.round(total * 0.93 * 10) / 10, projectedFrom: priced, starterCount: priced },
        bye: false,
        unpricedReason: null,
      },
    },
    rosterGrade: { available: false, reason: 'We need prices for most of this league’s rosters to rank yours against them, and we don’t have them yet.' },
    upcomingByes: football ? [{ week: cfg.week + 2, names: [name(3), name(8), name(31)] }] : [],
    liveScore: { available: false, reason: 'harness' },
    teamActivity: null,
    dynasty: null,
  } as unknown as MyTeamData
}

/** One league's week: your matchup, four sideline games, and a record for every team in it. */
export function weekBoardFixture(sport: HarnessSport): LeagueWeekBoard {
  const cfg = SPORTS[sport]
  const ids = MANAGERS.map((_, i) => `r${i + 1}`)
  const wins = [6, 6, 5, 5, 4, 4, 4, 3, 2, 1]
  const records = Object.fromEntries(ids.map((id, i) => [id, { wins: wins[i], losses: 8 - wins[i] }]))
  const scale = cfg.pts * cfg.slots.length
  const side = (i: number, k: number) => ({ rosterId: ids[i], name: MANAGERS[i], avatarUrl: null, projected: Math.round(scale * (0.92 + k * 0.03) * 10) / 10 })
  return {
    format: 'head-to-head',
    leagueId: 'e2e-redraft-core',
    leagueName: 'Sunday Night Redraft',
    platform: 'allfantasy',
    season: 2026,
    week: cfg.week,
    yours: {
      leagueId: 'e2e-redraft-core',
      leagueName: 'Sunday Night Redraft',
      platform: 'allfantasy',
      leagueImageUrl: null,
      season: 2026,
      week: cfg.week,
      href: '/core/matchup?league=e2e-redraft-core',
      opponent: { rosterId: 'r2', name: MANAGERS[1], avatarUrl: null },
      elimination: false,
      projection: { you: Math.round(scale * 10) / 10, them: Math.round(scale * 0.94 * 10) / 10, margin: Math.round(scale * 0.06 * 10) / 10, winProbability: 0.61 },
      form: null,
      yourSampleWeeks: 8,
      live: null,
    },
    sidelines: [[2, 3], [4, 5], [6, 7], [8, 9]].map(([a, b], k) => ({ a: side(a, k), b: side(b, 3 - k), aWinProbability: 0.42 + k * 0.06 })),
    rivalry: { wins: 3, losses: 2, ties: 0, meetings: 5, averageMargin: 6.4 },
    records,
    yourRosterId: 'r1',
    yourTeamName: MANAGERS[0],
    yourAvatarUrl: null,
    extraMatchup: null,
  } as unknown as LeagueWeekBoard
}

/** An IDP league's Defense Hub payload: four defenders (one unpriced, with its reason), a kicker, snaps, roles. */
export function defenseHubFixture(): DefenseHubPayload {
  const d = (i: number, position: string, group: 'DL' | 'LB' | 'DB', projection: number | null, extra: Record<string, unknown> = {}) => ({
    sleeperId: `fx-dh-${i}`,
    name: name(70 + i),
    team: SPORTS.NFL.teams[i % 9],
    position,
    positionGroup: group,
    projection,
    vorp: projection != null ? Math.round((projection - 7.5) * 10) / 10 : null,
    positionRank: projection != null ? 4 + i * 6 : null,
    value: projection != null ? 140 - i * 11 : null,
    valueIsFloor: i === 3,
    reason: null,
    lastWeek: projection != null ? { scored: true, points: Math.round(projection * 1.1 * 10) / 10 } : null,
    ...extra,
  })
  const defenders = [d(0, 'LB', 'LB', 11.4), d(1, 'DE', 'DL', 9.8), d(2, 'CB', 'DB', 8.1), d(3, 'S', 'DB', 6.2), d(4, 'LB', 'LB', null, { reason: 'No game on file for him this week — a bye, or the schedule has not been ingested.', lastWeek: null })]
  return {
    state: 'ok',
    projectedFor: { season: 2026, week: 9 },
    coverage: { defenders: 312, projected: 288, priced: 276 },
    defenders,
    kickers: [{ sleeperId: 'fx-k', name: name(90), team: 'BUF' }],
    kickerValue: { value: 96, replacementRank: 14, basis: 'Every kicker in this league is priced the same, on purpose: kicker rank does not carry from year to year.' },
    snaps: defenders.slice(0, 3).map((x, i) => ({ sleeperId: x.sleeperId, name: x.name, share: 0.92 - i * 0.11, games: 8, basis: 'defense', trend: null, reason: null })),
    roles: defenders.slice(0, 3).map((x, i) => ({ sleeperId: x.sleeperId, name: x.name, games: 8, lines: [{ label: 'Tackles per game', value: (7.1 - i * 1.4).toFixed(1), basis: 'Last 8 games' }, { label: 'Pressures per game', value: i === 1 ? '3.2' : null, basis: i === 1 ? 'Last 8 games' : 'Not tracked for his role' }] })),
    tendencies: [{ team: 'KC', tendency: { season: 2026, passRateFaced: 0.61, blitzRate: 0.27, playsFacedSeason: 512, thirdDownRateFaced: 0.38 } }],
    notes: ['No salary, contract or cap-efficiency columns: those tables have zero rows in production, so there is nothing to show for any league yet.'],
  } as unknown as DefenseHubPayload
}
