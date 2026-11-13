/**
 * Franchise Roadmap Types & Zod Schemas
 *
 * Defines the complete contract for 3-5 year franchise planning
 * across Dynasty, Devy, and C2C modes.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const RoadmapModeEnum = z.enum(['dynasty', 'devy', 'c2c'])
export type RoadmapMode = z.infer<typeof RoadmapModeEnum>

export const FranchisePhaseEnum = z.enum([
  'contending',
  'retooling',
  'rebuilding',
  'emerging',
  'aging_contender',
  'prospect_heavy',
  'misaligned',
])
export type FranchisePhase = z.infer<typeof FranchisePhaseEnum>

export const UserGoalEnum = z.enum([
  'win_now',
  'sustainable_contender',
  'fast_rebuild',
  'value_accumulation',
  'youth_movement',
  'devy_pipeline_build',
  'c2c_dual_window_balance',
])
export type UserGoal = z.infer<typeof UserGoalEnum>

export const WindowStrengthEnum = z.enum(['weak', 'moderate', 'strong'])
export type WindowStrength = z.infer<typeof WindowStrengthEnum>

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface RoadmapPlayer {
  name: string
  position: string
  age: number | null
  value: number
  slot: 'starter' | 'bench' | 'ir' | 'taxi' | 'devy'
  team: string | null
}

export const FranchiseRoadmapInputSchema = z.object({
  mode: RoadmapModeEnum,
  sport: z.string().default('NFL'),
  leagueFormat: z.string().default('dynasty'),
  scoringFormat: z.string().default('PPR'),
  lineupRequirements: z.record(z.string(), z.number()).optional(),
  horizonYears: z.number().int().min(1).max(5).default(3),
  teamRoster: z.array(z.object({
    name: z.string(),
    position: z.string(),
    age: z.number().nullable(),
    value: z.number(),
    slot: z.enum(['starter', 'bench', 'ir', 'taxi', 'devy']),
    team: z.string().nullable(),
  })),
  draftPicks: z.array(z.object({
    season: z.number(),
    round: z.number(),
    projected: z.enum(['early', 'mid', 'late', 'unknown']).default('unknown'),
  })).optional().default([]),
  devyAssets: z.array(z.object({
    name: z.string(),
    position: z.string(),
    age: z.number().nullable(),
    value: z.number(),
    classYear: z.number().optional(),
    nflDraftEligibleYear: z.number().optional(),
  })).optional().default([]),
  c2cCollegeRoster: z.array(z.object({
    name: z.string(),
    position: z.string(),
    age: z.number().nullable(),
    value: z.number(),
  })).optional().default([]),
  c2cProRoster: z.array(z.object({
    name: z.string(),
    position: z.string(),
    age: z.number().nullable(),
    value: z.number(),
  })).optional().default([]),
  leagueSettings: z.object({
    numTeams: z.number().int().min(2).default(12),
    isSF: z.boolean().default(false),
    isTEP: z.boolean().default(false),
    isDynasty: z.boolean().default(true),
  }),
  userGoal: UserGoalEnum.default('sustainable_contender'),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
  currentSeasonYear: z.number().int(),
})

export type FranchiseRoadmapInput = z.infer<typeof FranchiseRoadmapInputSchema>

// ---------------------------------------------------------------------------
// Year Plan
// ---------------------------------------------------------------------------

export interface YearPlan {
  year: number
  label: string
  objective: string
  priorities: string[]
  targetPositions: string[]
  recommendedMoves: string[]
  riskWatch: string[]
  milestoneToReach: string
}

// ---------------------------------------------------------------------------
// Core Output
// ---------------------------------------------------------------------------

export interface ChampionshipWindow {
  startYear: number | null
  endYear: number | null
  windowStrength: WindowStrength
}

export interface AssetStrategy {
  veterans: string
  youngCore: string
  picks: string
  prospects: string
}

export interface FranchiseRoadmap {
  mode: RoadmapMode
  horizonYears: number
  currentPhase: FranchisePhase
  confidencePct: number
  overallStrategy: string
  championshipWindow: ChampionshipWindow
  rosterIdentity: string
  strengths: string[]
  weaknesses: string[]
  marketInefficiencies: string[]
  urgentMoves: string[]
  avoidMoves: string[]
  riskFactors: string[]
  priorityPositions: string[]
  draftCapitalAdvice: string
  tradeStrategy: string
  timelineSummary: string
  yearPlans: YearPlan[]
  assetStrategy: AssetStrategy
  aiNotes: string[]
  generatedAt: string

  // Mode-specific extensions (nullable — only present for matching mode)
  dynastyExtension: DynastyRoadmapExtension | null
  devyExtension: DevyRoadmapExtension | null
  c2cExtension: C2CRoadmapExtension | null
}

// ---------------------------------------------------------------------------
// Mode-Specific Extensions
// ---------------------------------------------------------------------------

export interface DynastyRoadmapExtension {
  rosterAgeScore: number
  contenderScore: number
  futureFlexibilityScore: number
  veteranSellSignals: string[]
  youngCoreFoundation: string[]
  pickLeverageAdvice: string
}

export interface DevyRoadmapExtension {
  pipelineStrengthScore: number
  devyTimelineHealth: string
  stashPriorityTargets: string[]
  flipCandidates: string[]
  holdCandidates: string[]
  classBalanceNotes: string[]
  projectedPromotionWindows: string[]
}

export interface C2CRoadmapExtension {
  collegeWindowScore: number
  proWindowScore: number
  alignmentScore: number
  collegeSideStrategy: string
  proSideStrategy: string
  promotionPipelineHealth: string
  campusToProRecommendations: string[]
  dualWindowWarnings: string[]
}
