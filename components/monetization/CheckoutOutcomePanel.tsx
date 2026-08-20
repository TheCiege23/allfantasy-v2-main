'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { resolveLockedFeature } from '@/lib/monetization/lockedFeature'
import type { PostPurchaseSyncPhase } from '@/hooks/usePostPurchaseSync'
import '@/components/monetization/af-monetization.css'

/**
 * Screen 20c — what happened after Stripe.
 *
 * ⚠ THIS IS PRESENTATION OVER MACHINERY THAT ALREADY EXISTED, NOT A NEW FLOW.
 * `usePostPurchaseSync` already resolves five phases from the return URL, refetches
 * entitlement and token balance, retries a pending session, and fires analytics.
 * What was missing was any surface that said, in words, what the user had just
 * bought. Stripe returned them to `?checkout=success` and the page showed a toast.
 *
 * ⚠ NO NEW ROUTE, DELIBERATELY. Stripe's success_url is already
 * `{returnPath}?checkout=success&session_id=…` — it returns to whichever page
 * launched checkout. So this renders as a state on that page, which is both what
 * Stripe is configured for and what the repo's route budget allows.
 *
 * ⚠ PENDING NEVER CLAIMS THE PURCHASE SUCCEEDED. Tokens are granted by the
 * `invoice.payment_succeeded` webhook, so a session that has not settled has
 * granted nothing. Showing "here are your tokens" while the payment is still in
 * flight would be a promise made on the customer's behalf by a page that cannot
 * keep it.
 */

export type CheckoutOutcomePanelProps = {
  phase: PostPurchaseSyncPhase
  /** Retry for a session that has not settled yet. */
  onRetry?: () => void
  /** Tokens credited, when the sync has confirmed them. */
  tokensGranted?: number | null
  /** Plan name, when the purchase was a subscription. */
  planName?: string | null
  /** Next charge date, from the entitlement. */
  renewsAt?: string | null
}

export function CheckoutOutcomePanel({
  phase,
  onRetry,
  tokensGranted,
  planName,
  renewsAt,
}: CheckoutOutcomePanelProps) {
  const searchParams = useSearchParams()
  const feature = resolveLockedFeature(searchParams?.get('feature'))

  // 'idle' is "the user did not come back from checkout" — the ordinary case on a
  // pricing page, and it must render nothing at all.
  if (phase === 'idle') return null

  /*
   * ⚠ THE PRIMARY ACTION RETURNS TO THE FEATURE THEY HIT — that was the whole
   * reason the `?feature=` parameter existed and was being dropped. When the lock
   * is league- or bracket-scoped we do not hold the id, so `href` is null and this
   * degrades to a generic destination rather than guessing at a league.
   */
  const resumeHref = feature?.href ?? null
  const resumeLabel = feature ? `Back to ${feature.label}` : null

  if (phase === 'success') {
    return (
      <section className="af-mz-outcome" data-state="ok" role="status">
        <span className="af-mz-outcome-tag">Confirmed</span>
        <h2 className="af-mz-outcome-title">
          {planName ? `${planName} is active.` : 'Your purchase is complete.'}
        </h2>
        <ul className="af-mz-outcome-facts">
          {typeof tokensGranted === 'number' && tokensGranted > 0 ? (
            <li>
              <b>+{tokensGranted.toLocaleString()}</b> tokens credited
            </li>
          ) : null}
          {renewsAt ? (
            <li>
              Next charge <b>{renewsAt}</b>
            </li>
          ) : null}
          <li>Receipt sent by Stripe to your email.</li>
        </ul>
        <div className="af-mz-outcome-actions">
          {resumeHref && resumeLabel ? (
            <Link href={resumeHref} className="af-mz-btn af-mz-btn--primary">
              {resumeLabel}
            </Link>
          ) : (
            <Link href="/core" className="af-mz-btn af-mz-btn--primary">
              Go to your dashboard
            </Link>
          )}
          <Link href="/tokens" className="af-mz-btn">
            View tokens
          </Link>
        </div>
      </section>
    )
  }

  /*
   * 'syncing' and 'pending' are the same thing to a customer — the money is in
   * flight and nothing has been granted. They differ only in which side is still
   * working, which is our problem and not theirs.
   */
  if (phase === 'pending' || phase === 'syncing') {
    return (
      <section className="af-mz-outcome" data-state="wait" role="status" aria-live="polite">
        <span className="af-mz-outcome-tag">Processing</span>
        <h2 className="af-mz-outcome-title">Your payment is still going through.</h2>
        {/*
          ⚠ SAYS WHAT IS *NOT* TRUE YET, ON PURPOSE. Tokens land on
          invoice.payment_succeeded. Implying they are already there and having the
          balance read zero a moment later is worse than waiting honestly.
        */}
        <p className="af-mz-outcome-body">
          Nothing has been credited yet — tokens and plan access are granted once the payment
          settles, which is usually a few seconds. This page updates itself.
        </p>
        {onRetry ? (
          <div className="af-mz-outcome-actions">
            <button type="button" className="af-mz-btn" onClick={onRetry}>
              Check again
            </button>
          </div>
        ) : null}
      </section>
    )
  }

  const cancelled = phase === 'cancelled'
  return (
    <section className="af-mz-outcome" data-state={cancelled ? 'off' : 'bad'} role="status">
      <span className="af-mz-outcome-tag">{cancelled ? 'Cancelled' : 'Not completed'}</span>
      <h2 className="af-mz-outcome-title">
        {cancelled ? 'Checkout was cancelled.' : 'That payment did not go through.'}
      </h2>
      {/*
        ⚠ "NOTHING WAS CHARGED" IS THE SENTENCE THAT MATTERS. It is the first
        question anyone has after a failed payment, and the handoff calls for
        stating it plainly rather than leaving it to be inferred from an error code.
      */}
      <p className="af-mz-outcome-body">
        <strong>You were not charged and your plan has not changed.</strong>{' '}
        {cancelled
          ? 'Pick a plan below whenever you are ready.'
          : 'You can try again below, or use tokens for one-off access instead.'}
      </p>
    </section>
  )
}

export default CheckoutOutcomePanel
