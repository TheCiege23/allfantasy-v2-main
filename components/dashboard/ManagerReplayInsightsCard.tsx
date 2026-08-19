'use client'

import { useEffect, useState } from 'react'
import { Activity, Ban, Gauge, Layers, TrendingUp, type LucideIcon } from 'lucide-react'
import type {
  ManagerReplayInsightSetV1,
  ManagerReplayInsightV1,
  ReplayInsightCategory,
} from '@/lib/replay-framework/insights/managerReplayInsight'

/**
 * Phase 20/21 — Manager Replay Insights dashboard panel (display-only).
 *
 * A self-contained, read-only "Historical Replay Insights" panel that renders
 * the user-safe `ManagerReplayInsightSetV1` contract for one league EXACTLY as
 * returned — it recomputes nothing and reads only the contract's user-facing
 * fields. Phase 21 enriched the original minimal list into a summary grid +
 * highlights + an honest trends empty-state, using only what the contract
 * carries (the 4 insight cards + trade counts). No ROI / starter-conversion /
 * bench-conversion numbers are shown because the user-safe contract does not
 * carry them (they live only in the internal correlation summary, deliberately
 * stripped in Phase 17) — the panel never fabricates or recomputes them.
 *
 * It fetches the INTERNAL, session-authenticated route
 * `/api/leagues/[leagueId]/replay-insights` (the A1 path) — never the public
 * keyed Intelligence API, and never the replay internals. It shows historical,
 * validated observations; it does not modify or feed any recommendation logic.
 *
 * Gated client-side by `NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED`
 * so the panel is fully inert by default — no fetch, renders nothing — until the
 * feature is turned on. The internal route independently enforces its own
 * server-side `MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED` gate; both must be on
 * for the panel to show, keeping every dashboard render cost-free when off.
 *
 * Honest states: disabled, loading, error, empty (not enough trade history yet),
 * and ready. No raw replay/asset IDs are ever rendered — the contract carries
 * none, and this component never surfaces the internal `insightId` slug.
 */

type CardState =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'ready'; data: ManagerReplayInsightSetV1 }

interface CardResponse {
  enabled: boolean
  data?: ManagerReplayInsightSetV1
}

const CATEGORY_META: Record<ReplayInsightCategory, { label: string; icon: LucideIcon }> = {
  starter_impact_trades: { label: 'Starter-impact trades', icon: TrendingUp },
  bench_depth_trades: { label: 'Bench-depth trades', icon: Layers },
  wasted_acquisitions: { label: 'Wasted acquisitions', icon: Ban },
  lineup_efficiency_impact: { label: 'Overall lineup efficiency', icon: Gauge },
}

function sentimentClasses(sentiment: ManagerReplayInsightV1['sentiment']): string {
  if (sentiment === 'positive') return 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20'
  if (sentiment === 'caution') return 'bg-amber-500/15 text-amber-300 border-amber-400/20'
  return 'bg-white/10 text-white/70 border-white/15'
}

function confidenceLabel(confidence: ManagerReplayInsightV1['confidence']): string {
  if (confidence === 'high') return 'High confidence'
  if (confidence === 'moderate') return 'Moderate confidence'
  if (confidence === 'low') return 'Low confidence'
  return 'Very limited data'
}

function InsightTile({ insight }: { insight: ManagerReplayInsightV1 }) {
  const meta = CATEGORY_META[insight.category]
  const Icon = meta?.icon ?? Activity
  return (
    <li className="flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
          <Icon className="h-3.5 w-3.5 shrink-0 text-violet-200/70" aria-hidden />
          <span>{meta?.label ?? insight.category}</span>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold ${sentimentClasses(insight.sentiment)}`}>
          {insight.displayValue}
        </span>
      </div>
      <p className="mt-2 text-sm font-medium text-white/90">{insight.headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/55">{insight.detail}</p>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-white/40">
        <span>{confidenceLabel(insight.confidence)}</span>
        <span aria-hidden>·</span>
        <span>{insight.sampleSize} trade{insight.sampleSize === 1 ? '' : 's'}</span>
      </div>
      {insight.caveat && (
        <p className="mt-2 rounded-md bg-white/[0.03] px-2 py-1 text-[11px] leading-relaxed text-white/45">
          {insight.caveat}
        </p>
      )}
    </li>
  )
}

function PanelShell({ meta, children }: { meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4" aria-label="Historical replay insights">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-black text-white">Historical Replay Insights</h3>
        <span className="shrink-0 text-[11px] text-white/35">Historical · not advice</span>
      </div>
      <p className="text-[11px] leading-relaxed text-white/45">
        These observations summarize historical replay results and are not recommendations for future moves.
      </p>
      {meta}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function TrendsSection() {
  // The contract is a single validated snapshot — there is no time-series to
  // derive an improving/stable/declining trend from. Never fabricate one.
  return (
    <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/35">Historical trends</p>
      <p className="mt-1 text-xs text-white/45">
        Trend history isn’t available yet — these insights reflect a single validated snapshot, not a time series.
      </p>
    </div>
  )
}

export function ManagerReplayInsightsCard({ leagueId }: { leagueId: string }) {
  const enabledClient = process.env.NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED === 'true'
  const [state, setState] = useState<CardState>(enabledClient ? { status: 'loading' } : { status: 'disabled' })

  useEffect(() => {
    if (!enabledClient) return
    let cancelled = false
    setState({ status: 'loading' })
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/replay-insights`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`)
        return (await res.json()) as CardResponse
      })
      .then((body) => {
        if (cancelled) return
        if (!body.enabled) {
          setState({ status: 'disabled' })
          return
        }
        if (!body.data || body.data.insights.length === 0) {
          setState({ status: 'empty' })
          return
        }
        setState({ status: 'ready', data: body.data })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, enabledClient])

  if (state.status === 'disabled') return null

  if (state.status === 'loading') {
    return (
      <PanelShell>
        <div className="grid gap-3 sm:grid-cols-2" role="status" aria-live="polite">
          <span className="sr-only">Loading historical replay insights…</span>
          <div className="h-24 animate-pulse rounded-xl bg-white/5" />
          <div className="h-24 animate-pulse rounded-xl bg-white/5" />
          <div className="h-24 animate-pulse rounded-xl bg-white/5" />
          <div className="h-24 animate-pulse rounded-xl bg-white/5" />
        </div>
      </PanelShell>
    )
  }

  if (state.status === 'error') {
    return (
      <PanelShell>
        <p className="text-xs text-white/50">Historical replay insights couldn’t be loaded right now.</p>
      </PanelShell>
    )
  }

  if (state.status === 'empty') {
    return (
      <PanelShell>
        <p className="text-xs text-white/50">Not enough completed-trade history in this league yet to show historical replay insights.</p>
      </PanelShell>
    )
  }

  const { data } = state
  const metaLine = (
    <p className="mt-1 text-[11px] text-white/40">
      Based on {data.tradesAnalyzed} completed trade{data.tradesAnalyzed === 1 ? '' : 's'}
      {data.tradesWithLineupData > 0 ? ` (${data.tradesWithLineupData} with lineup data)` : ''}.
    </p>
  )

  return (
    <PanelShell meta={metaLine}>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="replay-insight-grid">
        {data.insights.map((insight) => (
          <InsightTile key={insight.insightId} insight={insight} />
        ))}
      </ul>
      <TrendsSection />
    </PanelShell>
  )
}
