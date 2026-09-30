import { NextResponse } from 'next/server'

/**
 * POST /api/shared/wallet/deposit — DISABLED.
 *
 * ⚠ This wrote a `completed` "Manual deposit" ledger entry for whatever amount
 * the caller sent, with no payment behind it, and `/withdraw` then filed a
 * payout request against that balance. Nothing processes payments here (the
 * `/wallet/deposit` page it was built for does not exist), so there is no
 * honest way to accept a deposit — and a fabricated balance is one manual
 * payout away from real money.
 *
 * Re-enable only behind a real payment (a verified Stripe PaymentIntent /
 * Checkout session credited from the webhook), never from the request body.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'DEPOSITS_UNAVAILABLE', message: 'Wallet deposits are not available.' },
    { status: 501 }
  )
}
