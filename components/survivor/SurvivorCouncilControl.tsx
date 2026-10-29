'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type ControlState = {
  councilId: string
  week: number
  status: string
  deadline: string
  autoReveal: boolean
  lineupsLocked: boolean
  canControl: boolean
  idolsHidden: boolean
  afterReadComplete: boolean
  scoringFinal: boolean
  immunitySet: boolean
  paused: boolean
  canReveal: boolean
  canResolveExactTie: boolean
  exactTieCandidates: Array<{ userId: string; name: string }>
  isRevealed: boolean
  submittedCount: number
  eligibleVoterCount: number
  voters: Array<{ userId: string; name: string; status: 'voted' | 'not_yet' | 'missed'; nudged: boolean }>
  audit: Array<{ id: string; actionType: string; description: string; executedAt: string }>
}

export function SurvivorCouncilControl({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<ControlState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/survivor`

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch(`${endpoint}/${encodeURIComponent(action)}`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Council action failed')
    return json
  }, [endpoint])
  const refresh = useCallback(async () => {
    try { setState((await call('council-control')) as ControlState); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Council status unavailable') }
  }, [call])
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 30_000); return () => clearInterval(timer) }, [refresh])

  const act = async (action: string, extra: Record<string, unknown> = {}, success = 'Council updated') => {
    setBusy(action)
    setError(null)
    setNotice(null)
    try {
      await call(action, extra)
      setNotice(success)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed') }
    finally { setBusy(null) }
  }

  if (!state) return <section className="rounded-2xl border border-white/10 bg-[#0b0d14] p-5"><h2 className="text-xl font-bold">Council control</h2><p className="mt-2 text-sm text-slate-400">{error ?? 'Loading the sealed Council status…'}</p></section>
  const open = state.status === 'voting_open'
  const closed = ['closed', 'voting_closed', 'sealed', 'tie_pending'].includes(state.status)
  const disabled = busy != null || !state.canControl
  const frozen = disabled || state.paused
  const checklist = [
    { label: 'Scores final', done: state.scoringFinal, detail: state.scoringFinal ? 'Weekly scoring is final.' : 'Waiting for final weekly scoring.' },
    { label: 'Immunity set', done: state.immunitySet, detail: state.immunitySet ? 'Immunity is recorded for this week.' : 'Waiting for immunity to be recorded.' },
    { label: 'Votes close', done: closed || state.isRevealed, detail: `${state.submittedCount} of ${state.eligibleVoterCount} voted. ${open ? `Deadline: ${new Date(state.deadline).toLocaleString()}` : 'The window is closed.'}` },
    { label: 'Read the scroll', done: state.isRevealed, detail: state.isRevealed ? 'The read is published to the league.' : 'Votes remain sealed until the read.' },
    { label: 'After the read', done: state.afterReadComplete, detail: state.afterReadComplete ? 'Torch out and Exile have run. Notifications and the moment page run on their own.' : state.isRevealed ? 'Torch out, Exile, notifications and the moment page run on their own. Settlement is pending.' : 'Torch out, Exile, notifications and the moment page run on their own after the read.' },
  ]
  const timeline = [
    { label: 'Lineups lock', done: state.lineupsLocked },
    { label: 'Scores final', done: state.scoringFinal },
    { label: 'Immunity', done: state.immunitySet },
    { label: 'Votes close', done: closed || state.isRevealed },
    { label: 'The read', done: state.isRevealed },
  ]
  const pending = timeline.findIndex(step => !step.done)
  const currentStage = pending < 0 ? timeline.length - 1 : pending
  const buttonClass = 'min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold disabled:opacity-40'
  const cardClass = 'rounded-xl border border-white/10 bg-[#0b0d14] p-5'
  const labels: Record<string, string> = { council_vote_nudge: 'One vote reminder sent', council_vote_extended: 'Vote deadline extended one hour; tribe notified', council_reveal_mode: 'Reveal mode changed', pause_season: 'League paused', resume_season: 'League resumed', council_closed: 'Votes closed', player_eliminated: 'Torch out and Exile settled', votes_revealed: 'Scroll read', revote_opened: 'Revote opened', exact_tie_commissioner_decision: 'Commissioner tie decision' }
  return <section className="space-y-5 text-white" data-testid="survivor-council-control">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-2xl font-bold">Tribal Council control - week {state.week}</h2><p className="mt-1 text-sm text-slate-400">Commissioner only - Tribal runs on its own; this is where you watch it and step in.</p></div>
      <div className="flex rounded-lg border border-white/15 p-1" aria-label="Reveal mode">
        {[true, false].map(enabled => <button key={String(enabled)} type="button" aria-pressed={state.autoReveal === enabled} disabled={disabled} onClick={() => void act('set-auto-reveal', { enabled }, enabled ? 'Automatic reveal enabled' : 'Manual reveal enabled')} className={`${buttonClass} ${state.autoReveal === enabled ? 'border-amber-300 bg-amber-400/10 text-amber-200' : ''}`}>{enabled ? 'Auto-reveal on' : 'Manual reveal'}</button>)}
      </div>
    </header>
    {error && <p role="alert" className="rounded-lg border border-red-500/30 p-3 text-sm text-red-200">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-500/30 p-3 text-sm text-emerald-200">{notice}</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <ol aria-label="Council timeline" className="grid gap-2 sm:grid-cols-5">{timeline.map((step, index) => <li key={step.label} aria-current={index === currentStage ? 'step' : undefined} className={`rounded-xl border p-3 ${index === currentStage ? 'border-amber-400/60 bg-amber-400/5' : 'border-white/10 bg-[#0b0d14]'}`}><p className="text-xs text-slate-400">{index === currentStage ? 'Current stage' : step.done ? 'Complete' : 'Upcoming'}</p><p className="mt-1 text-sm font-semibold">{step.label}</p></li>)}</ol>
        <div className={cardClass}>
          <div className="flex items-center gap-3"><img src={state.isRevealed ? '/survivor/weekly/torch-out.svg' : '/survivor/weekly/urn.svg'} alt="" width={36} height={44} /><h3 className="flex-1 font-bold">{state.paused ? 'League paused' : state.isRevealed ? 'The scroll has been read' : open ? 'Voting is open' : 'Council is sealed'}</h3><span className="text-sm text-amber-300">{checklist.filter(step => step.done).length} of 5 done</span></div>
          <ol aria-label="Council checklist" className="mt-4 space-y-3">{checklist.map((step, index) => <li key={step.label} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${step.done ? 'border-emerald-500/30' : 'border-white/10'}`}><span className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-sm" aria-label={step.done ? 'Complete' : `Step ${index + 1}`}>{step.done ? 'OK' : index + 1}</span><div className="min-w-40 flex-1"><h4 className="text-sm font-semibold">{step.label}</h4><p className="mt-1 text-sm text-slate-400">{step.detail}</p></div>{index === 2 && open && <button type="button" disabled={frozen} onClick={() => void act('close-vote-window', { councilId: state.councilId }, 'Votes closed and sealed for the read')} className={buttonClass}>Close votes now</button>}{index === 3 && !state.isRevealed && <button type="button" disabled={frozen || !closed || !state.canReveal} onClick={() => void act('reveal-votes', { councilId: state.councilId }, 'The read is published. Aftermath runs on its own.')} className={`${buttonClass} bg-amber-400 text-black`}>Start the reveal</button>}</li>)}</ol>
          <Link href={`/survivor/${leagueId}/tribal`} className="mt-4 inline-flex min-h-11 items-center text-sm text-amber-200 underline">Open Council and moment page</Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className={cardClass}><h3 className="text-sm font-bold uppercase tracking-wide">Who has voted - {state.submittedCount} of {state.eligibleVoterCount}</h3><ul className="mt-4 space-y-3">{state.voters.map(voter => <li key={voter.userId} className="flex flex-wrap items-center gap-2 text-sm"><span className="flex-1">{voter.name}</span><span>{voter.status === 'voted' ? 'Voted' : voter.status === 'missed' ? 'Missed' : 'Not yet'}</span>{voter.status === 'not_yet' && <button type="button" aria-label={`Nudge ${voter.name}`} disabled={frozen || !open || voter.nudged} onClick={() => void act('nudge-voter', { targetUserId: voter.userId }, 'One private push sent')} className={buttonClass}>{voter.nudged ? 'Nudged' : 'Nudge'}</button>}</li>)}</ul><p className="mt-4 text-xs text-slate-400">You see who has voted, never who they voted for. Uncast votes do not count. One nudge per manager per Council prevents repeat pushes.</p></div>
          <div className={cardClass}><h3 className="text-sm font-bold uppercase tracking-wide">Sealed until the read</h3><ul className="mt-4 space-y-4 text-sm"><li><b>Idol plays: {state.idolsHidden ? 'hidden from you' : 'sealed'}</b><p className="mt-1 text-slate-400">{state.idolsHidden ? 'Hidden idol plays are never included in this control page.' : 'View published plays on the scroll after the read.'}</p></li><li><b>Votes: sealed</b><p className="mt-1 text-slate-400">This page never receives ballot choices, even after the read.</p></li><li><b>Tie rule: sealed</b><p className="mt-1 text-slate-400">The system applies the league rule. Published results appear on the scroll.</p></li></ul></div>
        </div>
      </div>
      <aside className="space-y-4">
        <div className={cardClass}><h3 className="text-sm font-bold uppercase tracking-wide">Step in</h3><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={frozen || !open} onClick={() => void act('extend-votes-hour', {}, 'Voting extended one hour; tribe notified')} className={buttonClass}>Extend votes 1 hour</button><button type="button" disabled={disabled} onClick={() => void act(state.paused ? 'resume-league' : 'pause-league', {}, state.paused ? 'League resumed' : 'League paused')} className={buttonClass}>{state.paused ? 'Resume league' : 'Pause league'}</button></div><p className="mt-3 text-xs text-slate-400">Extending sends every manager in the tribe one push. Pausing freezes the deadline and reveal until you resume. Both go in the audit log.</p><p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-200">If you also play, your own vote and idols work like everyone else&apos;s. A co-commissioner settles anything that involves you.{!state.canControl ? ' Your control page is read-only; an independent host handles these actions.' : ''}</p></div>
        <div className={cardClass}><h3 className="text-sm font-bold uppercase tracking-wide">Audit log</h3><ul className="mt-3 space-y-3 text-sm">{state.audit.length ? state.audit.map(entry => <li key={entry.id} className="border-t border-white/10 pt-3"><p>{labels[entry.actionType] ?? 'Council action recorded'}</p><time className="text-xs text-slate-400" dateTime={entry.executedAt}>{new Date(entry.executedAt).toLocaleString()}</time></li>) : <li className="text-slate-400">No commissioner actions this week.</li>}</ul></div>
      </aside>
    </div>
  </section>
}
