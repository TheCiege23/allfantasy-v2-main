'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Loader2 } from 'lucide-react'

/**
 * Where the support welcome email's button lands (lib/monetization/supportGuestEmail).
 *
 * ⚠ OPENING THIS PAGE DOES NOT SIGN IN — THE TAP DOES. The token is single-use, and mail
 * scanners open every link in an email before the person does; signing in on page load
 * would spend the token on the scanner and greet the real person with "expired".
 */
export default function SupportSignInClient() {
  const token = useSearchParams().get('token')?.trim() ?? ''
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(!token)

  async function go() {
    if (busy || !token) return
    setBusy(true)
    const result = await signIn('support-link', { kind: 'link', token, redirect: false }).catch(() => null)
    if (result?.ok && !result.error) {
      window.location.href = '/'
      return
    }
    setFailed(true)
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="max-w-md w-full text-center space-y-6" data-testid="support-sign-in">
        <h1 className="text-3xl font-black tracking-tight" style={{ color: 'var(--text)' }}>
          {failed ? 'This button has expired' : 'Sign in to AllFantasy'}
        </h1>
        <p className="text-base" style={{ color: 'var(--muted)' }}>
          {failed
            ? "Sign-in buttons work once and last 7 days. Enter your email on the next page and we'll email you a link to get back in."
            : 'Tap the button to sign in. No password needed.'}
        </p>
        {failed ? (
          <Link
            href="/forgot-password?method=email"
            className="inline-flex items-center justify-center w-full px-6 py-4 rounded-xl text-lg font-bold text-white"
            style={{ background: '#0e7f9b' }}
          >
            Email me a new link
          </Link>
        ) : (
          <button
            type="button"
            onClick={go}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl text-lg font-bold text-white disabled:opacity-60"
            style={{ background: '#0e7f9b' }}
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        )}
      </div>
    </div>
  )
}
