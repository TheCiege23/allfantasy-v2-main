'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { FanPredictionState } from '@/lib/survivor/spectator/fanPredictions'

/**
 * "Call it": fans pick who goes home at the open Tribal Council, and the fan leaderboard counts the
 * right calls. Reloads whenever the council moves on (`councilKey`), so a read that finishes updates
 * the board without a page refresh.
 */
export function FanPredictionsCard({ leagueId, councilKey }: { leagueId: string; councilKey: string }) {
  const [state, setState] = useState<FanPredictionState | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/watch/predictions?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      if (res.ok) setState((await res.json()) as FanPredictionState)
    } catch {
      // The card simply stays as it was.
    }
  }, [leagueId])

  useEffect(() => { void load() }, [load, councilKey])

  const call = async (choice: string) => {
    setSaving(choice)
    setError(null)
    try {
      const res = await fetch('/api/survivor/watch/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, choice }),
      })
      const body = (await res.json().catch(() => ({}))) as { myPick?: string; error?: string }
      if (!res.ok) setError(body.error ?? 'That call did not save. Try again.')
      else setState(prev => (prev ? { ...prev, myPick: body.myPick ?? choice } : prev))
    } finally {
      setSaving(null)
    }
  }

  if (!state?.available) return null
  const here = typeof window !== 'undefined' ? window.location.pathname : `/l/${leagueId}/watch`

  return <div className="svk-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="watch-predictions">
    <span className="svk-lbl">Call it · fans only</span>
    {state.open ? <>
      <span className="svk-sub">Who goes home at Tribal Council{state.open.tribeName ? ` (${state.open.tribeName})` : ''}? Calls lock when voting closes.</span>
      {state.blocked === 'league_member'
        ? <span className="svk-faint" style={{ fontSize: 12 }}>You play in this league, so you can&apos;t call it as a fan.</span>
        : !state.signedIn
          ? <Link href={`/login?callbackUrl=${encodeURIComponent(here)}`} className="svk-btn svk-btn-gold">Sign in to make your call</Link>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {state.open.choices.map(choice => <button key={choice.key} type="button" className={`svk-btn${state.myPick === choice.key ? ' svk-btn-gold' : ''}`}
              aria-pressed={state.myPick === choice.key} disabled={saving != null} onClick={() => void call(choice.key)} data-testid="watch-prediction-choice">
              {choice.name}
            </button>)}
          </div>}
      {error && <span role="alert" style={{ fontSize: 12, color: '#fca5a5' }}>{error}</span>}
    </> : <span className="svk-sub">Calls open when the next Tribal Council starts voting.</span>}
    {state.myRecord && <span className="svk-sub">Your calls: {state.myRecord.correct} right of {state.myRecord.calls}</span>}
    {state.leaders.length > 0 && <>
      <span className="svk-lbl" style={{ marginTop: 6 }}>Fan leaderboard</span>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="watch-leaderboard">
        {state.leaders.map(row => <li key={row.name} className="svk-sub">{row.name} · {row.correct} of {row.calls}</li>)}
      </ol>
    </>}
  </div>
}
