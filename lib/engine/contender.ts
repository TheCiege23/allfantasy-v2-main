import type { TeamPhase } from './types'

export interface ContenderClassification {
  phase: TeamPhase
  score: number
  confidence: number
  signals: string[]
}

