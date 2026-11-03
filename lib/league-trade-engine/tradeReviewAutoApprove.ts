/**
 * TRADES DON'T WAIT FOREVER (phase 13, 2026-10-29) — the commissioner's opt-in.
 *
 * In a commissioner-review league an accepted trade sits in `awaiting_commissioner` until the
 * commissioner acts, and a commissioner who is away freezes both teams' trade indefinitely. With this
 * on, a trade still waiting `AUTO_APPROVE_HOURS` after it was accepted is approved by AllFantasy,
 * through the same processing the commissioner's Approve uses. The commissioner is told at
 * `WARN_HOURS` that it will happen, and again when it does.
 *
 * 🛑 A FLAGGED TRADE NEVER PASSES ON THE CLOCK. Any OPEN integrity flag on the trade — whatever its
 * severity, whatever the league's hold setting — keeps it waiting for a person. (The native redraft
 * review sweep, lib/redraft/tradeReviewWindowSweep.ts, has its own window and already leaves held
 * trades out; this is the same promise for league trades.)
 *
 * ⚠ "UNFLAGGED" MEANS NO OPEN FLAG, NOT "CHECKED CLEAN". The integrity check runs before approval only
 * where the league holds flagged trades (AF Commissioner); elsewhere it runs after the trade settles and
 * alerts — exactly as it does for a commissioner's own approval.
 *
 * Off unless the commissioner turns it on. Stored as `League.settings.trade_review_auto_approve`. Pure.
 */
export const TRADE_REVIEW_AUTO_APPROVE_KEY = 'trade_review_auto_approve'
export const AUTO_APPROVE_HOURS = 48
export const WARN_HOURS = 24
const HOUR_MS = 3_600_000

export function tradeReviewAutoApproveOn(settings: unknown): boolean {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  return s[TRADE_REVIEW_AUTO_APPROVE_KEY] === true
}

export type AutoApproveDecision = 'approve' | 'warn' | 'wait' | 'flagged'

export function autoApproveDecision(args: { acceptedAt: Date | null; now: Date; flagged: boolean }): AutoApproveDecision {
  if (args.flagged) return 'flagged'
  if (!args.acceptedAt) return 'wait'
  const age = args.now.getTime() - args.acceptedAt.getTime()
  if (age >= AUTO_APPROVE_HOURS * HOUR_MS) return 'approve'
  if (age >= WARN_HOURS * HOUR_MS) return 'warn'
  return 'wait'
}
