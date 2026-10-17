'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SavedSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import type { VerifiedSeasonCalendar } from '@/lib/tournament/seasonCalendarVerification'

export function SeasonRulesPublication({ saved }: { saved: SavedSeasonBlueprint }) {
  const router = useRouter()
  const [calendar, setCalendar] = useState<VerifiedSeasonCalendar | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [acceptExcluded, setAcceptExcluded] = useState(false)
  const [acceptPending, setAcceptPending] = useState(false)
  const format = (iso: string) => new Intl.DateTimeFormat('en', { timeZone: saved.config.rules?.calendar.timezone ?? 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  async function action(publish: boolean) {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/tournament/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: publish ? 'blueprint_publish_rules' : 'blueprint_check_calendar', tournamentId: saved.tournamentId, revision: saved.revision,
        ...(publish ? { digest: calendar?.digest, acceptExcludedGames: acceptExcluded, acceptPendingGames: acceptPending } : {}),
      }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not verify the calendar.')
      if (publish) router.refresh()
      else { setCalendar(body.calendar); setAcceptExcluded(false); setAcceptPending(false) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Calendar operation failed.') }
    finally { setBusy(false) }
  }
  const schedule = saved.config.rules && <details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Saved schedule in {saved.config.rules.calendar.timezone}</summary><ul className="space-y-3 text-sm">{saved.config.rules.calendar.drafts.filter(d => d.startsAt && d.completeBy).map(d => <li key={'draft-' + d.stage}>Stage {d.stage} draft: {format(d.startsAt)} to {format(d.completeBy)}</li>)}{saved.config.rules.calendar.periods.filter(p => p.startsAt && p.endsAt && p.finalizesAt).map(p => <li key={p.number}>Period {p.number}: {format(p.startsAt)} to {format(p.endsAt)}. Scores finalize {format(p.finalizesAt)}.</li>)}</ul></details>
  if (saved.publication) return <section className="rounded-2xl border border-emerald-300/30 p-4 sm:p-6">
    <h2 className="text-xl font-semibold">Rules published and frozen</h2>
    {schedule}
    <p className="mt-3 text-sm text-slate-300">Published {format(saved.publication.publishedAt)}. All participants will accept this version when registration is available.</p>
    <p className="mt-2 break-all text-xs text-slate-400">Rule version: {saved.publication.hash}</p>
    <p className="mt-3 text-sm">Verified against {saved.publication.regularGames} published regular-season games; {saved.publication.pendingGames} pending games; {saved.publication.excludedGames} games explicitly excluded by scoring gaps.</p>
    <p className="mt-3 text-sm text-amber-200">The owner can now manage registration. League creation and live execution are still pending. Schedule changes must be rechecked before scoring opens.</p>
  </section>
  if (!saved.canEditSettings) return null
  return <section className="space-y-3 rounded-2xl border border-white/15 p-4 sm:p-6" aria-label="Calendar verification and publication">
    <h2 className="text-xl font-semibold">Review and publish rules</h2>
    {schedule}
    <p className="text-sm text-slate-300">Check the saved calendar against a fresh provider schedule. Publication freezes these rules and records the reviewed schedule; it does not open registration.</p>
    <button className="min-h-11 rounded-xl border border-cyan-300/40 px-4 text-cyan-200 disabled:opacity-40" onClick={() => action(false)} disabled={busy || !saved.config.rules}>{busy ? 'Checking…' : 'Verify saved calendar against games'}</button>
    {error && <p role="alert" className="text-red-200">{error}</p>}
    {calendar && <>
      <p className="text-sm">{calendar.regularGames} provider games · checked {format(calendar.checkedAt)}</p>
      {calendar.blockers.length > 0 && <ul className="list-disc space-y-2 pl-5 text-sm text-amber-200">{calendar.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      {calendar.warnings.map(w => <p key={w} className="text-sm text-amber-200">{w}</p>)}
      <details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Games in each scoring period</summary><ul className="space-y-2 text-sm">{calendar.periods.map(p => <li key={p.number}>Period {p.number}: {p.games} games</li>)}</ul></details>
      {calendar.excludedGames.length > 0 && <details><summary className="min-h-11 cursor-pointer py-2 text-amber-200">Review excluded games</summary><ul className="space-y-2 text-sm">{calendar.excludedGames.map(g => <li key={g.gameId}>{g.gameId} · {format(g.startsAt)}</li>)}</ul></details>}
      {saved.isOwner && <>
        {calendar.excludedGames.length > 0 && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={acceptExcluded} onChange={e => setAcceptExcluded(e.target.checked)} disabled={busy} />I accept that the listed gap games will not count</label>}
        {calendar.pendingGames > 0 && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={acceptPending} onChange={e => setAcceptPending(e.target.checked)} disabled={busy} />I accept the pending NBA games and the required pre-scoring schedule recheck</label>}
        <p className="text-sm text-slate-400">Only the owner can publish. Published rules cannot be edited through this planner.</p>
        <button className="min-h-12 w-full rounded-xl bg-emerald-300 px-4 font-bold text-slate-950 disabled:opacity-40" onClick={() => action(true)} disabled={busy || !calendar.ready || (calendar.excludedGames.length > 0 && !acceptExcluded) || (calendar.pendingGames > 0 && !acceptPending)}>Publish and freeze tournament rules</button>
      </>}
    </>}
  </section>
}
