import type { UserLineupPreferenceProfileInput } from '@/lib/lineup-decision-engine/types'

export type LineupPreferenceEventKind =
  | 'ai_lineup_accepted'
  | 'ai_lineup_rejected'
  | 'bench_promoted'
  | 'auto_sub_allowed'
  | 'auto_sub_denied'
  | 'injury_contingency_respected'
  | 'injury_contingency_overridden'
  | 'lineup_outcome_feedback'

export interface LineupPreferenceExample {
  summary: string
  at: string
  kind?: string
}

export interface TraitStoredState {
  traitId: string
  confidence: number
  sampleSize: number
  lastReinforcedAt: Date | null
  examples: LineupPreferenceExample[]
  metadata: Record<string, unknown> | null
}

export interface UserLineupPreferenceProfile {
  userId: string
  traits: TraitStoredState[]
  /** Rolling rates from recent events (not persisted as traits). */
  stats: {
    autoSubAllowRate: number
    injuryContingencyOverrideRate: number
    eventsSampleSize: number
  }
  /** Ready for `POST /api/lineup/optimize` / premium engine */
  optimizerProfileInput: UserLineupPreferenceProfileInput
  /** Human-readable for UI */
  traitSummary: Record<string, { confidence: number; sampleSize: number; lastReinforcedAt: string | null }>
}

