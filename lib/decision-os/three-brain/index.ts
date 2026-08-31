/**
 * Decision OS three-brain / four-provider standalone analysis service (Phase 1 + 1.5).
 * DeepSeek (analyst) ∥ Grok (trend) → OpenAI synthesis → Claude selective review / fallback synthesis →
 * validated + server-bounded result. ClaudeReviewPolicy is surfaced from ./eligibility (its single source).
 *
 * 🛑 THERE ARE TWO STACKS IN THIS DIRECTORY AND ONLY ONE OF THEM IS LIVE. This header used to say
 * "Not wired into any live Decision OS route, persistence, or token flow yet", which was true of
 * the sentence's own subject and false of the directory. During the 2026-08-31 hub review a reader
 * trusted it over a grep and reported the whole stack as dead. Measured that day:
 *
 *   PHASE 1 / 1.5 — the four-provider orchestrator described above. `runThreeBrainAnalysis` has
 *       ZERO callers outside this directory and its tests. Genuinely standalone. The old sentence
 *       was about THIS.
 *
 *   PHASE 2 / 3 / 4 — live in six runtime paths, and it does NOT go through the orchestrator:
 *       `generateLeagueIntelligence` (phase3) calls `runManagedIntelligence` (phase2) directly.
 *         phase2 → app/api/cron/decision-os-intelligence-maintenance/route.ts
 *         phase3 → app/api/decision-os/manager-intelligence/route.ts
 *         phase4 → app/api/waiver-ai/engine/route.ts
 *                  app/api/today/lineup-actions/route.ts
 *                  app/api/redraft/trade-proposals/route.ts
 *                  lib/commissioner-hub/commissionerHubHealth.ts
 *
 * So "three-brain is unwired" and "three-brain is live" are both true of different halves, and any
 * claim about this directory must name which. ⚠ Both halves are additionally gated by
 * `AI_FEATURES_ENABLED`, which is off unless explicitly set to the string 'true'
 * (`lib/ai/aiSpendGuard.ts`) — so "imported by a route" is not the same as "running in an
 * environment", and neither is evidence for the other.
 *
 * Whatever gets wired next, invariant P3 holds: AI may summarize, explain, prioritize or communicate
 * a deterministic decision. It may NEVER generate, replace or fabricate a fact the Decision OS uses.
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
