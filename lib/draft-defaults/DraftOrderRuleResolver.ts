/**
 * Resolves draft order rules (snake vs linear) for pick order and UI labels.
 * Used by draft room and mock draft to compute pick slot and display rules.
 */
export type DraftOrderRule = 'snake' | 'linear'

export interface DraftOrderRuleDescription {
  rule: DraftOrderRule
  label: string
  description: string
}

export interface DraftOrderBehavior {
  rule: DraftOrderRule
  thirdRoundReversal: boolean
  label: string
  description: string
}

const RULES: Record<DraftOrderRule, DraftOrderRuleDescription> = {
  snake: {
    rule: 'snake',
    label: 'Snake',
    description: 'Order reverses each round (1–12, then 12–1, then 1–12).',
  },
  linear: {
    rule: 'linear',
    label: 'Linear',
    description: 'Same order every round (1–12 each round).',
  },
}

/**
 * Get draft order rule and description for UI/timer logic.
 */
export function getDraftOrderRule(snakeOrLinear: string | undefined | null): DraftOrderRuleDescription {
  const key = (snakeOrLinear ?? 'snake').toString().toLowerCase()
  return RULES[key === 'linear' ? 'linear' : 'snake'] ?? RULES.snake
}

/**
 * Resolve full draft order behavior including third-round reversal support.
 */
export function getDraftOrderBehavior(
  snakeOrLinear: string | undefined | null,
  thirdRoundReversal: boolean | undefined | null
): DraftOrderBehavior {
  const base = getDraftOrderRule(snakeOrLinear)
  const enable3rr = base.rule === 'snake' && Boolean(thirdRoundReversal)
  return {
    rule: base.rule,
    thirdRoundReversal: enable3rr,
    label: enable3rr ? `${base.label} (3RR)` : base.label,
    description: enable3rr
      ? `${base.description} Third round uses reversal to reduce early-slot advantage.`
      : base.description,
  }
}
