'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { signIn, useSession } from 'next-auth/react'
import { Heart, Loader2 } from 'lucide-react'

import { getMonetizationCatalogItemBySku } from '@/lib/monetization/catalog'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'
import { isTrustedWebActivity } from '@/lib/platform/isTrustedWebActivity'
import { useGooglePlayPrices } from '@/lib/monetization/google-play-client'
import { buildSignupConsentCookie } from '@/lib/auth/signupConsentCookie'
import { SmsConsentCheckbox } from '@/components/legal/SmsConsentCheckbox'
import { clearSupportPhone, saveSupportPhone } from '@/lib/monetization/supportPhoneHandoff'

const SKU = 'af_pro_monthly'
const RETURN_PATH = '/support/welcome'
const AGREED_KEY = 'af:support-monthly-agreed'

/**
 * "Support us monthly" for people who don't play (lib/monetization/supportGuestCheckout).
 * Signed out on the web: one tick, one button, Stripe's page — no account to make. Signed in,
 * or in the Android app: the normal plan checkout, which knows the account and goes through
 * Google Play in the app.
 *
 * ANDROID APP, SIGNED OUT: Google Play needs an account before it can sell, so the button is
 * "Continue with Google" — one tap, no username or password — and Google brings them straight back
 * here signed in, where the next tap opens Play's payment sheet. It cannot open by itself: Play's
 * sheet needs a fresh tap from the person, and the trip to Google is not one.
 *
 * (The iOS app never shows this page: /support is closed there, because Apple refuses donations
 * through in-app purchase. iPhone users sign in with Apple on /login and /signup —
 * components/auth/AppleNativeSignInButton — and buy AF Pro through Apple on the plan pages.)
 */
export default function SupportMonthlyCard() {
  const { status } = useSession()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inAndroidApp, setInAndroidApp] = useState(false)
  const [backFromGoogle, setBackFromGoogle] = useState(false)
  // Optional, web only: a number to text a sign-in code to after paying (lib/monetization/supportPhoneHandoff).
  const [phone, setPhone] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)
  useEffect(() => {
    setInAndroidApp(isTrustedWebActivity())
    // The tick survives the trip to Google, so nobody is asked to agree twice in a row.
    try {
      if (window.sessionStorage.getItem(AGREED_KEY) === '1') {
        window.sessionStorage.removeItem(AGREED_KEY)
        setAgreed(true)
        setBackFromGoogle(true)
      }
    } catch {
      /* storage blocked: they tick again */
    }
  }, [])
  const play = useGooglePlayPrices()
  const price = getMonetizationCatalogItemBySku(SKU)?.amountUsd ?? null
  // In the Android app the price shown must be Google Play's own figure, in local currency.
  const priceLabel = inAndroidApp ? (play.prices[SKU] ?? null) : price != null ? `$${price.toFixed(2)}` : null
  const needsGoogleFirst = inAndroidApp && status === 'unauthenticated'
  // The no-account web checkout is the only path that ends on the page that texts the code.
  const offersPhone = !inAndroidApp && status !== 'authenticated'

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
      if (needsGoogleFirst) {
        // The tick rides the round trip to Google (lib/auth/signupConsentCookie), so a new account
        // records the 18+ consent the person just gave.
        document.cookie = buildSignupConsentCookie(window.location.protocol === 'https:')
        try {
          window.sessionStorage.setItem(AGREED_KEY, '1')
        } catch {
          /* storage blocked: they tick again on return */
        }
        await signIn('google', { callbackUrl: '/support#monthly' })
        return
      }
      if (status === 'authenticated' || inAndroidApp) {
        await accountCheckout()
        return
      }
      if (offersPhone && phone.trim()) {
        if (phone.replace(/\D/g, '').length < 10) throw new Error('Enter your phone number with the area code, or leave it blank.')
        if (!smsConsent) throw new Error('Tick the text-message box, or leave the phone number blank.')
        saveSupportPhone(phone.trim())
      } else {
        clearSupportPhone()
      }
      const res = await fetch('/api/monetization/checkout/support-guest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ageConfirmed: true }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string; message?: string }
      if (res.status === 409 && data.code === 'use_account_checkout') {
        clearSupportPhone() // the signed-in checkout does not end on the page that texts it
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
      id="monthly"
      data-testid="support-monthly-card"
      className="max-w-md mx-auto p-6 rounded-2xl space-y-5 scroll-mt-6"
      style={{ background: 'var(--panel)', border: '2px solid rgba(239,68,68,0.35)' }}
    >
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Support us every month</h2>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {priceLabel ? `${priceLabel} a month. ` : ''}Cancel anytime.
          {status === 'authenticated'
            ? ''
            : needsGoogleFirst
              ? ' Sign in with Google in one tap, no password.'
              : ' No account or password to set up.'}
        </p>
        {backFromGoogle && status === 'authenticated' ? (
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }} data-testid="support-monthly-signed-in">
            You&apos;re signed in. Tap the button to finish.
          </p>
        ) : null}
      </div>

      {offersPhone ? (
        <div className="space-y-2" data-testid="support-monthly-phone">
          <label className="block text-sm font-semibold" style={{ color: 'var(--text)' }} htmlFor="support-monthly-phone">
            Phone number <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
          </label>
          <input
            id="support-monthly-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-base outline-none"
            style={{ background: 'var(--panel2, var(--panel))', border: '1px solid var(--border)', color: 'var(--text)' }}
            data-testid="support-monthly-phone-input"
          />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            After you pay, we&apos;ll text you a code so you can sign in later without a password.
          </p>
          {phone.trim() ? <SmsConsentCheckbox id="support-monthly-sms-consent" checked={smsConsent} onChange={setSmsConsent} /> : null}
        </div>
      ) : null}

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
        className="w-full flex items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold transition active:scale-[0.98] disabled:opacity-50"
        /* White inline, not a text-white class: light mode's readability rule (.mode-readable
           [class*="text-white"], !important) turns any text-white class dark. */
        style={{ background: '#ef4444', color: '#fff' }}
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : needsGoogleFirst ? null : <Heart className="w-5 h-5" fill="currentColor" />}
        {needsGoogleFirst
          ? busy ? 'Opening Google…' : 'Continue with Google'
          : busy ? 'Opening payment…' : priceLabel ? `Support for ${priceLabel} a month` : 'Support monthly'}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-center" style={{ color: '#ef4444' }}>{error}</p>
      ) : null}

      <p className="text-xs text-center" style={{ color: 'var(--muted2)' }}>
        {inAndroidApp
          ? 'You pay through Google Play.'
          : "You'll type your email and card on our secure payment page."}{' '}
        It also unlocks AF Pro, if you ever want to look around.
      </p>
    </div>
  )
}
