'use client'

import { useEffect, useState } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'

import PasskeyOffer from '@/components/auth/PasskeyOffer'
import { UnlockIcon } from '@/components/auth/PasskeySignInButton'
import { SmsConsentCheckbox } from '@/components/legal/SmsConsentCheckbox'
import { canUsePasskeys, deviceUnlockName } from '@/lib/auth/passkey-client'
import { checkPhoneCode, startPhoneVerification } from '@/lib/security-settings/PhoneVerificationSettingsService'
import { takeSupportPhone } from '@/lib/monetization/supportPhoneHandoff'

type Step = 'choose' | 'phone' | 'code' | 'phone-done' | 'passkey' | 'closed'

/** "(555) 123-4567" → "•••-•••-4567": enough to recognise, nothing to copy. */
function maskedTail(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : phone
}

const panel = { background: 'var(--panel)', border: '1px solid var(--border)' }
const primary =
  'w-full flex items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-semibold disabled:opacity-50'
const secondary = 'w-full flex items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-semibold disabled:opacity-50'
const input = 'w-full rounded-xl px-4 py-4 text-lg outline-none'

/**
 * The support thank-you page, for someone who just paid with no account (lib/monetization/
 * supportGuestCheckout): they are signed in NOW, but have no password and may never find the
 * emailed button again. One question — how do you want to get back in? — with the two ways that
 * need nothing remembered:
 *
 *   Text me a code   saves and VERIFIES their phone (/api/verify/phone/start + /check, the same
 *                    calls Settings makes), which is what /login's "Text me a code" requires.
 *   Face ID          a passkey (components/auth/PasskeyOffer), only on a device that can make one.
 *
 * "Not now" just closes it: the emailed sign-in button still works.
 *
 * IF THEY TYPED A NUMBER BEFORE PAYING (app/support/SupportMonthlyCard, with the SMS consent box
 * ticked there), there is no question: the code is texted as the page opens and the only thing
 * asked is the code. The number is saved only once that code checks out.
 */
export default function SignInNextTime() {
  const [step, setStep] = useState<Step>('choose')
  const [unlock, setUnlock] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A number typed before paying: text it straight away and ask only for the code.
  useEffect(() => {
    const handoff = takeSupportPhone()
    if (!handoff) return
    setPhone(handoff.phone)
    setConsent(true)
    setStep('code')
    void (async () => {
      const result = await startPhoneVerification(handoff.phone, { smsConsent: true, consentSource: 'support_checkout' }).catch(
        () => ({ ok: false as const, error: 'NETWORK', rateLimited: false }),
      )
      if (result.ok) return
      // Could not text it: fall back to the number step, with the number filled in and the reason.
      setStep('phone')
      setError(
        result.error === 'PHONE_ALREADY_IN_USE'
          ? 'That number is already used by another AllFantasy account.'
          : result.error === 'INVALID_PHONE'
            ? 'Enter a valid phone number, including the area code.'
            : "We couldn't text that number. Check it and try again.",
      )
    })()
  }, [])

  // After mount: whether this device can use Face ID is only knowable in the browser.
  useEffect(() => {
    let live = true
    void canUsePasskeys().then((ok) => {
      if (live && ok) setUnlock(deviceUnlockName().replace(/^your /, ''))
    })
    return () => {
      live = false
    }
  }, [])

  if (step === 'closed') return null

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    if (busy) return
    setError(null)
    if (phone.replace(/\D/g, '').length < 10) {
      setError('Enter your phone number, including the area code.')
      return
    }
    if (!consent) {
      setError('Tick the box to agree to receive the text.')
      return
    }
    setBusy(true)
    try {
      const result = await startPhoneVerification(phone, { smsConsent: true, consentSource: 'support_welcome' })
      if (result.ok) {
        setCode('')
        setStep('code')
      } else if (result.error === 'PHONE_ALREADY_IN_USE') {
        setError('That number is already used by another AllFantasy account.')
      } else if (result.rateLimited) {
        setError('Please wait a couple of minutes before asking for another code.')
      } else if (result.error === 'INVALID_PHONE') {
        setError('Enter a valid phone number, including the area code.')
      } else if (result.error === 'PHONE_REGION_NOT_SUPPORTED') {
        setError('We can only text US and Canadian phone numbers right now.')
      } else {
        setError("We couldn't send a text right now. Please try again.")
      }
    } catch {
      setError("We couldn't send a text right now. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function confirmCode(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    const digits = code.replace(/\s/g, '')
    if (!/^\d{4,10}$/.test(digits)) {
      setError('Enter the 6-digit code from the text.')
      return
    }
    setBusy(true)
    try {
      const result = await checkPhoneCode(phone, digits)
      if (result.ok) setStep('phone-done')
      else if (result.error === 'RATE_LIMITED') setError('Too many tries. Please wait a minute.')
      else setError("That code didn't work. Check it, or send a new one.")
    } catch {
      setError("That didn't work. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const errorLine = error ? (
    <p role="alert" className="text-sm" style={{ color: '#ef4444' }}>
      {error}
    </p>
  ) : null

  return (
    <div className="p-5 rounded-xl text-left space-y-4" style={panel} data-testid="sign-in-next-time" data-step={step}>
      {step === 'choose' ? (
        <>
          <h2 className="text-lg font-bold text-center" style={{ color: 'var(--text)' }}>
            How do you want to sign in next time?
          </h2>
          <div className="space-y-3">
            <button
              type="button"
              className={primary}
              style={{ background: 'var(--accent, #6366f1)', color: '#fff' }}
              onClick={() => {
                setError(null)
                setStep('phone')
              }}
              data-testid="sign-in-next-time-phone"
            >
              <MessageSquare className="w-5 h-5" aria-hidden="true" />
              Text me a code
            </button>
            {unlock ? (
              <button
                type="button"
                className={secondary}
                style={{ ...panel, color: 'var(--text)' }}
                onClick={() => setStep('passkey')}
                data-testid="sign-in-next-time-passkey"
              >
                <UnlockIcon name={unlock === 'fingerprint' ? 'your fingerprint' : unlock} size={20} />
                Use {unlock}
              </button>
            ) : null}
            <button
              type="button"
              className="w-full py-2 text-sm underline"
              style={{ color: 'var(--muted)' }}
              onClick={() => setStep('closed')}
              data-testid="sign-in-next-time-skip"
            >
              Not now — I&apos;ll use the emailed button
            </button>
          </div>
        </>
      ) : null}

      {step === 'phone' ? (
        <form className="space-y-4" onSubmit={sendCode}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>
            Your phone number
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Next time you sign in, we&apos;ll text you a code. No password to remember.
          </p>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={input}
            style={{ ...panel, color: 'var(--text)' }}
            aria-label="Phone number"
            data-testid="sign-in-next-time-phone-input"
          />
          <SmsConsentCheckbox id="support-sms-consent" checked={consent} onChange={setConsent} />
          {errorLine}
          <button
            type="submit"
            className={primary}
            style={{ background: 'var(--accent, #6366f1)', color: '#fff' }}
            disabled={busy}
            data-testid="sign-in-next-time-send"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {busy ? 'Sending…' : 'Text me the code'}
          </button>
          <button type="button" className="w-full py-2 text-sm underline" style={{ color: 'var(--muted)' }} onClick={() => setStep('choose')}>
            Back
          </button>
        </form>
      ) : null}

      {step === 'code' ? (
        <form className="space-y-4" onSubmit={confirmCode}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>
            Enter the code
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            We texted a code to {maskedTail(phone)}.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${input} tracking-widest text-center`}
            style={{ ...panel, color: 'var(--text)' }}
            aria-label="Code from the text"
            data-testid="sign-in-next-time-code"
          />
          {errorLine}
          <button
            type="submit"
            className={primary}
            style={{ background: 'var(--accent, #6366f1)', color: '#fff' }}
            disabled={busy}
            data-testid="sign-in-next-time-confirm"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <div className="flex justify-between text-sm">
            <button type="button" className="underline" style={{ color: 'var(--muted)' }} onClick={() => void sendCode()} disabled={busy}>
              Send a new code
            </button>
            <button
              type="button"
              className="underline"
              style={{ color: 'var(--muted)' }}
              onClick={() => {
                setError(null)
                setStep('phone')
              }}
            >
              Change number
            </button>
          </div>
        </form>
      ) : null}

      {step === 'phone-done' ? (
        <div className="space-y-2 text-center" data-testid="sign-in-next-time-done">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>
            Your phone is saved
          </h2>
          <p className="text-base" style={{ color: 'var(--muted)' }}>
            Next time, go to <strong>Sign in</strong>, tap <strong>Text me a code</strong>, and enter {maskedTail(phone)}.
          </p>
        </div>
      ) : null}

      {step === 'passkey' ? <PasskeyOffer compact onDone={() => setStep('closed')} /> : null}
    </div>
  )
}
