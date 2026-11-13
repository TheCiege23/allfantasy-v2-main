export type SportCode = 'NFL' | 'NBA' | 'MLB' | string

interface PlayerHistoryPoint {
  season: number
  age: number | null
  gamesPlayed: number | null
  fantasyPoints: number | null
}

export interface PlayerAgingInputs {
  sport: SportCode
  playerId: string
  name: string
  position: string
  age: number | null
  draftPick: number | null
  injuryIndex: number | null
  history: PlayerHistoryPoint[]
}

export interface PlayerCareerProjection {
  playerId: string
  sport: SportCode
  projectedPointsYear1: number
  projectedPointsYear2: number
  projectedPointsYear3: number
  projectedPointsYear4: number
  projectedPointsYear5: number
  breakoutProbability: number
  declineProbability: number
  volatilityScore: number
}

