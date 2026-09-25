'use client'

import { useState } from 'react'

/**
 * Sends a fresh verification link — the one step between an unverified account and importing a
 * league. The existing endpoint rate-limits (3 per 2 minutes) and answers `alreadyVerified` when
 * the link was already used, which reloads the home so the card moves on to "connect".
 */
export function ResendVerificationButton({ label }: { label: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed' | 'limited'>('idle')

  const send = async () => {
    if (state === 'sending') return
    setState('sending')
    try {
      const res = await fetch('/api/auth/verify-email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ returnTo: '/import' }),
      })
      const data = (await res.json().catch(() => ({}))) as { alreadyVerified?: boolean }
      if (res.status === 429) return setState('limited')
      if (!res.ok) return setState('failed')
      if (data.alreadyVerified) {
        window.location.reload()
        return
      }
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="af-connect-verify">
      <button type="button" className="af-connect-go" onClick={() => void send()} disabled={state === 'sending' || state === 'sent'}>
        {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent' : label}
      </button>
      {state === 'sent' ? (
        <p className="af-connect-note" role="status">
          Check your inbox (and spam). The link brings you straight to connecting your league.
        </p>
      ) : state === 'limited' ? (
        <p className="af-connect-note" role="status">
          One just went out. Give it a couple of minutes before asking again.
        </p>
      ) : state === 'failed' ? (
        <p className="af-connect-note" data-tone="bad" role="status">
          That didn&apos;t send. Try again in a moment.
        </p>
      ) : null}
    </div>
  )
}
