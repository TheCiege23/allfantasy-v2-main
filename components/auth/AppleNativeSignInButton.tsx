'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { hasNativeAppleSignIn, signInWithAppleNative } from '@/lib/auth/apple-native-client'

/**
 * "Continue with Apple" inside the iOS app (lib/auth/apple-native-client). Renders NOTHING
 * anywhere else — on the website the web Apple button in the social grid does this job, and in an
 * app build without the Sign in with Apple entitlement the native handler is absent, so there is
 * no button that could fail.
 *
 * Styled to Apple's Human Interface Guidelines for the button: black, white Apple mark, the
 * system title "Continue with Apple", full width, at least 44pt tall.
 */
export default function AppleNativeSignInButton({
  callbackUrl,
  showTerms = false,
  onSignedIn,
  beforeSignIn,
}: {
  callbackUrl?: string
  /** On sign-up: the 18+ / terms line the hidden social grid would otherwise carry. */
  showTerms?: boolean
  /** Instead of navigating to `callbackUrl`. */
  onSignedIn?: () => void | Promise<void>
  /** Runs first; `false` stops the sign-in (e.g. a Partner Code on /signup that did not check out). */
  beforeSignIn?: () => Promise<boolean>
}) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // After mount: the bridge exists only in the app, and server HTML must not differ from the client's.
  useEffect(() => setAvailable(hasNativeAppleSignIn()), [])
  if (!available) return null

  async function go() {
    if (busy) return
    setBusy(true)
    setError(null)
    if (beforeSignIn && !(await beforeSignIn())) {
      setBusy(false)
      return
    }
    const result = await signInWithAppleNative()
    if (result.ok) {
      if (onSignedIn) await onSignedIn()
      else window.location.href = callbackUrl || '/core'
      return
    }
    if (!result.cancelled) setError(result.error ?? "Sign in with Apple didn't work. Please try again.")
    setBusy(false)
  }

  return (
    <div data-testid="apple-native-signin" style={{ display: 'grid', gap: 8 }}>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          minHeight: 50,
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.25)',
          background: '#000',
          color: '#fff',
          fontSize: 17,
          fontWeight: 600,
          fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <svg width="16" height="19" viewBox="0 0 814 1000" aria-hidden="true" fill="#fff">
          <path d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-167 41s-106-57-156-128C44 788 0 670 0 557 0 376 118 280 234 280c62 0 113 41 152 41 37 0 95-43 165-43 27 0 123 2 187 63zM554 159c29-35 50-83 50-131 0-7-1-14-2-19-48 2-104 32-138 71-27 30-52 78-52 127 0 7 1 15 2 17 3 1 8 1 13 1 43 0 97-29 127-66z" />
        </svg>
        {busy ? 'Signing in…' : 'Continue with Apple'}
      </button>
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: '#f87171', textAlign: 'center' }}>{error}</p>
      ) : null}
      {showTerms ? (
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7, textAlign: 'center' }}>
          For adults 18+. By continuing you agree to the <Link href="/terms">Terms</Link> and{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      ) : null}
    </div>
  )
}
