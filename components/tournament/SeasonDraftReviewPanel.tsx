'use client'
import { useState } from 'react'
import { SeasonCrest } from './SeasonIdentity'
import type { loadSeasonNativeSetup } from '@/lib/tournament/seasonNativeProvisioning'
import type { reviewSeasonOpeningDraft } from '@/lib/tournament/seasonOpeningReadiness'

type Setup = NonNullable<Awaited<ReturnType<typeof loadSeasonNativeSetup>>>
type Report = Awaited<ReturnType<typeof reviewSeasonOpeningDraft>>
const labels = { not_started: 'Waiting for draft', drafting: 'Draft in progress', paused: 'Draft paused', checkpoint_pending: 'Completion pending', completed: 'Draft verified', review_required: 'Needs review' }

export function SeasonDraftReviewPanel({ tournamentId, setup }: { tournamentId: string; setup: Setup }) {
  const [reports, setReports] = useState<Report[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function review() {
    if (busy) return
    setBusy(true); setError(''); setReports([])
    const checked: Report[] = []
    try {
      for (const league of setup.leagues.filter(l => l.leagueId)) {
        const response = await fetch('/api/tournament/season-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'review_draft', tournamentId, freezeId: setup.freezeId, key: league.key }) })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not review this draft.')
        checked.push(body); setReports([...checked])
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Draft review failed. Retry to refresh the checks.') } finally { setBusy(false) }
  }
  async function prepare(key: string) {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/tournament/season-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'prepare_rosters', tournamentId, freezeId: setup.freezeId, key }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Roster preparation failed.')
      setReports(current => current.map(report => report.key === key ? { ...report, rostersPrepared: true } : report))
    } catch (e) { setError(e instanceof Error ? e.message : 'Roster preparation failed. Retry shortly.') } finally { setBusy(false) }
  }
  const gates = reports[0]?.gates ?? []
  return <section aria-label="Opening draft review" className="min-w-0 space-y-4 rounded-xl border border-[#e8b84a]/30 bg-[#0b0d14] p-4 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Opening draft review</h4><span className="rounded-lg border border-[#e8b84a]/40 px-3 py-1 text-sm text-[#ffd98a]">Season launch locked</span></div>
    <p className="text-sm text-slate-300">Check saved picks, team assignments and completion checkpoints before moving on. These checks preserve your rules and keep player moves and scoring locked.</p>
    <button className="min-h-11 rounded-xl bg-[#e8b84a] px-4 font-semibold text-[#1a1204] disabled:opacity-40" disabled={busy || !setup.leagues.some(l => l.leagueId)} onClick={review}>{busy ? 'Checking drafts…' : 'Review opening drafts'}</button>
    <p role={busy || reports.length ? 'status' : undefined} aria-live="polite" className="text-sm text-slate-300">{reports.length ? `Checked ${reports.length} of ${setup.leagues.filter(l => l.leagueId).length} drafts · ${reports.filter(r => r.state === 'completed').length} verified` : setup.leagues.some(l => l.leagueId) ? 'Review your saved opening drafts. Season launch remains locked.' : 'Create opening leagues to begin. Draft verification does not unlock the season.'}</p>
    {error && <p role="alert" className="text-red-200">{error}</p>}
    <ul className="grid min-w-0 gap-3 md:grid-cols-2">{reports.map(report => {
      const league = setup.leagues.find(l => l.key === report.key)
      return <li key={report.key} className="min-w-0 space-y-2 rounded-xl border border-white/10 bg-[#10131c] p-3">
        <div className="flex min-w-0 items-center gap-3">{league?.art && <SeasonCrest art={league.art} division={league.division ?? ''} className="w-12 shrink-0" />}<div className="min-w-0"><p className="break-words font-semibold">{league?.name ?? report.key}</p><p className={report.state === 'completed' ? 'text-sm text-emerald-300' : report.state === 'review_required' ? 'text-sm text-red-200' : 'text-sm text-[#ffd98a]'}>{labels[report.state]}</p></div></div>
        <p className="font-mono text-sm">{report.filledPicks} / {report.totalPicks} picks saved</p>
        {report.totalPicks > 0 && <progress aria-label={`${league?.name ?? report.key} saved picks`} className="block h-2 w-full accent-[#e8b84a]" value={Math.min(report.filledPicks, report.totalPicks)} max={report.totalPicks} />}
        {report.state === 'completed' && (report.rostersPrepared ? <p className="text-sm text-emerald-300">Rosters prepared · player moves locked</p> : <button className="min-h-11 rounded-lg border border-[#e8b84a]/40 px-3 text-sm text-[#ffd98a] disabled:opacity-40" disabled={busy} onClick={() => prepare(report.key)}>Prepare {league?.name ?? report.key} rosters</button>)}
        {report.completedAt && <p className="text-sm text-slate-400">Verified {new Date(report.completedAt).toLocaleString()}</p>}
        {report.blockers.map(blocker => <p key={blocker} className="break-words text-sm text-slate-300">{blocker}</p>)}
      </li>
    })}</ul>
    {gates.length > 0 && <div className="space-y-2 border-t border-white/10 pt-3"><h5 className="font-semibold">Still needed before season launch</h5><ul className="space-y-2">{gates.map(gate => <li key={gate.key} className="flex items-start justify-between gap-3 text-sm"><span>{gate.label}</span><span className="shrink-0 text-[#ffd98a]">Pending</span></li>)}</ul></div>}
  </section>
}
