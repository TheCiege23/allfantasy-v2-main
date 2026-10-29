export type GuillotinePlayerValue = {
  guillotineValue: number
  normalFantasyValue: number
  floorScore: number
  ceilingScore: number
  consistencyRating: string
  survivalRating: 'Anchor' | 'Reliable' | 'Risky' | 'Avoid'
  volatilityFlag: boolean
  valueJustification: string
}

export async function getGuillotinePlayerValue(
  _playerId: string,
  _sport: string,
  _teamsActive: number,
  _scoringPeriod: number,
): Promise<GuillotinePlayerValue> {
  return {
    guillotineValue: 72,
    normalFantasyValue: 68,
    floorScore: 8,
    ceilingScore: 22,
    consistencyRating: 'B',
    survivalRating: 'Reliable',
    volatilityFlag: false,
    valueJustification: 'Guilly value emphasizes floor and health — full model pending.',
  }
}
