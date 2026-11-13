import { z } from 'zod'

export const LineupDecisionModeSchema = z.enum([
  'Best Lineup',
  'Safe Lineup',
  'Upside Lineup',
  'Must-Win Lineup',
  'Underdog Lineup',
  'Playoff-Protect Lineup',
  'Dynasty Development Lineup',
  'Injury Contingency Lineup',
])

export const PremiumLineupDecisionJsonSchema = z.object({
  lineupMode: LineupDecisionModeSchema,
  teamContext: z.object({
    record: z.string(),
    rank: z.number(),
    projectedWinProbability: z.number(),
    teamDirection: z.enum(['favorite', 'underdog', 'neutral', 'contender', 'bubble', 'rebuild']),
    strategyRecommendation: z.string(),
  }),
  optimizedLineup: z.array(
    z.object({
      slot: z.string(),
      playerName: z.string(),
      position: z.string(),
      team: z.string(),
      weeklyStartScore: z.number(),
      startConfidence: z.number(),
      ceilingScore: z.number(),
      floorScore: z.number(),
      volatilityScore: z.number(),
      reason: z.array(z.string()),
      usedPreferenceTieBreaker: z.boolean(),
    })
  ),
  benchDecisions: z.array(
    z.object({
      playerName: z.string(),
      position: z.string(),
      benchReason: z.array(z.string()),
      swapPriority: z.number(),
    })
  ),
  startSitCalls: z.array(
    z.object({
      slot: z.string(),
      startPlayer: z.string(),
      sitPlayer: z.string(),
      edgeType: z.enum(['floor', 'ceiling', 'matchup', 'health', 'usage', 'preference', 'legality']),
      confidence: z.number(),
      explanation: z.string(),
    })
  ),
  autoSubRules: z.object({
    enabled: z.boolean(),
    injuryOnly: z.literal(true),
    eligibleStatuses: z.array(z.string()),
    notes: z.array(z.string()),
  }),
  autoSubPreview: z.array(
    z.object({
      ifStarterStatus: z.string(),
      starterToReplace: z.string(),
      replacementPlayer: z.string(),
      replacementReason: z.string(),
      usedPreferenceTieBreaker: z.boolean(),
      slotCode: z.string(),
      confidence: z.number(),
      samePositionReplacement: z.boolean(),
    })
  ),
  autoSubBlocked: z.array(
    z.object({
      starterName: z.string(),
      slotCode: z.string(),
      status: z.string(),
      reason: z.string(),
    })
  ),
  preferenceProfileSummary: z.object({
    activeTraits: z.array(z.string()),
    preferenceConfidence: z.number(),
    notes: z.array(z.string()),
  }),
  alerts: z.array(z.string()),
})

