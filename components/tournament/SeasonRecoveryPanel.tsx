'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SeasonRecoveryDashboard } from '@/lib/tournament/seasonRecovery'

const field = 'min-h-11 rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm'
const button = field + ' text-cyan-200 disabled:opacity-40'

export function SeasonRecoveryPanel({ tournamentId, isOwner = true }: { tournamentId: string; isOwner?: boolean }) {
  const router = useRouter()
  const path = '/api/tournament/' + encodeURIComponent(tournamentId) + '/season-recovery'
  const [board, setBoard] = useState<SeasonRecoveryDashboard | null>(null)
  const [stage, setStage] = useState('1')
  const [period, setPeriod] = useState('1')
  const [matchId, setMatchId] = useState('')
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [reason, setReason] = useState('')
  const [entrantId, setEntrantId] = useState('')
  const [withdrawalReason, setWithdrawalReason] = useState('')
  const [resolution, setResolution] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh(selection = false, signal?: AbortSignal) {
    const url = selection ? path + '?stage=' + stage + '&period=' + period : path
    const response = await fetch(url, { cache: 'no-store', signal })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Could not load tournament recovery.')
    setBoard(data)
  }
  useEffect(() => {
    const controller = new AbortController()
    refresh(false, controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [path])

  async function action(payload: Record<string, unknown>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Recovery could not be confirmed.')
      setNotice(payload.action === 'retry' ? (result.failed ? 'The worker ran and still found a provider or setup issue.' : 'Worker check finished.') :
        payload.outcome === 'reopen' ? 'The field is open for a replacement invite. Use the registration panel to create the link.' :
        payload.action === 'resolve' ? 'Resolution saved. Resume any paused draft in its draft room within the published window.' :
        'Case saved. Draft and advancement actions are on hold.')
      setResolution('')
      setReason('')
      setMatchId('')
      setEntrantId('')
      setWithdrawalReason('')
      await refresh()
      router.refresh()
    } catch (error) { setError(error instanceof Error ? error.message : 'Recovery could not be confirmed.') }
    finally { setBusy(false) }
  }

  const match = board?.matchups.find(row => row.id === matchId)
  return <section aria-label="Tournament recovery" className="space-y-4 rounded-2xl border border-white/15 bg-slate-950 p-4 text-white sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl font-semibold">Tournament recovery</h2>
      <button type="button" className={button} disabled={busy} onClick={() => refresh().catch(error => setError(error.message))}>Refresh recovery</button>
    </div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {notice && <p role="status" className="text-cyan-200">{notice}</p>}
    {board?.cases.map(item => <article key={item.id} className="space-y-2 rounded-xl border border-amber-300/40 p-3">
      <h3 className="font-semibold text-amber-200">{item.kind === 'withdrawal' ? 'Withdrawal request · ' + item.manager : 'Score correction · ' + item.home + (item.away ? ' vs ' + item.away : '')}</h3>
      <p className="text-sm">Stage {item.stage}{item.kind === 'correction' && ' · Period ' + item.period} · Owner review pending</p>
      <p className="break-words text-sm">{item.reason}</p>
      {item.kind === 'withdrawal' && item.replacement && <p className="text-sm">Proposed replacement · {item.replacement}</p>}
      {item.kind === 'correction' && <p className="text-sm">Saved score {item.before.join('–')} · Proposed score {item.after.join('–')}</p>}
      <p className="text-sm">{item.impact.explanation}</p>
      <p className="text-sm">Stage {item.impact.affectedStage} · {item.impact.rooms} issued rooms · {item.impact.started} started drafts · {item.impact.picks} saved picks</p>
      {item.impact.changedSeeds !== undefined && <p className="text-sm">{item.impact.changedSeeds} changed seeds. {item.impact.entrantsIn?.length ? 'Entering · ' + item.impact.entrantsIn.join(', ') + '. ' : ''}{item.impact.entrantsOut?.length ? 'Leaving · ' + item.impact.entrantsOut.join(', ') + '.' : ''}</p>}
      {isOwner && <><label className="block text-sm">Reason for resolution<input className={field + ' mt-1 block w-full'} value={resolution} maxLength={500} onChange={e => setResolution(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        {item.impact.eligible && <button type="button" className={button} disabled={busy || !resolution.trim()} onClick={() => action({ action: 'resolve', caseId: item.id, outcome: 'apply', reason: resolution })}>Apply reviewed {item.kind === 'withdrawal' ? 'replacement' : 'correction'}</button>}
        {item.impact.canReopen && <button type="button" className={button} disabled={busy || !resolution.trim()} onClick={() => action({ action: 'resolve', caseId: item.id, outcome: 'reopen', reason: resolution })}>Reopen registration for this seat</button>}
        <button type="button" className={button} disabled={busy || !resolution.trim()} onClick={() => action({ action: 'resolve', caseId: item.id, outcome: 'retain', reason: resolution })}>Keep saved outcome and release hold</button>
      </div></>}
    </article>)}
    {!!board?.delays.length && <div className="space-y-2 rounded-xl border border-amber-300/40 p-3">
      <h3 className="font-semibold">Final scoring delayed</h3>
      <ul className="space-y-1 text-sm">{board.delays.map(item => <li key={item.id}>{item.leagueName} · Stage {item.stage}, period {item.period} · Owner review by <time dateTime={item.escalationAt}>{new Date(item.escalationAt).toLocaleString()}</time></li>)}</ul>
      <p className="text-sm text-slate-300">The worker retries eligible scores. Advancement waits for the official results.</p>
      {isOwner && <button type="button" className={button} disabled={busy || !!board.cases.length} onClick={() => action({ action: 'retry' })}>Retry tournament worker</button>}
    </div>}
    {isOwner && !!board?.entrants.length && !board.cases.length && <details>
      <summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Review a withdrawal or no-show</summary>
      <div className="space-y-2">
        <label className="block text-sm">Assigned entrant<select className={field + ' mt-1 block w-full'} value={entrantId} onChange={e => setEntrantId(e.target.value)}><option value="">Choose an entrant</option>{board.entrants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="block text-sm">Reason for review<input className={field + ' mt-1 block w-full'} value={withdrawalReason} maxLength={500} onChange={e => setWithdrawalReason(e.target.value)} /></label>
        <button type="button" className={button} disabled={busy || !entrantId || !withdrawalReason.trim()} onClick={() => action({ action: 'withdraw', participantId: entrantId, reason: withdrawalReason })}>Open withdrawal review</button>
      </div>
    </details>}
    {!!board && !board.cases.length && <details>
      <summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Review a finalized matchup</summary>
      <div className="space-y-3">
        <p className="text-sm text-slate-300">Propose an official score correction with a reason. The case shows its effect on the next field for the owner to review.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Source stage<select className={field + ' mt-1 block'} value={stage} onChange={e => { setStage(e.target.value); setMatchId('') }}>{[1, 2, 3].map(number => <option key={number}>{number}</option>)}</select></label>
          <label className="text-sm">Scoring period<input className={field + ' mt-1 block w-24'} type="number" min={1} max={30} value={period} onChange={e => { setPeriod(e.target.value); setMatchId('') }} /></label>
          <button type="button" className={button} disabled={busy} onClick={() => { setMatchId(''); refresh(true).catch(error => setError(error.message)) }}>Load finalized matchups</button>
        </div>
        {!!board.matchups.length && <label className="block text-sm">Finalized matchup<select className={field + ' mt-1 block w-full'} value={matchId} onChange={e => {
          const selected = board.matchups.find(item => item.id === e.target.value)
          setMatchId(e.target.value); setHome(selected ? String(selected.homeScore) : ''); setAway(selected ? String(selected.awayScore) : '')
        }}><option value="">Choose a matchup</option>{board.matchups.map(item => <option key={item.id} value={item.id}>{item.leagueName} · {item.home} vs {item.away ?? 'bye'} · {item.homeScore}–{item.awayScore}</option>)}</select></label>}
        {match && <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">Corrected home score<input className={field + ' mt-1 block w-full'} type="number" step="0.0001" value={home} onChange={e => setHome(e.target.value)} /></label>
            <label className="text-sm">Corrected away score<input className={field + ' mt-1 block w-full'} type="number" step="0.0001" value={away} disabled={!match.away} onChange={e => setAway(e.target.value)} /></label>
          </div>
          <label className="block text-sm">Correction reason<input className={field + ' mt-1 block w-full'} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
          <button type="button" className={button} disabled={busy || !home || !away || !reason.trim()} onClick={() => action({
            action: 'correct', score: { matchupId: match.id, homeScore: Number(home), awayScore: Number(away) }, reason,
          })}>Open correction review</button>
        </div>}
      </div>
    </details>}
    {!!board?.resolutions.length && <details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Resolution history</summary>
      <ul className="space-y-2 text-sm">{board.resolutions.map(item => <li key={item.id}>{item.outcome === 'apply' ? 'Applied' : item.outcome === 'reopen' ? 'Registration reopened' : 'Saved outcome retained'} · {item.summary ?? 'Recovery review'}<span className="block">{item.requestReason && 'Request · ' + item.requestReason + ' · '}Resolution · {item.reason}</span><span className="block break-all text-xs text-slate-400">Case {item.caseId} · {new Date(item.resolvedAt).toLocaleString()}</span></li>)}</ul>
    </details>}
  </section>
}
