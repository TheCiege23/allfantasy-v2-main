/**
 * Waiver Recommendation Types & Scoring Model
 *
 * Unified JSON schema for the upgraded waiver AI output.
 * Includes the WaiverFitScore composite formula and classification system.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Recommendation Type Classification
// ---------------------------------------------------------------------------

const RecommendationTypeEnum = z.enum([
  'Immediate Starter',
  'Short-Term Streamer',
  'Injury Fill-In',
  'High-Upside Stash',
  'Dynasty Stash',
  'Bye Week Cover',
  'Handcuff Protection',
  'Playoff Stash',
  'Schedule-Based Pickup',
  'Speculative Add',
])

export type RecommendationType = z.infer<typeof RecommendationTypeEnum>

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

const TimingRecommendationEnum = z.enum([
  'Add now',
  'Bid tonight',
  'Wait and monitor',
  'Injury contingency add',
])

// ---------------------------------------------------------------------------
// Drop Confidence
// ---------------------------------------------------------------------------

const DropConfidenceEnum = z.enum(['safe', 'medium', 'risky'])

// ---------------------------------------------------------------------------
// Factual Evidence
// ---------------------------------------------------------------------------

const FactualEvidenceSchema = z.object({
  source: z.enum(['league', 'roster', 'news', 'model', 'waiver_pool', 'schedule']),
  metric: z.string(),
  value: z.string(),
})

export type FactualEvidence = z.infer<typeof FactualEvidenceSchema>

// ---------------------------------------------------------------------------
// Suggestion Schema
// ---------------------------------------------------------------------------

const WaiverSuggestionV2Schema = z.object({
  playerName: z.string(),
  position: z.string(),
  team: z.string().nullable(),
  recommendationType: RecommendationTypeEnum,
  rank: z.number().int().min(1),
  waiverFitScore: z.number().min(0).max(100),
  needFitScore: z.number().min(0).max(100),
  leagueFitScore: z.number().min(0).max(100),
  opportunityScore: z.number().min(0).max(100),
  shortTermProjection: z.number().min(0).max(100),
  longTermUpside: z.number().min(0).max(100),
  rosterUpgradeDelta: z.number().min(0).max(100),
  newsUrgency: z.number().min(0).max(100),
  faabBidRecommendation: z.number().min(0),
  faabBidConservative: z.number().min(0).optional(),
  faabBidAggressive: z.number().min(0).optional(),
  faabBidConfidence: z.enum(['high', 'medium', 'low']).optional(),
  faabBidRationale: z.string().optional(),
  claimPriorityRecommendation: z.number().nullable(),
  dropCandidate: z.string().nullable(),
  dropConfidence: DropConfidenceEnum.nullable(),
  dropReason: z.string().nullable().optional(),
  reason: z.array(z.string()).min(1),
  timingRecommendation: TimingRecommendationEnum,
  urgencyScore: z.number().min(0).max(100),
  factualEvidence: z.array(FactualEvidenceSchema),
  /** Why this fits YOUR team specifically */
  teamFitExplanation: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Team Diagnosis
// ---------------------------------------------------------------------------

const TeamDiagnosisSchema = z.object({
  teamDirection: z.string(),
  biggestNeeds: z.array(z.string()),
  benchProblems: z.array(z.string()),
  riskSummary: z.array(z.string()),
})

// ---------------------------------------------------------------------------
// Strategy Notes
// ---------------------------------------------------------------------------

const StrategyNotesV2Schema = z.object({
  faabPlan: z.string(),
  claimApproach: z.string(),
  stashVsPointsGuidance: z.string(),
})

// ---------------------------------------------------------------------------
// Callouts
// ---------------------------------------------------------------------------

const CalloutsSchema = z.object({
  bestAddForPoints: z.string().nullable(),
  bestAddForUpside: z.string().nullable(),
  safestAdd: z.string().nullable(),
  mostAggressiveAdd: z.string().nullable(),
  bestDeepLeagueAdd: z.string().nullable(),
  bestDynastyStash: z.string().nullable(),
  bestDropCandidate: z.string().nullable(),
  holdFAABRecommendation: z.boolean(),
})

export type Callouts = z.infer<typeof CalloutsSchema>

// ---------------------------------------------------------------------------
// Full Response Schema
// ---------------------------------------------------------------------------

export const WaiverResponseV2Schema = z.object({
  suggestions: z.array(WaiverSuggestionV2Schema).max(8),
  teamDiagnosis: TeamDiagnosisSchema,
  rosterAlerts: z.array(z.string()),
  strategyNotes: StrategyNotesV2Schema,
  callouts: CalloutsSchema,
})

// ---------------------------------------------------------------------------
// WaiverFitScore Composite Formula
// ---------------------------------------------------------------------------

export interface WaiverFitScoreInput {
  needFit: number         // 0-100
  leagueFit: number       // 0-100
  opportunityScore: number // 0-100
  shortTermProjection: number // 0-100
  longTermUpside: number  // 0-100
  rosterUpgradeDelta: number // 0-100
  newsUrgency: number     // 0-100
}

// ---------------------------------------------------------------------------
// Recommendation Type Classification Logic
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Urgency Score
// ---------------------------------------------------------------------------

