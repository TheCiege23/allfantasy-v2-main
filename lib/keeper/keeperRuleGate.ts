/**
 * Settings-save checks for keeper rules (lib/keeper/keeperRules.ts).
 *
 * Free: cost rules (same round / N earlier / N later / inflation), the waiver-pickup round and
 * the round floor. AF Commissioner (`commissioner_automation`): the same-round rules that MOVE a
 * keeper (`lose_round_before` / `lose_round_after`) — docs/AF_COMMISSIONER_SETTINGS_SPEC.md §1.2 —
 * and the "AF picks best value" missed-deadline rule (`auto_best_value`, ./missedDeadline, §4.3).
 * AF Commissioner too (AF Supreme includes it): turning ON automatic keeper placement on the draft
 * board (`keeper_auto_place_board`, ./keeperAutoBoard). Turning it off is always free.
 * Checked only when the rule CHANGES, so a league keeps a rule saved before its plan lapsed.
 */

import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { SAME_ROUND_RESOLVING_RULES, type KeeperSameRoundRule } from './keeperRules'
import { MISSED_DEADLINE_RULES } from './missedDeadline'
import { KEEPER_AUTO_BOARD_SETTING } from './keeperAutoBoardSetting'

const ROUND_KEYS = ['keeper_waiver_cost_round', 'keeper_min_cost_round'] as const
const ALL_RULES = ['lose_round_before', 'lose_round_after', 'player_chooses', 'reject_both']

export async function keeperRuleSettingsRefusal(
  userId: string,
  body: Record<string, unknown>,
  current: { keeperConflictRule: string | null; keeperMissedDeadlineRule?: string | null; keeperAutoBoard?: boolean },
): Promise<{ status: number; message: string } | null> {
  if (body.keeperRoundPenalty != null) {
    const n = Number(body.keeperRoundPenalty)
    if (!Number.isInteger(n) || n < -5 || n > 5) return { status: 400, message: 'keeperRoundPenalty must be -5 to 5' }
  }

  const merge = body.settingsMerge && typeof body.settingsMerge === 'object' && !Array.isArray(body.settingsMerge)
    ? (body.settingsMerge as Record<string, unknown>)
    : null
  for (const key of ROUND_KEYS) {
    if (!merge || !(key in merge) || merge[key] == null) continue
    const n = Number(merge[key])
    if (!Number.isInteger(n) || n < 1 || n > 40) return { status: 400, message: `${key} must be a round from 1 to 40` }
  }

  if (merge && KEEPER_AUTO_BOARD_SETTING in merge && merge[KEEPER_AUTO_BOARD_SETTING] != null) {
    const v = merge[KEEPER_AUTO_BOARD_SETTING]
    if (typeof v !== 'boolean') return { status: 400, message: `${KEEPER_AUTO_BOARD_SETTING} must be true or false` }
    if (v && current.keeperAutoBoard !== true) {
      const access = await new FeatureGateService().evaluateUserFeatureAccess(userId, 'commissioner_automation').catch(() => null)
      if (!access?.allowed) return { status: 403, message: 'Placing keepers on the draft board automatically requires AF Commissioner or AF Supreme.' }
    }
  }

  if (body.keeperMissedDeadlineRule !== undefined && body.keeperMissedDeadlineRule !== current.keeperMissedDeadlineRule) {
    const missed = String(body.keeperMissedDeadlineRule)
    if (!(MISSED_DEADLINE_RULES as readonly string[]).includes(missed)) return { status: 400, message: 'Unknown missed-deadline keeper rule' }
    if (missed === 'auto_best_value') {
      const access = await new FeatureGateService().evaluateUserFeatureAccess(userId, 'commissioner_automation').catch(() => null)
      if (!access?.allowed) return { status: 403, message: 'Having AF pick keepers for teams that miss the deadline requires AF Commissioner.' }
    }
  }

  if (body.keeperConflictRule === undefined || body.keeperConflictRule === current.keeperConflictRule) return null
  const rule = String(body.keeperConflictRule)
  if (!ALL_RULES.includes(rule)) return { status: 400, message: 'Unknown keeper same-round rule' }
  if (!SAME_ROUND_RESOLVING_RULES.includes(rule as KeeperSameRoundRule)) return null

  const access = await new FeatureGateService().evaluateUserFeatureAccess(userId, 'commissioner_automation').catch(() => null)
  if (access?.allowed) return null
  return { status: 403, message: 'Moving same-round keepers to the round before or after requires AF Commissioner.' }
}
