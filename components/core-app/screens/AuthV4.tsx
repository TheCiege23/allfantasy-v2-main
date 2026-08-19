'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Suspense, useState } from 'react'
// af-core.css carries the .af-core token layer (--surface, --surface2, --line2,
// --accent …) for all three modes. AfCoreShell imports it for screens inside the
// shell; these pages render standalone at /login and /signup, so without it every
// token below is undefined. Measured on live /login before this fix: --surface,
// --surface2 and --line2 all computed to "", the card painted transparent with a
// 0px border, and the primary Sign in button had background rgba(0,0,0,0) — an
// invisible CTA. --accent also fell through to the unrelated #2563eb in
// globals.css instead of the design's teal. Must precede af-auth.css.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-auth.css'
import { isSocialProviderEnabled, type SocialProvider } from '@/lib/auth/SocialProviderResolver'
import { resolveLoginErrorMessage } from '@/lib/auth/AuthErrorMessageResolver'

/**
 * Auth — the "landing, auth & import" handoff, wired to the real endpoints.
 *
 * Sign in goes through next-auth `signIn('credentials')`; sign up POSTs to
 * /api/auth/register and then signs the new account in — the same paths
 * app/login/LoginContent.tsx and app/signup/SignupContent.tsx already use, so
 * this is a new presentation of the existing flow rather than a second flow.
 *
 * ⚠ PROVIDER SET IS THE LIVE ONE, not the handoff's. Production shows Google,
 * Apple, Spotify and Discord; the handoff draws Facebook instead of Spotify.
 * Facebook is in MANUALLY_SUSPENDED_PROVIDERS (Meta platform review) so drawing
 * it would add a button that cannot work, and Spotify is a real, live option the
 * handoff simply did not know about. Availability still comes from
 * isSocialProviderEnabled rather than from this list.
 *
 * ⚠ THE 18+ CONFIRMATION IS FOLDED INTO THE DISCLAIMER CHECKBOX. /api/auth/register
 * rejects the request outright without `ageConfirmed`, and the handoff only draws
 * two boxes. Folding it into the fantasy-sports disclaimer keeps the two-checkbox
 * design while still capturing the age consent the endpoint requires — the box
 * says "I am 18 or older" in as many words, so the user is agreeing to something
 * stated, not something implied.
 */

export type AuthMode = 'signin' | 'signup'

const PROVIDERS: { id: SocialProvider; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'apple', label: 'Apple' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'discord', label: 'Discord' },
]

function OAuthGrid({ callbackUrl }: { callbackUrl: string }) {
  const [pending, setPending] = useState<SocialProvider | null>(null)

  return (
    <div className="af-au-oauth">
      <div className="af-au-divider">
        <span className="af-label">Or continue with</span>
      </div>
      <div className="af-au-oauth-grid">
        {PROVIDERS.map((p) => {
          const enabled = isSocialProviderEnabled(p.id)
          const busy = pending === p.id
          return (
            <button
              key={p.id}
              type="button"
              className="af-au-oauth-btn"
              disabled={!enabled || pending !== null}
              aria-disabled={!enabled}
              title={enabled ? `Continue with ${p.label}` : `${p.label} — coming soon`}
              onClick={async () => {
                if (!enabled) return
                setPending(p.id)
                try {
                  await signIn(p.id, { callbackUrl })
                } finally {
                  setPending(null)
                }
              }}
            >
              <span className="af-au-oauth-label">{busy ? 'Opening…' : p.label}</span>
              {/* Naming the state matters: a dimmed button with no label reads as
                  loading rather than as an unavailable provider. */}
              {!enabled ? <span className="af-au-soon af-num">soon</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SignIn({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!login.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setLoading(true)
    try {
      const result = await signIn('credentials', {
        login: login.trim(),
        password,
        redirect: false,
        callbackUrl,
      })
      if (result?.error) {
        // Shared resolver, so this page reports the same failure wording as the
        // live login rather than inventing its own.
        setError(resolveLoginErrorMessage(result.error))
      } else {
        router.replace(callbackUrl)
      }
    } catch {
      setError('Something went wrong signing in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="af-au-card">
      <header className="af-au-head">
        <div>
          <h1 className="af-au-title">Welcome back</h1>
          <p className="af-au-sub">Sign in to your leagues.</p>
        </div>
        <span className="af-au-switch">
          New here? <Link href="/signup">Create account</Link>
        </span>
      </header>

      <form className="af-au-form" onSubmit={onSubmit}>
        <label className="af-au-field">
          <span className="af-label">Email, username or phone</span>
          <input
            name="login"
            type="text"
            autoComplete="username"
            placeholder="you@email.com"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </label>

        <label className="af-au-field">
          <span className="af-au-field-head">
            <span className="af-label">Password</span>
            <Link href="/forgot-password" className="af-au-forgot">
              Forgot password?
            </Link>
          </span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error ? (
          <p className="af-au-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="af-btn af-au-submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <OAuthGrid callbackUrl={callbackUrl} />
    </div>
  )
}

function SignUp({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [disclaimer, setDisclaimer] = useState(false)
  const [terms, setTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Names the missing agreement rather than failing generically — with two
  // boxes, "please accept the terms" does not say which one was skipped.
  const missing: string[] = []
  if (!disclaimer) missing.push('the age and fantasy-sports confirmation')
  if (!terms) missing.push('the Terms and Privacy Policy')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (missing.length > 0) {
      setError(`Please accept ${missing.join(' and ')} to continue.`)
      return
    }
    if (!email.trim() || !password || !displayName.trim()) {
      setError('Fill in your name, email and a password.')
      return
    }
    if (password.length < 8) {
      setError('Passwords need at least 8 characters.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          // The disclaimer box states 18+ explicitly, so it carries both flags.
          // register() rejects outright without ageConfirmed.
          ageConfirmed: disclaimer,
          disclaimerAgreed: disclaimer,
          termsAgreed: terms,
          verificationMethod: 'EMAIL',
        }),
      })

      const text = await res.text()
      let data: Record<string, unknown> = {}
      try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        data = {}
      }

      if (!res.ok) {
        // Surface the server's own reason where it gives one — it knows about
        // duplicate emails and unavailable databases, and a generic message here
        // would hide both.
        setError(
          typeof data.error === 'string'
            ? data.error
            : 'We could not create your account. Please try again.'
        )
        return
      }

      const signedIn = await signIn('credentials', {
        login: email.trim(),
        password,
        redirect: false,
        callbackUrl,
      })
      if (signedIn?.error) {
        // The account DOES exist at this point — say so, rather than implying
        // signup failed and inviting a duplicate attempt.
        setError('Account created, but sign-in failed. Try signing in.')
        return
      }
      router.replace(callbackUrl)
    } catch {
      setError('Something went wrong creating your account. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="af-au-card">
      <header className="af-au-head">
        <div>
          <h1 className="af-au-title">Create your account</h1>
          <p className="af-au-sub">Step 1 of 3 · free forever for players.</p>
        </div>
        <span className="af-au-switch">
          Already have an account? <Link href="/login">Sign in</Link>
        </span>
      </header>

      <form className="af-au-form" onSubmit={onSubmit}>
        <label className="af-au-field">
          <span className="af-label">Display name</span>
          <input
            type="text"
            autoComplete="nickname"
            placeholder="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>

        <label className="af-au-field">
          <span className="af-label">Email</span>
          <input
            type="email"
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="af-au-field">
          <span className="af-label">Password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            placeholder="8+ characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="af-au-check">
          <input
            type="checkbox"
            checked={disclaimer}
            onChange={(e) => setDisclaimer(e.target.checked)}
          />
          <span>
            I am <strong>18 or older</strong> and understand AllFantasy is{' '}
            <strong>season-long fantasy sports only</strong> — no gambling, no daily fantasy. Not
            available in WA.
          </span>
        </label>

        <label className="af-au-check">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>
            I agree to the <Link href="/terms">Terms</Link> and{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </span>
        </label>

        {error ? (
          <p className="af-au-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="af-btn af-au-submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <OAuthGrid callbackUrl={callbackUrl} />
    </div>
  )
}

function AuthInner({ mode }: { mode: AuthMode }) {
  const params = useSearchParams()
  // Honour the callbackUrl the rest of the app already passes around, so a
  // deep link that bounced through sign-in returns where it started.
  const callbackUrl = params?.get('callbackUrl')?.trim() || '/dashboard'

  return mode === 'signin' ? (
    <SignIn callbackUrl={callbackUrl} />
  ) : (
    <SignUp callbackUrl={callbackUrl} />
  )
}

export function AuthV4({ mode }: { mode: AuthMode }) {
  return (
    <div className="af-core af-au">
      {/*
        The wordmark is the way home. It was a plain <span>, so /login and
        /signup were dead ends — no link back to the marketing site anywhere on
        the page (verified: no a[href="/"] in the DOM). The handoff's top bar is
        brand-left, cross-link-right, and the brand is the home affordance.
      */}
      <div className="af-au-brand">
        <Link href="/" className="af-au-wordmark" aria-label="AllFantasy — back to home">
          AllFantasy
        </Link>
      </div>
      {/*
        ⚠ THE SUSPENSE BOUNDARY IS NOT DECORATION — IT KEEPS THE FORM USABLE.
        useSearchParams() in a client component without one makes Next bail the
        whole root to client rendering on any hydration mismatch. This app has a
        pre-existing mismatch (the language provider resolves a different locale
        on the client than the server rendered — the theme control was observed
        flipping between "Light" and "Claro"), so the root remounted mid-typing
        and WIPED whatever had been entered. Caught by filling the form in a real
        browser and watching the fields empty themselves; it would never have
        shown up in a typecheck or a server-rendered HTML assertion.
      */}
      <Suspense fallback={<div className="af-au-card" aria-busy="true" />}>
        <AuthInner mode={mode} />
      </Suspense>
      <p className="af-au-legal">
        100% fantasy sports — no gambling, no DFS. Not available in WA.
      </p>
    </div>
  )
}

export default AuthV4
