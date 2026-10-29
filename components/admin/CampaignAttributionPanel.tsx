"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAdminRefresh } from "@/components/admin/adminRefreshSignal"

import type {
  CampaignAttributionReport,
  Metric,
  MetricStatus,
} from "@/lib/admin-dashboard/CampaignAttributionService"

/**
 * Admin Social/Campaigns panel.
 *
 * The whole point of this component is that a number and the ABSENCE of a number must not
 * look alike. `not_implemented` renders as an explicit "not built" chip with its reason,
 * never as 0, and `query_failed` renders as a failure — because on a dashboard a grey 0
 * and a real 0 are indistinguishable, and that is how an operator ends up trusting a
 * metric that was never wired.
 */

const WINDOW_OPTIONS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
]

const PLATFORMS = ["tiktok", "instagram", "facebook", "x", "youtube", "discord", "reddit", "email", "direct", "other"]

const STATUS_STYLES: Record<MetricStatus, { chip: string; label: string }> = {
  confirmed: { chip: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100", label: "confirmed" },
  no_activity: { chip: "border-white/15 bg-white/[0.04] text-white/55", label: "no activity" },
  not_implemented: { chip: "border-amber-300/30 bg-amber-300/10 text-amber-100", label: "not built" },
  unavailable: { chip: "border-white/15 bg-white/[0.04] text-white/55", label: "unavailable" },
  query_failed: { chip: "border-rose-300/30 bg-rose-300/10 text-rose-100", label: "query failed" },
}

const SHORT_METRIC_NOTES: Record<string, string> = {
  landing_viewed: "Tagged landing pages viewed.",
  signups_completed: "Accounts actually created.",
  dashboard_activated: "People who reached a usable dashboard.",
}

const FRESHNESS_STYLES: Record<CampaignAttributionReport["freshness"], string> = {
  fresh: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  delayed: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  stale: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  no_data: "border-white/15 bg-white/[0.04] text-white/55",
}

/** Admin presentation only. Authoritative timestamps stay UTC in the database. */
function formatEt(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso))
  } catch {
    return "—"
  }
}

function formatRate(rate: number | null): string {
  // Null denominator must not render "0%" — that reads as a real, terrible conversion rate.
  if (rate === null) return "—"
  return `${(rate * 100).toFixed(1)}%`
}

function MetricCard({ metric }: { metric: Metric }) {
  const style = STATUS_STYLES[metric.status]
  const showsNumber = metric.value !== null

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/45">{metric.label}</div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${style.chip}`}>
          {style.label}
        </span>
      </div>
      <div className={`mt-2 font-black ${showsNumber ? "text-2xl text-white sm:text-3xl" : "text-base text-white/40"}`}>
        {showsNumber ? metric.value!.toLocaleString() : "—"}
      </div>
      <div className="mt-1 text-xs leading-5 text-white/60">{metric.note ?? SHORT_METRIC_NOTES[metric.key] ?? metric.definition}</div>
    </div>
  )
}

export function CampaignAttributionPanel() {
  const [report, setReport] = useState<CampaignAttributionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(30)
  const [platform, setPlatform] = useState("")

  // `silent` is the background refresh: this panel swaps its whole body for a
  // loading card, so a visible reload every minute would blank it each time.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ windowDays: String(windowDays) })
      if (platform) params.set("platform", platform)
      const res = await fetch(`/api/admin/visitor-analytics/campaigns?${params}`, { cache: "no-store" })
      if (!res.ok) {
        // A failed fetch must surface as a failure, never as an empty (zeroed) report.
        setError(res.status === 401 || res.status === 403 ? "Not authorized." : `Request failed (${res.status}).`)
        setReport(null)
        return
      }
      setReport((await res.json()) as CampaignAttributionReport)
    } catch {
      setError("Network error — campaign data could not be loaded.")
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [windowDays, platform])

  useEffect(() => {
    void load()
  }, [load])
  useAdminRefresh(() => void load(true))

  // Lead with what needs attention: unbuilt stages are the actionable exception here.
  const unbuilt = useMemo(
    () => report?.summary.filter((m) => m.status === "not_implemented") ?? [],
    [report],
  )
  const measured = useMemo(
    () => report?.summary.filter((m) => m.status !== "not_implemented") ?? [],
    [report],
  )
  const headline = measured.filter((m) => ["landing_viewed", "signups_completed", "dashboard_activated"].includes(m.key))
  const supporting = measured.filter((m) => !headline.includes(m))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex overflow-hidden rounded-xl border border-white/10"
          role="group"
          aria-label="Time window"
        >
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => setWindowDays(opt.days)}
              aria-pressed={windowDays === opt.days}
              className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                windowDays === opt.days ? "bg-violet-500/25 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="sr-only" htmlFor="campaign-platform-filter">
          Filter by platform
        </label>
        <select
          id="campaign-platform-filter"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-white/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/60 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          Refresh
        </button>

        {report && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-1 text-[11px] font-black uppercase ${FRESHNESS_STYLES[report.freshness]}`}>
              {report.freshness === "no_data" ? "No activity" : `Data ${report.freshness}`}
            </span>
          </div>
        )}
      </div>

      {loading && <div className="rounded-2xl border border-white/10 bg-black/25 p-6 text-sm text-white/50">Loading campaign attribution…</div>}

      {!loading && error && (
        <div className="rounded-2xl border border-rose-300/25 bg-rose-300/[0.07] p-4 text-sm text-rose-100">{error}</div>
      )}

      {!loading && report && (
        <>
          {report.errors.length > 0 && (
            <div className="rounded-2xl border border-rose-300/25 bg-rose-300/[0.07] p-4 text-[12px] text-rose-100">
              {report.errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}

          <div className={`af-cc-focus af-cc-focus--${report.errors.length || report.freshness === "stale" ? "warn" : "neutral"}`}>
            <div>
              <p className="af-cc-focus-eyebrow">What this report can tell you</p>
              <h3>{report.errors.length > 0 ? "Some attribution data could not be measured" : report.sampleSize === 0 ? "No attributed activity in this window" : "Landing, signup, and activation are measured"}</h3>
              <p>{report.sampleSize === 0 ? "Try a longer window or check tagged links before judging campaign performance." : `${report.sampleSize.toLocaleString()} attributed events in this window.${unbuilt.length > 0 ? ` ${unbuilt.length} other funnel ${unbuilt.length === 1 ? "step has" : "steps have"} no emitter, so ${unbuilt.length === 1 ? "its result is" : "their results are"} unknown rather than zero.` : ""}`}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {headline.map((m) => <MetricCard key={m.key} metric={m} />)}
          </div>
          {unbuilt.length > 0 ? (
            <details className="af-cc-drilldown">
              <summary>View {unbuilt.length} unmeasured funnel steps</summary>
              <p className="af-cc-empty-state">These steps have no tracking emitter. Campaign credit for them cannot be calculated yet.</p>
              <ul className="af-cc-plain-list">
                {unbuilt.map((m) => <li key={m.key}><strong>{m.label}</strong><span>{m.note}</span></li>)}
              </ul>
            </details>
          ) : null}
          {supporting.length > 0 ? (
            <details className="af-cc-drilldown">
              <summary>View supporting attribution metrics</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {supporting.map((m) => <MetricCard key={m.key} metric={m} />)}
              </div>
            </details>
          ) : null}
          <details className="af-cc-drilldown">
            <summary>View campaign-by-campaign results</summary>
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/45">
                Campaigns
                {/* Stated explicitly: mixing first- and latest-touch totals would double-count
                    a visitor who arrived through two campaigns. */}
                <span className="ml-2 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-black tracking-normal text-white/50">
                  grouped by {report.attributionGrouping.replace("_", "-")}
                </span>
              </div>
              <div className="font-mono text-[11px] text-white/35">
                {formatEt(report.window.fromIso)} → {formatEt(report.window.toIso)} ET
              </div>
            </div>

            {report.campaigns.length === 0 ? (
              <div className="mt-4 text-sm text-white/45">
                No attributed campaign traffic in this window. This is a real absence of activity, not a failed
                query — tracked links that have not been visited yet will not appear here.
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <caption className="sr-only">Campaign attribution by platform, campaign and creative</caption>
                  <thead className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                    <tr>
                      <th scope="col" className="py-2 pr-3">Platform</th>
                      <th scope="col" className="py-2 pr-3">Campaign</th>
                      <th scope="col" className="py-2 pr-3">Creative</th>
                      <th scope="col" className="py-2 pr-3">Landing</th>
                      <th scope="col" className="py-2 pr-3 text-right">Views</th>
                      <th scope="col" className="py-2 pr-3 text-right">Visitors</th>
                      <th scope="col" className="py-2 pr-3 text-right">Accounts</th>
                      <th scope="col" className="py-2 pr-3 text-right">Activated</th>
                      <th scope="col" className="py-2 pr-3 text-right">V→A</th>
                      <th scope="col" className="py-2 pr-3 text-right">Acct→Act</th>
                      <th scope="col" className="py-2 pr-3">Latest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {report.campaigns.map((row) => (
                      <tr
                        key={`${row.platform}:${row.campaign}:${row.content}:${row.campaignId}`}
                        className="align-top text-white/70"
                      >
                        <td className="py-3 pr-3 font-black text-white">{row.platform}</td>
                        <td className="py-3 pr-3">{row.campaign ?? "—"}</td>
                        <td className="py-3 pr-3">{row.content ?? "—"}</td>
                        <td className="py-3 pr-3 font-mono text-[11px] text-white/45">{row.landingPath ?? "—"}</td>
                        <td className="py-3 pr-3 text-right">{row.landingViews.toLocaleString()}</td>
                        <td className="py-3 pr-3 text-right font-black text-white">{row.uniqueVisitors.toLocaleString()}</td>
                        <td className="py-3 pr-3 text-right font-black text-white">{row.signupsCompleted.toLocaleString()}</td>
                        {/* The launch question: which campaigns produced ACTIVATED users, not just accounts. */}
                        <td className="py-3 pr-3 text-right font-black text-violet-200">{row.dashboardsActivated.toLocaleString()}</td>
                        <td className="py-3 pr-3 text-right">{formatRate(row.visitorToActivationRate)}</td>
                        <td className="py-3 pr-3 text-right">{formatRate(row.signupToActivationRate)}</td>
                        <td className="py-3 pr-3 text-[11px] text-white/45">{formatEt(row.latestActivity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.campaignsTruncated && (
              <div className="mt-3 text-[11px] text-amber-100/70">
                Results truncated — narrow the window or filter by platform to see the rest.
              </div>
            )}
          </div>

          </details>
          <details className="af-cc-drilldown">
            <summary>How attribution is measured</summary>
            <p className="af-cc-context-note">First-party events only, grouped by first touch. GA4 and Pixel estimates are separate. Calculated {formatEt(report.calculatedAtIso)} ET; last recorded event {formatEt(report.lastEventAtIso)} ET. Environment: {report.environment}.</p>
            <ul className="af-cc-plain-list">
              {measured.map((metric) => <li key={metric.key}><strong>{metric.label}</strong><span>{metric.definition} Source: {metric.source}</span></li>)}
            </ul>
          </details>
        </>
      )}
    </div>
  )
}
