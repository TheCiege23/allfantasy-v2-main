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

