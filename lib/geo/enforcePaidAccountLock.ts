import { NextResponse } from "next/server"

import { ACCOUNT_CARD_PAID_BLOCK, ACCOUNT_FULL_BLOCK } from "./accountGeoLock"
import { readAccountGeoLockFresh } from "./accountGeoLockServer"
import { CARD_PAID_LOCK_MESSAGE, CARD_PAID_LOCK_REDIRECT } from "./cardLockCopy"

/**
 * Refuse a checkout for an account locked out of paid features — BEFORE any
 * Stripe call, so a locked account never reaches a charge the webhook would then
 * have to refund.
 *
 * ⚠ WHY HERE AS WELL AS IN THE MIDDLEWARE. The middleware reads the lock off the
 * session token, which is only as fresh as the last session refresh; a buyer
 * refunded a minute ago can still hold a token that predates the lock. This reads
 * the database.
 *
 * Fails OPEN on a failed read (`undefined`): an outage must not close checkout
 * for everyone, and the webhook's card check still stands behind it.
 */
export async function enforcePaidAccountLock(userId: string): Promise<NextResponse | null> {
  const lock = await readAccountGeoLockFresh(userId)
  if (lock === ACCOUNT_CARD_PAID_BLOCK) {
    return NextResponse.json(
      {
        error: "PAID_GEO_BLOCKED",
        reason: "billing_address",
        message: CARD_PAID_LOCK_MESSAGE,
        redirectTo: CARD_PAID_LOCK_REDIRECT,
        allowFree: true,
      },
      { status: 451 },
    )
  }
  if (lock === ACCOUNT_FULL_BLOCK) {
    return NextResponse.json(
      { error: "GEO_BLOCKED", reason: "account", redirectTo: "/geo-blocked?reason=account" },
      { status: 403 },
    )
  }
  return null
}
