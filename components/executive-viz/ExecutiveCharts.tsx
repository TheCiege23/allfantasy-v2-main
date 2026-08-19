/**
 * Fantasy OS Suite — Phase V2.1: Executive Visualization Engine chart primitives.
 *
 * Reusable data-mark primitives shared across the Executive Analytics Workspaces. Each lives here (rather
 * than inline in one card) only because it has at least two real consumers:
 *   - `ExecutiveHorizontalBars` — Manager Attention, League Health Breakdown, Commissioner Workload,
 *     Team Risk, Decision Focus, Transaction Distribution, Engagement Summary, Waiver Opportunity Impact.
 *   - `ExecutiveProgressRing` — League Readiness, Championship Trajectory, Competitive Balance, Waiver Urgency.
 *   - `ExecutiveDecisionSequence` (V2.5) — Manager OS Weekly Decision Timeline, Trade OS Trade Pipeline,
 *     Waiver OS Waiver Impact Sequence. Expresses ORDER + PRIORITY only, never calendar chronology.
 *
 * Same discipline as V2.0: colors come from `executiveVizTokens.ts` (Visual OS `status-*` semantics, no
 * raw hue/hex); bar/ring fill is rendered DIRECTLY at its correct value (never gated behind an animation
 * or effect, which freeze in hidden/background tabs), so the data is always visible; motion is limited to
 * non-hiding CSS transitions that honor `motion-reduce:*`.
 */
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExecutiveHealthStatus } from '@/lib/executive-viz/commissionerLeagueHealthViewModel'
import { EXECUTIVE_STATUS_BAR, EXECUTIVE_STATUS_LABEL, EXECUTIVE_STATUS_SURFACE } from './executiveVizTokens'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Status → SVG stroke color. Uses the `text-status-*` tokens (which resolve correctly, unlike the
 * `/opacity` shorthand) with `stroke="currentColor"`. */
const EXECUTIVE_STATUS_STROKE: Record<ExecutiveHealthStatus, string> = {
  excellent: 'text-status-success',
  healthy: 'text-status-success',
  watch: 'text-status-warning',
  at_risk: 'text-status-danger',
  critical: 'text-status-danger',
  unavailable: 'text-muted',
}

export type ExecutiveBarItem = {
  key: string
  label: string
  value: number
  /** Per-item scale ceiling. When omitted the whole group shares one max (see `scaleMax`). */
  max?: number
  status: ExecutiveHealthStatus
  /** The honest underlying figure shown as text. Defaults to the raw value. */
  valueLabel?: string
}

/**
 * A ranked set of horizontal readiness bars. Works for both count data (a shared `scaleMax`) and 0–100
 * score data (`max: 100` per item). Each bar is an accessible `meter`.
 */
export function ExecutiveHorizontalBars({
  items,
  scaleMax,
}: {
  items: ExecutiveBarItem[]
  /** Shared ceiling for count-style bars. Ignored for items that carry their own `max`. */
  scaleMax?: number
}) {
  const groupMax = scaleMax ?? Math.max(1, ...items.map((i) => i.max ?? i.value))
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const max = item.max ?? groupMax
        const pct = max > 0 ? clamp((item.value / max) * 100, 0, 100) : 0
        const valueText = item.valueLabel ?? String(item.value)
        return (
          <li key={item.key} data-testid={`executive-bar-${item.key}`} data-status={item.status}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[12px] font-semibold text-secondary">{item.label}</span>
              <span className="shrink-0 text-[12px] font-bold text-primary">{valueText}</span>
            </div>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted"
              role="meter"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${item.label}: ${valueText} (${EXECUTIVE_STATUS_LABEL[item.status]})`}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none',
                  EXECUTIVE_STATUS_BAR[item.status],
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A single circular progress ring. `strokeDashoffset` is a static inline style, so the ring always
 * renders at its correct value regardless of tab visibility; the transition is pure enhancement.
 */
export function ExecutiveProgressRing({
  value,
  max = 100,
  status,
  label,
  valueLabel,
  size = 72,
}: {
  value: number
  max?: number
  status: ExecutiveHealthStatus
  label: string
  valueLabel?: string
  size?: number
}) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0
  const stroke = 7
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - pct / 100)
  const valueText = valueLabel ?? `${Math.round(pct)}%`
  return (
    <div
      className="flex flex-col items-center gap-1.5"
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label}: ${valueText} (${EXECUTIVE_STATUS_LABEL[status]})`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            className="text-surface-muted"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
          />
          <circle
            className={cn(EXECUTIVE_STATUS_STROKE[status], 'transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none')}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[14px] font-black text-primary">{valueText}</span>
        </div>
      </div>
      <span className="text-center text-[11px] font-semibold text-secondary">{label}</span>
    </div>
  )
}

export type ExecutiveSequenceItem = {
  key: string
  label: string
  detail: string
  /** Priority / urgency chip text. */
  badgeLabel: string
  status: ExecutiveHealthStatus
  /** Optional secondary line (e.g. "High confidence"). */
  meta?: string
  actionHref?: string
  actionLabel?: string
}

/**
 * An ordered, numbered decision sequence — "what to do first", in the existing recommendation order.
 *
 * Extracted in Phase V2.5 once a THIRD real consumer appeared (Manager OS's Weekly Decision Timeline,
 * Trade OS's Trade Pipeline, and Waiver OS's Waiver Impact Sequence), clearing the engine's "at least two
 * real consumers" bar. It expresses ORDER and PRIORITY only — it never implies calendar chronology, so it
 * is safe for domains with no legitimate temporal data.
 *
 * Fully static: numbering, chips, and text render at their correct values on first paint, so nothing is
 * hidden behind an animation gate (hidden/background tabs freeze animations).
 */
export function ExecutiveDecisionSequence({
  items,
  testIdPrefix = 'sequence-step',
}: {
  items: ExecutiveSequenceItem[]
  testIdPrefix?: string
}) {
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li
          key={item.key}
          data-testid={`${testIdPrefix}-${item.key}`}
          data-status={item.status}
          className="flex items-start gap-3 rounded-xl border border-subtle bg-surface px-3 py-2.5 transition duration-200 hover:border-brand-primary/25 motion-reduce:transition-none"
        >
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-primary/25 bg-brand-primary/10 text-[12px] font-black text-brand-primary">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-bold text-primary">{item.label}</span>
              <span
                className={cn(
                  'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase',
                  EXECUTIVE_STATUS_SURFACE[item.status],
                )}
              >
                {item.badgeLabel}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-secondary">{item.detail}</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {item.meta ? <span className="text-[10px] font-semibold text-muted">{item.meta}</span> : <span />}
              {item.actionHref && item.actionLabel ? (
                <Link
                  href={item.actionHref}
                  className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-brand-primary transition hover:bg-brand-primary/10"
                >
                  {item.actionLabel}
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
