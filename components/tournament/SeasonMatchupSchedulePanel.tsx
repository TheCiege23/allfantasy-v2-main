'use client'
import { useRef, useState } from 'react'
import type { loadSeasonNativeSetup } from '@/lib/tournament/seasonNativeProvisioning'
import type { SeasonMatchupPreview } from '@/lib/tournament/seasonScoreLedger'
type Setup = NonNullable<Awaited<ReturnType<typeof loadSeasonNativeSetup>>>
export function SeasonMatchupSchedulePanel({ tournamentId, setup }: { tournamentId: string; setup: Setup }) {
  const created = setup.leagues.filter(l => l.leagueId)
  const [key, setKey] = useState(created[0]?.key ?? ''), [period, setPeriod] = useState(setup.scoringPeriods?.[0] ?? 1)
  const [report, setReport] = useState<SeasonMatchupPreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const running = useRef(false)
  async function request(action: 'preview' | 'publish', token?: string) {
    const response = await fetch('/api/tournament/season-matchups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, tournamentId, freezeId: setup.freezeId, key, period, ...(action === 'publish' ? { previewToken: token } : {}) }) })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Could not verify this matchup schedule.')
    return body
  }
  async function preview() {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setReport(null)
    try { setReport(await request('preview')) } catch (e) { setError(e instanceof Error ? e.message : 'Preview failed. Retry shortly.') } finally { running.current = false; setBusy(false) }
  }
  async function publish() {
    if (running.current || !report?.canPublish) return
    running.current = true; setBusy(true); setError('')
    try { await request('publish', report.previewToken); setReport(await request('preview')) } catch (e) { setReport(null); setError(e instanceof Error ? e.message : 'Publication failed. Preview the current schedule again.') } finally { running.current = false; setBusy(false) }
  }
  const league = setup.leagues.find(l => l.key === key)
  const date = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: report?.timezone })
  return <section aria-label="Tournament matchup schedule" className="min-w-0 space-y-4 rounded-xl border border-[#e8b84a]/30 bg-[#0b0d14] p-4 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Opening matchup schedule</h4><span className="text-sm text-[#ffd98a]">Setup only · launch locked</span></div>
    <p className="text-sm text-slate-300">Preview suggested round-robin opponents for each opening league and week. Teams rotate opponents before repeating. Publication locks that week's pairings; scoring and advancement stay locked.</p>
    <p className="text-sm text-slate-400">Complete the draft and prepare rosters first. Home and away labels do not change fantasy scoring.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 max-w-full text-sm">Matchup league<select className="mt-1 block min-h-11 max-w-full rounded-lg border border-white/20 bg-[#10131c] px-3" value={key} disabled={busy || !created.length} onChange={e => { setKey(e.target.value); setReport(null); setError('') }}>{created.map(l => <option key={l.key} value={l.key}>{l.name}</option>)}</select></label>
      <label className="text-sm">Matchup week<select className="mt-1 block min-h-11 rounded-lg border border-white/20 bg-[#10131c] px-3" value={period} disabled={busy} onChange={e => { setPeriod(Number(e.target.value)); setReport(null); setError('') }}>{(setup.scoringPeriods ?? []).map(p => <option key={p} value={p}>Week {p}</option>)}</select></label>
      <button className="min-h-11 rounded-xl bg-[#e8b84a] px-4 font-semibold text-[#1a1204] disabled:opacity-40" disabled={busy || !key || !setup.scoringPeriods?.length} onClick={preview}>{busy ? 'Checking schedule…' : 'Preview matchups'}</button>
    </div>
    {error && <p role="alert" className="break-words text-red-200">{error}</p>}
    {report && <>
      <p role="status" className="break-words text-sm text-[#ffd98a]">{league?.name ?? report.key} · week {report.period} · {report.state === 'published' ? 'Matchups published and locked' : report.state === 'closed' ? 'Publication closed · no schedule saved' : 'Suggested pairings · not published'}</p>
      <p className="break-words text-sm text-slate-300">Publish before {date(report.publishBefore)} ({report.timezone})</p>
      {report.publishedAt && <p className="break-words text-sm text-emerald-300">Published {date(report.publishedAt)}</p>}
      <ul className="grid min-w-0 gap-3 md:grid-cols-2">{report.pairs.map((pair, index) => <li key={index} className="min-w-0 space-y-2 rounded-xl border border-white/10 bg-[#10131c] p-3"><p className="text-xs text-slate-400">Matchup {index + 1}</p><p className="break-words font-semibold">{pair.home.displayName}</p><p className="text-xs text-[#ffd98a]">vs</p><p className="break-words font-semibold">{pair.away.displayName}</p></li>)}</ul>
      {report.canPublish && <button className="min-h-11 rounded-xl border border-[#e8b84a]/40 px-4 text-[#ffd98a] disabled:opacity-40" disabled={busy} onClick={publish}>Publish week {report.period} matchups</button>}
    </>}
  </section>
}
