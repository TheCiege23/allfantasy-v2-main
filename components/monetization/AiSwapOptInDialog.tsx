'use client'

import { useEffect, useState } from 'react'

/**
 * Asked ONCE, after an AF Pro / Supreme purchase: "turn on AI swap?" (owner's rule, 2026-11-23).
 *
 * AI swap is off until the subscriber turns it on (lib/lineup-automation/aiSwapPolicy.ts). Paying does not
 * switch it on. This shows only when the plan includes it and the user has never chosen; either answer is
 * saved, so it never asks again. Settings → Preferences holds the switch afterwards.
 */
type AiSwapState = { on: boolean; decided: boolean; entitled: boolean }

export function AiSwapOptInDialog() {
  const [state, setState] = useState<AiSwapState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    let cancelled = false
    // The entitlement can land a moment after Stripe returns; ask twice before giving up.
    const load = async (attempt: number) => {
      try {
        const res = await fetch('/api/user/ai-swap', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as AiSwapState
        if (cancelled) return
        if (!data.entitled && attempt === 0) {
          setTimeout(() => void load(1), 4000)
          return
        }
        setState(data)
      } catch {
        // No dialog is better than a broken one; Settings still has the switch.
      }
    }
    void load(0)
    return () => {
      cancelled = true
    }
  }, [])

  if (closed || !state || !state.entitled || state.decided) return null

  const choose = async (on: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/user/ai-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Could not save your choice. Try again.')
        return
      }
      setClosed(true)
    } catch {
      setError('Could not save your choice. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="af-mz-dialog-backdrop" role="presentation">
      <section className="af-mz-dialog" role="dialog" aria-modal="true" aria-labelledby="af-ai-swap-title">
        <h2 id="af-ai-swap-title" className="af-mz-outcome-title">
          Turn on Chimmy Auto-Swap?
        </h2>
        <p className="af-mz-outcome-body">
          Your plan includes Chimmy Auto-Swap. With it on, Chimmy swaps a starter who is ruled out, injured or on bye for
          your best bench player whose game has not started yet. A player whose game has started is never moved,
          and your commissioner can switch Auto-Swap off for their league.
        </p>
        <p className="af-mz-outcome-body">It stays off unless you turn it on. You can change this any time in Settings.</p>
        {error ? (
          <p className="af-mz-outcome-body" role="alert">
            {error}
          </p>
        ) : null}
        <div className="af-mz-outcome-actions">
          <button type="button" className="af-mz-btn af-mz-btn--primary" disabled={saving} onClick={() => void choose(true)}>
            Turn on Auto-Swap
          </button>
          <button type="button" className="af-mz-btn" disabled={saving} onClick={() => void choose(false)}>
            Not now
          </button>
        </div>
      </section>
    </div>
  )
}

export default AiSwapOptInDialog
