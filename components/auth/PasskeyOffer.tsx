'use client'

import { useEffect, useState } from 'react'

import { addPasskey, canUsePasskeys, deviceUnlockName, hasSavedPasskey } from '@/lib/auth/passkey-client'
import { UnlockIcon } from '@/components/auth/PasskeySignInButton'

const DISMISSED_KEY = 'af:passkey-offer-dismissed-at'
const ASK_AGAIN_AFTER_MS = 30 * 24 * 60 * 60 * 1000

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISSED_KEY) || 0)
    return at > 0 && Date.now() - at < ASK_AGAIN_AFTER_MS
  } catch {
    return false
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()))
  } catch {
    /* storage blocked: we may ask again next time, which is harmless */
  }
}

/**
 * Should the "use Face ID next time?" offer show right now? Only just after a sign-in, on a device
 * that can do it, for an account with no passkey yet, and not if they said "Not now" this month.
 * Gives up after 2.5s rather than hold anyone on the sign-in page.
 */
export async function shouldOfferPasskey(): Promise<boolean> {
  if (typeof window === 'undefined' || dismissedRecently()) return false
  const check = (async () => (await canUsePasskeys()) && (await hasSavedPasskey()) === false)()
  const timeout = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 2500))
  return Promise.race([check, timeout])
}

/**
 * Self-styled (inline), so it works on pages without the auth CSS — /login and /support/welcome.
 *
 * One question, two buttons: turn on Face ID (fingerprint, Windows Hello) for next time, or not.
 * `onDone` runs after either answer — the caller carries on to where they were going.
 */
export default function PasskeyOffer({ onDone, compact = false }: { onDone: () => void; compact?: boolean }) {
  // Read after mount: the server cannot know the device, and its HTML must match the first render.
  const [unlock, setUnlock] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setUnlock(deviceUnlockName()), [])
  if (!unlock) return null
  const short = unlock.replace(/^your /, '')

  async function turnOn() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await addPasskey()
    if (result.ok) {
      setDone(true)
      window.setTimeout(onDone, 1400)
      return
    }
    if (!result.cancelled) setError(result.error ?? "That didn't work. Please try again.")
    setBusy(false)
  }

  function notNow() {
    rememberDismissed()
    onDone()
  }

  return (
    <div data-testid="passkey-offer" style={{ display: 'grid', gap: 14, textAlign: 'center' }}>
      {!compact ? (
        <div
          style={{
            margin: '0 auto',
            width: 56,
            height: 56,
            borderRadius: 16,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--accent-soft, rgba(99,102,241,0.15))',
            color: 'var(--accent, #6366f1)',
          }}
        >
          <UnlockIcon name={unlock} size={28} />
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: compact ? 17 : 20, fontWeight: 700, color: 'var(--text)' }}>
          {done ? "You're all set" : `Sign in with ${short} next time?`}
        </h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted, var(--text2))' }}>
          {done
            ? `Next time, tap “Sign in with ${short}”.`
            : `No password to type. ${
                unlock === 'Face ID' ? 'Your face' : unlock === 'Touch ID' || unlock === 'your fingerprint' ? 'Your fingerprint' : 'Your face, fingerprint or PIN'
              } stays on this device — AllFantasy never sees it.`}
        </p>
      </div>
      {done ? null : (
        <div style={{ display: 'grid', gap: 8 }}>
          <button
            type="button"
            onClick={turnOn}
            disabled={busy}
            data-testid="passkey-offer-accept"
            style={{
              width: '100%',
              minHeight: 48,
              borderRadius: 12,
              border: 'none',
              background: 'var(--accent, #6366f1)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Setting up…' : `Turn on ${short}`}
          </button>
          <button
            type="button"
            onClick={notNow}
            disabled={busy}
            data-testid="passkey-offer-decline"
            style={{ minHeight: 44, background: 'transparent', border: 'none', color: 'var(--muted, var(--text2))', fontSize: 14, textDecoration: 'underline' }}
          >
            Not now
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: '#f87171' }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
