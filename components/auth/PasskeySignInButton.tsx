'use client'

import { useEffect, useState } from 'react'
import { Fingerprint, KeyRound, ScanFace } from 'lucide-react'

import { canUsePasskeys, deviceUnlockName, signInWithPasskey } from '@/lib/auth/passkey-client'

/** The icon for this device's unlock: a face for Face ID, a fingerprint for the rest. */
export function UnlockIcon({ name, size = 18 }: { name: string; size?: number }) {
  if (name === 'Face ID') return <ScanFace size={size} aria-hidden="true" />
  if (name === 'Windows Hello' || name === 'a passkey') return <KeyRound size={size} aria-hidden="true" />
  return <Fingerprint size={size} aria-hidden="true" />
}

/**
 * "Sign in with Face ID" (or fingerprint / Windows Hello) on /login. Renders nothing on a device
 * that cannot do it — including an iOS app build without native passkeys (lib/auth/passkey-client).
 * Not marked data-hide-in-ios-app: whether it shows is canUsePasskeys()'s call, not the CSS's.
 */
export default function PasskeySignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [unlock, setUnlock] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // After mount: whether the device can do it is only knowable in the browser.
  useEffect(() => {
    let live = true
    void canUsePasskeys().then((ok) => {
      if (live && ok) setUnlock(deviceUnlockName())
    })
    return () => {
      live = false
    }
  }, [])
  if (!unlock) return null

  async function go() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await signInWithPasskey()
    if (result.ok) {
      window.location.href = callbackUrl || '/core'
      return
    }
    if (!result.cancelled) setError(result.error ?? "That didn't work. Please try again.")
    setBusy(false)
  }

  return (
    <div data-testid="passkey-signin" style={{ display: 'grid', gap: 8 }}>
      <button
        type="button"
        className="af-au-oauth-btn"
        onClick={go}
        disabled={busy}
        style={{ width: '100%', minHeight: 50, fontSize: 15, fontWeight: 600 }}
        data-testid="passkey-signin-button"
      >
        <UnlockIcon name={unlock} />
        {busy ? 'Signing in…' : `Sign in with ${unlock === 'a passkey' ? 'a passkey' : unlock.replace(/^your /, '')}`}
      </button>
      {error ? (
        <p role="alert" className="af-au-error" style={{ margin: 0, textAlign: 'center' }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
