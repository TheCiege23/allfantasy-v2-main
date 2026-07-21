'use client'

import type { MetricAvailability } from '@/lib/players/player-data-availability'

/**
 * Renders one metric, or an explicit account of why it cannot be rendered.
 *
 * This is the point where the page's honesty is enforced structurally rather than
 * by convention: a metric with no production source cannot be displayed as a
 * number, because the value branch is unreachable unless availability says the
 * source exists. Callers cannot accidentally pass `0` for "unknown" — an absent
 * value renders as an em dash with a tooltip explaining the absence, which reads
 * as "we don't have this" rather than "this player scored zero".
 *
 * The distinction matters most for the metrics the design mockups asked for that
 * have no source at all: weekly projections, rest-of-season rank, ownership and
 * start percentages. Those render as absent here rather than being invented.
 */

export interface MetricSlotProps {
  label: string
  availability: MetricAvailability
  /** Formatted display value. Pass null when the source exists but this player has no data. */
  value: string | null
  /** Optional tone applied to the value, e.g. for trend direction. */
  tone?: 'up' | 'down' | 'flat'
  /** Shown under the value when present and the metric is renderable. */
  hint?: string
}

export function MetricSlot({ label, availability, value, tone, hint }: MetricSlotProps) {
  const renderable = availability.state === 'available' || availability.state === 'partial'
  const hasValue = renderable && value !== null && value !== ''

  const explanation = !renderable
    ? availability.reason ?? 'No data source for this metric.'
    : value === null
      ? `No ${label.toLowerCase()} recorded for this player.`
      : availability.state === 'partial' && availability.reason
        ? availability.reason
        : availability.source
          ? `Source: ${availability.source}`
          : undefined

  const toneClass =
    tone === 'up' ? 'afp-trend-up' : tone === 'down' ? 'afp-trend-down' : tone === 'flat' ? 'afp-trend-flat' : ''

  return (
    <div
      className={`afp-metric${hasValue ? '' : ' afp-metric-empty'}`}
      title={explanation}
      data-metric-state={hasValue ? 'value' : availability.state}
    >
      <div className={`afp-metric-value ${toneClass}`.trim()}>
        {hasValue ? value : <span aria-hidden="true">—</span>}
      </div>
      <div className="afp-metric-label">{label}</div>

      {/*
        Screen readers get the explanation as text. A sighted user gets it on hover;
        without this, an em dash would be announced as meaningless punctuation.
      */}
      {!hasValue && explanation && <span className="afp-sr-only">{label}: {explanation}</span>}
      {hasValue && hint && <div className="afp-metric-label">{hint}</div>}
    </div>
  )
}

/**
 * Formats a market value for display. FantasyCalc values run into five figures,
 * which is too wide for a card, so thousands are abbreviated.
 */
export function formatMarketValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

/** Signed trend with an explicit direction, e.g. "+115" / "-42". */
export function formatTrend(trend: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (!Number.isFinite(trend) || trend === 0) return { text: '0', tone: 'flat' }
  const rounded = Math.round(trend)
  if (rounded === 0) return { text: '0', tone: 'flat' }
  return { text: `${rounded > 0 ? '+' : ''}${rounded}`, tone: rounded > 0 ? 'up' : 'down' }
}
