'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Heart, Loader2 } from 'lucide-react'

import { getMonetizationCatalogItemBySku } from '@/lib/monetization/catalog'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'
import { isTrustedWebActivity } from '@/lib/platform/isTrustedWebActivity'

const SKU = 'af_pro_monthly'
const RETURN_PATH = '/support/welcome'

/**
 * "Support us monthly" for people who don't play (lib/monetization/supportGuestCheckout).
 * Signed out on the web: one tick, one button, Stripe's page — no account to make. Signed in,
 * or in the Android app: the normal plan checkout, which knows the account and goes through
 * Google Play in the app.
 */
export default function SupportMonthlyCard() {
  const { status } = useSession()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const price = getMonetizationCatalogItemBySku(SKU)?.amountUsd ?? null
  const priceLabel = price != null ? `$${price.toFixed(2)}` : null

  async function accountCheckout() {
    const result = await resolveCheckoutUrl({
      sku: SKU,
      productType: 'subscription',
      returnPath: RETURN_PATH,
      entrySource: 'support_link',
    })
    if (!result.ok) throw new Error(result.error)
    if ('url' in result) window.location.href = result.url
    else window.location.href = `${RETURN_PATH}?completed=1`
  }

  async function start() {
    if (!agreed || busy) return
    setBusy(true)
    setError(null)
    try {
      if (status === 'authenticated' || isTrustedWebActivity()) {
        await accountCheckout()
        return
      }
      const res = await fetch('/api/monetization/checkout/support-guest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ageConfirmed: true }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string; message?: string }
      if (res.status === 409 && data.code === 'use_account_checkout') {
        await accountCheckout()
        return
      }
      if (!res.ok || !data.url) throw new Error(data.message || data.error || 'Something went wrong. Please try again.')
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="support-monthly-card"
      className="max-w-md mx-auto p-6 rounded-2xl space-y-5"
      style={{ background: 'var(--panel)', border: '2px solid rgba(239,68,68,0.35)' }}
    >
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Support us every month</h2>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {priceLabel ? `${priceLabel} a month. ` : ''}Cancel anytime.
          {status === 'authenticated' ? '' : ' No account or password to set up.'}
        </p>
      </div>

      <label className="flex items-start gap-3 cursor-pointer select-none text-sm" style={{ color: 'var(--text)' }}>
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-6 w-6 shrink-0 accent-red-500"
          data-testid="support-monthly-agree"
        />
        <span>
          I&apos;m 18 or older and I agree to the{' '}
          <Link href="/terms" className="underline">Terms</Link> and{' '}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </span>
      </label>

      <button
        type="button"
        onClick={start}
        disabled={!agreed || busy}
        data-testid="support-monthly-button"
        className="w-full flex items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
        style={{ background: '#ef4444' }}
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Heart className="w-5 h-5" fill="currentColor" />}
        {busy ? 'Opening payment…' : priceLabel ? `Support for ${priceLabel} a month` : 'Support monthly'}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-center" style={{ color: '#ef4444' }}>{error}</p>
      ) : null}

      <p className="text-xs text-center" style={{ color: 'var(--muted2)' }}>
        You&apos;ll type your email and card on our secure payment page. It also unlocks AF Pro, if you ever want to look around.
      </p>
    </div>
  )
}
