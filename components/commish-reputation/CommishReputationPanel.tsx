'use client'

import { useState } from 'react'
import { MIN_RATERS, MIN_RATINGS, WELL_RUN_MIN, type PublicReputation, type Summary } from '@/lib/commish-reputation/reputation'
import { CommishReputationBadge } from './CommishReputationBadge'

/**
 * The commissioner's own view of their reputation across every league they run, and the opt-in that
 * shows it on THIS league's public listings (league discovery and the open-teams board).
 */
export type ReputationView = { summary: Summary; public: PublicReputation; isPublic: boolean }

export function CommishReputationPanel({ leagueId, initial }: { leagueId: string; initial: ReputationView }) {
  const [view, setView] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = view.summary

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/commissioner-rating`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public: !view.isPublic }),
      })
      const body = (await res.json().catch(() => null)) as { reputation?: ReputationView | null; error?: string } | null
      if (res.ok && body?.reputation) setView(body.reputation)
      else setError(body?.error ?? 'Could not save')
    } catch {
      setError('Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left" data-testid="commish-reputation-panel">
      <h2 className="text-[15px] font-bold text-white">Your commish reputation</h2>
      <p className="mt-1 text-[12px] text-white/50">
        Every league you run, every season.{' '}
        {s.ratings === 0
          ? 'No ratings yet.'
          : `${s.overall?.toFixed(1)}★ from ${s.ratings} rating${s.ratings === 1 ? '' : 's'} by ${s.raters} manager${s.raters === 1 ? '' : 's'} in ${s.leagues} league${s.leagues === 1 ? '' : 's'}.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-white/40">How it shows publicly:</span>
        <CommishReputationBadge reputation={view.public} />
      </div>
      <p className="mt-2 text-[11px] text-white/40">
        A score shows once you have {MIN_RATINGS} ratings from at least {MIN_RATERS} different managers; until then listings say
        &ldquo;New commissioner&rdquo;. An average of {WELL_RUN_MIN} or better earns the &ldquo;Well-run league&rdquo; badge. Ratings stay
        anonymous: no names or comments are ever shown.
      </p>
      <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
        <span className="text-[13px] text-white/85">Show it on this league&rsquo;s public listings and open teams</span>
        <input type="checkbox" checked={view.isPublic} disabled={busy} onChange={() => void toggle()} className="h-5 w-5" />
      </label>
      {error && <p role="alert" className="mt-2 text-[12px] text-red-300">{error}</p>}
    </section>
  )
}
