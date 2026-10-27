/**
 * Survivor AI actions → AF Token spend rule codes (`lib/tokens/pricing-matrix.ts`).
 *
 * 🛑 THE COST IS READ FROM THE MATRIX, NEVER TYPED HERE (2026-09-29). This file carried its own
 * 15 / 50 / 100 beside each rule code while the matrix — which seeds the `tokenSpendRule` rows the
 * charge actually reads (`TOKEN_SPEND_RULE_SEEDS`) — says 10 / 30 / 75 / 200. The command centre
 * showed the typed numbers, so every price on it was wrong. `tokenCost` below is the matrix's base
 * cost for the rule; a plan discount can only lower what is charged, and the confirmation prompt
 * states the exact figure before any spend.
 */

import type { TokenSpendRuleCode } from '@/lib/tokens/constants'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'
import type { SurvivorAIType } from '@/lib/survivor/ai/SurvivorAIContext'

export type SurvivorAiActionId =
  | 'vote_risk_quick'
  | 'idol_advice_simple'
  | 'minigame_recommendation_one'
  | 'recap_short'
  | 'juror_sentiment_hint'
  | 'confessional_polish'
  | 'weekly_advice_package'
  | 'tribe_analysis_deep'
  | 'challenge_strategy_breakdown'
  | 'jury_management_advice'
  | 'blindside_risk_breakdown'
  | 'idol_timing_breakdown'
  | 'alliance_threat_scan'
  | 'full_episode_recap'
  | 'season_story_package'
  | 'host_vote_processing_assist'
  | 'host_idol_validation_assist'
  | 'host_minigame_grading_assist'
  | 'host_anti_collusion_scan'
  | 'host_fairness_report'
  | 'host_weekly_recap_generator'
  | 'host_story_mode_pack'

export type SurvivorAiActionMeta = {
  id: SurvivorAiActionId
  label: string
  /** The matrix's base cost for `ruleCode`. Null only if the rule is missing from the matrix. */
  tokenCost: number | null
  ruleCode: TokenSpendRuleCode
  /** Player-facing vs host/commissioner automation */
  lane: 'player' | 'host'
}

const SURVIVOR_AI_ACTION_ROWS: readonly Omit<SurvivorAiActionMeta, 'tokenCost'>[] = [
  { id: 'vote_risk_quick', label: 'Quick vote-risk check', ruleCode: 'survivor_ai_vote_risk_quick', lane: 'player' },
  { id: 'idol_advice_simple', label: 'Simple idol advice', ruleCode: 'survivor_ai_idol_advice_simple', lane: 'player' },
  { id: 'minigame_recommendation_one', label: 'One mini-game recommendation', ruleCode: 'survivor_ai_minigame_one', lane: 'player' },
  { id: 'recap_short', label: 'Short recap', ruleCode: 'survivor_ai_recap_short', lane: 'player' },
  { id: 'juror_sentiment_hint', label: 'Juror sentiment hint', ruleCode: 'survivor_ai_jury_sentiment_hint', lane: 'player' },
  { id: 'confessional_polish', label: 'Confessional polish', ruleCode: 'survivor_ai_confessional_polish', lane: 'player' },
  { id: 'weekly_advice_package', label: 'Weekly Survivor advice package', ruleCode: 'survivor_ai_weekly_advice_pack', lane: 'player' },
  { id: 'tribe_analysis_deep', label: 'Deeper tribe analysis', ruleCode: 'survivor_ai_tribe_analysis_deep', lane: 'player' },
  { id: 'challenge_strategy_breakdown', label: 'Challenge strategy breakdown', ruleCode: 'survivor_ai_challenge_strategy', lane: 'player' },
  { id: 'jury_management_advice', label: 'Jury management advice', ruleCode: 'survivor_ai_jury_management', lane: 'player' },
  { id: 'blindside_risk_breakdown', label: 'Blindside risk breakdown', ruleCode: 'survivor_ai_blindside_risk', lane: 'player' },
  { id: 'idol_timing_breakdown', label: 'Idol timing breakdown', ruleCode: 'survivor_ai_idol_timing', lane: 'player' },
  { id: 'alliance_threat_scan', label: 'Full alliance / threat scan', ruleCode: 'survivor_ai_alliance_threat_scan', lane: 'player' },
  { id: 'full_episode_recap', label: 'Full episode recap', ruleCode: 'survivor_ai_episode_recap_full', lane: 'player' },
  { id: 'season_story_package', label: 'Season-wide story package', ruleCode: 'survivor_ai_season_story_pack', lane: 'player' },
  { id: 'host_vote_processing_assist', label: 'Automated vote processing assist', ruleCode: 'survivor_ai_host_vote_processing', lane: 'host' },
  { id: 'host_idol_validation_assist', label: 'Idol / advantage validation assist', ruleCode: 'survivor_ai_host_idol_validation', lane: 'host' },
  { id: 'host_minigame_grading_assist', label: 'Mini-game grading assist', ruleCode: 'survivor_ai_host_minigame_grade', lane: 'host' },
  { id: 'host_anti_collusion_scan', label: 'Anti-collusion investigation', ruleCode: 'survivor_ai_host_anti_collusion', lane: 'host' },
  { id: 'host_fairness_report', label: 'Commissioner fairness report', ruleCode: 'survivor_ai_host_fairness_report', lane: 'host' },
  { id: 'host_weekly_recap_generator', label: 'Weekly recap generator', ruleCode: 'survivor_ai_host_weekly_recap', lane: 'host' },
  { id: 'host_story_mode_pack', label: 'Story mode control pack', ruleCode: 'survivor_ai_host_story_mode', lane: 'host' },
] as const

export const SURVIVOR_AI_ACTIONS: readonly SurvivorAiActionMeta[] = SURVIVOR_AI_ACTION_ROWS.map((row) => ({
  ...row,
  tokenCost: getTokenSpendRuleMatrixEntry(row.ruleCode)?.tokenCost ?? null,
}))

const BY_ID = new Map<SurvivorAiActionId, SurvivorAiActionMeta>(
  SURVIVOR_AI_ACTIONS.map((a) => [a.id, a]),
)

export function getSurvivorAiAction(id: SurvivorAiActionId): SurvivorAiActionMeta | undefined {
  return BY_ID.get(id)
}

/**
 * 🛑 WHAT IS ACTUALLY SOLD (2026-10-27). The rows above are the pricing catalogue; only these AI
 * request types exist (`POST .../survivor/ai`), and each charges ONE rule. This map is the single
 * source the route guard charges from and the command centre lists from, so the price list can
 * never again offer an action nobody built (13 of the 22 rows above had no code behind them).
 */
export const SURVIVOR_AI_TYPE_RULE_CODE = {
  host_challenge: 'survivor_ai_host_weekly_recap',
  host_merge: 'survivor_ai_host_minigame_grade',
  host_council: 'survivor_ai_host_vote_processing',
  host_jury: 'survivor_ai_host_story_mode',
  tribe_help: 'survivor_ai_vote_risk_quick',
  tribal_help: 'survivor_ai_blindside_risk',
  exile_help: 'survivor_ai_recap_short',
  bestball_help: 'survivor_ai_challenge_strategy',
} as const satisfies Partial<Record<SurvivorAIType, TokenSpendRuleCode>>

export type SurvivorPaidAiType = keyof typeof SURVIVOR_AI_TYPE_RULE_CODE

/** What each paid request does, in the words a manager would use. */
const SURVIVOR_PAID_AI_LABELS: Record<SurvivorPaidAiType, string> = {
  tribe_help: 'Tribe strategy help',
  tribal_help: 'Tribal Council strategy help',
  exile_help: 'Exile Island help',
  bestball_help: 'Best-ball lineup help',
  host_challenge: 'Challenge announcement',
  host_merge: 'Merge announcement',
  host_council: 'Tribal Council narration',
  host_jury: 'Jury and finale narration',
}

export type SurvivorSoldAiAction = { aiType: SurvivorPaidAiType; label: string; lane: 'player' | 'host'; tokenCost: number | null; ruleCode: TokenSpendRuleCode }

/** The paid Survivor AI actions that exist, with the price their rule charges. */
export const SURVIVOR_SOLD_AI_ACTIONS: readonly SurvivorSoldAiAction[] = (Object.keys(SURVIVOR_AI_TYPE_RULE_CODE) as SurvivorPaidAiType[]).map((aiType) => {
  const ruleCode = SURVIVOR_AI_TYPE_RULE_CODE[aiType]
  return {
    aiType,
    label: SURVIVOR_PAID_AI_LABELS[aiType],
    lane: aiType.startsWith('host_') ? 'host' : 'player',
    tokenCost: getTokenSpendRuleMatrixEntry(ruleCode)?.tokenCost ?? null,
    ruleCode,
  }
})
