/**
 * SAMPLE DATA for /e2e/league-phase-a only — also served by the capture script's route mocks so the
 * Team banner (which fetches the matchup-center payload) renders the same matchup.
 */
const starter = (playerId: string, position: string, gameStatus: 'final' | 'upcoming', af: number | null) => ({
  playerId, name: playerId, position, team: null, opponent: null, headshotUrl: null, currentPoints: 0, projectedPoints: 10,
  hasRealProjection: true, afProjectedPoints: af, injuryStatus: null, newsBlurb: null, weatherSummary: null,
  gameStatus, gameLabel: 'Scheduled', aiInsight: null,
})

export const SAMPLE_MATCHUP = {
  leagueId: 'harness-league',
  season: 2026,
  week: 11,
  sport: 'NFL',
  matchupStatus: 'live',
  conceptOverlay: null,
  winProbabilityLeft: 0.58,
  partialData: false,
  refreshIntervalMs: 60000,
  insights: { matchupEdge: '', startSit: '', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' },
  left: {
    rosterId: 'r1', teamName: '(F) SF IDP', avatarUrl: null, record: { wins: 5, losses: 5, ties: 0 }, winPct: 0.5,
    totalPoints: 188.8, projectedTotal: 146.69, projectedTotalIncludesFallback: false, afProjectedTotal: 138.2, afProjectedFrom: 4,
    remainingStarters: 3,
    starters: [starter('a', 'QB', 'upcoming', 30), starter('b', 'RB', 'upcoming', 40), starter('c', 'RB', 'final', 30), starter('d', 'WR', 'upcoming', 38.2)],
  },
  right: {
    rosterId: 'r2', teamName: 'Team Captainameri', avatarUrl: null, record: { wins: 8, losses: 2, ties: 0 }, winPct: 0.8,
    totalPoints: 203.06, projectedTotal: 140.45, projectedTotalIncludesFallback: false, afProjectedTotal: 151.9, afProjectedFrom: 4,
    remainingStarters: 1,
    starters: [starter('e', 'QB', 'final', 40), starter('f', 'RB', 'final', 40), starter('g', 'WR', 'upcoming', 40), starter('h', 'TE', 'final', 31.9)],
  },
}

export const SAMPLE_TRADES_PANEL = {
  tradeBlock: [
    { id: 't1', playerId: '4017', name: 'Justin Herbert', position: 'QB', team: 'LAC', ownerName: 'jcoffey1257' },
    { id: 't2', playerId: '7564', name: 'Christian Watson', position: 'WR', team: 'GB', ownerName: 'erosado0826' },
    { id: 't3', playerId: '6794', name: 'Khalil Shakir', position: 'WR', team: 'BUF', ownerName: 'erosado0826' },
    { id: 't4', playerId: '5045', name: 'Courtland Sutton', position: 'WR', team: 'DEN', ownerName: 'erosado0826' },
    { id: 't5', playerId: '7090', name: "Wan'Dale Robinson", position: 'WR', team: 'TEN', ownerName: 'erosado0826' },
    { id: 't6', playerId: '1234', name: 'Jalen Ramsey', position: 'CB', team: 'PIT', ownerName: 'jcoffey1257' },
    { id: 't7', playerId: '5678', name: 'Minkah Fitzpatrick', position: 'DB', team: 'NYJ', ownerName: 'MercSauce' },
  ],
  tradeBlockNote: null,
  tradeBlockReadable: true,
}

const ref = (ownerId: string, name: string) => ({ ownerId, name, avatar: null, teamName: null })
const season = (year: string, status: string, champ: ReturnType<typeof ref> | null) => ({
  season: year, sleeperLeagueId: `sl-${year}`, name: 'Defense IDP For Life', status, champion: champ, runnerUp: null,
  topScorer: null, standings: [], draft: null, missing: [],
})

export const SAMPLE_HISTORY = {
  supported: true,
  viewerSleeperUserId: 'me',
  history: {
    version: 1, sleeperLeagueId: 'sl-2026', fetchedAt: '2026-11-17T00:00:00Z', staleAsOf: null, deepSync: false,
    seasons: [
      season('2026', 'in_season', null),
      season('2025', 'complete', ref('u4', 'RobbyS5')),
      season('2024', 'complete', ref('u3', 'jaydezz')),
      season('2023', 'complete', ref('u2', 'BricktopBill')),
      season('2022', 'complete', ref('u1', 'youngmantwist')),
    ],
    allTime: [
      { ...ref('u2', 'BricktopBill'), wins: 42, losses: 23, ties: 0, pointsFor: 10735.32, titles: 1, seasons: 4 },
      { ...ref('me', 'TheCiege24'), wins: 30, losses: 35, ties: 0, pointsFor: 9999.46, titles: 0, seasons: 4 },
    ],
  },
}

const mp = (id: string, name: string, position: string, team: string, to: string | null = null) => ({ id, name, position, team, imageUrl: null, to })
const daysAgo = (d: number, h = 0) => new Date(Date.now() - d * 86_400_000 - h * 3_600_000).toISOString()

export const SAMPLE_MOVES = {
  moves: [
    { id: 'm1', kind: 'waiver', occurredAt: daysAgo(1, 3), teamName: 'TDIsland', managerName: 'TDIsland', avatarUrl: null, involvedTeams: ['TDIsland'],
      adds: [mp('9001', 'Nick Herbig', 'LB', 'PIT')], drops: [mp('9002', 'Stetson Bennett IV', 'QB', 'LAR')], bid: 12, picks: [] },
    { id: 'm2', kind: 'trade', occurredAt: daysAgo(2, 1), teamName: 'jcoffey1257', managerName: 'jcoffey1257', avatarUrl: null, involvedTeams: ['jcoffey1257', 'erosado0826'],
      adds: [mp('7564', 'Christian Watson', 'WR', 'GB', 'jcoffey1257'), mp('4984', 'Baker Mayfield', 'QB', 'TB', 'erosado0826')], drops: [], bid: null, picks: ['2027 2nd (erosado0826)'] },
    { id: 'm3', kind: 'roster_move', occurredAt: daysAgo(2, 6), teamName: 'Hoovi', managerName: 'Hoovi', avatarUrl: null, involvedTeams: ['Hoovi'],
      adds: [], drops: [mp('9003', 'Theo Johnson', 'TE', 'NYG')], bid: null, picks: [] },
    { id: 'm4', kind: 'waiver', occurredAt: daysAgo(9), teamName: 'RobbyS5', managerName: 'RobbyS5', avatarUrl: null, involvedTeams: ['RobbyS5'],
      adds: [mp('9004', 'Brevyn Spann-Ford', 'TE', 'DAL')], drops: [mp('9005', 'Boye Mafe', 'DL', 'CIN')], bid: 3, picks: [] },
  ],
}

export const SAMPLE_PLAYER_MAP = {
  '9101': { id: '9101', name: 'Kimani Vidal', position: 'RB', team: 'LAC' },
  '9102': { id: '9102', name: 'Sauce Gardner', position: 'DB', team: 'IND' },
}

export const SAMPLE_ROSTER = { roster: { players: ['9101', '9102'] } }

export const SAMPLE_NEWS = {
  items: [
    { id: 'n1', title: 'Kimani Vidal tallies two catches against Baltimore', source: 'RotoWire', url: null, playerName: 'Kimani Vidal', imageUrl: null, publishedAt: daysAgo(0, 2),
      body: "Vidal turned two carries into zero yards and caught both of his targets for 14 yards in the Chargers' 23-20 win over the Ravens on Monday." },
    { id: 'n2', title: 'Sauce Gardner (calf) misses practice Tuesday', source: 'FantasyPros', url: null, playerName: 'Sauce Gardner', imageUrl: null, publishedAt: daysAgo(0, 5),
      body: 'Gardner did not practice on Tuesday. His status is uncertain for Thursday’s game against the Texans.' },
  ],
}

/** Phase B: the future-picks view and the standings it joins to (SAMPLE DATA). */
const pk = (season: number, round: number, fromTeam: string | null = null) => ({ season, round, label: ['1st', '2nd', '3rd', '4th'][round - 1], fromTeam })
export const SAMPLE_FUTURE_PICKS = {
  board: {
    seasons: [2027, 2028, 2029],
    rounds: 4,
    coverage: 'complete',
    teams: [
      { rosterId: 'r-me', name: '(F) SF IDP', isViewer: true, total: 13, firsts: 4,
        bySeason: { 2027: [pk(2027, 1), pk(2027, 1, 'Hoovi'), pk(2027, 2), pk(2027, 4)], 2028: [pk(2028, 1), pk(2028, 2), pk(2028, 2, 'jaydezz'), pk(2028, 3), pk(2028, 4)], 2029: [pk(2029, 1), pk(2029, 2), pk(2029, 3), pk(2029, 4)] },
        tradedAwayBySeason: { 2027: [{ round: 3, label: '3rd', toTeam: 'RobbyS5' }] } },
      { rosterId: 'r-hoovi', name: 'Hoovi', isViewer: false, total: 11, firsts: 2, bySeason: {}, tradedAwayBySeason: {} },
      { rosterId: 'r-anth', name: 'Anthonyfkern1223', isViewer: false, total: 12, firsts: 3, bySeason: {}, tradedAwayBySeason: {} },
      { rosterId: 'r-baby', name: 'babytezz', isViewer: false, total: 12, firsts: 3, bySeason: {}, tradedAwayBySeason: {} },
    ],
  },
  ids: [
    { rosterId: 'r-me', teamId: 't-me', name: '(F) SF IDP', isViewer: true },
    { rosterId: 'r-hoovi', teamId: 't-hoovi', name: 'Hoovi', isViewer: false },
    { rosterId: 'r-anth', teamId: 't-anth', name: 'Anthonyfkern1223', isViewer: false },
    { rosterId: 'r-baby', teamId: 't-baby', name: 'babytezz', isViewer: false },
  ],
  projection: {
    draftSeason: 2027, phase: 'regular_season', teamCount: 4, warnings: ['Max PF is computed live and is not frozen yet; stat corrections can still move it.'],
    slots: {
      't-baby': { slot: 1, status: 'provisional', group: 'non_playoff', reason: 'Worst record among non-playoff teams (3-7).' },
      't-hoovi': { slot: 2, status: 'provisional', group: 'non_playoff', reason: '2nd-worst record among non-playoff teams (4-6).' },
      't-me': { slot: 3, status: 'provisional', group: 'non_playoff', reason: 'Outside the playoff line at 5-5; ordered by Max PF among non-playoff teams.' },
      't-anth': { slot: 4, status: 'provisional', group: 'playoff', reason: 'Playoff seed 1: picks after every non-playoff team.' },
    },
  },
}

export const SAMPLE_STANDINGS = {
  season: 2026, scoringMode: 'points', viewerRosterId: 't-me', source: 'imported', sourcePlatform: 'Sleeper', scoredWeeks: null,
  standings: [
    { rosterId: 't-anth', teamName: 'Anthonyfkern1223', wins: 8, losses: 2, ties: 0, pointsFor: 1792.28, pointsAgainst: 1547.92, rank: 1 },
    { rosterId: 't-me', teamName: '(F) SF IDP', wins: 5, losses: 5, ties: 0, pointsFor: 1676.24, pointsAgainst: 1435.94, rank: 7 },
    { rosterId: 't-hoovi', teamName: 'Hoovi', wins: 4, losses: 6, ties: 0, pointsFor: 1583.62, pointsAgainst: 1535.96, rank: 11 },
    { rosterId: 't-baby', teamName: 'babytezz', wins: 3, losses: 7, ties: 0, pointsFor: 1175.82, pointsAgainst: 1447.88, rank: 13 },
  ],
}
