'use client'
import { SeasonMatchupSchedulePanel } from './SeasonMatchupSchedulePanel'
import { SeasonStandingsPanel } from './SeasonStandingsPanel'
import { SeasonScoringPanel } from './SeasonScoringPanel'
import { SeasonDraftReviewPanel } from './SeasonDraftReviewPanel'
import { SeasonScheduleReviewPanel } from './SeasonScheduleReviewPanel'
import { useEffect, useState } from 'react'
import { SeasonCrest } from './SeasonIdentity'
import Link from 'next/link'
import type { checkSeasonDraftReadiness } from '@/lib/tournament/seasonDraftReadiness'
import type { loadSeasonNativeSetup } from '@/lib/tournament/seasonNativeProvisioning'
type Setup = NonNullable<Awaited<ReturnType<typeof loadSeasonNativeSetup>>>
export function SeasonNativeSetup({ tournamentId }: { tournamentId: string }) {
  const [readiness, setReadiness] = useState<Awaited<ReturnType<typeof checkSeasonDraftReadiness>> | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('')
  async function reload() {
    const res = await fetch('/api/tournament/season-setup?tournamentId=' + encodeURIComponent(tournamentId), { cache: 'no-store' })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'Could not load opening setup.')
    setSetup(body.setup)
  }
  useEffect(() => { reload().catch(e => setError(e.message)) }, [tournamentId])
  async function provision() {
    if (busy || !setup) return
    setBusy(true); setError('')
    try {
      // Each request commits one league. Reloading or retrying resumes the saved checkpoints.
      for (let i = 0; i <= setup.leagues.length; i++) {
        const res = await fetch('/api/tournament/season-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tournamentId, freezeId: setup.freezeId }) })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Opening setup failed.')
        setProgress(body.completed + '/' + body.total + ' opening leagues created. Draft launch remains blocked.')
        if (body.complete) break
      }
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed. Retry to resume.')
      try { await reload() } catch { /* Keep original failure visible. */ }
    } finally { setBusy(false) }
  }
  async function checkDraft() {
    if (busy || !setup) return
    setBusy(true); setError('')
    try {
      const created = setup.leagues.filter(l => l.leagueId)
      const keys = created.length ? created.map(l => l.key) : [undefined]
      const reports: Awaited<ReturnType<typeof checkSeasonDraftReadiness>>['reports'] = []
      // Bound each request to one catalog lookup; resume/retry benefits from saved checks.
      for (const key of keys) {
        const res = await fetch('/api/tournament/season-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check_draft', tournamentId, freezeId: setup.freezeId, ...(key ? { key } : {}) }) })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Could not check draft readiness.')
        reports.push(...body.reports)
        setReadiness({ ...body, reports: [...reports] })
        setProgress('Checked ' + reports.length + '/' + keys.length + ' player pools. Draft launch remains blocked.')
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Draft check failed.') } finally { setBusy(false) }
  }
  async function releaseDraft(key: string) {
    if (busy || !setup) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/tournament/season-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'release_draft', tournamentId, freezeId: setup.freezeId, key }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not release this opening draft.')
      setProgress('Opening draft released for ' + (setup.leagues.find(l => l.key === key)?.name ?? key) + '. Season scoring and player moves remain locked.')
      await reload()
    } catch (e) { setError(e instanceof Error ? e.message : 'Draft release failed.') } finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-xl border border-cyan-300/30 p-4" aria-label="Opening league setup">
    <h3 className="font-semibold">Create opening leagues and drafts</h3>
    <p className="text-sm text-slate-300">Creates the saved teams, scoring, roster settings, waiver balances and draft sessions. An opening draft can be released only after its player pool and the published NBA schedule pass fresh checks. Player moves and live scoring remain locked.</p>
    {error && <p role="alert" className="text-red-200">{error}</p>}{progress && <p role="status">{progress}</p>}
    {setup && <><ul className="space-y-2">{setup.leagues.map(l => <li key={l.key} className="flex min-w-0 flex-wrap items-center gap-3">{l.art && <SeasonCrest art={l.art} division={l.division ?? ''} className="w-14 shrink-0" />}<span className="min-w-0 break-words">{l.name} · {l.slots} teams · {l.state.replaceAll('_', ' ')}{l.draftReleased ? ' · draft released' : ''}</span>{l.draftId && <Link className="flex min-h-11 items-center rounded-xl border border-cyan-300/60 px-3 text-sm text-cyan-100" href={`/drafts/${encodeURIComponent(l.draftId)}`}>Open draft room</Link>}{setup.draftReleaseEnabled && l.state === 'created' && !l.draftReleased && <button className="min-h-11 rounded-xl border border-cyan-300/60 px-3 text-sm text-cyan-100 disabled:opacity-40" disabled={busy || !setup.leagues.every(entry => entry.state === 'created')} onClick={() => releaseDraft(l.key)}>Release opening draft</button>}</li>)}</ul>
      {!setup.draftReleaseEnabled && <p className="text-sm text-amber-200">Opening draft release is disabled on this deployment. The commissioner can still verify the saved setup and player pools.</p>}
      <button className="min-h-11 rounded-xl bg-cyan-300 px-4 font-semibold text-slate-950 disabled:opacity-40" disabled={busy} onClick={provision}>{busy ? 'Working…' : setup.leagues.every(l => l.state === 'created') ? 'Verify saved setup' : 'Create or resume opening setup'}</button></>}
    {setup?.scoringSource && <section aria-label="Tournament scoring feed readiness" className="min-w-0 space-y-2 rounded-xl border border-amber-300/30 bg-amber-300/5 p-3 text-sm">
      <h4 className="font-semibold text-amber-100">Scoring feed readiness · launch blocked</h4>
      <p className="break-words text-slate-200">{setup.scoringSource.source} · {setup.scoringSource.boxContractReady ? 'enabled box stats mapped' : 'additional stat evidence required'}</p>
      {setup.scoringSource.sport === 'NBA' && <p className="text-slate-300">{setup.scoringSource.measured.length} measured stats · {setup.scoringSource.derived.length} derived stats</p>}
      {setup.scoringSource.missing.length > 0 && <p className="break-words text-amber-100">Needs evidence for: {setup.scoringSource.missing.map(key => key.replaceAll('_', ' ')).join(', ')}.</p>}
      <ul className="list-disc space-y-1 pl-5 text-amber-100">{setup.scoringSource.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
      {setup.scoringSource.sport === 'NBA' && <p className="text-slate-300">TheSportsDB supplies schedule and artwork enrichment here; scoring still depends on verified player and game evidence.</p>}
    </section>}
    {setup && <SeasonScheduleReviewPanel key={setup.freezeId + ':schedule'} tournamentId={tournamentId} freezeId={setup.freezeId} periods={setup.scoringPeriods ?? []} leagues={setup.leagues.map(league => ({ key: league.key, name: league.name, leagueId: league.leagueId }))} />}
    <button className="min-h-11 rounded-xl border border-cyan-300/40 px-4" disabled={busy || !setup} onClick={checkDraft}>Check draft player pools</button>
    {readiness && <section aria-label="Tournament draft readiness" className="space-y-3"><h4 className="font-semibold">Draft readiness · launch blocked</h4><p className="text-sm">Catalog checks expire after five minutes. Active drafts refresh before picks and auction actions; failed refreshes retry after 30 seconds. Expired pools block picks until recovery. These checks do not certify injury data or live scoring.</p><ul className="space-y-2">{readiness.reports.map(report => <li key={report.key}>{setup?.leagues.find(l => l.key === report.key)?.name ?? report.key}: {report.poolReady ? 'Pool fits all roster slots' : 'Pool blocked'} · {report.players} players{report.expiresAt && <p className="text-sm text-slate-300">Verified until {new Date(report.expiresAt).toLocaleString()}</p>}{report.retryAt && <p className="text-sm text-amber-200">Retry after {new Date(report.retryAt).toLocaleString()}</p>}{report.blockers.map(blocker => <p key={blocker} className="text-sm text-amber-200">{blocker}</p>)}</li>)}</ul><ul className="list-disc space-y-1 pl-5 text-sm text-amber-200">{readiness.remaining.map(item => <li key={item}>{item}</li>)}</ul></section>}
    {setup && <SeasonDraftReviewPanel key={setup.freezeId} tournamentId={tournamentId} setup={setup} />}
    {setup && <SeasonMatchupSchedulePanel key={setup.freezeId + ":matchups"} tournamentId={tournamentId} setup={setup} />}
    {setup && <SeasonScoringPanel key={setup.freezeId + ":scoring"} tournamentId={tournamentId} setup={setup} />}
    {setup && <SeasonStandingsPanel key={setup.freezeId + ":standings"} tournamentId={tournamentId} setup={setup} />}
    <button className="min-h-11 rounded-xl border border-white/20 px-4" disabled={busy} onClick={() => reload().catch(e => setError(e.message))}>Refresh setup progress</button>
  </section>
}
