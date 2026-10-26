/**
 * FAAB at season rollover — the commissioner's "Reset to the starting budget" / "Carry over what is
 * left" option (`waiverEngineConfig.faab_rollover_rule`, lib/waiver-wire/hub-waiver-options.ts).
 *
 * Before this the answer was implicit and differed by path: a redraft renewal (renewRedraftLeague,
 * renewNativeRedraft and the legacy reset in the renew route) always wrote the budget back, and a
 * keeper / dynasty renewal never touched FAAB, so each team carried last season's leftovers. Those
 * stay the defaults when the commissioner has not chosen — nothing changes for a league that never
 * opens the setting — and an explicit choice now applies to every renewal path.
 *
 * 🛑 ONLY THE ROLLOVER READS IT. Saving the setting moves no balance; it decides what the next
 * renewal writes. A balance that is NULL (FAAB never seeded) is given the budget under either rule,
 * since there is nothing to carry.
 *
 * Not built: a one-time mid-season top-up week. Reported as left.
 */
import { readFaabRolloverRule, type FaabRolloverRule } from './hub-waiver-options'
import { parseWaiverEngineConfig } from './waiver-engine-config'

export type RenewalFamily = 'redraft' | 'carry_rosters'

/** The rule a renewal applies: the commissioner's, else the family's historical behaviour. */
export function effectiveFaabRolloverRule(stored: FaabRolloverRule | null | undefined, family: RenewalFamily): FaabRolloverRule {
  if (stored === 'reset' || stored === 'carry_over') return stored
  return family === 'redraft' ? 'reset' : 'carry_over'
}

/** One team's balance after the rollover. */
export function faabBalanceAfterRollover(
  rule: FaabRolloverRule,
  startingBudget: number,
  remaining: number | null | undefined,
): number {
  if (rule === 'reset') return startingBudget
  return typeof remaining === 'number' && Number.isFinite(remaining) ? remaining : startingBudget
}

/** The stored rule from a `LeagueWaiverSettings.waiverEngineConfig` JSON. */
export function storedFaabRolloverRule(waiverEngineConfig: unknown): FaabRolloverRule | null {
  return readFaabRolloverRule(parseWaiverEngineConfig(waiverEngineConfig).faab_rollover_rule)
}
