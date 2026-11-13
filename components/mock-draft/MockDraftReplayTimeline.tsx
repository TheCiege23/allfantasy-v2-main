'use client'

type ReplayPick = {
  overall: number
  round: number
  pick: number
  slot: number
  manager: string
  playerName: string
  position: string
  team?: string | null
  playerId?: string | null
  byeWeek?: number | null
  injuryStatus?: string | null
  source?: string
}

