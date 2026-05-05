import { z } from 'zod'

export const NpcDraftPersonalitySchema = z.enum([
  'BALANCED',
  'NEED_BASED',
  'BEST_PLAYER_AVAILABLE',
  'YOUTH_DYNASTY_UPSIDE',
  'WIN_NOW_VETERAN',
  'STACK_TEAM_CORRELATION',
  'CONTRARIAN_CHAOS',
  'HOMER_TEAM_FAVORITE',
])

export const AiStyleSchema = z.enum([
  'BPA',
  'NEEDS',
  'BALANCED',
  'UPSIDE',
  'SAFE',
  'YOUTH',
  'STARS_AND_SCRUBS',
])

export const TradeAggressionSchema = z.enum(['none', 'low', 'medium', 'high'])

export const CommissionerAiAssignmentSchema = z.object({
  rosterId: z.string().min(1),
  aiStyle: AiStyleSchema,
  tradeAggression: TradeAggressionSchema,
  active: z.boolean(),
  /** Per-team overrides; inherit global when omitted */
  allowOutbound: z.boolean().optional(),
  allowInbound: z.boolean().optional(),
  npcDraftPersonality: NpcDraftPersonalitySchema.optional(),
  /** Uppercase team abbreviation for HOMER_TEAM_FAVORITE */
  npcFavoriteTeamAbbr: z.string().max(8).optional(),
})

export const CommissionerTradeRulesSchema = z.object({
  allowOutbound: z.boolean(),
  allowInbound: z.boolean(),
  blockAiToAi: z.boolean(),
  proposalCooldownSeconds: z.number().int().min(0).max(3600),
  maxProposalsPerRound: z.number().int().min(0).max(20),
  acceptConfidenceMin: z.number().min(0).max(1),
  /** Opt-in: NPC/AI managers may send or accept draft pick trades (subject to route execution). */
  npcDraftTradingEnabled: z.boolean().optional(),
})

export const CommissionerAiManagersBlobSchema = z.object({
  assignments: z.array(CommissionerAiAssignmentSchema).max(4),
  tradeRules: CommissionerTradeRulesSchema,
  _meta: z
    .object({
      lastOutboundProposalAtByRosterId: z.record(z.string(), z.string()).optional(),
      proposalsThisRound: z
        .object({
          round: z.number(),
          byRosterId: z.record(z.string(), z.number()),
        })
        .optional(),
    })
    .optional(),
})

export type CommissionerAiManagersBlob = z.infer<typeof CommissionerAiManagersBlobSchema>
export type CommissionerAiAssignment = z.infer<typeof CommissionerAiAssignmentSchema>
export type CommissionerTradeRules = z.infer<typeof CommissionerTradeRulesSchema>

export const DEFAULT_TRADE_RULES: CommissionerTradeRules = {
  allowOutbound: true,
  allowInbound: true,
  blockAiToAi: true,
  proposalCooldownSeconds: 90,
  maxProposalsPerRound: 4,
  acceptConfidenceMin: 0.58,
}
