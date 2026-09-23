import { z } from 'zod'
import {
  computeChimmyConfidenceRubric,
  buildConfidenceBlockFromRubric,
  confidenceLevelFor,
  type ChimmyTrackRecord,
} from './confidence-rubric'

const LEVEL_RANK = { low: 0, medium: 1, high: 2 } as const

/**
 * The drawer renders `{level} confidence · {confidencePct}%` side by side, but the
 * level comes from the rubric and the percent is the orchestrator's own number.
 * They disagreed in production — "HIGH CONFIDENCE · 26%" — most visibly when every
 * provider failed: the fallback caps the percent at 20-35 while the rubric barely
 * moves. A label may never claim more than the number printed next to it, so the
 * level is capped at the band that number falls in. It is only ever LOWERED.
 */
export function capConfidenceLevelToShownPct(
  block: ChimmyConfidenceBlock,
  shownPct: number | null | undefined,
): ChimmyConfidenceBlock {
  if (typeof shownPct !== 'number' || !Number.isFinite(shownPct)) return block
  const ceiling = confidenceLevelFor(shownPct)
  return LEVEL_RANK[ceiling] < LEVEL_RANK[block.level] ? { ...block, level: ceiling } : block
}

export type ChimmyAnswerType =
  | 'trade'
  | 'start_sit'
  | 'waiver'
  | 'draft'
  | 'injury'
  | 'general'
  | 'commissioner'

export type ChimmyConfidenceBlock = {
  level: 'high' | 'medium' | 'low'
  rationale: string
  freshness: 'fresh' | 'partial' | 'stale' | 'unknown'
  basedOn: string[]
  missing: string[]
  leagueContext: 'available' | 'partial' | 'missing'
}

export type ChimmyFollowUpPrompt = {
  label: string
  prompt: string
}

type ChimmyContractBase = {
  answerType: ChimmyAnswerType
  confidence: ChimmyConfidenceBlock
  followUps: ChimmyFollowUpPrompt[]
}

export type ChimmyTradeAnswerContract = ChimmyContractBase & {
  answerType: 'trade'
  score: number
  grade: string
  recommendation: 'accept' | 'reject' | 'counter' | 'hold'
  reasons: string[]
  risks: string[]
  whatChangesThisAdvice: string[]
  suggestedCounter?: string
}

export type ChimmyStartSitAnswerContract = ChimmyContractBase & {
  answerType: 'start_sit'
  recommendation: string
  safeOption: string
  upsideOption: string
  matchupNote: string
  reasons: string[]
  risks: string[]
}

export type ChimmyWaiverAnswerContract = ChimmyContractBase & {
  answerType: 'waiver'
  priority: 'high' | 'medium' | 'low'
  addTarget: string
  dropCandidate?: string
  claimTypeSuggestion?: 'faab' | 'rolling' | 'fcfs' | 'standard'
  faabSuggestion?: string
  reasons: string[]
  risks: string[]
}

export type ChimmyDraftAnswerContract = ChimmyContractBase & {
  answerType: 'draft'
  recommendation: string
  reasons: string[]
  risks: string[]
}

export type ChimmyInjuryAnswerContract = ChimmyContractBase & {
  answerType: 'injury'
  recommendation: string
  playerOutlook: string
  reasons: string[]
  risks: string[]
}

export type ChimmyGeneralAnswerContract = ChimmyContractBase & {
  answerType: 'general'
  recommendation: string
  keyPoints: string[]
}

export type ChimmyCommissionerAnswerContract = ChimmyContractBase & {
  answerType: 'commissioner'
  recommendation: string
  policyImpact: string
  fairnessChecks: string[]
}

export type ChimmyAnswerContract =
  | ChimmyTradeAnswerContract
  | ChimmyStartSitAnswerContract
  | ChimmyWaiverAnswerContract
  | ChimmyDraftAnswerContract
  | ChimmyInjuryAnswerContract
  | ChimmyGeneralAnswerContract
  | ChimmyCommissionerAnswerContract

const ConfidenceSchema = z.object({
  level: z.enum(['high', 'medium', 'low']),
  rationale: z.string().min(1),
  freshness: z.enum(['fresh', 'partial', 'stale', 'unknown']),
  basedOn: z.array(z.string().min(1)).min(1),
  missing: z.array(z.string().min(1)),
  leagueContext: z.enum(['available', 'partial', 'missing']),
})

const FollowUpSchema = z.object({
  label: z.string().min(1),
  prompt: z.string().min(1),
})

const TradeSchema = z.object({
  answerType: z.literal('trade'),
  score: z.number().min(0).max(100),
  grade: z.string().min(1),
  recommendation: z.enum(['accept', 'reject', 'counter', 'hold']),
  reasons: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)).min(1),
  whatChangesThisAdvice: z.array(z.string().min(1)).min(1),
  suggestedCounter: z.string().min(1).optional(),
  confidence: ConfidenceSchema,
  followUps: z.array(FollowUpSchema).max(5),
})

const StartSitSchema = z.object({
  answerType: z.literal('start_sit'),
  recommendation: z.string().min(1),
  safeOption: z.string().min(1),
  upsideOption: z.string().min(1),
  matchupNote: z.string().min(1),
  reasons: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)).min(1),
  confidence: ConfidenceSchema,
  followUps: z.array(FollowUpSchema).max(5),
})

const WaiverSchema = z.object({
  answerType: z.literal('waiver'),
  priority: z.enum(['high', 'medium', 'low']),
  addTarget: z.string().min(1),
  dropCandidate: z.string().min(1).optional(),
  claimTypeSuggestion: z.enum(['faab', 'rolling', 'fcfs', 'standard']).optional(),
  faabSuggestion: z.string().min(1).optional(),
  reasons: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)).min(1),
  confidence: ConfidenceSchema,
  followUps: z.array(FollowUpSchema).max(5),
})

const DraftSchema = z.object({
  answerType: z.literal('draft'),
  recommendation: z.string().min(1),
  reasons: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)).min(1),
  confidence: ConfidenceSchema,
  followUps: z.array(FollowUpSchema).max(5),
})

const InjurySchema = z.object({
  answerType: z.literal('injury'),
  recommendation: z.string().min(1),
  playerOutlook: z.string().min(1),
  reasons: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)).min(1),
  confidence: ConfidenceSchema,
  followUps: z.array(FollowUpSchema).max(5),
})

const GeneralSchema = z.object({
  answerType: z.literal('general'),
  recommendation: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(1),
  confidence: ConfidenceSchema,
  followUps: z.array(FollowUpSchema).max(5),
})

const CommissionerSchema = z.object({
  answerType: z.literal('commissioner'),
  recommendation: z.string().min(1),
  policyImpact: z.string().min(1),
  fairnessChecks: z.array(z.string().min(1)).min(1),
  confidence: ConfidenceSchema,
  followUps: z.array(FollowUpSchema).max(5),
})

const ChimmyAnswerContractSchema = z.discriminatedUnion('answerType', [
  TradeSchema,
  StartSitSchema,
  WaiverSchema,
  DraftSchema,
  InjurySchema,
  GeneralSchema,
  CommissionerSchema,
])

function toSentenceList(...values: Array<string | null | undefined>): string[] {
  const out = values
    .flatMap((value) => {
      if (!value) return []
      return value
        .split(/\n|\.|•|\-/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    })
    .slice(0, 4)

  return out.length > 0 ? out : ['Context signals support this recommendation.']
}

function scoreToGrade(score: number): string {
  if (score >= 93) return 'A'
  if (score >= 90) return 'A-'
  if (score >= 87) return 'B+'
  if (score >= 83) return 'B'
  if (score >= 80) return 'B-'
  if (score >= 77) return 'C+'
  if (score >= 73) return 'C'
  if (score >= 70) return 'C-'
  return 'D'
}

function inferRecommendation(text: string): 'accept' | 'reject' | 'counter' | 'hold' {
  const lower = text.toLowerCase()
  if (/\bcounter\b/.test(lower)) return 'counter'
  if (/\breject\b|\bdecline\b/.test(lower)) return 'reject'
  if (/\bhold\b|\bwait\b/.test(lower)) return 'hold'
  return 'accept'
}

function detectAnswerType(args: {
  insightType?: string | null
  specialistAgent?: string | null
  message: string
}): ChimmyAnswerType {
  const insight = String(args.insightType ?? '').toLowerCase()
  if (insight === 'trade') return 'trade'
  if (insight === 'waiver') return 'waiver'
  if (insight === 'draft') return 'draft'

  const text = args.message.toLowerCase()
  if (/\bstart\b|\bsit\b|\blineup\b/.test(text)) return 'start_sit'
  if (/\binjury\b|\bquestionable\b|\bout\b/.test(text)) return 'injury'
  if (/\bdraft\b|\brookie\b|\bpick\b/.test(text)) return 'draft'
  if (/\btrade\b|\boffer\b/.test(text)) return 'trade'
  if (/\bwaiver\b|\bfaab\b|\bclaim\b/.test(text)) return 'waiver'
  if (/\bcommissioner\b|\bveto\b|\brule\b/.test(text)) return 'commissioner'

  const agent = String(args.specialistAgent ?? '').toLowerCase()
  if (agent.includes('trade')) return 'trade'
  if (agent.includes('waiver')) return 'waiver'
  if (agent.includes('commissioner')) return 'commissioner'
  return 'general'
}

function fallbackFollowUps(answerType: ChimmyAnswerType): ChimmyFollowUpPrompt[] {
  if (answerType === 'trade') {
    return [
      { label: 'Suggest a counter', prompt: 'Suggest a counter based on my roster needs.' },
      { label: 'Explain risk', prompt: 'Explain the downside risk for this trade.' },
    ]
  }
  if (answerType === 'waiver') {
    return [
      { label: 'Rank by need', prompt: 'Rank waiver targets by my roster needs.' },
      { label: 'Who to drop', prompt: 'Who is my safest drop candidate?' },
    ]
  }
  if (answerType === 'start_sit') {
    return [
      { label: 'Safer option', prompt: 'Show the safer option.' },
      { label: 'Upside option', prompt: 'Show the upside option.' },
    ]
  }
  return [
    { label: 'What next?', prompt: 'What should I do next?' },
  ]
}

export type ChimmyAnswerContractResult = {
  contract: ChimmyAnswerContract
  fallbackUsed: boolean
  fallbackReason?: string
}

export function buildChimmyAnswerContract(args: {
  message: string
  insightType?: string | null
  specialistAgent?: string | null
  confidencePct?: number | null
  stalenessWarning?: string | null
  /** Minutes since data was last synced — passed to rubric for freshness scoring. */
  staleMinutes?: number | null
  /** Freshness threshold in minutes for this domain. */
  thresholdMinutes?: number | null
  dataSources?: string[]
  sourceLinks?: Array<string | { label: string; href: string }>
  hasLeagueContext: boolean
  responseStructure?: {
    shortAnswer?: string
    whatDataSays?: string
    whatItMeans?: string
    recommendedAction?: string
    caveats?: string[]
  } | null
  followUps?: Array<{ label?: string | null; prompt?: string | null }>
  /** Chimmy's track record per answer type; only the detected type's entry is used. */
  trackRecords?: Partial<Record<ChimmyAnswerType, ChimmyTrackRecord>> | null
}): ChimmyAnswerContractResult {
  const answerType = detectAnswerType({
    insightType: args.insightType,
    specialistAgent: args.specialistAgent,
    message: args.message,
  })

  const structure = args.responseStructure ?? null
  const rubricResult = computeChimmyConfidenceRubric({
    modelReportedPct: args.confidencePct ?? null,
    hasStalenessWarning: Boolean(args.stalenessWarning),
    staleMinutes: args.staleMinutes ?? null,
    thresholdMinutes: args.thresholdMinutes ?? null,
    hasLeagueContext: args.hasLeagueContext,
    dataSourceCount: args.dataSources?.filter(Boolean).length ?? 0,
    sourceLinkCount: args.sourceLinks?.length ?? 0,
    responseStructurePopulated: {
      shortAnswer: Boolean(structure?.shortAnswer),
      whatDataSays: Boolean(structure?.whatDataSays),
      whatItMeans: Boolean(structure?.whatItMeans),
      recommendedAction: Boolean(structure?.recommendedAction),
      caveatsCount: structure?.caveats?.length ?? 0,
    },
    answerType,
    trackRecord: args.trackRecords?.[answerType] ?? null,
  })
  const score = rubricResult.score
  const confidence = capConfidenceLevelToShownPct(
    buildConfidenceBlockFromRubric(rubricResult, args.dataSources?.filter(Boolean) ?? []),
    args.confidencePct,
  )

  const followUps =
    args.followUps
      ?.map((item) => ({
        label: item.label?.trim() ?? '',
        prompt: item.prompt?.trim() ?? '',
      }))
      .filter((item) => item.label.length > 0 && item.prompt.length > 0)
      .slice(0, 5) ?? []
  const normalizedFollowUps = followUps.length > 0 ? followUps : fallbackFollowUps(answerType)

  const reasons = toSentenceList(structure?.whatDataSays, structure?.whatItMeans)
  const risks =
    structure?.caveats && structure.caveats.length > 0
      ? structure.caveats.slice(0, 3)
      : ['Monitor injury/news updates before lock.']

  let contract: ChimmyAnswerContract
  if (answerType === 'trade') {
    contract = {
      answerType,
      score,
      grade: scoreToGrade(score),
      recommendation: inferRecommendation(`${structure?.shortAnswer ?? ''} ${structure?.recommendedAction ?? ''}`),
      reasons,
      risks,
      whatChangesThisAdvice:
        confidence.missing.length > 0
          ? confidence.missing
          : ['League scoring detail changes', 'Injury status changes'],
      suggestedCounter: /counter/i.test(structure?.recommendedAction ?? '')
        ? structure?.recommendedAction
        : undefined,
      confidence,
      followUps: normalizedFollowUps,
    }
  } else if (answerType === 'start_sit') {
    contract = {
      answerType,
      recommendation: structure?.shortAnswer || 'Start the safer projection option.',
      safeOption: structure?.recommendedAction || 'Play the higher-floor option.',
      upsideOption: 'Use the higher-ceiling option if you need variance.',
      matchupNote: structure?.whatDataSays || 'Matchup context is moderately favorable.',
      reasons,
      risks,
      confidence,
      followUps: normalizedFollowUps,
    }
  } else if (answerType === 'waiver') {
    contract = {
      answerType,
      priority: score >= 80 ? 'high' : score >= 65 ? 'medium' : 'low',
      addTarget: structure?.shortAnswer || 'Top projected waiver target',
      dropCandidate: structure?.recommendedAction || undefined,
      claimTypeSuggestion: 'faab',
      faabSuggestion: score >= 80 ? '8-12% FAAB' : '3-7% FAAB',
      reasons,
      risks,
      confidence,
      followUps: normalizedFollowUps,
    }
  } else if (answerType === 'draft') {
    contract = {
      answerType,
      recommendation: structure?.shortAnswer || 'Prioritize best player value at current pick.',
      reasons,
      risks,
      confidence,
      followUps: normalizedFollowUps,
    }
  } else if (answerType === 'injury') {
    contract = {
      answerType,
      recommendation: structure?.shortAnswer || 'Use the safer healthy option.',
      playerOutlook: structure?.whatItMeans || 'Availability risk is elevated.',
      reasons,
      risks,
      confidence,
      followUps: normalizedFollowUps,
    }
  } else if (answerType === 'commissioner') {
    contract = {
      answerType,
      recommendation: structure?.shortAnswer || 'Apply a transparent, league-wide policy.',
      policyImpact: structure?.whatItMeans || 'Maintains competitive fairness across managers.',
      fairnessChecks: reasons,
      confidence,
      followUps: normalizedFollowUps,
    }
  } else {
    contract = {
      answerType: 'general',
      recommendation: structure?.shortAnswer || 'Use the clearest high-probability next step.',
      keyPoints: reasons,
      confidence,
      followUps: normalizedFollowUps,
    }
  }

  const validated = ChimmyAnswerContractSchema.safeParse(contract)
  if (validated.success) return { contract: validated.data, fallbackUsed: false }

  const fallbackReason = validated.error.errors
    .map((e) => `${e.path.join('.')}: ${e.message}`)
    .slice(0, 5)
    .join('; ')

  return {
    contract: buildFallbackChimmyAnswerContract(args.hasLeagueContext),
    fallbackUsed: true,
    fallbackReason,
  }
}

export function buildFallbackChimmyAnswerContract(hasLeagueContext: boolean): ChimmyAnswerContract {
  const fallback: ChimmyGeneralAnswerContract = {
    answerType: 'general',
    recommendation: 'I am missing some critical context for a high-confidence recommendation.',
    keyPoints: [
      'Safe answer: use the higher-floor option.',
      'Upside answer: use the higher-ceiling option.',
      'Best next action: check final injury + lineup status before lock.',
    ],
    confidence: {
      level: 'low',
      rationale: 'Contract fallback: missing required fields for structured recommendation.',
      freshness: 'unknown',
      basedOn: ['fallback_policy'],
      missing: ['league scoring settings', 'latest injury report'],
      leagueContext: hasLeagueContext ? 'partial' : 'missing',
    },
    followUps: fallbackFollowUps('general'),
  }
  // Validate the fallback itself; if it fails, use a literal last-resort.
  const validated = GeneralSchema.safeParse(fallback)
  if (validated.success) return validated.data as ChimmyAnswerContract
  return {
    answerType: 'general',
    recommendation: 'Unable to generate a structured recommendation at this time.',
    keyPoints: ['Check roster health before lock.'],
    confidence: {
      level: 'low',
      rationale: 'Last-resort fallback.',
      freshness: 'unknown',
      basedOn: ['fallback_policy'],
      missing: [],
      leagueContext: 'missing',
    },
    followUps: [{ label: 'What next?', prompt: 'What should I do next?' }],
  }
}
