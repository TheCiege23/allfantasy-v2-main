import type { SupportedSport } from '@/lib/sport-scope'

/** Optimizer templates may extend beyond Prisma `LeagueSport` (e.g. Golf, NASCAR). */
export type LineupOptimizerSportKey = SupportedSport | 'GOLF' | 'NASCAR'

export interface OptimizerPlayerInput {
  id?: string
  name: string
  positions: string[]
  projectedPoints: number
  team?: string
}

export interface OptimizerSlotInput {
  id?: string
  code: string
  label?: string
  allowedPositions?: string[]
  required?: boolean
}

export interface LineupOptimizerInput {
  sport?: SupportedSport | string
  players: OptimizerPlayerInput[]
  slots?: OptimizerSlotInput[]
}

interface OptimizedStarter {
  slotId: string
  slotCode: string
  slotLabel: string
  playerId: string
  playerName: string
  playerTeam?: string
  projectedPoints: number
  selectedPosition: string
}

export interface LineupOptimizerResult {
  sport: LineupOptimizerSportKey
  totalProjectedPoints: number
  starters: OptimizedStarter[]
  bench: Array<{
    playerId: string
    playerName: string
    projectedPoints: number
    positions: string[]
  }>
  unfilledSlots: Array<{
    slotId: string
    slotCode: string
    slotLabel: string
  }>
  deterministicNotes: string[]
}
