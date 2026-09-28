import { z } from 'zod'

export const PickRecommendationSchema = z.object({
  playerName: z.string(),
  position: z.string(),
  team: z.string(),
  combinedAdp: z.number(),
  externalAdp: z.number().nullable(),
  siteAdp: z.number().nullable(),
  pickScore: z.number(),
  recommendationType: z.enum([
    'bpa',
    'needs',
    'balanced',
    'upside',
    'safe',
    'trade-up target',
    'trade-down target',
  ]),
  reasoning: z.array(z.string()),
  riskNotes: z.array(z.string()),
  waitOrTakeNow: z.enum(['take_now', 'safe_to_wait', 'unlikely_to_return']),
})

export const NextPickPredictionSchema = z.object({
  manager: z.string(),
  predictedPlayer: z.string(),
  predictedPosition: z.string(),
  probability: z.number(),
  reason: z.string(),
})

export const AiManagerAssignmentSchema = z.object({
  teamId: z.string(),
  aiStyle: z.string(),
  tradeAggression: z.enum(['none', 'low', 'medium', 'high']),
  active: z.boolean(),
})

export const DraftTradeDecisionSchema = z.object({
  action: z.enum(['send', 'accept', 'reject', 'counter']),
  confidence: z.number(),
  reasoning: z.array(z.string()),
  guardrailsPassed: z.boolean(),
})

export const PostDraftGradeSchema = z.object({
  teamName: z.string(),
  letterGrade: z.string(),
  numericScore: z.number(),
  bestPick: z.string(),
  biggestReach: z.string(),
  summary: z.string(),
})

export const LeagueChatPostSchema = z.object({
  title: z.string(),
  body: z.string(),
  awards: z.array(z.string()),
})

export const CombinedAdpDataSchema = z.object({
  playerKey: z.string(),
  playerName: z.string(),
  externalAdp: z.number().nullable(),
  siteAdp: z.number().nullable(),
  combinedAdp: z.number(),
  trend: z.string(),
  trendArrow: z.enum(['up', 'down', 'flat']),
  confidence: z.number(),
  contextLabel: z.string(),
  sourceCoverageNote: z.string(),
})

export const LiveDraftBrainEnvelopeSchema = z.object({
  pickRecommendation: PickRecommendationSchema,
  pickRecommendationsTop3: z.array(PickRecommendationSchema),
  nextPickPredictions: z.array(NextPickPredictionSchema),
  positionalRunSignals: z.array(z.string()),
  tierCliffWarnings: z.array(z.string()),
  boardTierSummary: z.array(
    z.object({
      tierLabel: z.string(),
      playersRemainingInTier: z.number(),
      nextTierDropRisk: z.enum(['low', 'medium', 'high']),
      notes: z.array(z.string()),
    })
  ),
  combinedAdp: z.array(CombinedAdpDataSchema).optional(),
  deterministicMeta: z.object({
    assistantMode: z.string(),
    draftFormat: z.string(),
    sport: z.string(),
  }),
})

export type PickRecommendationJson = z.infer<typeof PickRecommendationSchema>
export type LiveDraftBrainEnvelope = z.infer<typeof LiveDraftBrainEnvelopeSchema>
