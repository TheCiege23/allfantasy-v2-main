'use client'

import { useEffect, useRef, useState } from 'react'

type Strategy = 'balanced' | 'win-now' | 'rebuild'
type View = { available: boolean; active: Strategy | null; revision: number | null;
  pending: { strategy: Strategy; observations: number; readyToConfirm: boolean } | null;
  evidence?: { available: boolean; completedWeek: number | null; canConfirm: boolean } }
const names: Record<Strategy, string> = { balanced: 'Balanced', 'win-now': 'Win now', rebuild: 'Rebuild' }

/** Keyed by league so an in-flight response can never become another league's preference. */
export default function ChimmyStrategyCard({ leagueId }: { leagueId: string }) {
  return <StrategyCard key={leagueId} leagueId={leagueId} />
}
function StrategyCard({ leagueId }: { leagueId: string }) {
  const [view, setView] = useState<View | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const locked = useRef(false)
  const url = `/api/decision-os/strategy?leagueId=${encodeURIComponent(leagueId)}`

  async function send(body: object, signal: AbortSignal) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }
  async function refresh(signal: AbortSignal) {
    const response = await send({ action: 'refresh' }, signal)
    if (!response.ok) throw new Error('unavailable')
    const next: View = await response.json()
    if (!signal.aborted) setView(next)
  }
  async function run(confirm: boolean) {
    if (locked.current) return
    locked.current = true
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setBusy(true); setError(''); setNotice('')
    try {
      if (confirm && view?.pending && view.evidence?.canConfirm) {
        const response = await send({ expectedRevision: view.revision, strategy: view.pending.strategy, confirmed: true }, current.signal)
        if (response.status === 409) {
          await refresh(current.signal)
          if (!current.signal.aborted) setNotice('The proposal changed or needs fresh results. Review it before confirming again.')
        } else {
          if (!response.ok) throw new Error('unavailable')
          const next: View = await response.json()
          if (!current.signal.aborted) { setView(next); setNotice('Your strategy preference is saved.') }
        }
      } else await refresh(current.signal)
    } catch {
      if (!current.signal.aborted) setError('Strategy guidance is temporarily unavailable. Try again.')
    } finally {
      if (!current.signal.aborted) { locked.current = false; setBusy(false) }
    }
  }
  useEffect(() => {
    void run(false)
    return () => { controller.current?.abort(); locked.current = false }
    // The inner component remounts whenever the league changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <section aria-label="League strategy" className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
    <div className="font-semibold">League strategy{view?.active ? ` · ${names[view.active]}` : ''}</div>
    {view?.pending && <p className="mt-1 text-white/70">Suggested: {names[view.pending.strategy]} · {Math.min(3, view.pending.observations)}/3 consecutive weekly observations. Your preference changes only when you confirm.</p>}
    {view && !view.evidence?.available && !notice && <p className="mt-1 text-white/60">Fresh, complete weekly league results are needed for strategy guidance.</p>}
    {view?.available && !view.pending && view.evidence?.available && <p className="mt-1 text-white/60">No strategy change is proposed.</p>}
    {view?.pending && view.evidence?.canConfirm && <button type="button" disabled={busy} onClick={() => void run(true)} className="mt-2 rounded-lg bg-cyan-400 px-3 py-2 font-medium text-slate-950 disabled:opacity-50">Use {names[view.pending.strategy].toLowerCase()} strategy</button>}
    <div role="status" aria-live="polite" className="mt-1 text-white/70">{busy ? 'Checking league strategy…' : notice}</div>
    {error && <p role="alert" className="mt-1 text-amber-200">{error}</p>}
    {!busy && <button type="button" onClick={() => void run(false)} className="mt-2 text-xs text-cyan-300">Refresh strategy</button>}
  </section>
}
