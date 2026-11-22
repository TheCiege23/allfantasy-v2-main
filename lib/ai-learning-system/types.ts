/**
 * AllFantasy 3-level AI learning — deterministic aggregates only (not LLM training).
 * Learned outputs are explainable, timestamped, and recomputable from `AfLearningEvent`.
 */

export type AfLearningSnapshotRow = {
  features: unknown
  explain: unknown | null
  confidence: number
  sampleSize: number
  windowDays: number
  updatedAt: Date
  computedAt: Date
}

/** Injected into `AllFantasyStandardAiPayload.learningLayers`. */
export type AllFantasyLearningLayersPayload = {
  schemaVersion: 1
  sport: string
  leagueId: string | null
  userId: string
  /** Platform intelligence for the active sport. */
  appLearningState: {
    loaded: boolean
    snapshot: AfLearningSnapshotRow | null
  }
  /** League economy / activity (null when not in a league context). */
  leagueLearningState: {
    loaded: boolean
    leagueId: string | null
    snapshot: AfLearningSnapshotRow | null
  }
  /** User tendencies (soft personalization). */
  userLearningState: {
    loaded: boolean
    snapshot: AfLearningSnapshotRow | null
  }
  /**
   * Short prompt-safe reminder: learned layers adjust tone/priorities only;
   * injuries, locks, eligibility, and scoring rules always win.
   */
  safetyReminder: string
}
