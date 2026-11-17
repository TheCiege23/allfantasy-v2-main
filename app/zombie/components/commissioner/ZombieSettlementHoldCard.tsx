'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * A zombie week held for review: which week, why in words, and a Retry settlement button
 * (lib/zombie/settlementHoldRelease.ts). Renders nothing when no week is held.
 *
 * Before this the panel said only "needs commissioner review" and offered nothing to press.
 */

type Hold = { week: number; reason: { code: string; kind: 'commissioner' | 'scores' | 'support'; text: string }; heldAt: string | null }

export function ZombieSettlementHoldCard({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [hold, setHold] = useState<Hold | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    fetch(`/api/zombie/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=settlement_hold`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hold?: Hold | null } | null) => setHold(d?.hold ?? null))
      .catch(() => setHold(null))
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  if (!hold) return null

  const retry = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/zombie/commissioner', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, action: 'retry_settlement', week: hold.week }),
      })
      const data = (await res.json().catch(() => ({}))) as { outcome?: string; detail?: string; error?: string }
      if (!res.ok) setMessage({ tone: 'error', text: data.error ?? `Could not retry (${res.status}).` })
      else setMessage({ tone: data.outcome === 'held_again' ? 'error' : 'ok', text: data.outcome === 'held_again' ? `Still on hold: ${data.detail ?? ''}` : (data.detail ?? 'Released.') })
      load()
    } catch {
      setMessage({ tone: 'error', text: 'Could not retry. Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="alert" data-testid="zombie-settlement-hold" className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-100">
      <p className="font-semibold">Week {hold.week} settlement is on hold</p>
      <p className="mt-1" data-testid="zombie-settlement-hold-reason">{hold.reason.text}</p>
      {canEdit && (
        <button
          type="button"
          data-testid="zombie-settlement-retry"
          onClick={retry}
          disabled={busy}
          className="mt-2 min-h-11 rounded-lg border border-amber-300/40 bg-amber-500/20 px-3 py-1.5 text-[12px] font-semibold text-amber-50 hover:bg-amber-500/30 disabled:opacity-50"
        >
          {busy ? 'Retrying…' : 'Retry settlement'}
        </button>
      )}
      {message && (
        <p role="status" data-testid="zombie-settlement-retry-message" className={`mt-2 ${message.tone === 'ok' ? 'text-emerald-200' : 'text-rose-200'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
