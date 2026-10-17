'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type ControlState = {
  councilId: string
  week: number
  status: string
  deadline: string
  autoReveal: boolean
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
    const legacyPause = action === 'pause_season' || action === 'resume_season'
    const response = await fetch(legacyPause ? '/api/survivor/commissioner' : `${endpoint}/${encodeURIComponent(action)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(legacyPause ? { leagueId } : {}), ...extra }) })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Council action failed')
    return json
  }, [endpoint, leagueId])
  const refresh = useCallback(async () => {
    try { setState((await call('council-control')) as ControlState); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Council status unavailable') }
  }, [call])
  useEffect(() => { void refresh() }, [refresh])

  const act = async (action: string, extra: Record<string, unknown> = {}, success = 'Council updated') => {
    setBusy(action)
    setError(null)
    setNotice(null)
    try {
      await call(action, extra)
      if (action === 'close-vote-window') await call('tally-votes', { councilId: state?.councilId })
      setNotice(success)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed') }
    finally { setBusy(null) }
  }

  if (!state) return <section className="rounded-2xl border border-white/10 bg-[#0b0d14] p-5"><h2 className="text-xl font-bold">Council control</h2><p className="mt-2 text-sm text-slate-400">{error ?? 'Loading the sealed Council status…'}</p></section>
  const open = state.status === 'voting_open'
  const closed = state.status === 'closed' || state.status === 'sealed' || state.status === 'tie_pending'
  const timeline = [
    ['Scores final', state.scoringFinal], ['Immunity set', state.immunitySet], ['Votes close', !open], ['Read the scroll', state.isRevealed], ['After the read', state.isRevealed],
  ] as const
  const complete = state.voters.filter(voter => voter.status === 'voted').length
  return <section className="space-y-5 text-white" data-testid="survivor-council-control">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.25em] text-amber-300">Commissioner controls · week {state.week}</p><h2 className="mt-1 text-2xl font-bold">Elimination Council</h2><p className="text-sm text-slate-400">The system runs the Council. You can monitor and step in without seeing sealed choices.</p></div><div className="flex rounded-lg border border-white/15 bg-[#10121b] p-1"><button type="button" aria-pressed={state.autoReveal} disabled={busy != null} onClick={() => void act('set-auto-reveal', { enabled: true }, 'Automatic reveal enabled')} className={`rounded-md px-3 py-2 text-sm ${state.autoReveal ? 'bg-amber-400 text-black' : 'text-slate-300'}`}>Auto-reveal on</button><button type="button" aria-pressed={!state.autoReveal} disabled={busy != null} onClick={() => void act('set-auto-reveal', { enabled: false }, 'Manual reveal enabled')} className={`rounded-md px-3 py-2 text-sm ${!state.autoReveal ? 'bg-amber-400 text-black' : 'text-slate-300'}`}>Manual reveal</button></div></div>
    {error ? <p role="alert" className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-red-200">{error}</p> : null}{notice ? <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3 text-emerald-200">{notice}</p> : null}
    <div className="grid gap-2 sm:grid-cols-5">{timeline.map(([label, done], index) => <div key={label} className={`rounded-xl border p-3 ${done ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-white/10 bg-[#10121b]'}`}><p className="text-xs text-slate-400">Step {index + 1}</p><p className="mt-1 text-sm font-semibold">{label}</p><p className="mt-1 text-xs">{done ? 'Complete' : 'Pending'}</p></div>)}</div>
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]"><div className="space-y-4"><div className="rounded-xl border border-white/10 bg-[#10121b] p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Voting {open ? 'is open' : state.isRevealed ? 'has been read' : 'is sealed'}</h3><p className="text-sm text-slate-400">{complete} of {state.eligibleVoterCount} eligible managers voted · closes {new Date(state.deadline).toLocaleString()}</p></div>{open ? <button type="button" disabled={busy != null} onClick={() => void act('close-vote-window', { councilId: state.councilId }, 'Votes closed and sealed for the read')} className="min-h-11 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold disabled:opacity-50">Close votes now</button> : null}</div><ol className="mt-4 space-y-2">{state.voters.map(voter => <li key={voter.userId} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm"><span>{voter.name}</span><span className={voter.status === 'voted' ? 'text-emerald-300' : 'text-amber-300'}>{voter.status === 'not_yet' ? 'Not yet' : voter.status === 'voted' ? 'Voted' : 'Missed'}</span>{voter.status === 'not_yet' ? <button type="button" disabled={busy != null || voter.nudged} onClick={() => void act('nudge-voter', { targetUserId: voter.userId }, 'One private nudge sent')} className="min-h-9 rounded-lg border border-white/20 px-3 text-xs disabled:opacity-40">{voter.nudged ? 'Nudged' : 'Nudge once'}</button> : null}</li>)}</ol><p className="mt-3 text-xs text-slate-400">Only submission status appears here. Ballots and idol plays remain sealed until the read.</p></div>
      <div className="rounded-xl border border-white/10 bg-[#10121b] p-5"><h3 className="font-bold">The read</h3><p className="mt-2 text-sm text-slate-400">The scroll is published to the league after votes close. A tie opens a two-hour revote for eligible managers.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy != null || !state.canReveal || !closed} onClick={() => void act('reveal-votes', { councilId: state.councilId }, 'Torch Ceremony published')} className="min-h-11 rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black disabled:opacity-40">Start the reveal</button><Link href={`/survivor/${leagueId}/tribal`} className="min-h-11 rounded-lg border border-white/20 px-4 py-2 text-sm leading-7">Open Council</Link></div>{state.exactTieCandidates.length > 0 && <div className="mt-4 rounded-lg border border-amber-500/30 p-3"><p className="text-sm font-semibold">Finalized season points are also tied.</p><p className="mt-1 text-xs text-slate-400">An independent nonplaying commissioner must choose who leaves. The decision is announced and audited.</p>{state.canResolveExactTie && <div className="mt-3 flex flex-wrap gap-2">{state.exactTieCandidates.map(candidate => <button key={candidate.userId} type="button" disabled={busy != null} onClick={() => void act('resolve-exact-tie', { councilId: state.councilId, eliminatedUserId: candidate.userId }, `${candidate.name} selected in the public tiebreak`)} className="rounded-lg border border-amber-400/50 px-3 py-2 text-sm disabled:opacity-40">Vote out {candidate.name}</button>)}</div>}</div>}</div></div>
    <aside className="space-y-4"><div className="rounded-xl border border-white/10 bg-[#10121b] p-5"><h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Step in</h3><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy != null || !open} onClick={() => void act('extend-votes-hour', {}, 'Voting extended one hour')} className="min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40">Extend votes 1 hour</button><button type="button" disabled={busy != null} onClick={() => void act(state.paused ? 'resume_season' : 'pause_season', {}, state.paused ? 'League resumed' : 'League paused')} className="min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40">{state.paused ? 'Resume league' : 'Pause league'}</button></div><p className="mt-3 text-xs text-slate-400">A playing commissioner sees only operational status. A co-commissioner handles a decision involving the commissioner.</p></div><div className="rounded-xl border border-white/10 bg-[#10121b] p-5"><h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Sealed until the read</h3><ul className="mt-3 space-y-2 text-sm text-slate-300"><li>Votes: sealed</li><li>Idol plays: sealed except to their holder</li><li>Tie outcome: sealed</li></ul></div><div className="rounded-xl border border-white/10 bg-[#10121b] p-5"><h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Audit log</h3><ul className="mt-3 space-y-2 text-xs text-slate-400">{state.audit.length ? state.audit.map(entry => <li key={entry.id} className="border-t border-white/10 pt-2">{entry.actionType.replaceAll('_', ' ')} · {new Date(entry.executedAt).toLocaleString()}</li>) : <li>No commissioner actions this week.</li>}</ul></div></aside></div>
  </section>
}
