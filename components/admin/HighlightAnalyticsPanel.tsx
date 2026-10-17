'use client'

import { useEffect, useState } from 'react'
import type { HighlightReport } from '@/lib/analytics/highlightReport'
const labels = { player_card: 'Player cards', my_team: 'My Team', league_spotlight: 'League spotlights' }
const percent = (n: number | null) => n === null ? '—' : (n * 100).toFixed(1) + '%'

export function HighlightAnalyticsPanel() {
  const [report, setReport] = useState<HighlightReport | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    fetch('/api/admin/highlight-analytics', { signal: controller.signal, cache: 'no-store' }).then(async res => {
      if (!res.ok) throw new Error('Unavailable')
      const data: HighlightReport = await res.json()
      if (!controller.signal.aborted) setReport(data)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [attempt])
  if (error) return <p role="alert">Highlight analytics could not be loaded. <button onClick={() => setAttempt(n => n + 1)}>Retry</button></p>
  if (!report) return <p role="status">Loading highlight analytics…</p>
  const r = report.returns
  return <div className="space-y-4 text-sm text-white/80">
    <p>Last 28 days · authenticated first-party browser events · updated {new Date(report.until).toLocaleString()}.</p>
    {!report.lastEventAt ? <p>No observations yet. Rates stay blank until there is a denominator.</p> : <p>Latest exposure: {new Date(report.lastEventAt).toLocaleString()}.</p>}
    <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Highlight availability and engagement by section</caption>
      <thead><tr>{['Section', 'Exposures / users', 'With clips', 'Load intent', 'Embed ready', 'Empty / unavailable / errors', 'Watch on X'].map(t => <th key={t} className="p-2">{t}</th>)}</tr></thead>
      <tbody>{report.surfaces.map(s => <tr key={s.surface} className="border-t border-white/10">
        <th scope="row" className="p-2">{labels[s.surface]}</th><td className="p-2">{s.views} / {s.users}</td>
        <td className="p-2">{s.withClips}/{s.views} ({percent(s.availabilityRate)})</td>
        <td className="p-2">{s.loadViews}/{s.withClips} ({percent(s.loadRate)})</td>
        <td className="p-2">{s.readyViews}/{s.loadViews} ({percent(s.embedSuccessRate)}) · {s.failedViews} failed</td>
        <td className="p-2">{s.empty} / {s.unavailable} / {s.errors}</td><td className="p-2">{s.sourceViews} exposures</td>
      </tr>)}</tbody></table></div>
    <p>An exposure means the section header was at least half visible for one second in an active tab, or the user acted on a clip. Counts deduplicate each mounted request. Load and source counts are exposures with those actions; multiple clips in one exposure count once. Filter changes do not create new exposures.</p>
    <p>Embed ready confirms that X rendered a post. It does not confirm playback, watch time, or completion; those metrics are unavailable.</p>
    <p><strong>Seven-day game-day return: {percent(r.rate)}</strong> · {r.returned} returned / {r.matured} mature users · {r.pending} still waiting · {r.scheduledDays} NFL dates in the stored schedule.</p>
    <p>Each user&apos;s first observed highlight exposure in this window starts their cohort. A return requires another highlight exposure on a later America/New_York calendar date with an NFL game in the stored schedule, within seven days. Only users with seven complete days of follow-up enter the rate. This measures return to highlights, not all app visits. Missing schedule rows and blocked beacons can undercount. This is observational, not evidence of causation.</p>
    {r.status === 'pending' ? <p>Waiting for the first cohort to complete seven days.</p> : r.status === 'schedule_unavailable' ? <p>Return rate unavailable: no NFL game dates are stored for this window.</p> : null}
    <button className="rounded border border-white/20 px-3 py-1" onClick={() => setAttempt(n => n + 1)}>Refresh report</button>
  </div>
}
