/**
 * AI Goal Tracker Engine
 *
 * Continuous behavioral and roster-alignment AI. Tracks whether a user's
 * moves align with their declared strategy, detects contradictions and
 * drift, and recommends corrective actions.
 *
 * Pure deterministic. <15ms.
 */

import { z } from 'zod'
import { getAgeCurve } from '@/lib/trade-engine/sport-tuning-registry'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const GoalTypeEnum = z.enum([
  'win_now', 'sustainable_contender', 'fast_rebuild', 'value_accumulation',
  'youth_movement', 'pick_collection', 'prospect_pipeline', 'c2c_dual_window_balance',
  'devy_pipeline_build', 'risk_control', 'aggressive_upside', 'commissioner_defined_custom_goal',
])

type TrendDirection = 'improving' | 'stable' | 'drifting' | 'off_track'

interface MoveRecord {
  type: 'trade' | 'waiver_add' | 'waiver_drop' | 'lineup_change' | 'draft_pick'
  description: string
  assetsGained: string[]
  assetsLost: string[]
  /** Net age impact: negative = got younger, positive = got older */
  ageImpact: number
  /** Net value impact */
  valueImpact: number
  /** Whether this involved picks */
  involvedPicks: boolean
  /** When this happened */
  timestamp: string
}

interface GoalTrackerPlayer {
  name: string
  position: string
  age: number | null
  value: number
  slot: 'starter' | 'bench' | 'ir' | 'taxi' | 'devy'
}

export const GoalTrackerInputSchema = z.object({
  sport: z.string().default('NFL'),
  leagueType: z.string().default('dynasty'),
  currentGoal: GoalTypeEnum,
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
  currentSeasonYear: z.number(),
  teamRoster: z.array(z.object({
    name: z.string(), position: z.string(), age: z.number().nullable(),
    value: z.number(), slot: z.enum(['starter', 'bench', 'ir', 'taxi', 'devy']),
  })),
  draftPicks: z.array(z.object({ season: z.number(), round: z.number() })).default([]),
  devyAssets: z.array(z.object({ name: z.string(), value: z.number() })).default([]),
  moveHistory: z.array(z.object({
    type: z.enum(['trade', 'waiver_add', 'waiver_drop', 'lineup_change', 'draft_pick']),
    description: z.string(),
    assetsGained: z.array(z.string()).default([]),
    assetsLost: z.array(z.string()).default([]),
    ageImpact: z.number().default(0),
    valueImpact: z.number().default(0),
    involvedPicks: z.boolean().default(false),
    timestamp: z.string(),
  })).default([]),
})
type GoalTrackerInput = z.infer<typeof GoalTrackerInputSchema>

interface GoalTrackerResult {
  currentGoal: string
  goalAlignmentScore: number
  trendDirection: TrendDirection
  confidencePct: number
  strategySummary: string
  recentHelpfulMoves: string[]
  recentHarmfulMoves: string[]
  contradictionFlags: string[]
  disciplineNotes: string[]
  nextBestActions: string[]
  avoidNextActions: string[]
  priorityCorrections: string[]
  timelineRiskNotes: string[]
  rosterAlignmentNotes: string[]
  assetAlignmentNotes: string[]
  behaviorAlignmentNotes: string[]
  summary: string
  generatedAt: string
  // Mode-specific
  rebuildIntegrityScore: number | null
  contenderPressureScore: number | null
  pickDisciplineScore: number | null
  devyPipelineDisciplineScore: number | null
  c2cBalanceScore: number | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ---------------------------------------------------------------------------
// Goal Alignment Profiles — what each goal EXPECTS
// ---------------------------------------------------------------------------

interface GoalProfile {
  /** Should age trend younger? */
  prefersYounger: boolean
  /** Should acquire picks? */
  prefersPicks: boolean
  /** Should trade picks away for production? */
  spendsPicks: boolean
  /** Should value short-term production? */
  valuesProduction: boolean
  /** Should acquire prospects/devy? */
  valuesProspects: boolean
  /** Maximum acceptable avg age for starters */
  maxDesiredAge: number
  /** Minimum desired pick count */
  minDesiredPicks: number
}

const GOAL_PROFILES: Record<string, GoalProfile> = {
  win_now:                { prefersYounger: false, prefersPicks: false, spendsPicks: true, valuesProduction: true, valuesProspects: false, maxDesiredAge: 32, minDesiredPicks: 0 },
  sustainable_contender:  { prefersYounger: true, prefersPicks: false, spendsPicks: false, valuesProduction: true, valuesProspects: false, maxDesiredAge: 28, minDesiredPicks: 2 },
  fast_rebuild:           { prefersYounger: true, prefersPicks: true, spendsPicks: false, valuesProduction: false, valuesProspects: true, maxDesiredAge: 25, minDesiredPicks: 5 },
  value_accumulation:     { prefersYounger: true, prefersPicks: true, spendsPicks: false, valuesProduction: false, valuesProspects: true, maxDesiredAge: 27, minDesiredPicks: 4 },
  youth_movement:         { prefersYounger: true, prefersPicks: true, spendsPicks: false, valuesProduction: false, valuesProspects: true, maxDesiredAge: 25, minDesiredPicks: 3 },
  pick_collection:        { prefersYounger: false, prefersPicks: true, spendsPicks: false, valuesProduction: false, valuesProspects: false, maxDesiredAge: 30, minDesiredPicks: 6 },
  prospect_pipeline:      { prefersYounger: true, prefersPicks: true, spendsPicks: false, valuesProduction: false, valuesProspects: true, maxDesiredAge: 25, minDesiredPicks: 3 },
  devy_pipeline_build:    { prefersYounger: true, prefersPicks: true, spendsPicks: false, valuesProduction: false, valuesProspects: true, maxDesiredAge: 25, minDesiredPicks: 2 },
  c2c_dual_window_balance:{ prefersYounger: false, prefersPicks: false, spendsPicks: false, valuesProduction: true, valuesProspects: true, maxDesiredAge: 28, minDesiredPicks: 2 },
  risk_control:           { prefersYounger: false, prefersPicks: false, spendsPicks: false, valuesProduction: true, valuesProspects: false, maxDesiredAge: 30, minDesiredPicks: 2 },
  aggressive_upside:      { prefersYounger: true, prefersPicks: false, spendsPicks: true, valuesProduction: false, valuesProspects: true, maxDesiredAge: 26, minDesiredPicks: 1 },
  commissioner_defined_custom_goal: { prefersYounger: false, prefersPicks: false, spendsPicks: false, valuesProduction: true, valuesProspects: false, maxDesiredAge: 30, minDesiredPicks: 2 },
}

// ---------------------------------------------------------------------------
// Move Classification
// ---------------------------------------------------------------------------

function classifyMove(move: MoveRecord, profile: GoalProfile): 'helpful' | 'harmful' | 'neutral' {
  let score = 0

  // Age alignment
  if (profile.prefersYounger && move.ageImpact < 0) score += 1 // got younger = good for rebuilders
  if (profile.prefersYounger && move.ageImpact > 2) score -= 1 // got significantly older = bad
  if (!profile.prefersYounger && move.ageImpact < -3) score -= 1 // win-now but traded away production for youth

  // Pick alignment
  if (profile.prefersPicks && move.involvedPicks && move.assetsGained.some(a => a.toLowerCase().includes('pick'))) score += 1
  if (profile.prefersPicks && move.involvedPicks && move.assetsLost.some(a => a.toLowerCase().includes('pick'))) score -= 2 // losing picks when collecting = contradiction
  if (profile.spendsPicks && move.involvedPicks && move.assetsLost.some(a => a.toLowerCase().includes('pick'))) score += 1 // spending picks for production = aligned

  // Value alignment
  if (profile.valuesProduction && move.valueImpact > 500) score += 1
  if (!profile.valuesProduction && move.valueImpact < -500 && move.ageImpact < 0) score += 1 // sold value for youth = good for rebuilders

  if (score >= 1) return 'helpful'
  if (score <= -1) return 'harmful'
  return 'neutral'
}

// ---------------------------------------------------------------------------
// Contradiction Detection
// ---------------------------------------------------------------------------

function detectContradictions(
  moves: MoveRecord[],
  profile: GoalProfile,
  goal: string,
): string[] {
  const contradictions: string[] = []

  // Rebuilder buying vets
  if ((goal === 'fast_rebuild' || goal === 'youth_movement') && moves.some(m => m.ageImpact > 3 && m.type === 'trade')) {
    contradictions.push('You declared a rebuild but acquired significantly older players in a trade — this contradicts your stated goal.')
  }

  // Rebuilder spending picks
  if (profile.prefersPicks && moves.some(m => m.involvedPicks && m.assetsLost.some(a => a.toLowerCase().includes('pick')))) {
    contradictions.push('You are spending draft picks while your goal is to accumulate them — this is a direct contradiction.')
  }

  // Win-now collecting picks instead of spending
  if (goal === 'win_now' && moves.filter(m => m.involvedPicks && m.assetsGained.some(a => a.toLowerCase().includes('pick'))).length >= 2) {
    contradictions.push('You declared win-now but are hoarding picks instead of converting them into starters.')
  }

  // Win-now selling starters
  if (profile.valuesProduction && moves.some(m => m.valueImpact < -3000 && m.type === 'trade')) {
    contradictions.push('You sold a high-value asset while your goal demands production — contradicts your competitive strategy.')
  }

  // Devy/prospect goal but no prospect activity
  if ((goal === 'devy_pipeline_build' || goal === 'prospect_pipeline') && moves.filter(m => m.description.toLowerCase().includes('devy') || m.description.toLowerCase().includes('prospect')).length === 0 && moves.length >= 3) {
    contradictions.push('Your goal is prospect development but you have made no prospect-related moves — you are not executing your plan.')
  }

  return contradictions.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Roster Alignment
// ---------------------------------------------------------------------------

function analyzeRosterAlignment(
  roster: GoalTrackerPlayer[],
  picks: Array<{ season: number; round: number }>,
  devyAssets: Array<{ name: string; value: number }>,
  profile: GoalProfile,
  sport: string,
): { rosterNotes: string[]; assetNotes: string[]; alignmentDelta: number } {
  const rosterNotes: string[] = []
  const assetNotes: string[] = []
  let alignmentDelta = 0

  const starters = roster.filter(p => p.slot === 'starter')
  const ages = starters.map(p => p.age).filter((a): a is number => a != null)
  const avgAge = ages.length > 0 ? ages.reduce((s, a) => s + a, 0) / ages.length : 26

  // Age alignment
  if (avgAge > profile.maxDesiredAge + 2) {
    rosterNotes.push(`Average starter age (${avgAge.toFixed(1)}) exceeds your goal's target (${profile.maxDesiredAge}). Roster is too old for ${profile.prefersYounger ? 'a youth-focused' : 'your'} strategy.`)
    alignmentDelta -= 15
  } else if (avgAge <= profile.maxDesiredAge) {
    rosterNotes.push(`Age profile (${avgAge.toFixed(1)} avg) aligns with your strategy.`)
    alignmentDelta += 10
  }

  // Pick alignment
  if (picks.length < profile.minDesiredPicks) {
    assetNotes.push(`You hold ${picks.length} pick${picks.length !== 1 ? 's' : ''} but your strategy targets ${profile.minDesiredPicks}+. Acquire more draft capital.`)
    alignmentDelta -= 10
  } else if (picks.length >= profile.minDesiredPicks) {
    assetNotes.push(`Pick count (${picks.length}) meets your strategy target.`)
    alignmentDelta += 5
  }

  // Devy alignment
  if (profile.valuesProspects && devyAssets.length < 3) {
    assetNotes.push(`Only ${devyAssets.length} devy assets — your prospect-focused strategy needs more pipeline depth.`)
    alignmentDelta -= 10
  }

  // Aging starters for rebuilders
  if (profile.prefersYounger) {
    const agingStarters = starters.filter(p => {
      if (p.age == null) return false
      const curve = getAgeCurve(sport, p.position)
      return curve ? p.age > curve.declineAge : p.age > 28
    })
    if (agingStarters.length >= 3) {
      rosterNotes.push(`${agingStarters.length} starters past decline age — sell before value craters to align with rebuild.`)
      alignmentDelta -= 10
    }
  }

  return { rosterNotes, assetNotes, alignmentDelta }
}

// ---------------------------------------------------------------------------
// Alignment Score
// ---------------------------------------------------------------------------

function computeAlignmentScore(
  helpfulCount: number,
  harmfulCount: number,
  contradictions: string[],
  alignmentDelta: number,
  totalMoves: number,
): number {
  let score = 60 // baseline

  // Move alignment
  if (totalMoves > 0) {
    const helpfulPct = helpfulCount / totalMoves
    score += Math.round(helpfulPct * 25)
    score -= Math.round((harmfulCount / totalMoves) * 20)
  }

  // Contradiction penalty
  score -= contradictions.length * 8

  // Roster alignment
  score += alignmentDelta

  return clamp(Math.round(score), 0, 100)
}

function classifyTrend(score: number, contradictions: string[], harmfulCount: number): TrendDirection {
  if (score >= 75 && contradictions.length === 0) return 'improving'
  if (score >= 55 && contradictions.length <= 1) return 'stable'
  if (score >= 35 || contradictions.length <= 2) return 'drifting'
  return 'off_track'
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function buildNextActions(goal: string, profile: GoalProfile, contradictions: string[], rosterNotes: string[]): string[] {
  const actions: string[] = []

  if (contradictions.length > 0) {
    actions.push('Address contradictions first — your recent moves are working against your stated goal.')
  }

  switch (goal) {
    case 'win_now':
      actions.push('Convert excess picks into proven weekly starters.')
      actions.push('Target the weakest starting position for a trade upgrade.')
      break
    case 'fast_rebuild':
    case 'youth_movement':
      actions.push('Sell any veteran starter over 27 at peak value.')
      actions.push('Acquire at least one additional 1st-round pick this month.')
      break
    case 'pick_collection':
      actions.push('Convert any tradeable veteran into draft capital.')
      break
    case 'sustainable_contender':
      actions.push('Balance win-now upgrades with youth preservation.')
      actions.push('Avoid overpaying — maintain future flexibility.')
      break
    case 'devy_pipeline_build':
      actions.push('Acquire at least one more devy prospect this period.')
      break
    default:
      actions.push('Review your roadmap and ensure your next move aligns with your strategy.')
  }

  return actions.slice(0, 4)
}

function buildAvoidActions(goal: string, profile: GoalProfile): string[] {
  const avoids: string[] = []

  if (profile.prefersYounger) avoids.push('Do NOT trade for players over 28 unless they are elite.')
  if (profile.prefersPicks) avoids.push('Do NOT spend picks on marginal upgrades.')
  if (profile.spendsPicks) avoids.push('Do NOT hoard picks — convert them into production.')
  if (profile.valuesProduction) avoids.push('Do NOT sell productive starters for speculative assets.')
  if (!profile.valuesProduction) avoids.push('Do NOT chase short-term production at the expense of long-term value.')

  return avoids.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function analyzeGoalAlignment(input: GoalTrackerInput): GoalTrackerResult {
  const profile = GOAL_PROFILES[input.currentGoal] ?? GOAL_PROFILES.sustainable_contender
  const moves = input.moveHistory

  // Classify each move
  const classified = moves.map(m => ({ move: m, alignment: classifyMove(m, profile) }))
  const helpful = classified.filter(c => c.alignment === 'helpful')
  const harmful = classified.filter(c => c.alignment === 'harmful')

  const recentHelpfulMoves = helpful.slice(-4).map(c => c.move.description)
  const recentHarmfulMoves = harmful.slice(-4).map(c => `${c.move.description} — contradicts your ${input.currentGoal.replace(/_/g, ' ')} strategy`)

  // Contradictions
  const contradictions = detectContradictions(moves, profile, input.currentGoal)

  // Roster alignment
  const { rosterNotes, assetNotes, alignmentDelta } = analyzeRosterAlignment(
    input.teamRoster, input.draftPicks, input.devyAssets, profile, input.sport,
  )

  // Scores
  const alignmentScore = computeAlignmentScore(helpful.length, harmful.length, contradictions, alignmentDelta, moves.length)
  const trend = classifyTrend(alignmentScore, contradictions, harmful.length)
  const confidence = clamp(40 + (moves.length >= 3 ? 15 : 0) + (input.teamRoster.length >= 10 ? 15 : 0) + (contradictions.length === 0 ? 10 : 0), 20, 90)

  // Recommendations
  const nextBestActions = buildNextActions(input.currentGoal, profile, contradictions, rosterNotes)
  const avoidNextActions = buildAvoidActions(input.currentGoal, profile)

  // Discipline notes
  const disciplineNotes: string[] = []
  if (harmful.length > helpful.length && moves.length >= 3) {
    disciplineNotes.push('More harmful moves than helpful ones — you may be making emotional decisions rather than strategic ones.')
  }
  if (contradictions.length >= 2) {
    disciplineNotes.push('Multiple contradictions detected — your actions are working against your declared strategy.')
  }
  if (moves.length === 0) {
    disciplineNotes.push('No moves recorded yet. Inaction can be just as harmful as bad moves — make sure you are actively pursuing your goal.')
  }

  // Priority corrections
  const priorityCorrections: string[] = []
  if (contradictions.length > 0) priorityCorrections.push(`Fix ${contradictions.length} strategic contradiction${contradictions.length > 1 ? 's' : ''} before making any new moves.`)
  if (alignmentScore < 40) priorityCorrections.push('Alignment score is critically low — consider updating your goal or dramatically changing your approach.')

  // Strategy summary
  const goalLabel = input.currentGoal.replace(/_/g, ' ')
  const strategySummary = alignmentScore >= 70
    ? `Your ${goalLabel} strategy is on track. Keep executing — your moves are aligned with your plan.`
    : alignmentScore >= 45
      ? `Your ${goalLabel} strategy is showing some drift. ${contradictions.length > 0 ? 'Address contradictions' : 'Tighten discipline'} to stay on course.`
      : `Your ${goalLabel} strategy is off track. ${contradictions.length} contradictions and ${harmful.length} harmful moves are undermining your plan. Corrective action needed.`

  // Mode-specific scores
  const isRebuild = ['fast_rebuild', 'youth_movement', 'pick_collection', 'value_accumulation'].includes(input.currentGoal)
  const isContender = ['win_now', 'sustainable_contender'].includes(input.currentGoal)

  return {
    currentGoal: input.currentGoal,
    goalAlignmentScore: alignmentScore,
    trendDirection: trend,
    confidencePct: confidence,
    strategySummary,
    recentHelpfulMoves,
    recentHarmfulMoves,
    contradictionFlags: contradictions,
    disciplineNotes,
    nextBestActions,
    avoidNextActions,
    priorityCorrections,
    timelineRiskNotes: trend === 'off_track' ? ['At this rate, your strategy timeline will slip significantly. Urgent correction needed.'] : [],
    rosterAlignmentNotes: rosterNotes,
    assetAlignmentNotes: assetNotes,
    behaviorAlignmentNotes: disciplineNotes,
    summary: `${goalLabel}: ${alignmentScore}/100 alignment | ${trend} | ${helpful.length} helpful, ${harmful.length} harmful moves | ${contradictions.length} contradiction${contradictions.length !== 1 ? 's' : ''}`,
    generatedAt: new Date().toISOString(),
    rebuildIntegrityScore: isRebuild ? clamp(alignmentScore + (contradictions.length === 0 ? 10 : -10), 0, 100) : null,
    contenderPressureScore: isContender ? clamp(alignmentScore + (harmful.length === 0 ? 10 : -15), 0, 100) : null,
    pickDisciplineScore: profile.prefersPicks ? clamp(50 + (input.draftPicks.length - profile.minDesiredPicks) * 10, 0, 100) : null,
    devyPipelineDisciplineScore: input.currentGoal === 'devy_pipeline_build' ? clamp(30 + input.devyAssets.length * 12, 0, 100) : null,
    c2cBalanceScore: input.currentGoal === 'c2c_dual_window_balance' ? alignmentScore : null,
  }
}
