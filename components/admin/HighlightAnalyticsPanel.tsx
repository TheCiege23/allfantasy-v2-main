"use client"

import { useEffect, useState } from "react"
import type { HighlightReport } from "@/lib/analytics/highlightReport"

const labels = { player_card: "Player cards", my_team: "My Team", league_spotlight: "League spotlights" }
const percent = (n: number | null) => n === null ? "Not available" : `${(n * 100).toFixed(1)}%`
const formatEt = (value: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}).format(new Date(value))

export function HighlightAnalyticsPanel() {
  const [report, setReport] = useState<HighlightReport | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    fetch("/api/admin/highlight-analytics", { signal: controller.signal, cache: "no-store" }).then(async (res) => {
      if (!res.ok) throw new Error("Unavailable")
      const data: HighlightReport = await res.json()
      if (!controller.signal.aborted) setReport(data)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [attempt])

  if (error) return <p role="alert">Highlight analytics could not be loaded. <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>
  if (!report) return <p role="status">Loading highlight analytics…</p>

  const returns = report.returns
  const exposures = report.surfaces.reduce((sum, surface) => sum + surface.views, 0)
  const withClips = report.surfaces.reduce((sum, surface) => sum + surface.withClips, 0)
  const errors = report.surfaces.reduce((sum, surface) => sum + surface.errors + surface.failedViews, 0)
  const unobserved = report.surfaces.filter((surface) => surface.views === 0)

  return <div className="af-cc-analytics-summary">
    <div className={`af-cc-focus af-cc-focus--${errors > 0 ? "warn" : "neutral"}`}>
      <div>
        <p className="af-cc-focus-eyebrow">What this tells you</p>
        <h3>{exposures === 0 ? "No highlight views have been observed" : errors > 0 ? "Some highlight views had errors" : `${withClips} of ${exposures} views showed clips`}</h3>
        <p>{exposures === 0 ? "There is not enough traffic to judge availability or return yet." : `${unobserved.length} of ${report.surfaces.length} sections had no observed views. An unobserved section is not a failed section.`}</p>
      </div>
    </div>
    <div className="af-cc-compact-stats">
      <div><strong>{exposures}</strong><span>Section views in 28 days</span></div>
      <div><strong>{withClips}</strong><span>Views with clips</span></div>
      <div><strong>{returns.matured > 0 ? `${returns.returned} of ${returns.matured}` : "—"}</strong><span>Returned on a later game day</span></div>
    </div>
    <div className="af-cc-priority-list">
      <h3>By section</h3>
      <ul>
        {report.surfaces.map((surface) => (
          <li key={surface.surface}>
            <div>
              <strong>{labels[surface.surface]}</strong>
              <p>{surface.views === 0 ? "No views observed" : `${surface.withClips} of ${surface.views} views had clips${surface.empty + surface.unavailable + surface.errors > 0 ? ` · ${surface.empty + surface.unavailable + surface.errors} empty or unavailable` : ""}`}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
    <p className="af-cc-context-note">
      {returns.status === "schedule_unavailable" ? "Game-day return is unavailable because this window has no stored NFL game dates." : exposures === 0 ? "No game-day return rate yet because no highlight views were observed." : returns.matured === 0 ? "Game-day return is pending until the first viewers have seven complete days of follow-up." : `${returns.returned} of ${returns.matured} eligible viewers returned on a later game day (${percent(returns.rate)}). ${returns.matured < 10 ? "This is a small sample, not a trend." : ""}`}
      {report.lastEventAt ? ` Latest observed view: ${formatEt(report.lastEventAt)} ET.` : ""}
    </p>
    <details className="af-cc-drilldown">
      <summary>View the full engagement breakdown</summary>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><caption className="sr-only">Highlight availability and engagement by section</caption>
        <thead><tr>{["Section", "Views / people", "With clips", "Load intent", "Embed ready", "Empty / unavailable / errors", "Watch on X"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{report.surfaces.map((surface) => <tr key={surface.surface} className="border-t border-white/10">
          <th scope="row" className="p-2">{labels[surface.surface]}</th><td className="p-2">{surface.views} / {surface.users}</td>
          <td className="p-2">{surface.withClips}/{surface.views} ({percent(surface.availabilityRate)})</td>
          <td className="p-2">{surface.loadViews}/{surface.withClips} ({percent(surface.loadRate)})</td>
          <td className="p-2">{surface.readyViews}/{surface.loadViews} ({percent(surface.embedSuccessRate)}) · {surface.failedViews} failed</td>
          <td className="p-2">{surface.empty} / {surface.unavailable} / {surface.errors}</td><td className="p-2">{surface.sourceViews} views</td>
        </tr>)}</tbody>
      </table></div>
    </details>
    <details className="af-cc-drilldown">
      <summary>How these measurements work</summary>
      <div className="af-cc-method-notes">
        <p>A view counts when a section header was at least half visible for one second in an active tab, or a person acted on a clip. Repeated clips in the same view count once.</p>
        <p>Embed ready means X rendered a post. Playback, watch time, and completion are not measured.</p>
        <p>Game-day return requires a later highlight view on an NFL game date within seven days. Only people with seven complete days of follow-up enter the rate. It does not measure all app visits or prove why someone returned.</p>
        <p>Updated {formatEt(report.until)} ET · {returns.pending} viewers still awaiting follow-up · {returns.scheduledDays} NFL dates in the stored schedule.</p>
      </div>
    </details>
    <button type="button" className="af-cc-refresh-button" onClick={() => setAttempt((n) => n + 1)}>Refresh report</button>
  </div>
}
