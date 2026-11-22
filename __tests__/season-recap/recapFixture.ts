import { computeSeasonRecap, type SeasonRecap, type SeasonRecapInput } from '@/lib/season-recap/computeSeasonRecap'

/**
 * One finished season with every award present. Every id is distinct — roster ids, owner ids, the
 * league, trade and player ids — so a test that reads the wrong one cannot pass by coincidence.
 */
const team = (rosterId: string, name: string, ownerId: string, wins: number, losses: number, pointsFor: number, playoffSeed: number | null) => ({
  rosterId, name, ownerId, wins, losses, ties: 0, pointsFor, pointsAgainst: 0, playoffSeed,
})

export const RECAP_LEAGUE_ID = 'lg-recap-7f3'
export const RECAP_SEASON = 2026

export function recapInput(over: Partial<SeasonRecapInput> = {}): SeasonRecapInput {
  return {
    leagueId: RECAP_LEAGUE_ID,
    season: RECAP_SEASON,
    sport: 'NFL',
    playoffStartWeek: 5,
    teams: [
      team('ros-aces-11', 'Aces', 'own-aces-21', 3, 1, 480.4, 1),
      team('ros-bears-12', 'Bears', 'own-bears-22', 2, 2, 470.2, 2),
      team('ros-cats-13', 'Cats', 'own-cats-23', 2, 2, 430.6, null),
      team('ros-dogs-14', 'Dogs', 'own-dogs-24', 1, 3, 400.8, null),
    ],
    regularGames: [
      { week: 1, homeRosterId: 'ros-aces-11', awayRosterId: 'ros-bears-12', homeScore: 120.2, awayScore: 119.7 },
      { week: 1, homeRosterId: 'ros-cats-13', awayRosterId: 'ros-dogs-14', homeScore: 100.1, awayScore: 90.4 },
      { week: 2, homeRosterId: 'ros-aces-11', awayRosterId: 'ros-cats-13', homeScore: 150.3, awayScore: 80.1 },
      { week: 2, homeRosterId: 'ros-bears-12', awayRosterId: 'ros-dogs-14', homeScore: 110.5, awayScore: 100.2 },
      { week: 3, homeRosterId: 'ros-aces-11', awayRosterId: 'ros-dogs-14', homeScore: 100.4, awayScore: 110.9 },
      { week: 3, homeRosterId: 'ros-bears-12', awayRosterId: 'ros-cats-13', homeScore: 120.6, awayScore: 125.3 },
    ],
    championRosterId: 'ros-bears-12',
    runnerUpRosterId: 'ros-aces-11',
    playoffRosterIds: ['ros-aces-11', 'ros-bears-12'],
    lowerBracketFinal: { mode: 'toilet_bowl', winnerRosterId: 'ros-cats-13', loserRosterId: 'ros-dogs-14' },
    trades: [
      { tradeId: 'trd-31', executedAt: null, sides: [{ rosterId: 'ros-aces-11', valueIn: 900, valueOut: 600 }, { rosterId: 'ros-cats-13', valueIn: 600, valueOut: 900 }] },
    ],
    pickups: [{ rosterId: 'ros-bears-12', playerId: 'ply-41', playerName: 'Jordan Reed', position: 'RB', pickupWeek: 1, pointsAfter: 64.2, weeksCounted: 3 }],
    priorSeasonByOwnerId: { 'own-aces-21': { wins: 1, losses: 3, ties: 0 } },
    computedAt: '2027-01-10T00:00:00.000Z',
    ...over,
  }
}

export function recapFixture(over: Partial<SeasonRecapInput> = {}): SeasonRecap {
  return computeSeasonRecap(recapInput(over))
}
