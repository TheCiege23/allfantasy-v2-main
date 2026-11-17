import { logAuditEntry } from './auditService'

/**
 * Why a zombie week was held for review, said in words a commissioner can act on.
 *
 * 🛑 A HELD WEEK USED TO SAY NOTHING ABOUT WHY. The weekly settlement holds a week (`review_required`) when one of
 * ~22 `ZOMBIE_WINNINGS_*` / `ZOMBIE_ITEMS_*` checks fails while it captures the week's settlement snapshot
 * (lib/zombie/weeklyResolutionEngine.ts). The code was thrown away: the row kept only its status, and the alert said
 * "Review the saved policy, roles, item score receipts and opening balances" whatever the cause. Now the code is
 * written to the zombie audit log with the hold, and read back for the commissioner (no schema change).
 *
 * Three kinds, because they need three different responses:
 *   - `commissioner` — the commissioner can fix it on the league screens, then retry;
 *   - `scores`       — a matchup's scores are missing or still settling; wait for the score sync, then retry;
 *   - `support`      — the saved game state is inconsistent and needs AllFantasy support. Retrying is harmless
 *                      (the week holds again with the same reason) but will not fix it.
 * An unknown code is `support`: a reason nobody wrote down is not one a commissioner can fix.
 */

export const SETTLEMENT_HELD_ACTION = 'SETTLEMENT_HELD'
export const SETTLEMENT_RELEASED_ACTION = 'COMMISSIONER_RELEASED_SETTLEMENT_HOLD'

export type HoldReasonKind = 'commissioner' | 'scores' | 'support'
export type HoldReason = { code: string; kind: HoldReasonKind; text: string }

const STATUS_TEXT = "A team's status isn't Survivor, Zombie, Whisperer or Revived. Fix it with Override status, then retry."
const SCORE_TEXT = "A matchup's scores are missing or don't match their item receipts yet. Wait for the score sync to finish, then retry."
const SUPPORT_TEXT = "This week's saved game state is inconsistent. Contact AllFantasy support before retrying; a retry holds it again for the same reason."

const REASONS: Record<string, Omit<HoldReason, 'code'>> = {
  ZOMBIE_WINNINGS_STATUS_REQUIRED: { kind: 'commissioner', text: STATUS_TEXT },
  ZOMBIE_ITEMS_UNKNOWN_ROLE: { kind: 'commissioner', text: STATUS_TEXT },
  ZOMBIE_WINNINGS_WHISPERER_PAIR_REVIEW_REQUIRED: {
    kind: 'commissioner',
    text: 'Two Whisperers face each other this week, which the 2025 rules do not settle. Resolve the Whisperer role through its offer workflow, then retry.',
  },
  ZOMBIE_WINNINGS_INVALID_SCORE: { kind: 'scores', text: SCORE_TEXT },
  ZOMBIE_ITEMS_INVALID_SCORE: { kind: 'scores', text: SCORE_TEXT },
  ZOMBIE_ITEMS_MISSING_SCORE_RECEIPT: { kind: 'scores', text: SCORE_TEXT },
  ZOMBIE_ITEMS_SCORE_RECEIPT_MISMATCH: { kind: 'scores', text: SCORE_TEXT },
}

export function describeHoldReason(code: string | null | undefined): HoldReason {
  const c = typeof code === 'string' && code.trim() ? code.trim() : 'UNKNOWN'
  const known = REASONS[c]
  return { code: c, ...(known ?? { kind: 'support', text: SUPPORT_TEXT }) }
}

/** Written beside the hold, best-effort: a failed log must not stop the hold itself. */
export async function recordSettlementHold(zombieLeagueId: string, week: number, code: string): Promise<void> {
  const reason = describeHoldReason(code)
  await logAuditEntry(zombieLeagueId, {
    category: 'weekly_update',
    action: SETTLEMENT_HELD_ACTION,
    description: `Week ${week} settlement held: ${reason.text}`,
    week,
    actorRole: 'system',
    newState: { code: reason.code, kind: reason.kind },
    isVisibleToAffectedUser: false,
  }).catch(() => {})
}
