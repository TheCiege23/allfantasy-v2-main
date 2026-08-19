/**
 * Decision OS three-brain / four-provider standalone analysis service (Phase 1 + 1.5).
 * DeepSeek (analyst) ∥ Grok (trend) → OpenAI synthesis → Claude selective review / fallback synthesis →
 * validated + server-bounded result. Not wired into any live Decision OS route, persistence, or token flow
 * yet (see later phases). ClaudeReviewPolicy is surfaced from ./eligibility (its single source).
 */
export * from './types'
export * from './schemas'
export * from './evidencePacket'
export * from './prompts'
export * from './validate'
export * from './confidence'
export * from './eligibility'
export * from './claudeReview'
export * from './anthropicClient'
export * from './orchestrator'
