'use client'
import { useRef, useState } from 'react'
import type { loadSeasonNativeSetup } from '@/lib/tournament/seasonNativeProvisioning'
import type { SeasonOpeningStandingsReport } from '@/lib/tournament/seasonFinalizedStandings'
type Setup = NonNullable<Awaited<ReturnType<typeof loadSeasonNativeSetup>>>
const PAGE_SIZE = 8
const format = (points: number | null) => points === null ? '—' : points.toLocaleString(undefined, { maximumFractionDigits: 4 })
export function SeasonStandingsPanel({ tournamentId, setup }: { tournamentId: string; setup: Setup }) {
  const [through, setThrough] = useState(setup.scoringPeriods?.[0] ?? 1), [report, setReport] = useState<SeasonOpeningStandingsReport | null>(null)
  const [page, setPage] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const running = useRef(false)
  async function review() {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setReport(null); setPage(0)
    try {
      const response = await fetch('/api/tournament/season-standings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tournamentId, freezeId: setup.freezeId, throughPeriod: through }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not verify standings.')
      setReport(body)
    } catch (e) { setError(e instanceof Error ? e.message : 'Standings review failed. Retry shortly.') } finally { running.current = false; setBusy(false) }
  }
  const pages = report ? Math.ceil(report.rows.length / PAGE_SIZE) : 0
  return <section aria-label="Tournament opening standings" className="min-w-0 space-y-4 rounded-xl border border-[#e8b84a]/30 bg-[#0b0d14] p-4 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Opening tournament standings</h4><span className="text-sm text-[#ffd98a]">Setup review · advancement locked</span></div>
    <p className="text-sm text-slate-300">Compare all frozen teams using current finalized-week checkpoints. Missing or corrected weeks do not count until verified again. Ranks stay pending while required weeks are incomplete.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Standings through<select className="mt-1 block min-h-11 rounded-lg border border-white/20 bg-[#10131c] px-3" value={through} disabled={busy} onChange={e => { setThrough(Number(e.target.value)); setReport(null); setPage(0); setError('') }}>{(setup.scoringPeriods ?? []).map(p => <option key={p} value={p}>Week {p}</option>)}</select></label><button className="min-h-11 rounded-xl bg-[#e8b84a] px-4 font-semibold text-[#1a1204] disabled:opacity-40" disabled={busy || !setup.scoringPeriods?.length} onClick={review}>{busy ? 'Checking standings…' : 'Review opening standings'}</button></div>
    {error && <p role="alert" className="break-words text-red-200">{error}</p>}
    {report && <>
      <p role="status" className="text-sm text-slate-300">{report.verifiedWeeks} of {report.requiredWeeks} league-week checkpoints verified · {report.rows.length} teams</p>
      <p className="text-sm text-slate-300">{report.verifiedMatchupWeeks ?? 0} of {report.requiredWeeks} matchup checkpoints verified</p>
      {report.blockers.map(b => <p key={b} className="break-words text-sm text-[#ffd98a]">{b}</p>)}
      <ul className="grid min-w-0 gap-3 md:grid-cols-2">{report.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => <li key={row.entrantId} className="min-w-0 space-y-2 rounded-xl border border-white/10 bg-[#10131c] p-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold">{row.displayName}</p><p className="break-words text-sm text-slate-400">{row.leagueName}</p></div><span className="shrink-0 text-sm text-[#ffd98a]">{row.rank === null ? 'Rank pending' : 'Rank ' + row.rank + (row.tied ? ' · tie pending' : '')}</span></div>
        <p className="text-sm">Total points: <span className="font-mono">{format(row.pointsFor)}</span></p>
        <p className="text-sm text-slate-300">Known finalized points: {format(row.knownFinalizedPoints)} · Best week: {format(row.bestWeek)}</p>
        <p className="text-sm text-slate-300">Win credits: {format(row.wins)} · Losses: {format(row.losses ?? null)} · Ties: {format(row.ties ?? null)}</p>
        {(row.missingMatchupPeriods?.length ?? 0) > 0 && <p className="break-words text-sm text-[#ffd98a]">Matchup verification needed: weeks {row.missingMatchupPeriods.join(', ')}</p>}
        {row.missingPeriods.length > 0 && <p className="break-words text-sm text-[#ffd98a]">Needs checkpoint: weeks {row.missingPeriods.join(', ')}</p>}
      </li>)}</ul>
      {pages > 1 && <nav aria-label="Standings pages" className="flex flex-wrap items-center justify-between gap-3"><button className="min-h-11 rounded-lg border border-white/20 px-3 disabled:opacity-40" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous teams</button><span className="text-sm">Page {page + 1} of {pages}</span><button className="min-h-11 rounded-lg border border-white/20 px-3 disabled:opacity-40" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Next teams</button></nav>}
      <details className="rounded-lg border border-white/10 p-3"><summary className="min-h-11 cursor-pointer text-sm">League-week verification details</summary><ul className="space-y-2 text-sm text-slate-300">{report.weeks.map(w => <li key={w.leagueKey + ':' + w.period} className="break-words">{setup.leagues.find(l => l.key === w.leagueKey)?.name ?? w.leagueKey} · week {w.period} · {w.state.replaceAll('_', ' ')} · revision {w.revision} · matchups {w.matchupsState ?? 'pending'}</li>)}</ul></details>
    </>}
  </section>
}
