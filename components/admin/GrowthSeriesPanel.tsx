"use client"

import { useId, useState } from "react"
import type {
  AdminGrowthSeries,
  GrowthGranularity,
  GrowthMetric,
} from "@/lib/admin-dashboard/AdminGrowthSeriesService"

/**
 * Signups and activity over time, switchable between day / week / month.
 *
 * ⚠ ALL THREE GRANULARITIES ARRIVE IN ONE PAYLOAD, so switching is instant and
 * costs no query and no reload. That is a deliberate property of
 * AdminGrowthSeriesService, not an accident of this component — see its header.
 *
 * ⚠ AN UNTRACKED METRIC DOES NOT GET A CHART. Drawing a flat line along the
 * axis for something nobody is measuring is the chart-shaped version of the
 * $0.00 bug 29a exists to fix: it looks like a confident measurement of zero.
 * Untracked metrics render as a NOT TRACKED row with the reason instead.
 */

const GRANULARITIES: Array<{ key: GrowthGranularity; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
]

function MetricRow({ metric, granularity }: { metric: GrowthMetric; granularity: GrowthGranularity }) {
  const chartId = useId()

  if (!metric.tracked) {
    return (
      <div className="af-cc-untracked">
        <div className="af-cc-untracked-text">
          <div className="af-cc-untracked-label">{metric.label}</div>
          {metric.reason ? <div className="af-cc-untracked-reason">{metric.reason}</div> : null}
        </div>
        <div className="af-cc-untracked-chip">Not tracked</div>
      </div>
    )
  }

  const peak = Math.max(...metric.buckets.map((b) => b.value), 0)
  const last = metric.buckets[metric.buckets.length - 1]
  /*
   * "Busiest" deliberately ignores the in-progress period. A part-period can
   * only understate, so it can never legitimately be the peak — but on a quiet
   * metric it can tie at zero and win the reduce, which would report today as
   * the busiest day on record.
   */
  const complete = metric.buckets.filter((b) => !b.partial)
  const busiest = (complete.length ? complete : metric.buckets).reduce(
    (a, b) => (b.value > a.value ? b : a),
    (complete.length ? complete : metric.buckets)[0],
  )

  return (
    <div className="af-cc-series">
      <div className="af-cc-series-head">
        <div className="af-cc-stack" style={{ flex: 1 }}>
          <span className="af-cc-series-label">{metric.label}</span>
          <span className="af-cc-job-cadence">{metric.hint}</span>
        </div>
        <span className="af-cc-metric-value af-cc-metric-value--lead">{metric.total.toLocaleString()}</span>
      </div>

      {/*
        role="img" with a summary label: a bare stack of divs is invisible to a
        screen reader, and a 30-column table read cell by cell is worse than
        useless. The peak is the one fact worth speaking aloud.
      */}
      <div
        className="af-cc-bars"
        role="img"
        aria-labelledby={chartId}
        aria-describedby={`${chartId}-desc`}
      >
        {metric.buckets.map((bucket) => (
          <span
            key={bucket.key}
            className={[
              "af-cc-chartbar",
              bucket.value > 0 ? "" : "af-cc-chartbar--empty",
              // The in-progress period is drawn hollow so a short final column
              // reads as "not finished" rather than "fell off a cliff".
              bucket.partial ? "af-cc-chartbar--partial" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ height: peak > 0 ? `${Math.max(2, (bucket.value / peak) * 100)}%` : "2px" }}
            title={
              bucket.partial
                ? `${bucket.label}: ${bucket.value.toLocaleString()} so far — this ${granularity} is still in progress`
                : `${bucket.label}: ${bucket.value.toLocaleString()}`
            }
          />
        ))}
      </div>
      <span id={chartId} className="af-cc-sr">
        {metric.label} over time
      </span>
      <span id={`${chartId}-desc`} className="af-cc-sr">
        {metric.total.toLocaleString()} total across {metric.buckets.length} buckets. Busiest:{" "}
        {busiest?.label ?? "none"} with {busiest?.value.toLocaleString() ?? 0}.
        {last?.partial
          ? ` The final ${granularity}, ${last.label}, is still in progress and is lower than a full one.`
          : ""}
      </span>

      {/*
        The axis says so too. A hollow bar is only legible to someone who
        already knows the convention; the word "in progress" needs no legend,
        and it is the same fact a screen reader gets above.
      */}
      <div className="af-cc-bars-axis">
        <span>{metric.buckets[0]?.label}</span>
        <span>
          {last?.label}
          {last?.partial ? <span className="af-cc-partial-tag"> · in progress</span> : null}
        </span>
      </div>
    </div>
  )
}

export function GrowthSeriesPanel({ series }: { series: AdminGrowthSeries }) {
  const [granularity, setGranularity] = useState<GrowthGranularity>("day")
  const active = series.byGranularity[granularity]

  return (
    <section className="af-cc-card" aria-label="Growth over time">
      <div className="af-cc-card-head">
        <div className="af-cc-card-title">Growth</div>
        <div className="af-cc-tabs" role="group" aria-label="Time granularity">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGranularity(g.key)}
              aria-pressed={granularity === g.key}
              className={granularity === g.key ? "af-cc-tab af-cc-tab--on" : "af-cc-tab"}
              style={{ cursor: "pointer" }}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="af-cc-card-scope">{active.windowLabel}</div>
      </div>

      <div className="af-cc-card-body">
        {active.metrics.map((metric) => (
          <MetricRow key={metric.key} metric={metric} granularity={granularity} />
        ))}
        {/*
          The timezone is stated, not assumed. "Signups today" means a different
          number in UTC than in New York, and an operator comparing this against
          Stripe or Vercel needs to know which day boundary produced it.
        */}
        <p className="af-cc-footnote">
          Buckets are {series.timezone.replace("_", " ")} calendar periods. Active users counts distinct
          signed-in users; anonymous traffic is in the visitor panel below.
        </p>
      </div>
    </section>
  )
}
