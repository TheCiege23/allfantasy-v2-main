'use client'

/**
 * Fantasy OS Suite — Phase V2.4: Trade OS signature visualization.
 *
 * Trade Opportunity Matrix — the recognizable flagship for Trade OS (the fourth Executive Analytics
 * Workspace). It answers: "Where are the highest-value opportunities?"
 *
 * A 2×2 value × confidence quadrant: each real trade recommendation is placed by its own priority
 * (value) and confidence, so high-value + high-confidence opportunities land top-right ("Pursue now").
 * It represents OPPORTUNITIES — real trade recommendations — never raw player values, provider payloads,
 * or identifiers (per the Step 1 audit: no position-supply / player-value contract exists). Degrades to
 * an honest empty state that still states the market temperature.
 */
import { useMemo } from 'react'
import { Grid3x3, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import type { Recommendation } from '@/lib/decision-os/phase6/recommendations/types'
import {
  buildTradeOpportunityMatrix,
  TRADE_QUADRANT_LABEL,
  type TradeOpportunity,
  type TradeQuadrant,
} from '@/lib/executive-viz/tradeMarketViewModel'
import { EXECUTIVE_STATUS_SURFACE } from './executiveVizTokens'
import {
  ExecutiveEmptyState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

// Visual grid order (top row = high value): [investigate, pursue_now] / [monitor, easy_win].
const QUADRANT_GRID: TradeQuadrant[] = ['investigate', 'pursue_now', 'monitor', 'easy_win']
const QUADRANT_TONE: Record<TradeQuadrant, 'excellent' | 'watch' | 'healthy' | 'unavailable'> = {
  pursue_now: 'excellent',
  investigate: 'watch',
  easy_win: 'healthy',
  monitor: 'unavailable',
}

function QuadrantCell({ quadrant, opportunities }: { quadrant: TradeQuadrant; opportunities: TradeOpportunity[] }) {
  const tone = QUADRANT_TONE[quadrant]
  const isPrimary = quadrant === 'pursue_now'
  return (
    <div
      data-testid={`trade-quadrant-${quadrant}`}
      className={cn(
        'flex min-h-[92px] flex-col rounded-xl border p-3',
        isPrimary ? EXECUTIVE_STATUS_SURFACE.excellent : 'border-subtle bg-surface-muted',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-[11px] font-bold uppercase tracking-wide', isPrimary ? '' : 'text-muted')}>
          {TRADE_QUADRANT_LABEL[quadrant]}
        </span>
        <span className="text-[11px] font-bold text-secondary">{opportunities.length}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {opportunities.slice(0, 3).map((o) => (
          <li key={o.key} className="rounded-lg border border-subtle bg-surface px-2 py-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[12px] font-bold text-primary">{o.label}</span>
              <span className={cn('shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold uppercase', EXECUTIVE_STATUS_SURFACE[o.status])}>
                {o.priorityLabel}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted">{o.detail}</p>
          </li>
        ))}
        {opportunities.length > 3 ? (
          <li className="text-[10px] font-semibold text-muted">+{opportunities.length - 3} more</li>
        ) : null}
      </ul>
    </div>
  )
}

export function TradeOpportunityMatrix({
  recommendations,
  analytics,
  loading = false,
}: {
  recommendations: Recommendation[] | null
  analytics: LeagueAnalyticsSnapshot | null
  loading?: boolean
}) {
  const model = useMemo(() => buildTradeOpportunityMatrix(recommendations, analytics), [recommendations, analytics])
  const byQuadrant = useMemo(() => {
    const map: Record<TradeQuadrant, TradeOpportunity[]> = { pursue_now: [], investigate: [], easy_win: [], monitor: [] }
    for (const o of model.opportunities) map[o.quadrant].push(o)
    return map
  }, [model])

  return (
    <ExecutiveVisualizationShell
      title="Trade Opportunity Matrix"
      description="Where the highest-value trade opportunities sit — by value and confidence."
      icon={Grid3x3}
      dominant
      meta={
        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide', EXECUTIVE_STATUS_SURFACE[model.marketActivity === 'active' ? 'excellent' : model.marketActivity === 'moderate' ? 'healthy' : 'watch'])}>
          {model.marketActivity} market
        </span>
      }
      accessibleSummary={model.headline}
    >
      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-surface-muted motion-reduce:animate-none" role="status" aria-label="Loading trade opportunities" />
      ) : model.opportunities.length === 0 ? (
        <ExecutiveEmptyState
          icon={Grid3x3}
          title="No trade opportunities surfaced yet"
          description={model.headline + ' Opportunities appear here as trade recommendations are generated for this league — no sample opportunities are shown in their place.'}
        />
      ) : (
        <>
          <p className="mb-3 text-[12px] font-semibold text-secondary">{model.headline}</p>
          <div className="flex items-stretch gap-2">
            <div className="flex flex-col items-center justify-center">
              <span className="rotate-180 text-[9px] font-bold uppercase tracking-[0.14em] text-muted [writing-mode:vertical-rl]">Value</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-2 gap-2">
                {QUADRANT_GRID.map((q) => (
                  <QuadrantCell key={q} quadrant={q} opportunities={byQuadrant[q]} />
                ))}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
                <span>Lower confidence</span>
                <span className="inline-flex items-center gap-1">
                  Higher confidence <ArrowUpRight className="h-3 w-3" aria-hidden />
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export default TradeOpportunityMatrix
