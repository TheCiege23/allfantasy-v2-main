'use client'

import { useEffect, useState } from 'react'
import { useEntitlement } from '@/hooks/useEntitlement'
import { isInIosAppClient } from '@/lib/platform/iosApp'
import { BILLING_PORTAL_HREF, formatBillingDate } from '@/lib/billing/retention'

/**
 * "Your payment didn't go through" across the top of every /core screen while a plan is past due or in
 * its grace period (lib/billing/retention.ts). Before this the only sign was losing access.
 *
 * Not in the HomePromptSlot queue on purpose: that slot shows one optional prompt, on home only, and a
 * failing card is neither optional nor a home-screen matter. It renders nothing in the common case.
 *
 * 🛑 Never in the iOS app: it links to a card form outside Apple's purchases (App Store 3.1.1); the email
 * reaches those people instead. Hidden for the synthetic dev-admin grant, which has no card to update.
 * Dismissal lasts for this browser session only — the problem has not gone away.
 */
const DISMISS_KEY = 'af-payment-issue-dismissed'

export function PaymentIssueBanner() {
  const { entitlement, isAdminBypassAccount } = useEntitlement()
  const [inIosApp, setInIosApp] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    setInIosApp(isInIosAppClient())
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      /* storage blocked: the banner simply shows */
    }
  }, [])

  const status = entitlement?.status
  if (inIosApp || dismissed || isAdminBypassAccount || (status !== 'grace' && status !== 'past_due')) return null
  const ends = entitlement?.gracePeriodEnd ? new Date(entitlement.gracePeriodEnd) : null
  const endsOn = ends && !Number.isNaN(ends.getTime()) ? formatBillingDate(ends) : null

  return (
    <div
      role="alert"
      data-testid="payment-issue-banner"
      className="mx-3 mt-3 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm"
      style={{ borderColor: 'var(--warn, #f59e0b)', background: 'var(--panel, #111827)', color: 'var(--text, #f9fafb)' }}
    >
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Your payment didn&apos;t go through.</span>{' '}
        {endsOn ? `Update your card to keep AF Pro. Access stays on until ${endsOn}.` : 'Update your card to keep AF Pro.'}
      </p>
      <a
        href={BILLING_PORTAL_HREF}
        className="af-btn inline-flex min-h-[44px] items-center rounded-xl px-4 font-semibold"
        data-testid="payment-issue-update-card"
      >
        Update card
      </a>
      <button
        type="button"
        aria-label="Dismiss"
        className="min-h-[44px] min-w-[44px] rounded-lg"
        style={{ color: 'var(--muted, #9ca3af)' }}
        onClick={() => {
          setDismissed(true)
          try {
            sessionStorage.setItem(DISMISS_KEY, '1')
          } catch {
            /* fine: dismissed for this page view */
          }
        }}
      >
        ×
      </button>
    </div>
  )
}
