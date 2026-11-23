'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { signIn, useSession } from 'next-auth/react'
import { Heart, Loader2, Mail } from 'lucide-react'

import SignInNextTime from './SignInNextTime'

type View = 'waiting' | 'done' | 'check_email' | 'slow'

const POLL_MS = 2000
const GIVE_UP_MS = 60_000

/**
 * After the support checkout (lib/monetization/supportGuestCheckout). Waits for the webhook,
 * then — only for an account that checkout just made — signs the buyer in with the one-time
 * claim. An email that already had an account gets "check your email" instead, never a
 * sign-in (lib/monetization/supportGuestAccount explains why).
 */
export default function SupportWelcomeClient() {
  const params = useSearchParams()
  const sessionId = params.get('session_id')?.trim() ?? ''
  const { status, update } = useSession()
  const [view, setView] = useState<View>('waiting')
  // True once this page has handled a no-account checkout: only those get the sign-in email.
  const [guest, setGuest] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (status === 'loading' || started.current) return
    started.current = true
    // Signed-in checkout, or an app-store purchase that already finished.
    if (status === 'authenticated' || !sessionId) {
      setView(status === 'authenticated' || params.get('completed') === '1' ? 'done' : 'slow')
      return
    }

    setGuest(true)
    let cancelled = false
    const deadline = Date.now() + GIVE_UP_MS
    const tick = async () => {
      if (cancelled) return
      try {
        // A check that hangs must not stall the whole wait: give each one 8 seconds, then try again.
        const res = await fetch(`/api/monetization/checkout/support-guest/status?session_id=${encodeURIComponent(sessionId)}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        })
        const data = (await res.json().catch(() => ({}))) as { state?: string }
        if (data.state === 'ready') {
          const result = await signIn('support-link', { kind: 'claim', token: sessionId, redirect: false })
          if (result?.ok && !result.error) {
            await update().catch(() => undefined)
            if (!cancelled) setView('done')
            return
          }
        } else if (data.state === 'check_email') {
          if (!cancelled) setView('check_email')
          return
        }
      } catch {
        // A network blip: try again on the next tick.
      }
      if (Date.now() > deadline) {
        if (!cancelled) setView('slow')
        return
      }
      setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [status, sessionId, params, update])

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="max-w-md w-full text-center space-y-6" data-testid="support-welcome" data-view={view}>
        {view === 'waiting' ? (
          <>
            <Loader2 className="w-12 h-12 mx-auto animate-spin" style={{ color: 'var(--muted)' }} />
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Finishing up…</h1>
            <p className="text-base" style={{ color: 'var(--muted)' }}>This takes a few seconds. Please keep this page open.</p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
              {view === 'check_email' ? (
                <Mail className="w-10 h-10 text-red-400" />
              ) : (
                <Heart className="w-10 h-10 text-red-400" fill="currentColor" />
              )}
            </div>
            <h1 className="text-3xl font-black tracking-tight" style={{ color: 'var(--text)' }}>
              {view === 'done' ? "You're all set. Thank you!" : 'Thank you!'}
            </h1>
            <p className="text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
              {view === 'done'
                ? "Your monthly support has started. There's nothing else you need to do."
                : view === 'check_email'
                  ? "This email already has an AllFantasy account, so we added your support to it. We sent that email a button to sign in."
                  : "Your payment went through. We're finishing your account and will email you a button to sign in."}
            </p>
            {guest && view === 'done' ? (
              <div className="p-4 rounded-xl text-sm" style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--muted2)' }}>
                We emailed you your username and password, plus a button that signs you straight in.
              </div>
            ) : null}
            {/* Signed in just now with no password: how to get back in later without the email
                (a texted code, or Face ID where the device has it). ./SignInNextTime */}
            {guest && view === 'done' ? <SignInNextTime /> : null}
            <Link
              href="/"
              className="inline-flex items-center justify-center w-full px-6 py-4 rounded-xl text-base font-semibold"
              style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              Go to AllFantasy
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
