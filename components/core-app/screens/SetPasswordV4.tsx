'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  BangGlyph,
  CheckGlyph,
  EyeGlyph,
  RecoveryAlert,
  RecoveryCard,
  RecoveryChecking,
  RecoveryIcon,
  RecoveryShell,
  RecoverySub,
  RecoveryTitle,
  ShieldGlyph,
  WarnGlyph,
} from './RecoveryChrome'

/**
 * Screen 16a states 3–6 — set a new password from an emailed link, and the three
 * ways that link can fail to produce a form.
 *
 * ⚠ THE WORKFLOW IS UNCHANGED AND WAS NOT REWIRED. Same POST /api/auth/password/
 * reset/confirm with the same { token, newPassword } body the previous page sent,
 * and the same four server error codes mapped to the same four messages. No API
 * route was added or changed.
 *
 * ⚠ EACH OF THE FOUR CARDS IS A STATE, NOT A WIZARD STEP — the handoff's build
 * note. Which one renders is decided by the token in the URL and the server's
 * answer to it, never by a "next" button, so a user landing here from a stale
 * bookmark gets the session-required card rather than an empty form that would
 * fail on submit.
 */

type Mode = 'checking' | 'token' | 'none'
type Failure = 'expired' | 'invalid' | null

const ERROR_COPY: Record<string, string> = {
  WEAK_PASSWORD: 'Password must be at least 8 characters with a letter and number.',
  INVALID_OR_USED_TOKEN: 'This reset link is invalid or has already been used.',
  EXPIRED_TOKEN: 'This reset link has expired. Please request a new one.',
  MISSING_FIELDS: 'Token and new password are required.',
  RESET_FAILED: 'Something went wrong saving your password. Please try again.',
}

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
        // "·" until the user types — greeting an untouched form with three red
        // crosses tells someone they got something wrong before they started.
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

export function SetPasswordV4() {
  const searchParams = useSearchParams()
  const token = searchParams?.get('token') || ''
  const requestedReturnTo = searchParams?.get('returnTo') || ''
  const safeReturnTo = requestedReturnTo.startsWith('/') ? requestedReturnTo : '/dashboard'
  const loginHref = `/login?callbackUrl=${encodeURIComponent(safeReturnTo)}`
  const requestHref = `/forgot-password?returnTo=${encodeURIComponent(safeReturnTo)}`

  const [mode, setMode] = useState<Mode>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    setMode(token ? 'token' : 'none')
  }, [token])

  // The handoff's step-4 copy says "Redirecting to sign in…", so it has to
  // actually redirect — a card that promises a redirect and then sits there is
  // the same broken promise as a spinner that never resolves.
  useEffect(() => {
    if (!success) return
    const id = window.setTimeout(() => {
      window.location.href = `${loginHref}&reset=1`
    }, 2500)
    return () => window.clearTimeout(id)
  }, [success, loginHref])

  const valid =
    password.length >= 8 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password) &&
    password === confirmPassword

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must include at least one letter and one number.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/password/reset/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const code = typeof data?.error === 'string' ? data.error : 'RESET_FAILED'
        // A dead token stops being a field-validation problem and becomes a state
        // change — there is nothing the user can type into this form that will
        // work, so the form is replaced by the card that offers a new link.
        if (code === 'EXPIRED_TOKEN') {
          setFailure('expired')
          return
        }
        if (code === 'INVALID_OR_USED_TOKEN') {
          setFailure('invalid')
          return
        }
        setError(ERROR_COPY[code] ?? 'Something went wrong saving your password. Please try again.')
        return
      }

      setSuccess(true)
    } catch {
      setError('Something went wrong saving your password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  /* ── State 4 · Done ──────────────────────────────────────────────── */
  if (success) {
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="STEP 4 · DONE" tone="good">
          <RecoveryIcon tone="good">
            <CheckGlyph />
          </RecoveryIcon>
          <RecoveryTitle>Password reset</RecoveryTitle>
          <RecoverySub>Your password has been updated. Redirecting to sign in…</RecoverySub>
          <Link href={`${loginHref}&reset=1`} className="af-rc-btn af-rc-btn--block">
            Sign in
          </Link>
          <p className="af-rc-foot">
            That link is now spent and can&rsquo;t be reused. Devices where you&rsquo;re already
            signed in stay signed in.
          </p>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── State 5 · The link is bad ───────────────────────────────────── */
  if (failure) {
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="IF THE LINK IS BAD" tone="warn">
          <RecoveryIcon tone="warn">
            <WarnGlyph />
          </RecoveryIcon>
          <RecoveryTitle>
            {failure === 'expired'
              ? 'This reset link has expired'
              : 'This reset link has already been used'}
          </RecoveryTitle>
          <RecoverySub>
            Reset links last one hour and work once. Request a new one and we&rsquo;ll send it
            straight away.
          </RecoverySub>
          <Link href={requestHref} className="af-rc-btn af-rc-btn--block">
            Request a new link
          </Link>

          {/*
            The handoff lists the sibling failure messages under this card so the
            whole error vocabulary is visible in one place. They are the exact
            strings the confirm route's other codes map to, not paraphrases.
          */}
          <div className="af-rc-variants">
            <span className="af-label">THE OTHER MESSAGES</span>
            <ul>
              <li>· This reset link is invalid or has already been used.</li>
              <li>· Token and new password are required.</li>
              <li>· Something went wrong saving your password. Please try again.</li>
            </ul>
          </div>
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── State 6 · No link at all ────────────────────────────────────── */
  if (mode !== 'token') {
    return (
      <RecoveryShell>
        <RecoveryCard eyebrow="NO LINK AT ALL">
          <RecoveryIcon tone="neutral">
            <ShieldGlyph />
          </RecoveryIcon>
          <RecoveryTitle>Session required</RecoveryTitle>
          <RecoverySub>
            We couldn&rsquo;t verify a password reset session. Use the link from your email, or
            request a new reset.
          </RecoverySub>
          <Link href={requestHref} className="af-rc-btn af-rc-btn--block">
            Request reset
          </Link>
          {mode === 'checking' ? (
            <RecoveryChecking
              title="Checking your reset session…"
              sub="shown for the moment before either card appears"
            />
          ) : null}
        </RecoveryCard>
      </RecoveryShell>
    )
  }

  /* ── State 3 · Set new password ──────────────────────────────────── */
  return (
    <RecoveryShell>
      <RecoveryCard eyebrow="STEP 3 · SET NEW PASSWORD" align="left">
        <RecoveryTitle>Set new password</RecoveryTitle>
        <RecoverySub>Choose a strong new password for your AllFantasy account.</RecoverySub>

        <form className="af-rc-form" onSubmit={handleSubmit} noValidate>
          {error ? <RecoveryAlert mark={<BangGlyph />} title={error} slim /> : null}

          <label className="af-rc-field af-rc-pw" data-invalid={error ? 'true' : undefined}>
            <span className="af-label">New password</span>
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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

          <PasswordRules password={password} confirm={confirmPassword} />

          <button type="submit" className="af-rc-btn" disabled={!valid || loading}>
            {loading ? 'Saving…' : 'Reset password'}
          </button>
        </form>

        <Link href={loginHref} className="af-rc-back">
          ← Back to sign in
        </Link>
      </RecoveryCard>
    </RecoveryShell>
  )
}

export default SetPasswordV4
