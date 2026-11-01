/**
 * FIXTURE DATA for the redraft /core Matchup + Live scores harness (batch B3). Harness only — app/e2e
 * is notFound() in production (app/e2e/layout.tsx) and nothing here is read by a real screen.
 *
 * The shapes are the real ones (`MatchupData`, `LivePageData`), so the screens render through their
 * own code paths; the names, teams and numbers are invented test values, labelled as such on the
 * harness page. Period labels are the shapes the server actually builds (lib/live/liveScoresPage.ts
 * `clockLabel`): "Q3 · 8:42", "P2 · 12:41", ESPN's own "Bot 6th" for baseball, "2H · 8:12" for college
 * basketball and soccer — plus NHL "P4 · 3:10", which the bug renders as OT.
 */
import type { MatchupData, MatchupPlayerCell, MatchupSlot } from '@/lib/core-app/matchup'
import type { LiveGameCard, LivePageData } from '@/lib/live/liveScoresPage'

export type FixtureSport = 'NFL' | 'NCAAF' | 'NBA' | 'NCAAB' | 'NHL' | 'MLB' | 'SOCCER'
export type FixtureState = 'live' | 'final' | 'upcoming'

type Row = { slot: string; pos: string; you: [string, string]; them: [string, string] }

/** Per sport: lineup slots, each with a fictional starter on both sides ([name, club]). */
const LINEUPS: Record<FixtureSport, Row[]> = {
  NFL: [
    { slot: 'QB', pos: 'QB', you: ['J. Harlan', 'DET'], them: ['M. Okafor', 'KC'] },
    { slot: 'RB', pos: 'RB', you: ['T. Bishop', 'ATL'], them: ['D. Ramos', 'SF'] },
    { slot: 'RB', pos: 'RB', you: ['K. Ellery', 'BAL'], them: ['R. Vance', 'DAL'] },
    { slot: 'WR', pos: 'WR', you: ['A. Whitlock', 'CIN'], them: ['S. Moreau', 'MIA'] },
    { slot: 'WR', pos: 'WR', you: ['C. Dunmore', 'LAR'], them: ['P. Achebe', 'MIN'] },
    { slot: 'TE', pos: 'TE', you: ['B. Kessler', 'KC'], them: ['L. Ostrow', 'SF'] },
    { slot: 'FLEX', pos: 'WR', you: ['N. Petrov', 'NYJ'], them: ['G. Halloway', 'PHI'] },
    { slot: 'K', pos: 'K', you: ['E. Sato', 'BAL'], them: ['V. Ruiz', 'DAL'] },
  ],
  NCAAF: [
    { slot: 'QB', pos: 'QB', you: ['R. Coleman', 'UGA'], them: ['T. Whitfield', 'OSU'] },
    { slot: 'RB', pos: 'RB', you: ['J. Banner', 'TEX'], them: ['M. Delaney', 'BAMA'] },
    { slot: 'WR', pos: 'WR', you: ['D. Ashby', 'LSU'], them: ['K. Morrow', 'ORE'] },
    { slot: 'WR', pos: 'WR', you: ['S. Quill', 'MICH'], them: ['A. Tennant', 'PSU'] },
    { slot: 'TE', pos: 'TE', you: ['H. Lyle', 'ND'], them: ['B. Corrigan', 'USC'] },
    { slot: 'FLEX', pos: 'RB', you: ['O. Mercer', 'FSU'], them: ['C. Rhodes', 'CLEM'] },
  ],
  NBA: [
    { slot: 'PG', pos: 'PG', you: ['D. Avery', 'BOS'], them: ['J. Laurent', 'DEN'] },
    { slot: 'SG', pos: 'SG', you: ['M. Castile', 'PHX'], them: ['T. Rourke', 'MIL'] },
    { slot: 'SF', pos: 'SF', you: ['K. Adeyemi', 'LAL'], them: ['R. Sutter', 'NYK'] },
    { slot: 'PF', pos: 'PF', you: ['B. Okonkwo', 'MIA'], them: ['L. Fenwick', 'OKC'] },
    { slot: 'C', pos: 'C', you: ['V. Marchetti', 'MIN'], them: ['G. Holt', 'SAC'] },
    { slot: 'UTIL', pos: 'SG', you: ['P. Draper', 'GSW'], them: ['A. Kwan', 'DAL'] },
  ],
  NCAAB: [
    { slot: 'G', pos: 'G', you: ['C. Pryor', 'DUKE'], them: ['M. Ibarra', 'UK'] },
    { slot: 'G', pos: 'G', you: ['J. Stroud', 'UNC'], them: ['T. Haley', 'KU'] },
    { slot: 'F', pos: 'F', you: ['D. Lomax', 'UCONN'], them: ['R. Paxton', 'GONZ'] },
    { slot: 'F', pos: 'F', you: ['A. Fairley', 'HOU'], them: ['K. Brandt', 'PUR'] },
    { slot: 'C', pos: 'C', you: ['S. Voss', 'ARIZ'], them: ['O. Grady', 'BAY'] },
  ],
  NHL: [
    { slot: 'C', pos: 'C', you: ['E. Lindqvist', 'TOR'], them: ['M. Bouchard', 'EDM'] },
    { slot: 'C', pos: 'C', you: ['J. Novak', 'COL'], them: ['A. Petersen', 'NYR'] },
    { slot: 'LW', pos: 'LW', you: ['K. Halvorsen', 'FLA'], them: ['T. Gagne', 'BOS'] },
    { slot: 'RW', pos: 'RW', you: ['R. Sorensen', 'VGK'], them: ['D. Marchand', 'DAL'] },
    { slot: 'D', pos: 'D', you: ['L. Ahlberg', 'CAR'], them: ['P. Kowalski', 'NJ'] },
    { slot: 'G', pos: 'G', you: ['S. Virtanen', 'WPG'], them: ['B. Lacroix', 'TB'] },
  ],
  MLB: [
    { slot: 'C', pos: 'C', you: ['A. Medina', 'LAD'], them: ['J. Sterling', 'NYY'] },
    { slot: '1B', pos: '1B', you: ['T. Garland', 'ATL'], them: ['R. Ishida', 'HOU'] },
    { slot: '2B', pos: '2B', you: ['M. Calloway', 'PHI'], them: ['D. Ferrer', 'SD'] },
    { slot: 'SS', pos: 'SS', you: ['K. Navarro', 'BAL'], them: ['L. Ostrander', 'SEA'] },
    { slot: 'OF', pos: 'OF', you: ['B. Whitaker', 'TEX'], them: ['C. Mbeki', 'TOR'] },
    { slot: 'SP', pos: 'SP', you: ['H. Takeda', 'CLE'], them: ['G. Brennan', 'MIL'] },
  ],
  SOCCER: [
    { slot: 'GK', pos: 'GK', you: ['M. Varga', 'ARS'], them: ['T. Lindgren', 'LIV'] },
    { slot: 'DEF', pos: 'DEF', you: ['R. Okoye', 'MCI'], them: ['S. Duarte', 'CHE'] },
    { slot: 'DEF', pos: 'DEF', you: ['L. Maier', 'TOT'], them: ['A. Costa', 'NEW'] },
    { slot: 'MID', pos: 'MID', you: ['J. Fontaine', 'AVL'], them: ['K. Reyes', 'BHA'] },
    { slot: 'MID', pos: 'MID', you: ['D. Haaland', 'MUN'], them: ['E. Rossi', 'WHU'] },
    { slot: 'FWD', pos: 'FWD', you: ['P. Adebayo', 'LIV'], them: ['N. Kirkland', 'ARS'] },
  ],
}

/** Per-row actuals and projections, cycled; scaled per sport so the totals look like that sport's. */
const ACTUAL = [24.6, 18.2, 9.4, 21.0, 6.8, 12.4, 15.1, 8.0]
const OPP_ACTUAL = [19.8, 22.4, 11.6, 7.2, 14.0, 5.6, 9.9, 10.0]
const PROJ = [21.5, 15.0, 12.2, 16.8, 13.1, 9.4, 11.7, 8.6]
const OPP_PROJ = [20.2, 16.4, 13.0, 12.5, 14.8, 8.1, 10.6, 9.2]
const SCALE: Record<FixtureSport, number> = { NFL: 1, NCAAF: 1, NBA: 1.9, NCAAB: 1.4, NHL: 0.45, MLB: 0.55, SOCCER: 0.4 }
/** On a live board: which rows are done, playing, or still to come (cycled). */
const LIVE_STATES: Array<'final' | 'live' | 'upcoming'> = ['final', 'live', 'final', 'upcoming', 'live', 'final', 'upcoming', 'final']

const r1 = (n: number) => Math.round(n * 10) / 10

function cell(
  sport: FixtureSport,
  id: string,
  [name, team]: [string, string],
  pos: string,
  projected: number,
  actual: number | null,
  gameState: MatchupPlayerCell['gameState'],
  opponentClub: string,
): MatchupPlayerCell {
  return {
    playerId: id,
    sleeperId: null,
    name,
    position: pos,
    team,
    sport,
    imageUrl: null,
    projected,
    afEngine: null,
    actual,
    empty: false,
    unavailable: null,
    gameState,
    kickoff: gameState === 'upcoming' ? '2026-11-01T18:00:00.000Z' : null,
    opponentClub,
    home: Number(id.replace(/\D/g, '')) % 2 === 0,
  }
}

export function matchupFixture(sport: FixtureSport, state: FixtureState): MatchupData {
  const rows = LINEUPS[sport]
  const k = SCALE[sport]
  const slots: MatchupSlot[] = rows.map((row, i) => {
    const gs = state === 'live' ? LIVE_STATES[i % LIVE_STATES.length] : state
    const a = state === 'upcoming' || gs === 'upcoming' ? null : r1(ACTUAL[i % 8] * k * (gs === 'live' ? 0.6 : 1))
    const b = state === 'upcoming' || gs === 'upcoming' ? null : r1(OPP_ACTUAL[i % 8] * k * (gs === 'live' ? 0.6 : 1))
    return {
      slotLabel: row.slot,
      you: cell(sport, `y${i}`, row.you, row.pos, r1(PROJ[i % 8] * k), a, gs, row.them[1]),
      opponent: cell(sport, `o${i}`, row.them, row.pos, r1(OPP_PROJ[i % 8] * k), b, gs, row.you[1]),
    }
  })
  const sum = (side: 'you' | 'opponent', key: 'actual' | 'projected') =>
    r1(slots.reduce((t, s) => t + ((s[side]?.[key] as number | null) ?? 0), 0))
  const scored = state !== 'upcoming'
  const you = { teamName: 'Sunday Night Squad', ownerName: 'you', record: '6-2', isYou: true, avatarUrl: null }
  const opp = { teamName: 'Waiver Wire Wizards', ownerName: 'rival', record: '5-3', isYou: false, avatarUrl: null }
  const counts = (side: 'you' | 'opponent') => {
    const c = { upcoming: 0, live: 0, final: 0, unknown: 0 }
    for (const s of slots) {
      const st = s[side]?.gameState
      if (st === 'live' || st === 'final' || st === 'upcoming') c[st] += 1
    }
    return c
  }
  return {
    league: { id: 'e2e-redraft-core', name: 'Sunday Night Redraft', platform: 'allfantasy', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 9, season: 2026, isFinal: state === 'final' } },
    teams: { available: true, data: { you, opponent: opp } },
    sides: scored
      ? { available: true, data: { you: { ...you, points: sum('you', 'actual') }, opponent: { ...opp, points: sum('opponent', 'actual') } } }
      : { available: false, reason: 'this week has not been scored yet' },
    lineups: { available: true, data: slots },
    identityNote: null,
    playerScoring: scored
      ? { available: true, data: { playersScored: slots.length * 2, source: 'AllFantasy' } }
      : { available: false, reason: 'these are projections — no starter has played yet' },
    /*
     * Provided in EVERY state, final included, on purpose: the redraft bug must drop it on a final
     * week by itself (af-core-redraft-matchup.css), and a fixture that withheld it would let that
     * gate pass untested.
     */
    winProbability: {
      available: true,
      data: { pWin: 0.64, projectedMargin: 8.4, confidence: 'medium', detail: 'projected margins under this league’s scoring' },
    },
    projectedFinal: {
      available: true,
      data: { you: sum('you', 'projected'), opponent: sum('opponent', 'projected'), unprojected: { you: 0, opponent: 0 } },
    },
    yetToPlay: { available: false, reason: 'counted from each starter’s game state' },
    starterCountsBySide: { you: counts('you'), opponent: counts('opponent') },
    weekNav: { prev: 8, next: 10 },
  }
}

/* ── Live scores ─────────────────────────────────────────────────────────────────────────────── */

type GameSpec = { away: [string, string]; home: [string, string]; state: FixtureState; score?: [number, number]; clock?: string; detail?: string; lines?: [number[], number[]] }

/** Per sport: two live games, one upcoming, two finals. Clock labels are the server's own shapes. */
const GAMES: Record<FixtureSport, GameSpec[]> = {
  NFL: [
    { away: ['KC', 'Kansas City'], home: ['DET', 'Detroit'], state: 'live', score: [17, 20], clock: 'Q3 · 8:42', lines: [[7, 10, 0], [3, 10, 7]] },
    { away: ['SF', 'San Francisco'], home: ['DAL', 'Dallas'], state: 'live', score: [24, 24], clock: 'Q4 · 2:05', lines: [[7, 7, 3, 7], [0, 14, 7, 3]] },
    { away: ['MIA', 'Miami'], home: ['BUF', 'Buffalo'], state: 'upcoming', detail: 'Sun, 8:20 PM EST' },
    { away: ['BAL', 'Baltimore'], home: ['CIN', 'Cincinnati'], state: 'final', score: [31, 27], detail: 'Final' },
    { away: ['LAR', 'Los Angeles'], home: ['MIN', 'Minnesota'], state: 'final', score: [20, 23], detail: 'Final/OT' },
  ],
  NCAAF: [
    { away: ['UGA', 'Georgia'], home: ['TEX', 'Texas'], state: 'live', score: [14, 10], clock: 'Q2 · 1:15', lines: [[7, 7], [3, 7]] },
    { away: ['OSU', 'Ohio State'], home: ['PSU', 'Penn State'], state: 'live', score: [21, 28], clock: 'Q3 · 11:02', lines: [[7, 14, 0], [14, 7, 7]] },
    { away: ['ORE', 'Oregon'], home: ['USC', 'USC'], state: 'upcoming', detail: 'Sat, 7:30 PM EST' },
    { away: ['LSU', 'LSU'], home: ['BAMA', 'Alabama'], state: 'final', score: [24, 31], detail: 'Final' },
    { away: ['ND', 'Notre Dame'], home: ['MICH', 'Michigan'], state: 'final', score: [27, 17], detail: 'Final' },
  ],
  NBA: [
    { away: ['BOS', 'Boston'], home: ['DEN', 'Denver'], state: 'live', score: [88, 91], clock: 'Q4 · 2:31', lines: [[24, 22, 25, 17], [26, 21, 27, 17]] },
    { away: ['LAL', 'LA Lakers'], home: ['NYK', 'New York'], state: 'live', score: [54, 49], clock: 'Q2 · 0:48', lines: [[28, 26], [24, 25]] },
    { away: ['MIA', 'Miami'], home: ['OKC', 'Oklahoma City'], state: 'upcoming', detail: 'Sun, 7:00 PM EST' },
    { away: ['PHX', 'Phoenix'], home: ['MIL', 'Milwaukee'], state: 'final', score: [112, 108], detail: 'Final' },
    { away: ['GSW', 'Golden State'], home: ['DAL', 'Dallas'], state: 'final', score: [121, 124], detail: 'Final/OT' },
  ],
  NCAAB: [
    { away: ['DUKE', 'Duke'], home: ['UNC', 'North Carolina'], state: 'live', score: [41, 38], clock: '2H · 8:12', lines: [[33, 8], [30, 8]] },
    { away: ['UK', 'Kentucky'], home: ['KU', 'Kansas'], state: 'live', score: [22, 25], clock: '1H · 4:40', lines: [[22], [25]] },
    { away: ['GONZ', 'Gonzaga'], home: ['UCONN', 'UConn'], state: 'upcoming', detail: 'Sat, 9:00 PM EST' },
    { away: ['HOU', 'Houston'], home: ['PUR', 'Purdue'], state: 'final', score: [68, 71], detail: 'Final' },
    { away: ['ARIZ', 'Arizona'], home: ['BAY', 'Baylor'], state: 'final', score: [80, 74], detail: 'Final' },
  ],
  NHL: [
    { away: ['TOR', 'Toronto'], home: ['EDM', 'Edmonton'], state: 'live', score: [2, 1], clock: 'P2 · 12:41', lines: [[1, 1], [0, 1]] },
    { away: ['COL', 'Colorado'], home: ['NYR', 'NY Rangers'], state: 'live', score: [3, 3], clock: 'P4 · 3:10', lines: [[1, 1, 1, 0], [2, 0, 1, 0]] },
    { away: ['FLA', 'Florida'], home: ['BOS', 'Boston'], state: 'upcoming', detail: 'Sun, 7:00 PM EST' },
    { away: ['VGK', 'Vegas'], home: ['DAL', 'Dallas'], state: 'final', score: [4, 2], detail: 'Final' },
    { away: ['CAR', 'Carolina'], home: ['NJ', 'New Jersey'], state: 'final', score: [2, 3], detail: 'Final/OT' },
  ],
  MLB: [
    { away: ['LAD', 'LA Dodgers'], home: ['NYY', 'NY Yankees'], state: 'live', score: [3, 2], clock: 'Bot 6th', lines: [[0, 1, 0, 2, 0, 0], [1, 0, 0, 0, 1]] },
    { away: ['ATL', 'Atlanta'], home: ['HOU', 'Houston'], state: 'live', score: [1, 4], clock: 'Top 3rd', lines: [[0, 1, 0], [3, 1]] },
    { away: ['PHI', 'Philadelphia'], home: ['SD', 'San Diego'], state: 'upcoming', detail: 'Sun, 4:10 PM EST' },
    { away: ['BAL', 'Baltimore'], home: ['SEA', 'Seattle'], state: 'final', score: [5, 3], detail: 'Final' },
    { away: ['TEX', 'Texas'], home: ['TOR', 'Toronto'], state: 'final', score: [6, 7], detail: 'Final/10' },
  ],
  SOCCER: [
    { away: ['ARS', 'Arsenal'], home: ['LIV', 'Liverpool'], state: 'live', score: [1, 1], clock: "2H · 67'", lines: [[1, 0], [0, 1]] },
    { away: ['MCI', 'Man City'], home: ['CHE', 'Chelsea'], state: 'live', score: [2, 0], clock: "1H · 38'", lines: [[2], [0]] },
    { away: ['TOT', 'Tottenham'], home: ['NEW', 'Newcastle'], state: 'upcoming', detail: 'Sun, 11:30 AM EST' },
    { away: ['AVL', 'Aston Villa'], home: ['BHA', 'Brighton'], state: 'final', score: [3, 1], detail: 'FT' },
    { away: ['MUN', 'Man United'], home: ['WHU', 'West Ham'], state: 'final', score: [0, 2], detail: 'FT' },
  ],
}

function game(sport: FixtureSport, i: number, g: GameSpec): LiveGameCard {
  const played = g.state !== 'upcoming'
  const side = ([abbrev, name]: [string, string], score: number | undefined, line: number[] | undefined, rec: string) => ({
    abbrev,
    name,
    logo: '',
    score: played ? score ?? 0 : null,
    record: rec,
    linescores: played ? line ?? [] : [],
    hits: null,
    errors: null,
    leaders: [],
    shooting: null,
  })
  const homeShare = g.state === 'live' && g.score ? Math.max(8, Math.min(92, Math.round(50 + (g.score[1] - g.score[0]) * (sport === 'NBA' ? 2 : sport === 'NHL' || sport === 'SOCCER' ? 14 : 3)))) : null
  return {
    gameId: `${sport}-${i}`,
    sport,
    week: sport === 'NFL' || sport === 'NCAAF' ? 9 : null,
    status: g.state === 'live' ? 'STATUS_IN_PROGRESS' : g.state === 'final' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED',
    statusDetail: g.state === 'live' ? g.clock ?? '' : g.detail ?? '',
    clockLabel: g.state === 'live' ? g.clock ?? null : g.state === 'final' ? 'FINAL' : null,
    isLive: g.state === 'live',
    completed: g.state === 'final',
    startTime: '2026-11-01T18:00:00.000Z',
    away: side(g.away, g.score?.[0], g.lines?.[0], '6-2'),
    home: side(g.home, g.score?.[1], g.lines?.[1], '5-3'),
    winProbability: homeShare == null ? null : { home: homeShare, away: 100 - homeShare, isEstimate: true },
    topPerformer: null,
    leaders: [],
    leadersArePregame: false,
    situation: null,
    venue: null,
    broadcast: i === 0 ? 'ESPN' : null,
    espnDetail: false,
    tieIns: [
      {
        leagueId: 'e2e-redraft-core',
        leagueName: 'Sunday Night Redraft',
        playerId: `${sport}-${i}-p`,
        playerName: LINEUPS[sport][i % LINEUPS[sport].length].you[0],
        position: LINEUPS[sport][i % LINEUPS[sport].length].pos,
        imageUrl: null,
        isStarter: true,
        points: played ? r1(ACTUAL[i % 8] * SCALE[sport]) : null,
        projected: played ? null : r1(PROJ[i % 8] * SCALE[sport]),
      },
    ],
    leaguesAffected: 1,
  }
}

export function livePageFixture(sport: FixtureSport): LivePageData {
  const games = GAMES[sport].map((g, i) => game(sport, i, g))
  return {
    sport,
    scope: 'my',
    counts: (['NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB', 'SOCCER'] as const).map((s) => ({ sport: s, label: s === 'SOCCER' ? 'Soccer' : s, slateCount: 5 })),
    games,
    impact: { totalPoints: 0, livePlayers: 2, upcomingPlayers: 1, finishedPlayers: 2, liveLeagues: 1, liveGames: 2, biggestMover: null, plays: [], upNext: [] },
    lockAlerts: [],
    fetchedAt: null,
    hasRosterData: true,
    loadFailed: false,
    rosterFailed: false,
    top25: null,
  }
}

export const FIXTURE_SPORTS: FixtureSport[] = ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB', 'SOCCER']
