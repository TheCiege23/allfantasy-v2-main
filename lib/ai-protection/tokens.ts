/**
 * Token enforcement for AI: check balance before allowing a request.
 * Uses persisted token balance from UserTokenBalance.
 */

import { TokenSpendService } from "@/lib/tokens/TokenSpendService"

export type TokenCheckResult = {
  allowed: boolean
  remaining?: number
  /** When not allowed, suggested retry message. */
  message?: string
}

/**
 * Check if the user has enough balance for estimated cost.
 * estimatedCost: optional tokens to deduct for this request.
 * Returns { allowed: true } when balance is not yet implemented.
 */
export async function checkTokenBalance(
  userId: string | null,
  estimatedCost: number = 0
): Promise<TokenCheckResult> {
  if (!userId) {
    return {
      allowed: false,
      remaining: 0,
      message: "Sign in to use token-metered Chimmy features.",
    }
  }

  const required = Math.max(0, Math.trunc(estimatedCost))
  if (required <= 0) {
    return { allowed: true }
  }

  const service = new TokenSpendService()
  const snapshot = await service.getBalance(userId)
  const remaining = Math.max(0, snapshot.balance - required)
  if (snapshot.balance < required) {
    return {
      allowed: false,
      remaining,
      message: `Need ${required} tokens. Current balance: ${snapshot.balance}.`,
    }
  }

  return { allowed: true, remaining }
}

/**
 * @deprecated DO NOT CALL — this is a no-op stub that will be removed.
 *
 * Token deductions MUST go through `TokenSpendService.spendTokensForRule()`
 * which enforces spend rules, writes a real `TokenLedger` row, handles the
 * dev-admin bypass, and respects idempotency.
 *
 * Calling this function does nothing: no DB write, no balance check.
 * It exists only to prevent compile errors in legacy call-sites; any remaining
 * call-sites should be migrated to `spendTokensForRule`.
 */
export async function deductTokens(
  _userId: string | null,
  _cost: number
): Promise<{ ok: boolean }> {
  if (process.env.NODE_ENV === "development") {
    console.warn(
      "[deductTokens] Called the no-op token deduction stub. " +
        "Use TokenSpendService.spendTokensForRule() instead."
    )
  }
  return { ok: true }
}
