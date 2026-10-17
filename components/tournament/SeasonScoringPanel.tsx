'use client'
import { useRef, useState } from 'react'
import type { loadSeasonNativeSetup } from '@/lib/tournament/seasonNativeProvisioning'
import type { SeasonWeekReport } from '@/lib/tournament/seasonScoreLedger'
import { SeasonCrest } from './SeasonIdentity'
type Setup = NonNullable<Awaited<ReturnType<typeof loadSeasonNativeSetup>>>
const labels = { missing: 'Waiting for scores', provisional: 'Scores provisional', ready: 'Ready for setup finalization', finalized: 'Setup week finalized' }
export function SeasonScoringPanel({ tournamentId, setup }: { tournamentId: string; setup: Setup }) {
  const [period, setPeriod] = useState(setup.scoringPeriods?.[0] ?? 1)
  const [reports, setReports] = useState<SeasonWeekReport[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const running = useRef(false)
  async function request(key: string, action: 'review' | 'finalize', report?: SeasonWeekReport) {
    const response = await fetch('/api/tournament/season-scoring', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, tournamentId, freezeId: setup.freezeId, key, period, ...(action === 'finalize' ? { revision: report!.revision, reviewToken: report!.reviewToken } : {}) }) })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Scoring review failed. Retry shortly.')
    return body
  }
  async function review() {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setReports([])
    const checked: SeasonWeekReport[] = []
    try {
      for (const league of setup.leagues.filter(l => l.leagueId)) {
        checked.push(await request(league.key, 'review')); setReports([...checked])
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Scoring review failed.') } finally { running.current = false; setBusy(false) }
  }
  async function finalize(report: SeasonWeekReport) {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try {
      await request(report.key, 'finalize', report)
      const updated = await request(report.key, 'review')
      setReports(current => current.map(r => r.key === report.key ? updated : r))
    } catch (e) {
      // Never retain a stale finalization button after a conflict or ambiguous response.
      setReports(current => current.filter(r => r.key !== report.key))
      setError(e instanceof Error ? e.message : 'Finalization failed. Review scores again.')
    } finally { running.current = false; setBusy(false) }
  }
  return <section aria-label="Tournament weekly scoring" className="min-w-0 space-y-4 rounded-xl border border-[#e8b84a]/30 bg-[#0b0d14] p-4 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Weekly scoring review</h4><span className="text-sm text-[#ffd98a]">Setup checkpoints · launch locked</span></div>
    <p className="text-sm text-slate-300">Review saved results across your opening leagues. Finalization requires complete results and a closed correction window. Setup checkpoints do not advance teams or start live scoring.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 text-sm">Scoring week<select className="mt-1 block min-h-11 rounded-lg border border-white/20 bg-[#10131c] px-3" value={period} disabled={busy} onChange={e => { setPeriod(Number(e.target.value)); setReports([]); setError('') }}>{(setup.scoringPeriods ?? []).map(p => <option key={p} value={p}>Week {p}</option>)}</select></label><button className="min-h-11 rounded-xl bg-[#e8b84a] px-4 font-semibold text-[#1a1204] disabled:opacity-40" disabled={busy || !setup.scoringPeriods?.length || !setup.leagues.some(l => l.leagueId)} onClick={review}>{busy ? 'Checking scores…' : 'Review weekly scores'}</button></div>
    {reports.length > 0 && <p role="status" className="text-sm text-slate-300">Checked {reports.length} of {setup.leagues.filter(l => l.leagueId).length} leagues for week {period}</p>}
    {error && <p role="alert" className="break-words text-red-200">{error}</p>}
    <ul className="grid min-w-0 gap-3 md:grid-cols-2">{reports.map(report => {
      const league = setup.leagues.find(l => l.key === report.key)
      return <li key={report.key} className="min-w-0 space-y-2 rounded-xl border border-white/10 bg-[#10131c] p-3">
        <div className="flex min-w-0 items-center gap-3">{league?.art && <SeasonCrest art={league.art} division={league.division ?? ''} className="w-12 shrink-0" />}<div className="min-w-0"><p className="break-words font-semibold">{league?.name ?? report.key}</p><p className="text-sm text-[#ffd98a]">{labels[report.state]}</p></div></div>
        <p className="text-sm">{report.teams} teams · revision {report.revision}</p>
        {report.state !== 'missing' && <p className="text-sm text-slate-300">{report.missingResults} missing results · {report.provisionalResults} provisional results</p>}
        {report.statRefresh && <p className="text-sm text-slate-300">Latest full-period refresh: {report.statRefresh.correctedRows} revised player results · {report.statRefresh.backfilledRows} backfilled · {report.statRefresh.statusChangedGames} game status changes</p>}
        <p className="break-words text-sm text-slate-400">Correction window closes {new Date(report.finalizesAt).toLocaleString()}</p>
        {report.finalizedAt && <p className="text-sm text-emerald-300">Checkpoint saved {new Date(report.finalizedAt).toLocaleString()}</p>}
        {report.blockers.map(b => <p key={b} className="break-words text-sm text-slate-300">{b}</p>)}
        {report.canFinalize && report.reviewToken && <button className="min-h-11 rounded-lg border border-[#e8b84a]/40 px-3 text-sm text-[#ffd98a] disabled:opacity-40" disabled={busy} onClick={() => finalize(report)}>Finalize {league?.name ?? report.key} setup week</button>}
      </li>
    })}</ul>
  </section>
}
