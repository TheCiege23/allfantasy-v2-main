/**
 * AI Trade Negotiation Assistant Engine
 *
 * Negotiation intelligence: posture selection, message generation,
 * pressure point analysis, counter strategy, sequencing plans.
 * Turns manager psychology + trade context into actionable deal-closing advice.
 *
 * Pure deterministic. <10ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NegotiationPosture = 'soft_probe' | 'balanced_pitch' | 'firm_offer' | 'patient_wait' | 'counter_now' | 'walk_away'
type ToneRecommendation = 'friendly' | 'businesslike' | 'confident' | 'light' | 'cautious'

const NegotiationStageEnum = z.enum([
  'first_contact', 'exploratory', 'offer_sent', 'counter_received', 'stalled', 'rejected', 'final_push',
])

const TradeGoalEnum = z.enum([
  'acquire_star', 'move_veteran', 'gain_picks', 'gain_youth', 'fix_depth',
  'consolidate_assets', 'cash_out_peak_value', 'buy_low_target',
  'devy_pipeline_move', 'c2c_balance_move',
])

interface SequencingStep {
  step: number
  action: string
  rationale: string
}

export const NegotiationInputSchema = z.object({
  sport: z.string().default('NFL'),
  leagueType: z.string().default('dynasty'),
  negotiationStage: NegotiationStageEnum,
  tradeGoal: TradeGoalEnum.default('acquire_star'),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
  // Target manager
  targetManagerName: z.string(),
  targetManagerArchetype: z.string().optional(),
  targetManagerNeeds: z.array(z.string()).default([]),
  targetManagerContenderTier: z.string().optional(),
  targetManagerPatienceScore: z.number().optional(), // 0-100
  targetManagerFairnessTolerance: z.number().optional(), // 0-1
  // Trade context
  userSendingAssets: z.array(z.string()).default([]),
  userReceivingAssets: z.array(z.string()).default([]),
  fairnessScore: z.number().optional(), // 0-100
  acceptanceOdds: z.number().optional(), // 0-100
  // Relationship
  relationshipContext: z.enum(['friendly', 'neutral', 'tense', 'rival', 'unknown']).default('neutral'),
  previousOfferRejected: z.boolean().default(false),
  negotiationHistoryNotes: z.array(z.string()).default([]),
})
type NegotiationInput = z.infer<typeof NegotiationInputSchema>

interface NegotiationResult {
  negotiationStage: string
  recommendedPosture: NegotiationPosture
  confidencePct: number
  acceptanceOutlook: string
  strategySummary: string
  bestApproachNotes: string[]
  pressurePoints: string[]
  avoidTalkingPoints: string[]
  suggestedMessage: string
  alternateMessages: string[]
  counterStrategyNotes: string[]
  fallbackTradeIdeas: string[]
  walkAwayTriggers: string[]
  summary: string
  generatedAt: string
  relationshipRiskScore: number
  negotiationLeverageScore: number
  urgencyScore: number
  toneRecommendation: ToneRecommendation
  sequencingPlan: SequencingStep[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

// ---------------------------------------------------------------------------
// Posture Selection
// ---------------------------------------------------------------------------

function selectPosture(input: NegotiationInput): NegotiationPosture {
  const { negotiationStage, riskTolerance, previousOfferRejected, targetManagerArchetype, relationshipContext } = input

  if (negotiationStage === 'rejected' && previousOfferRejected) {
    if (riskTolerance === 'aggressive') return 'firm_offer'
    return 'walk_away'
  }
  if (negotiationStage === 'stalled') {
    if (riskTolerance === 'conservative') return 'patient_wait'
    return 'balanced_pitch'
  }
  if (negotiationStage === 'counter_received') return 'counter_now'
  if (negotiationStage === 'final_push') return 'firm_offer'
  if (negotiationStage === 'first_contact') {
    if (targetManagerArchetype === 'Hoarder' || relationshipContext === 'tense') return 'soft_probe'
    if (riskTolerance === 'aggressive') return 'balanced_pitch'
    return 'soft_probe'
  }
  if (negotiationStage === 'exploratory') return 'balanced_pitch'
  if (negotiationStage === 'offer_sent') return 'patient_wait'

  return 'balanced_pitch'
}

// ---------------------------------------------------------------------------
// Tone Selection
// ---------------------------------------------------------------------------

function selectTone(input: NegotiationInput, posture: NegotiationPosture): ToneRecommendation {
  if (input.relationshipContext === 'rival') return 'businesslike'
  if (input.relationshipContext === 'tense') return 'cautious'
  if (input.relationshipContext === 'friendly') return 'friendly'
  if (posture === 'soft_probe') return 'light'
  if (posture === 'firm_offer' || posture === 'counter_now') return 'confident'
  return 'businesslike'
}

// ---------------------------------------------------------------------------
// Pressure Points
// ---------------------------------------------------------------------------

function identifyPressurePoints(input: NegotiationInput): string[] {
  const points: string[] = []
  const { targetManagerNeeds, targetManagerContenderTier, targetManagerArchetype, tradeGoal, userSendingAssets } = input

  if (targetManagerNeeds.length > 0) {
    points.push(`They need ${targetManagerNeeds.slice(0, 2).join(' and ')} — your offer should address this directly`)
  }
  if (targetManagerContenderTier === 'rebuild' && tradeGoal === 'move_veteran') {
    points.push('They are rebuilding — frame veterans as tradeable assets, not keepers')
  }
  if (targetManagerContenderTier === 'contender' && userSendingAssets.length > 0) {
    points.push('They are contending — emphasize how your assets help them win THIS year')
  }
  if (targetManagerArchetype === 'Win-Now Addict') {
    points.push('This manager chases production — lead with weekly points impact')
  }
  if (targetManagerArchetype === 'Patient Builder') {
    points.push('This manager values future assets — lead with picks and youth')
  }
  if (targetManagerArchetype === 'Taco') {
    points.push('This manager tends to overpay — your initial offer can be slightly favorable to you')
  }

  return points.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Avoid Talking Points
// ---------------------------------------------------------------------------

function identifyAvoidPoints(input: NegotiationInput): string[] {
  const avoids: string[] = []

  if (input.targetManagerArchetype === 'Shark') {
    avoids.push('Do NOT try to lowball — they will reject and lose respect')
  }
  if (input.relationshipContext === 'tense') {
    avoids.push('Avoid referencing past deals or conflicts — keep it professional and forward-looking')
  }
  if (input.negotiationStage === 'stalled') {
    avoids.push('Do NOT send the same offer again — change something, even if small')
  }
  if (input.fairnessScore != null && input.fairnessScore < 60) {
    avoids.push('Do NOT pretend this is a fair offer if it is not — own the ask and explain why')
  }
  avoids.push('Never pressure with fake deadlines or artificial scarcity')

  return avoids.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Message Generation
// ---------------------------------------------------------------------------

function generateMessage(input: NegotiationInput, posture: NegotiationPosture, tone: ToneRecommendation): string {
  const { targetManagerName, userSendingAssets, userReceivingAssets, tradeGoal, negotiationStage, targetManagerNeeds } = input
  const sending = userSendingAssets.join(', ') || 'assets'
  const receiving = userReceivingAssets.join(', ') || 'your player'

  if (negotiationStage === 'first_contact' && posture === 'soft_probe') {
    if (tone === 'friendly') return `Hey ${targetManagerName}! Been looking at your roster — would you be open to discussing ${receiving}? I think I have some pieces that could help your ${targetManagerNeeds[0] ?? 'team'} situation. No pressure, just exploring.`
    if (tone === 'light') return `${targetManagerName} — any chance ${receiving} is available? I might have something interesting for you. Let me know if you want to chat about it.`
    return `${targetManagerName}, I'm interested in ${receiving}. Would you be open to hearing an offer? I have some assets that might fill a need for you.`
  }

  if (negotiationStage === 'offer_sent' || posture === 'balanced_pitch') {
    return `${targetManagerName}, here's what I'm thinking: my ${sending} for your ${receiving}. ${targetManagerNeeds.length > 0 ? `This gets you help at ${targetManagerNeeds[0]}, which I know you need.` : 'I think this works for both of us.'} Let me know your thoughts.`
  }

  if (negotiationStage === 'counter_received') {
    return `Appreciate the counter, ${targetManagerName}. I can work with parts of it — ${tradeGoal === 'acquire_star' ? 'I really want to make this happen' : 'let me see where we can meet'}. What if we adjusted to ${sending} for ${receiving}? I think that closes the gap.`
  }

  if (negotiationStage === 'stalled') {
    return `${targetManagerName}, just checking back in on our discussion about ${receiving}. I'm still interested and flexible on the details. Is there a version of this that works for you?`
  }

  if (negotiationStage === 'rejected') {
    return `No worries on the rejection, ${targetManagerName}. Totally get it. If anything changes or you want to revisit with different pieces, I'm open. Good luck this week.`
  }

  if (negotiationStage === 'final_push') {
    return `${targetManagerName}, I want to make one final push on this: ${sending} for ${receiving}. I've sweetened from my original offer and I think this is genuinely fair for both sides. If it's not going to work, no hard feelings — but I wanted to give it one more shot.`
  }

  return `${targetManagerName}, I'd like to propose: ${sending} for ${receiving}. Let me know what you think.`
}

function generateAlternateMessages(input: NegotiationInput, posture: NegotiationPosture): string[] {
  const alts: string[] = []
  const tones: ToneRecommendation[] = ['friendly', 'businesslike', 'confident', 'light']
  for (const tone of tones.slice(0, 3)) {
    const msg = generateMessage(input, posture, tone)
    if (msg) alts.push(msg)
  }
  return [...new Set(alts)].slice(0, 3)
}

// ---------------------------------------------------------------------------
// Counter Strategy
// ---------------------------------------------------------------------------

function buildCounterStrategy(input: NegotiationInput): string[] {
  const notes: string[] = []

  if (input.negotiationStage === 'counter_received') {
    notes.push('Evaluate their counter objectively — is the gap bridgeable?')
    if (input.fairnessScore != null && input.fairnessScore >= 70) {
      notes.push('Their counter is close to fair — consider accepting with a small sweetener rather than re-countering')
    }
    notes.push('If you counter again, change at most one asset to show good faith')
  }

  if (input.negotiationStage === 'stalled') {
    notes.push('Try a different package structure — same value, different pieces')
    notes.push('Ask what they would need to make this work (reverse-engineer their ask)')
  }

  if (input.targetManagerArchetype === 'Shark') {
    notes.push('Against a Shark: your counter must be data-justified. Vague "I feel like" won\'t work.')
  }

  return notes.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Fallback Ideas
// ---------------------------------------------------------------------------

function buildFallbackIdeas(input: NegotiationInput): string[] {
  const ideas: string[] = []

  ideas.push('If rejected: pivot to a different asset from their roster that fills the same need')
  if (input.tradeGoal === 'acquire_star') {
    ideas.push('If their star is off limits: target their 2nd-best asset at the same position for less')
  }
  if (input.tradeGoal === 'gain_picks') {
    ideas.push('If they won\'t part with 1sts: target a package of 2nds or conditional picks')
  }
  ideas.push('If this manager is a dead end: identify the 2nd-best trade partner for the same goal')

  return ideas.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Walk-Away Triggers
// ---------------------------------------------------------------------------

function buildWalkAwayTriggers(input: NegotiationInput): string[] {
  const triggers: string[] = []

  triggers.push('If they ask for a cornerstone player you cannot replace')
  triggers.push('If 3+ counter-offers have been exchanged with no progress')
  if (input.fairnessScore != null && input.fairnessScore < 50) {
    triggers.push('If they insist on terms that make this a clear overpay')
  }
  triggers.push('If relationship tension is escalating — no deal is worth poisoning a league dynamic')

  return triggers.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Sequencing Plan
// ---------------------------------------------------------------------------

function buildSequencingPlan(input: NegotiationInput, posture: NegotiationPosture): SequencingStep[] {
  const plan: SequencingStep[] = []

  switch (input.negotiationStage) {
    case 'first_contact':
      plan.push({ step: 1, action: 'Send soft feeler message', rationale: 'Gauge interest without committing to specifics' })
      plan.push({ step: 2, action: 'If positive response: send structured offer within 24 hours', rationale: 'Strike while interest is warm' })
      plan.push({ step: 3, action: 'If no response in 48h: follow up once, then move on', rationale: 'Respect their time without being pushy' })
      break
    case 'counter_received':
      plan.push({ step: 1, action: 'Evaluate counter against fair market value', rationale: 'Know your walk-away point before responding' })
      plan.push({ step: 2, action: 'If bridgeable: counter with one small adjustment', rationale: 'Show good faith without caving' })
      plan.push({ step: 3, action: 'If far apart: ask what they need to close', rationale: 'Let them show their hand' })
      break
    case 'stalled':
      plan.push({ step: 1, action: 'Wait 3-5 days, then re-approach with restructured package', rationale: 'New structure can re-engage interest' })
      plan.push({ step: 2, action: 'If still stalled: explore alternative trade partners', rationale: 'Don\'t waste time on a dead deal' })
      break
    default:
      plan.push({ step: 1, action: `Execute ${posture.replace(/_/g, ' ')} approach`, rationale: 'Aligned with current negotiation dynamics' })
      plan.push({ step: 2, action: 'Monitor response within 48 hours', rationale: 'Timely follow-up shows seriousness' })
      plan.push({ step: 3, action: 'Adjust strategy based on response', rationale: 'Stay flexible and responsive' })
  }

  return plan
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

function computeLeverage(input: NegotiationInput): number {
  let score = 50
  if (input.targetManagerNeeds.length >= 2 && input.userSendingAssets.length > 0) score += 15
  if (input.targetManagerArchetype === 'Taco') score += 10
  if (input.targetManagerArchetype === 'Shark') score -= 10
  if (input.fairnessScore != null && input.fairnessScore >= 80) score += 10
  if (input.previousOfferRejected) score -= 10
  return clamp(score, 0, 100)
}

function computeUrgency(input: NegotiationInput): number {
  let score = 40
  if (input.negotiationStage === 'counter_received') score += 25
  if (input.negotiationStage === 'final_push') score += 20
  if (input.negotiationStage === 'stalled') score += 10
  if (input.tradeGoal === 'cash_out_peak_value') score += 15
  return clamp(score, 0, 100)
}

function computeRelationshipRisk(input: NegotiationInput): number {
  let risk = 20
  if (input.relationshipContext === 'tense') risk += 30
  if (input.relationshipContext === 'rival') risk += 20
  if (input.previousOfferRejected) risk += 10
  if (input.negotiationStage === 'final_push') risk += 10
  return clamp(risk, 0, 100)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function generateNegotiationStrategy(input: NegotiationInput): NegotiationResult {
  const posture = selectPosture(input)
  const tone = selectTone(input, posture)
  const pressurePoints = identifyPressurePoints(input)
  const avoidPoints = identifyAvoidPoints(input)
  const suggestedMessage = generateMessage(input, posture, tone)
  const alternateMessages = generateAlternateMessages(input, posture)
  const counterNotes = buildCounterStrategy(input)
  const fallbacks = buildFallbackIdeas(input)
  const walkAways = buildWalkAwayTriggers(input)
  const sequencing = buildSequencingPlan(input, posture)
  const leverage = computeLeverage(input)
  const urgency = computeUrgency(input)
  const relRisk = computeRelationshipRisk(input)

  const acceptanceOutlook = input.acceptanceOdds != null
    ? input.acceptanceOdds >= 70 ? 'Strong — this deal has a good chance of getting done'
      : input.acceptanceOdds >= 45 ? 'Moderate — possible but may need adjustment'
      : 'Low — expect pushback or rejection'
    : 'Unknown — insufficient data to project acceptance'

  const confidence = clamp(40 + (pressurePoints.length * 8) + (input.fairnessScore != null ? 10 : 0) + (input.targetManagerArchetype ? 10 : 0), 25, 90)

  const strategySummary = posture === 'walk_away'
    ? `This deal is unlikely to close. The recommendation is to walk away and pursue alternative targets.`
    : posture === 'soft_probe'
      ? `Start with a soft feeler to gauge interest before committing to a formal offer. ${input.targetManagerArchetype === 'Hoarder' ? 'This manager rarely trades — patience is key.' : ''}`
      : posture === 'patient_wait'
        ? `Your offer is on the table. Give them time to process — pushing too hard now could backfire.`
        : posture === 'counter_now'
          ? `They've countered. This is the critical moment — respond thoughtfully within 24 hours.`
          : `Present a balanced offer that addresses their needs. Frame it as mutually beneficial.`

  return {
    negotiationStage: input.negotiationStage,
    recommendedPosture: posture,
    confidencePct: confidence,
    acceptanceOutlook,
    strategySummary,
    bestApproachNotes: [
      `Posture: ${posture.replace(/_/g, ' ')} | Tone: ${tone}`,
      ...pressurePoints.slice(0, 2),
    ],
    pressurePoints,
    avoidTalkingPoints: avoidPoints,
    suggestedMessage,
    alternateMessages,
    counterStrategyNotes: counterNotes,
    fallbackTradeIdeas: fallbacks,
    walkAwayTriggers: walkAways,
    summary: `${input.negotiationStage.replace(/_/g, ' ')} stage → ${posture.replace(/_/g, ' ')} posture | Leverage: ${leverage}/100 | Urgency: ${urgency}/100 | Relationship risk: ${relRisk}/100`,
    generatedAt: new Date().toISOString(),
    relationshipRiskScore: relRisk,
    negotiationLeverageScore: leverage,
    urgencyScore: urgency,
    toneRecommendation: tone,
    sequencingPlan: sequencing,
  }
}
