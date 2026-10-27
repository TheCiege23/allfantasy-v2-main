import { computeSeasonRecap, type SeasonRecapInput } from '@/lib/season-recap/computeSeasonRecap'

/** A small finished season: three teams, a few games, one pickup. */
export function recapInput(overrides: Partial<SeasonRecapInput> = {}): SeasonRecapInput {
  return {
    leagueId: 'l1',
    season: 2026,
    sport: 'NFL',
    playoffStartWeek: 15,
    teams: [
      { rosterId: 'a', name: 'Aces', ownerId: 'ua', wins: 10, losses: 4, ties: 0, pointsFor: 1500.44, pointsAgainst: 1300, playoffSeed: 1 },
      { rosterId: 'b', name: 'Bears', ownerId: 'ub', wins: 8, losses: 6, ties: 0, pointsFor: 1400, pointsAgainst: 1350, playoffSeed: 2 },
      { rosterId: 'c', name: 'Gridiron 99', ownerId: 'uc', wins: 3, losses: 11, ties: 0, pointsFor: 1100, pointsAgainst: 1600, playoffSeed: 3 },
    ],
    regularGames: [
      { week: 1, homeRosterId: 'a', awayRosterId: 'b', homeScore: 110, awayScore: 100 },
      { week: 2, homeRosterId: 'a', awayRosterId: 'c', homeScore: 150.2, awayScore: 80 },
      { week: 3, homeRosterId: 'b', awayRosterId: 'c', homeScore: 101, awayScore: 100.5 },
    ],
    championRosterId: 'a',
    runnerUpRosterId: 'b',
    lowerBracketFinal: null,
    trades: [],
    pickups: [{ rosterId: 'b', playerId: 'p1', playerName: 'Joe Burrow', position: 'QB', pickupWeek: 3, pointsAfter: 150.44, weeksCounted: 10 }],
    priorSeasonByOwnerId: null,
    computedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export const sampleRecap = (overrides: Partial<SeasonRecapInput> = {}) => computeSeasonRecap(recapInput(overrides))
