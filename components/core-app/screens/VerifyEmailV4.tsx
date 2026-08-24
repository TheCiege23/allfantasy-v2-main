'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useResendCooldown } from '@/hooks/useResendCooldown'
import {
  BangGlyph,
  CheckGlyph,
  MailGlyph,
  RecoveryAlert,
  RecoveryCard,
  RecoveryIcon,
  RecoveryNote,
  RecoveryShell,
  RecoverySub,
  RecoveryTitle,
  ShieldGlyph,
  WarnGlyph,
} from './RecoveryChrome'

/**
 * Screen 16b — post-signup email verification.
 *
 * ⚠ THE WORKFLOW IS UNCHANGED AND WAS NOT REWIRED. Same POST /api/auth/verify-
 * email/send, same /api/verify/phone/start and /check, same POST /api/auth/
 * confirm-age, and the same query-parameter vocabulary the emailed link and every
 * server redirect already use (verified=email|phone, error=EXPIRED_LINK |
 * INVALID_LINK | AGE_REQUIRED | VERIFICATION_REQUIRED, status=…). No API route
 * was added or changed.
 *
 * ⚠ THE PHONE TAB AND THE 18+ AGE GATE ARE NOT IN HANDOFF 16b AND ARE KEPT ANYWAY.
 * The handoff draws the five email states only, but ten live callers across the
 * brackets flow redirect here with error=AGE_REQUIRED or VERIFICATION_REQUIRED —
 * app/bracket/[tournamentId]/entries/new, brackets/join, brackets/leagues/new and
 * the league action buttons — and the age gate is a paid-league compliance
 * control, not decoration. Dropping either would break those flows silently, since
 * the redirect would still land on a page that no longer answers it.
 *
 * ⚠ A FAILED SEND IS NEVER REPORTED AS A SUCCESS — 16b's stated trust rule. The
 * send route answers 502 EMAIL_SEND_FAILED and discards its own half-made token
 * when the mail provider rejects; this screen renders that as the send-failed card
 * and, critically, does NOT arm the resend countdown, because a countdown implies
 * something is on its way.
 */

type Tab = 'email' | 'phone'
type SendOutcome = 'sent' | 'already' | 'rate_limited' | 'send_failed' | 'login_required' | 'error'

/** The send route's own spacing rule is 60s; the button mirrors it. */
const RESEND_COOLDOWN_SECONDS = 60

export type VerifyEmailV4Props = {
  /** From the server session — the handoff prints it in the pending card. */
  email: string | null
  /** True when the account is already verified before this page loads. */
  alreadyVerified: boolean
  signedIn: boolean
}

export function VerifyEmailV4({ email, alreadyVerified, signedIn }: VerifyEmailV4Props) {
  const searchParams = useSearchParams()
  const router = useRouter()

  const status = searchParams?.get('status')
  const error = searchParams?.get('error')
  const verified = searchParams?.get('verified')
  const methodParam = searchParams?.get('method')
  const requestedReturnTo = searchParams?.get('returnTo') || ''
  const safeReturnTo = requestedReturnTo.startsWith('/') ? requestedReturnTo : '/dashboard'

  const [tab, setTab] = useState<Tab>(methodParam === 'phone' ? 'phone' : 'email')
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<SendOutcome | null>(null)
  const [countdown, setCountdown] = useState(3)

  const [phoneNumber, setPhoneNumber] = useState('')
  const [phoneSending, setPhoneSending] = useState(false)
  const [phoneCodeSent, setPhoneCodeSent] = useState(false)
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneVerifying, setPhoneVerifying] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)

  const [ageConfirming, setAgeConfirming] = useState(false)
  const [ageError, setAgeError] = useState<string | null>(null)

  const cooldown = useResendCooldown()

  function resolveState() {
    if (verified === 'email' || verified === 'phone' || status === 'success' || phoneVerified) {
      return 'success'
    }
    if (error === 'EXPIRED_LINK' || error === 'EXPIRED_TOKEN' || status === 'expired') return 'expired'
    if (
      error === 'INVALID_LINK' ||
      error === 'INVALID_OR_USED_TOKEN' ||
      error === 'MISSING_TOKEN' ||
      status === 'invalid'
    ) {
      return 'invalid'
    }
    if (error === 'AGE_REQUIRED') return 'age_required'
    if (error === 'VERIFICATION_REQUIRED') return 'verification_required'
    if (error || status === 'error') return 'error'
    if (alreadyVerified) return 'success'
    return 'pending'
  }

  const state = resolveState()

  // 16b build note: the verified card "auto-continues". It returns the user to
  // where they were, which is what returnTo carries — falling back to /dashboard.
  useEffect(() => {
    if (state !== 'success') return
    if (countdown <= 0) {
      router.push(safeReturnTo)
      return
    }
    const timer = window.setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [state, countdown, router, safeReturnTo])

  async function handleSend() {
    if (cooldown.active || sending) return
    setSending(true)
    setOutcome(null)
    try {
      const res = await fetch('/api/auth/verify-email/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ returnTo: safeReturnTo }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        setOutcome('login_required')
        return
      }
      if (res.status === 429) {
        setOutcome('rate_limited')
        // The server's spacing rule is what the user is actually waiting on, so
        // the countdown is armed here too — unlike a failed send, a rate limit
        // does mean "wait, then try".
        cooldown.start(RESEND_COOLDOWN_SECONDS)
        return
      }
      if (res.ok && data?.alreadyVerified) {
        setOutcome('already')
        return
      }
      if (res.ok) {
        setOutcome('sent')
        cooldown.start(RESEND_COOLDOWN_SECONDS)
        return
      }
      // 502 EMAIL_SEND_FAILED and anything else non-ok. No countdown: nothing was
      // sent, so there is nothing to wait for.
      setOutcome(data?.error === 'EMAIL_SEND_FAILED' ? 'send_failed' : 'error')
    } catch {
      setOutcome('send_failed')
    } finally {
      setSending(false)
    }
  }

  async function handleSendPhoneCode() {
    if (!phoneNumber.trim()) return
    setPhoneSending(true)
    setPhoneError(null)
    try {
      const res = await fetch('/api/verify/phone/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setPhoneCodeSent(true)
        return
      }
      setPhoneError(resolvePhoneError(data?.error, data?.message, res.status))
    } catch {
      setPhoneError('Verification failed. Please try again.')
    } finally {
      setPhoneSending(false)
    }
  }

  async function handleVerifyPhoneCode() {
    if (!phoneCode.trim()) return
    setPhoneVerifying(true)
    setPhoneError(null)
    try {
      const res = await fetch('/api/verify/phone/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber.trim(), code: phoneCode.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setPhoneVerified(true)
        return
      }
      setPhoneError(resolvePhoneError(data?.error, data?.message, res.status))
    } catch {
      setPhoneError('Verification failed. Please try again.')
    } finally {
      setPhoneVerifying(false)
    }
  }

  function resolvePhoneError(code?: string, fallback?: string, httpStatus?: number): string {
    if (httpStatus === 429) return 'Too many attempts. Please wait a minute and try again.'
    switch (code) {
      case 'INVALID_PHONE':
        return 'Please enter a valid phone number with country code.'
      case 'INVALID_CODE':
        return 'That code is not right. Check it and try again.'
      case 'SEND_FAILED':
        return 'The verification text could not be sent right now.'
      case 'VERIFY_FAILED':
        return 'The verification check failed right now.'
      default:
        return fallback || 'Something went wrong. Please try again.'
    }
  }

  async function handleConfirmAge() {
    setAgeConfirming(true)
    setAgeError(null)
    try {
      const res = await fetch('/api/auth/confirm-age', { method: 'POST' })
      if (res.ok) {
        // Back to whatever gated the user — the brackets flow that sent them here.
        router.push(safeReturnTo)
        router.refresh()
        return
      }
      setAgeError('We could not record your confirmation. Please try again.')
    } catch {
      setAgeError('We could not record your confirmation. Please try again.')
    } finally {
      setAgeConfirming(false)
    }
  }

  /* ── State 2 · Verified ──────────────────────────────────────────── */
  if (state === 'success') {
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="VERIFIED" tone="good">
          <RecoveryIcon tone="good">
            <CheckGlyph />
          </RecoveryIcon>
          <RecoveryTitle>{verified === 'phone' || phoneVerified ? 'Phone verified' : 'Email verified'}</RecoveryTitle>
          <RecoverySub>
            Email alerts are unlocked and account recovery is set up. Taking you back to where you
            were.
          </RecoverySub>
          <Link href={safeReturnTo} className="af-rc-btn af-rc-btn--block">
            Continue{safeReturnTo === '/dashboard' ? ' to dashboard' : ''}
          </Link>
          <p className="af-rc-foot">Redirecting in {Math.max(0, countdown)}s…</p>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── Age gate (kept from the live page, not in the handoff) ──────── */
  if (state === 'age_required') {
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="AGE CONFIRMATION" tone="warn">
          <RecoveryIcon tone="warn">
            <WarnGlyph />
          </RecoveryIcon>
          <RecoveryTitle>Confirm you&rsquo;re 18 or older</RecoveryTitle>
          <RecoverySub>
            Paid leagues and brackets are limited to adults. Confirming takes a second and we only
            record that you did it.
          </RecoverySub>
          {ageError ? (
            <div style={{ marginTop: 18 }}>
              <RecoveryAlert mark={<BangGlyph />} title={ageError} slim />
            </div>
          ) : null}
          <button
            type="button"
            className="af-rc-btn af-rc-btn--block"
            onClick={handleConfirmAge}
            disabled={ageConfirming}
          >
            {ageConfirming ? 'Confirming…' : "I'm 18 or older"}
          </button>
          <Link href={safeReturnTo} className="af-rc-back">
            ← Back
          </Link>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── Bad link states ─────────────────────────────────────────────── */
  if (state === 'expired' || state === 'invalid' || state === 'error') {
    const expired = state === 'expired'
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow={expired ? 'LINK EXPIRED' : 'LINK PROBLEM'} tone={expired ? 'warn' : 'bad'}>
          <RecoveryIcon tone={expired ? 'warn' : 'bad'}>
            <WarnGlyph />
          </RecoveryIcon>
          <RecoveryTitle>
            {expired
              ? 'This verification link has expired'
              : state === 'invalid'
                ? 'This verification link is invalid'
                : 'We couldn’t verify your account'}
          </RecoveryTitle>
          <RecoverySub>
            {expired
              ? 'Verification links last one hour and work once. Send yourself a new one.'
              : state === 'invalid'
                ? 'It may already have been used. Send yourself a fresh link and try again.'
                : 'Nothing was changed on your account. Send a new link and try once more.'}
          </RecoverySub>

          {outcome === 'send_failed' ? (
            <div style={{ marginTop: 18 }}>
              <RecoveryAlert
                mark={<BangGlyph />}
                title="We couldn't send the verification email right now. Please try again."
              />
            </div>
          ) : null}

          {signedIn ? (
            <button
              type="button"
              className="af-rc-btn af-rc-btn--block"
              onClick={handleSend}
              disabled={sending || cooldown.active}
            >
              {cooldown.active ? `Resend in ${cooldown.label}` : sending ? 'Sending…' : 'Send a new link'}
            </button>
          ) : (
            <Link href="/login" className="af-rc-btn af-rc-btn--block">
              Sign in to resend
            </Link>
          )}
          <Link href={safeReturnTo} className="af-rc-back">
            ← Back
          </Link>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── State 4 · Send failed ───────────────────────────────────────── */
  if (outcome === 'send_failed') {
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="SEND FAILED" tone="bad" align="left">
          <RecoveryAlert
            mark={<BangGlyph />}
            title="We couldn't send the verification email right now. Please try again."
            body="The mail provider rejected it. We threw the half-made link away rather than leave a token you'd never receive."
          />
          <div className="af-rc-actions">
            <button type="button" className="af-rc-btn" onClick={handleSend} disabled={sending}>
              {sending ? 'Sending…' : 'Try again'}
            </button>
            <Link href="/contact" className="af-rc-btn af-rc-btn--ghost">
              Contact support
            </Link>
          </div>
          <p className="af-rc-foot">
            A failed send never reports success. If you didn&rsquo;t get the email, we didn&rsquo;t
            send it.
          </p>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── State 3 · Rate limited ──────────────────────────────────────── */
  if (outcome === 'rate_limited') {
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="RATE LIMITED" tone="warn" align="left">
          <RecoveryAlert
            tone="warn"
            mark={<WarnGlyph />}
            title="Please wait 60 seconds before requesting another email."
            body="Three requests every two minutes, and one minute between sends. It's a spam guard, not a punishment."
          />
          <RecoveryNote>
            Already verified on another tab? Refresh and this screen disappears — we return
            &ldquo;already verified&rdquo; rather than sending a second email.
          </RecoveryNote>
          <button
            type="button"
            className="af-rc-btn af-rc-btn--ghost af-rc-btn--block"
            onClick={handleSend}
            disabled={cooldown.active || sending}
          >
            {cooldown.active ? `Resend in ${cooldown.label}` : sending ? 'Sending…' : 'Resend email'}
          </button>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── State 1 · Pending (and the verification-required gate) ──────── */
  const gate = state === 'verification_required'

  return (
    <RecoveryShell>
      <RecoveryCard eyebrow={gate ? 'VERIFICATION REQUIRED' : 'PENDING'}>
        <RecoveryIcon>
          <MailGlyph />
        </RecoveryIcon>
        <RecoveryTitle>{gate ? 'Verify to continue' : 'Verify your email'}</RecoveryTitle>
        <RecoverySub>
          {gate ? (
            <>Leagues and brackets need a verified email or phone. It only takes a minute.</>
          ) : email ? (
            <>
              We sent a link to <strong>{email}</strong>. It expires in an hour.
            </>
          ) : (
            <>We&rsquo;ll send a link to the email on your account. It expires in an hour.</>
          )}
        </RecoverySub>

        {/*
          The method switch is the phone branch's only entry point. It is not in
          the handoff; see the file header for why it stays.
        */}
        <div className="af-rc-tabs" role="group" aria-label="Verification method">
          <button
            type="button"
            className="af-rc-tab"
            data-active={tab === 'email'}
            onClick={() => setTab('email')}
          >
            Email
          </button>
          <button
            type="button"
            className="af-rc-tab"
            data-active={tab === 'phone'}
            onClick={() => setTab('phone')}
          >
            Phone
          </button>
        </div>

        {tab === 'email' ? (
          <>
            {outcome === 'login_required' ? (
              <div style={{ marginTop: 18 }}>
                <RecoveryAlert
                  mark={<BangGlyph />}
                  title="Sign in first"
                  body="We can only send a verification link to the account you're signed in as."
                />
              </div>
            ) : null}
            {outcome === 'already' ? (
              <div style={{ marginTop: 18 }}>
                <RecoveryAlert
                  tone="warn"
                  mark={<CheckGlyph />}
                  title="You're already verified."
                  body="Nothing more to do — refresh and this screen goes away."
                  slim
                />
              </div>
            ) : null}
            {outcome === 'error' ? (
              <div style={{ marginTop: 18 }}>
                <RecoveryAlert mark={<BangGlyph />} title="Something went wrong. Please try again." slim />
              </div>
            ) : null}

            {signedIn ? (
              <button
                type="button"
                className="af-rc-btn af-rc-btn--ghost af-rc-btn--block"
                onClick={handleSend}
                disabled={cooldown.active || sending}
              >
                {cooldown.active
                  ? `Resend in ${cooldown.label}`
                  : sending
                    ? 'Sending…'
                    : outcome === 'sent'
                      ? 'Resend email'
                      : 'Send verification email'}
              </button>
            ) : (
              <Link href="/login" className="af-rc-btn af-rc-btn--block">
                Sign in to verify
              </Link>
            )}

            <RecoveryNote>
              You can keep using AllFantasy while this is pending. Requesting a new link replaces the
              old one.
            </RecoveryNote>

            <Link href="/settings?tab=account" className="af-rc-link">
              Wrong address? Change it →
            </Link>
          </>
        ) : (
          <>
            {phoneError ? (
              <div style={{ marginTop: 18 }}>
                <RecoveryAlert mark={<BangGlyph />} title={phoneError} slim />
              </div>
            ) : null}

            <div className="af-rc-form">
              <label className="af-rc-field">
                <span className="af-label">Phone</span>
                <input
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 555 123 4567"
                />
              </label>

              {phoneCodeSent ? (
                <>
                  <label className="af-rc-field">
                    <span className="af-label">6-digit code</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={phoneCode}
                      onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                    />
                  </label>
                  <button
                    type="button"
                    className="af-rc-btn"
                    onClick={handleVerifyPhoneCode}
                    disabled={phoneVerifying || phoneCode.length !== 6}
                  >
                    {phoneVerifying ? 'Checking…' : 'Verify phone'}
                  </button>
                  <button
                    type="button"
                    className="af-rc-btn af-rc-btn--ghost"
                    onClick={handleSendPhoneCode}
                    disabled={phoneSending}
                  >
                    {phoneSending ? 'Sending…' : 'Send a new code'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="af-rc-btn"
                  onClick={handleSendPhoneCode}
                  disabled={phoneSending || !phoneNumber.trim()}
                >
                  {phoneSending ? 'Sending…' : 'Text me a code'}
                </button>
              )}
            </div>
          </>
        )}
      </RecoveryCard>
    </RecoveryShell>
  )
}

export default VerifyEmailV4
