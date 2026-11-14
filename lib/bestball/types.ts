export type LineupSlotDef = {
  slot: string
  eligible: string[]
  count: number
  required?: boolean
  min?: number
  max?: number
}

export type OptimizerPlayer = {
  playerId: string
  playerName: string
  position: string
  points: number
}

export type SlotAssignment = {
  slot: string
  player: OptimizerPlayer
}

export type OptimizerResult = {
  assignments: SlotAssignment[]
  totalPoints: number
  alternateExists: boolean
  alternateLineup: unknown | null
  optimizerLog: Record<string, unknown>
}

