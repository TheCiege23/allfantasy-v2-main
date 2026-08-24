'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import {
  isValidPhoneE164,
  normalizePhoneE164,
} from '@/lib/auth/ForgotPasswordFlowController'
import { resolvePasswordResetErrorMessage } from '@/lib/auth/AuthErrorMessageResolver'
import {
  requestPasswordResetByEmail,
  requestPasswordResetBySms,
} from '@/lib/auth/PasswordRecoveryService'
import {
  resetPasswordWithCode,
  verifyResetCode,
} from '@/lib/auth/ResetCodeVerificationService'
import { useResendCooldown } from '@/hooks/useResendCooldown'
import {
  BangGlyph,
  CheckGlyph,
  EyeGlyph,
  MailGlyph,
  RecoveryAlert,
  RecoveryCard,
  RecoveryIcon,
  RecoveryNote,
  RecoveryShell,
  RecoverySub,
  RecoveryTitle,
} from './RecoveryChrome'

/**
 * Screen 16a states 1 and 2 — request a reset link, and the "check your email"
 * confirmation.
 *
 * ⚠ THE WORKFLOW IS UNCHANGED AND WAS NOT REWIRED. This is a new presentation of
 * the flow ForgotPasswordClient already ran: the same POST /api/auth/password/
 * reset/request through the same PasswordRecoveryService helpers, the same
 * verify-code and confirm calls through ResetCodeVerificationService, and the
 * same resolvePasswordResetErrorMessage for server error codes. No API route was
 * added, changed or duplicated.
 *
 * ⚠ THE SMS BRANCH IS NOT IN HANDOFF 16a AND IS KEPT ANYWAY. The handoff draws
 * only the email-link flow, but the live page also resets by SMS code, which is
 * the only recovery path for an account that signed up by phone. Owner-confirmed
 * before this cutover: restyle it, do not drop it. It is reached from a secondary
 * link rather than the handoff's front door, so the email flow is still the one
 * the design describes.
 *
 * ⚠ THE COOLDOWN IS COSMETIC AND THE SERVER STILL DECIDES. The handoff prints a
 * live "Resend in 0:47" timer. The request route rate-limits 5 per 10 minutes per
 * IP and always answers 200 regardless, so this countdown cannot be derived from
 * the response — it is a spam guard on the button, and a cleared timer still only
 * means "you may try".
 */

type Method = 'email' | 'sms'
type Step = 'request' | 'sent' | 'enter_code' | 'success'

/** Matches the handoff's "Resend in 0:47". */
const RESEND_COOLDOWN_SECONDS = 60

function PasswordRules({ password, confirm }: { password: string; confirm: string }) {
  const rules = [
    { label: 'At least 8 characters', pass: password.length >= 8 },
    {
      label: 'One letter and one number',
      pass: /[A-Za-z]/.test(password) && /[0-9]/.test(password),
    },
    { label: 'Both fields match', pass: password.length > 0 && password === confirm },
  ]

  return (
    <ul className="af-rc-rules">
      {rules.map((rule) => {
        // Unevaluated until the user has typed something — the handoff's third
        // "·" state. Marking every rule failed on an empty field would greet the
        // user with a wall of red before they have done anything wrong.
        const state = password.length === 0 ? 'idle' : rule.pass ? 'pass' : 'fail'
        return (
          <li key={rule.label} className="af-rc-rule" data-state={state}>
            <span className="af-rc-rule-mark" aria-hidden>
              {state === 'pass' ? '✓' : state === 'fail' ? '✕' : '·'}
            </span>
            <span>{rule.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function PasswordResetV4() {
  const searchParams = useSearchParams()
  const requestedReturnTo = searchParams?.get('returnTo') || ''
  const safeReturnTo = requestedReturnTo.startsWith('/') ? requestedReturnTo : '/dashboard'
  const loginHref = `/login?callbackUrl=${encodeURIComponent(safeReturnTo)}`
  const startMethod: Method = searchParams?.get('method') === 'sms' ? 'sms' : 'email'

  const [method, setMethod] = useState<Method>(startMethod)
  const [step, setStep] = useState<Step>('request')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeVerified, setCodeVerified] = useState(false)
  const [verifyingCode, setVerifyingCode] = useState(false)

  const cooldown = useResendCooldown()

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (method === 'email') {
      const value = email.trim().toLowerCase()
      if (!value) {
        setError('Please enter your email address.')
        return
      }
      setLoading(true)
      try {
        const res = await requestPasswordResetByEmail({ email: value, returnTo: safeReturnTo })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof data?.message === 'string' ? data.message : 'Could not send the link. Try again.')
          return
        }
        setStep('sent')
        cooldown.start(RESEND_COOLDOWN_SECONDS)
      } catch {
        setError('Something went wrong. Please try again.')
      } finally {
        setLoading(false)
      }
      return
    }

    if (!phone.trim()) {
      setError('Please enter your phone number.')
      return
    }
    const normalized = normalizePhoneE164(phone)
    if (!isValidPhoneE164(normalized)) {
      setError('Enter a valid phone number with country code (e.g. +1 555 123 4567).')
      return
    }
    setLoading(true)
    setCodeVerified(false)
    try {
      const res = await requestPasswordResetBySms({ phone: normalized, returnTo: safeReturnTo })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          typeof data?.message === 'string'
            ? data.message
            : 'Could not send the code. Try email reset or try again later.',
        )
        return
      }
      setStep('enter_code')
      cooldown.start(RESEND_COOLDOWN_SECONDS)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (cooldown.active || loading) return
    setError(null)
    setLoading(true)
    try {
      const res =
        method === 'email'
          ? await requestPasswordResetByEmail({
              email: email.trim().toLowerCase(),
              returnTo: safeReturnTo,
            })
          : await requestPasswordResetBySms({
              phone: normalizePhoneE164(phone),
              returnTo: safeReturnTo,
            })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // A failed resend must not arm the cooldown — that would tell the user to
        // wait for something that never went out. Same rule as 16b's send-failed
        // card.
        setError(typeof data?.message === 'string' ? data.message : 'Could not resend. Try again in a minute.')
        return
      }
      cooldown.start(RESEND_COOLDOWN_SECONDS)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode() {
    setError(null)
    if (code.trim().length !== 6) {
      setError('Enter your 6-digit code.')
      return
    }
    setVerifyingCode(true)
    try {
      const res = await verifyResetCode(
        method === 'email'
          ? { email: email.trim().toLowerCase(), code: code.trim() }
          : { phone: normalizePhoneE164(phone), code: code.trim() },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCodeVerified(false)
        setError(resolvePasswordResetErrorMessage(data?.error))
        return
      }
      setCodeVerified(true)
    } catch {
      setCodeVerified(false)
      setError('Something went wrong. Please try again.')
    } finally {
      setVerifyingCode(false)
    }
  }

  async function handleConfirmCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!codeVerified) {
      setError('Verify your code before saving a new password.')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Password must include at least one letter and one number.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await resetPasswordWithCode(
        method === 'email'
          ? { email: email.trim().toLowerCase(), code: code.trim(), newPassword }
          : { phone: normalizePhoneE164(phone), code: code.trim(), newPassword },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(resolvePasswordResetErrorMessage(data?.error))
        return
      }
      setStep('success')
      setTimeout(() => {
        window.location.href = `${loginHref}&reset=1`
      }, 2000)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  /* ── State 1 · Request ───────────────────────────────────────────── */
  if (step === 'request') {
    const isEmail = method === 'email'
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="STEP 1 · REQUEST" align="left" withCrest>
          <RecoveryTitle>Forgot your password?</RecoveryTitle>
          <RecoverySub>
            {isEmail
              ? "Enter the email on your account and we'll send a reset link."
              : "Enter the phone number on your account and we'll text a reset code."}
          </RecoverySub>

          <form className="af-rc-form" onSubmit={handleRequest} noValidate>
            {error ? <RecoveryAlert mark={<BangGlyph />} title={error} slim /> : null}

            <label className="af-rc-field">
              <span className="af-label">{isEmail ? 'Email' : 'Phone'}</span>
              <input
                type={isEmail ? 'email' : 'tel'}
                name={isEmail ? 'email' : 'phone'}
                autoComplete={isEmail ? 'email' : 'tel'}
                inputMode={isEmail ? 'email' : 'tel'}
                autoFocus
                value={isEmail ? email : phone}
                onChange={(e) => (isEmail ? setEmail(e.target.value) : setPhone(e.target.value))}
                placeholder={isEmail ? 'you@example.com' : '+1 555 123 4567'}
              />
            </label>

            <button type="submit" className="af-rc-btn" disabled={loading}>
              {loading ? 'Sending…' : isEmail ? 'Send reset link' : 'Send reset code'}
            </button>
          </form>

          <Link href={loginHref} className="af-rc-back">
            ← Back to sign in
          </Link>

          <p className="af-rc-foot">
            <button
              type="button"
              className="af-rc-link"
              style={{ marginTop: 0 }}
              onClick={() => {
                setMethod(isEmail ? 'sms' : 'email')
                setError(null)
              }}
            >
              {isEmail ? 'Use SMS instead' : 'Use email instead'}
            </button>
          </p>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── State 2 · Sent (email link) ─────────────────────────────────── */
  if (step === 'sent') {
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="STEP 2 · SENT">
          <RecoveryIcon>
            <MailGlyph />
          </RecoveryIcon>
          <RecoveryTitle>Check your email</RecoveryTitle>
          <RecoverySub>
            If an account exists for <strong>{email.trim().toLowerCase()}</strong>, a reset link is on
            its way. The link works once and expires in an hour.
          </RecoverySub>

          {/*
            ⚠ COPY CONTRACT — "if an account exists" IS DELIBERATE AND MUST NOT BE
            SOFTENED INTO A CONFIRMATION. The request route answers 200 whether or
            not the address is registered, precisely so this screen cannot leak
            which emails have accounts. Saying "we sent it" here would give away
            what the API refuses to.
          */}
          <RecoveryNote>
            We say &ldquo;if an account exists&rdquo; on purpose — confirming which emails are
            registered would leak who has an account.
          </RecoveryNote>

          {error ? (
            <div style={{ marginTop: 18 }}>
              <RecoveryAlert mark={<BangGlyph />} title={error} slim />
            </div>
          ) : null}

          <div className="af-rc-actions">
            <button
              type="button"
              className="af-rc-btn af-rc-btn--ghost"
              onClick={handleResend}
              disabled={cooldown.active || loading}
            >
              {cooldown.active ? `Resend in ${cooldown.label}` : loading ? 'Sending…' : 'Resend link'}
            </button>
            {/*
              "Open email app" is a mailto: with no address — every desktop and
              mobile OS resolves that to the user's default mail client. A link to
              a specific webmail host would be a guess, and wrong for most people.
            */}
            <a href="mailto:" className="af-rc-btn">
              Open email app
            </a>
          </div>

          <Link href={loginHref} className="af-rc-back">
            ← Back to sign in
          </Link>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── SMS branch · enter code and set a new password ──────────────── */
  if (step === 'enter_code') {
    const canSubmit =
      codeVerified &&
      newPassword.length >= 8 &&
      /[A-Za-z]/.test(newPassword) &&
      /[0-9]/.test(newPassword) &&
      newPassword === confirmPassword

    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="STEP 2 · ENTER CODE" align="left">
          <RecoveryTitle>Enter your code</RecoveryTitle>
          <RecoverySub>
            If that number has an account, a 6-digit code is on its way. Codes expire in 15 minutes.
          </RecoverySub>

          <form className="af-rc-form" onSubmit={handleConfirmCode} noValidate>
            {error ? <RecoveryAlert mark={<BangGlyph />} title={error} slim /> : null}

            <label className="af-rc-field">
              <span className="af-label">6-digit code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ''))
                  setCodeVerified(false)
                }}
                placeholder="123456"
              />
            </label>

            {codeVerified ? (
              <p className="af-rc-rule" data-state="pass" style={{ margin: 0 }}>
                <span className="af-rc-rule-mark" aria-hidden>
                  ✓
                </span>
                <span>Code verified — choose your new password.</span>
              </p>
            ) : (
              <button
                type="button"
                className="af-rc-btn af-rc-btn--ghost"
                onClick={handleVerifyCode}
                disabled={verifyingCode || code.length !== 6}
              >
                {verifyingCode ? 'Checking…' : 'Verify code'}
              </button>
            )}

            {codeVerified ? (
              <>
                <label className="af-rc-field af-rc-pw">
                  <span className="af-label">New password</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Choose a new password"
                  />
                  <button
                    type="button"
                    className="af-rc-pw-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <EyeGlyph off={showPassword} />
                  </button>
                </label>

                <label className="af-rc-field">
                  <span className="af-label">Confirm password</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your new password"
                  />
                </label>

                <PasswordRules password={newPassword} confirm={confirmPassword} />

                <button type="submit" className="af-rc-btn" disabled={!canSubmit || loading}>
                  {loading ? 'Saving…' : 'Reset password'}
                </button>
              </>
            ) : null}
          </form>

          <button
            type="button"
            className="af-rc-link"
            onClick={handleResend}
            disabled={cooldown.active || loading}
          >
            {cooldown.active ? `Resend in ${cooldown.label}` : 'Send a new code'}
          </button>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── Success ─────────────────────────────────────────────────────── */
  return (
    <RecoveryShell>
      <RecoveryCard eyebrow="DONE" tone="good">
        <RecoveryIcon tone="good">
          <CheckGlyph />
        </RecoveryIcon>
        <RecoveryTitle>Password reset</RecoveryTitle>
        <RecoverySub>Your password has been updated. Redirecting to sign in…</RecoverySub>
        <Link href={`${loginHref}&reset=1`} className="af-rc-btn af-rc-btn--block">
          Sign in
        </Link>
        <p className="af-rc-foot">
          That code is now spent and can&rsquo;t be reused. Devices where you&rsquo;re already signed
          in stay signed in.
        </p>
      </RecoveryCard>
    </RecoveryShell>
  )
}

export default PasswordResetV4
