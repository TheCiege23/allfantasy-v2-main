/**
 * Which rules a `settings_changed` event may carry, and the before/after diff. Pure and client-safe.
 */

import { sameRuleValue } from './compare'
import type { RuleChange, RuleKey, RuleSnapshot } from './types'

/**
 * Keys a change may name. Anything else on a stored event is ignored, never displayed. Every key here
 * has a label and value sentences in lib/i18n/league-rules-copy.ts (pinned by the explainer test).
 */
export const CHANGEABLE_RULE_KEYS: readonly RuleKey[] = [
  'teamCount',
  'feederScoring', 'feederRosterSize', 'feederBenchSize', 'feederWaiverType',
  'feederFaabBudget', 'feederFaabReset', 'feederTradeDeadline', 'feederTradeLockHours',
  'scoringMode',
  'scoringPreset',
  'categoryRecordMode',
  'rosterSlots',
  'medianGame',
  'playoffTeams',
  'playoffStartWeek',
  'playoffWeeksPerRound',
  'championshipLength',
  'playoffSeries',
  'playoffByes',
  'thirdPlaceGame',
  'tradeDeadlineWeek',
  'tradeDeadlineAt',
  'tradeReview',
  'tradeReviewHours',
  'waiverType',
  'waiverBudget',
  'waiverMinBid',
  'waiverHours',
  'waiverDays',
  'waiverProcessHour',
  'lineupMode',
  'teamsPerChop',
  'chopStartWeek',
  'chopEndWeek',
  'chopSteps',
  'chopOverrides',
  'chopImmunity',
  'endgame',
  'tiebreakers',
  'statCorrectionHours',
  'dangerMarginPoints',
  'releaseTiming',
  'faabOnChop',
  'keeperCount',
  'keeperCost',
  'keeperMaxYears',
  'pickTrading',
  'pickTradeDeadline',
  'pickTerms',
  'taxiSlots',
  'taxiEligibilityYears',
  'taxiDeadlineWeek',
  'taxiMaxYears',
  'taxiStealing',
  'rookieDraftOrder',
  'rookieDraftRounds',
  'rookieDraftType',
  'rookieDraftAutoStartDays',
  // The rookie lottery's own settings (./loadDraftRules.ts loadRookieLotteryRules).
  'rookieDraftLottery',
  'tankingPenalty',
  // The main draft (./loadDraftRules.ts). `draftStatus` and `draftAuctionMinBid` are never changes.
  'draftType',
  'draftRounds',
  'draftPickSeconds',
  'draftOvernightPause',
  'draftOnTimeout',
  'draftOrderMethod',
  'draftThirdRoundReversal',
  'draftAuctionBudget',
  'draftStartAt',
  'draftAutostart',
  'draftOrphanPicks',
  // Devy / C2C college rounds of the main draft (./loadDraftRules.ts).
  'draftDevyRounds',
  'draftCollegeRounds',
]

const CHANGEABLE = new Set<string>(CHANGEABLE_RULE_KEYS)

export function isChangeableRuleKey(key: unknown): key is RuleKey {
  return typeof key === 'string' && CHANGEABLE.has(key)
}

/**
 * Before/after for every rule that differs. Only keys present on BOTH sides are compared — a key the
 * caller could not read on one side (e.g. roster slots on a settings save) is not a change.
 */
export function diffRuleSnapshots(before: Partial<RuleSnapshot>, after: Partial<RuleSnapshot>): RuleChange[] {
  const out: RuleChange[] = []
  for (const key of CHANGEABLE_RULE_KEYS) {
    if (!(key in before) || !(key in after)) continue
    const b = before[key] ?? null
    const a = after[key] ?? null
    if (!sameRuleValue(b, a)) out.push({ key, before: b, after: a })
  }
  return out
}
