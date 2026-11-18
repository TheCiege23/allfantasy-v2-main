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
