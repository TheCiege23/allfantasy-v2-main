import { z } from 'zod'

export const MAX_AI_MANAGERS_PER_DRAFT = 4

const AiDraftStyleSchema = z.enum([
  'BPA',
  'NEEDS',
  'BALANCED',
  'UPSIDE',
  'SAFE',
  'STARS_AND_SCRUBS',
  'YOUTH',
])

const TradeAggressionSchema = z.enum(['none', 'low', 'medium', 'high'])

type AiDraftStyle = z.infer<typeof AiDraftStyleSchema>
type TradeAggression = z.infer<typeof TradeAggressionSchema>

export interface CommissionerAiTeamAssignment {
  teamId: string
  aiStyle: AiDraftStyle
  tradeAggression: TradeAggression
  active: boolean
  /** Distinct flavor — maps to brain mode + tie-break jitter */
  personalityId?: 'value_discipline' | 'youth_first' | 'positional_run' | 'ceiling_chaser'
}

