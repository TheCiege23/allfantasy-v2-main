'use client'

import { useCallback, useEffect, useState } from 'react'
import { SurvivorVoteRevealScrolls, type RevealScroll } from '@/components/league/survivor/SurvivorVoteRevealScrolls'
import type { TribalCouncilView } from '@/lib/survivor/survivorTribalView'

function remaining(deadline: string, now: number): string {
  const seconds = Math.max(0, Math.floor((new Date(deadline).getTime() - now) / 1000))
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function SurvivorRevote({ leagueId }: { leagueId: string }) {
  const [view, setView] = useState<TribalCouncilView | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor`, { cache: 'no-store' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Revote unavailable')
    setView(payload.tribalCouncil as TribalCouncilView)
  }, [leagueId])
  useEffect(() => { void refresh().catch(cause => setError(cause instanceof Error ? cause.message : 'Revote unavailable')) }, [refresh])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const revote = view?.revote
  const deadlinePassed = revote ? new Date(revote.deadline).getTime() <= now : false
  const eligible = Boolean(view?.you.isEligibleVoter && !view?.you.hasVoted && !deadlinePassed && view.status === 'voting_open')

  const cast = async () => {
    if (!eligible || !selected) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit-vote', message: `@Chimmy <@${selected}>` }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Could not cast your revote')
      setNotice('Your revote is sealed. The scroll will be read after the two-hour window closes.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cast your revote') }
    finally { setBusy(false) }
  }

  if (!revote) return <div className="mx-auto max-w-4xl rounded-xl border border-white/10 bg-[#10121b] p-6 text-slate-300">{error ?? 'Loading the revote…'}</div>
  const scrolls: RevealScroll[] = view?.reveal?.revealSequence.map((step, index) => ({ order: index + 1, targetUserId: step.targetUserId, targetName: step.targetName, status: step.status, isExtraVote: step.isExtraVote })) ?? []
  return <main className="mx-auto max-w-6xl space-y-6 px-3 py-6 text-white" data-testid="survivor-revote">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5"><div><p className="text-xs font-bold uppercase tracking-[.3em] text-amber-300">Elimination Council · week {view?.week}</p><h1 className="mt-2 font-serif text-3xl font-bold">It&apos;s a tie</h1><p className="mt-2 text-sm text-slate-400">Revote, then finalized season points if it stays tied.</p></div><div className="rounded-xl border border-amber-500/30 bg-[#10121b] px-5 py-3"><p className="text-xs uppercase tracking-wider text-slate-400">Revote clock</p><p className="mt-1 font-mono text-3xl tabular-nums text-amber-300" aria-live="off">{remaining(revote.deadline, now)}</p><p className="text-xs text-slate-400">Uncast revotes do not count.</p></div></header>
    {error ? <p role="alert" className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-red-200">{error}</p> : null}{notice ? <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3 text-emerald-200">{notice}</p> : null}
    <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]"><aside className="space-y-3"><div className="rounded-xl border border-amber-500/30 bg-[#10121b] p-5"><p className="text-xs font-bold uppercase tracking-wider text-amber-300">1 · Revote</p><p className="mt-2 text-sm text-slate-300">Only managers who are not tied vote, and only for the tied managers.</p></div><div className="rounded-xl border border-white/10 bg-[#10121b] p-5"><p className="text-xs font-bold uppercase tracking-wider text-slate-300">2 · Still tied?</p><p className="mt-2 text-sm text-slate-400">Fewer finalized season points goes home.</p></div><div className="rounded-xl border border-white/10 bg-[#10121b] p-5"><p className="text-xs font-bold uppercase tracking-wider text-slate-300">3 · Exact points tie?</p><p className="mt-2 text-sm text-slate-400">An independent commissioner decides, and the choice is logged.</p></div></aside>
      <section className="rounded-xl border border-white/10 bg-[#10121b] p-5"><p className="text-center font-serif text-sm font-bold uppercase tracking-[.25em] text-amber-300">The tally is tied</p><div className="mt-6 grid grid-cols-2 gap-3">{revote.candidates.map(candidate => <div key={candidate.userId} className="rounded-xl border border-red-500/30 bg-red-950/10 p-4 text-center"><p className="font-semibold">{candidate.displayName}</p><p className="mt-2 font-serif text-4xl text-amber-200">{candidate.firstRoundVotes}</p><p className="text-xs text-slate-400">first-round votes</p></div>)}</div><p className="mt-6 text-center text-sm text-slate-400">Nobody goes home yet. No new idols can be played in the revote; earlier plays stand.</p>
      {eligible ? <div className="mt-6 border-t border-white/10 pt-5"><h2 className="font-semibold">Cast your revote privately</h2><p className="mt-1 text-sm text-slate-400">Choose a tied manager. We&apos;ll send your sealed @Chimmy ballot.</p><div className="mt-3 grid gap-2">{view?.you.eligibleTargets.map(target => <button key={target.userId} type="button" aria-pressed={selected === target.userId} onClick={() => setSelected(target.userId)} className={`min-h-12 rounded-lg border px-4 py-2 text-left ${selected === target.userId ? 'border-amber-400 bg-amber-950/30' : 'border-white/15'}`}>{target.displayName}</button>)}</div><button type="button" disabled={!selected || busy} onClick={() => void cast()} className="mt-4 min-h-12 w-full rounded-lg bg-amber-400 px-4 font-bold text-black disabled:opacity-40">{busy ? 'Sealing your ballot…' : 'Drop revote in the urn'}</button></div> : <p className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4 text-center text-sm text-slate-300">{view?.you.hasVoted ? 'Your revote has been received.' : view?.you.isEligibleVoter ? 'The revote window has closed.' : 'You are in the tie and do not vote in this round.'}</p>}
      </section></div>
    {view?.isRevealed && scrolls.length > 0 ? <section className="rounded-xl border border-white/10 bg-[#10121b] p-5"><h2 className="font-serif text-xl font-bold">Revote scroll</h2><SurvivorVoteRevealScrolls scrolls={scrolls} eliminatedName={view.reveal?.eliminatedName ?? null} isTie={view.reveal?.isTie === true} tiePhase={view.reveal?.tiePhase ?? null} /></section> : null}
  </main>
}
