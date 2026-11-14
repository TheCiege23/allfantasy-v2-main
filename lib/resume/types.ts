/**
 * Phase 6B — Fantasy Resume Domain Model (foundation)
 *
 * Sport-agnostic, provider-agnostic identity layer that sits on top of the
 * existing `lib/ranking` primitives (`AFUserRating`, `RankingSnapshot`,
 * `LeagueDifficultyRating`, historical-analysis dimensions).
 *
 * Hard rules for this phase:
 *   - Types only. No DB migrations, no I/O, no UI.
 *   - All fields nullable or carry an explicit `verified` flag so unknown
 *     data degrades to "unverified" rather than fabricated zeros.
 *   - Sport union mirrors `RankingSport` exactly.
 *   - Visibility is defined as a contract here so every renderer/consumer
 *     downstream filters through the same gate.
 */

import type { RankingSport } from "@/lib/ranking/types"

/* -------------------------------------------------------------------------- */
/* 1. Visibility                                                              */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* 2. Verification + credibility                                              */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* 3. Core resume records                                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* 4. Aggregate AF Resume                                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* 5. Snapshot cards (consumer contracts)                                     */
/* -------------------------------------------------------------------------- */

export interface ResumeMatchmakingProfile {
  userId: string
  preferredSports: RankingSport[]
  preferredFormats: string[]
  preferredDifficultyBand: [number, number]
  activityScore: number
  reliabilityScore: number
  socialAffinity: number
  competitivenessIndex: number
}
