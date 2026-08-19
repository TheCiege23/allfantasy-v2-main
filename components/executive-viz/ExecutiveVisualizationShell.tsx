/**
 * Fantasy OS Suite — Phase V2.0: Executive Visualization Engine foundation primitives.
 *
 * A small, reusable set of visualization containers and states — NOT a chart library. Every executive
 * graph (starting with the Commissioner OS League Health Map) composes these so titles, metadata,
 * legends, loading / empty / unavailable / error states, accessible summaries, and theme behavior stay
 * consistent across the whole Fantasy OS Suite. Colors and motion come from `executiveVizTokens.ts`,
 * which reuses the Visual OS V1.1–V1.3 status semantics; nothing here hardcodes a palette.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, Clock3, Info, ShieldAlert, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDecisionOsUpdated } from '@/components/decision-os/DecisionOsCardPrimitives'
import {
  EXECUTIVE_LEGEND_ENTRIES,
  EXECUTIVE_STATUS_DOT,
  EXECUTIVE_VIZ_TYPOGRAPHY,
} from './executiveVizTokens'

/** The outer container for any executive visualization: header (title/description/meta), an
 * accessible text summary, the chart body, and an optional footer (legend, source, freshness). */
export function ExecutiveVisualizationShell({
  title,
  description,
  icon: Icon = BarChart3,
  meta,
  accessibleSummary,
  footer,
  children,
  className,
  dominant = false,
}: {
  title: string
  description?: string
  icon?: LucideIcon
  /** Right-aligned metadata, e.g. an updated stamp or context label. */
  meta?: ReactNode
  /** Screen-reader-first, non-visual sentence describing what the chart shows. Rendered visually hidden
   * so assistive tech gets the full picture without duplicating the visible graph. */
  accessibleSummary: string
  footer?: ReactNode
  children: ReactNode
  className?: string
  /** When true, adopts the heavier "flagship" treatment (used for the 60% signature visualization). */
  dominant?: boolean
}) {
  return (
    <section
      className={cn(
        'card-premium overflow-hidden p-0 transition duration-200 motion-reduce:transition-none',
        dominant ? 'border-brand-commissioner/20 shadow-popover' : 'hover:border-brand-primary/25',
        className,
      )}
      aria-label={title}
    >
      <ExecutiveChartHeader title={title} description={description} icon={Icon} meta={meta} dominant={dominant} />
      <p className="sr-only" data-testid="executive-viz-summary">
        {accessibleSummary}
      </p>
      <div className={cn('px-4 pb-4 sm:px-5 sm:pb-5', dominant && 'sm:px-6 sm:pb-6')}>{children}</div>
      {footer ? (
        <div className="border-t border-subtle bg-surface-muted/60 px-4 py-3 sm:px-5">{footer}</div>
      ) : null}
    </section>
  )
}

export function ExecutiveChartHeader({
  title,
  description,
  icon: Icon = BarChart3,
  meta,
  dominant = false,
}: {
  title: string
  description?: string
  icon?: LucideIcon
  meta?: ReactNode
  dominant?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5',
        dominant && 'sm:px-6 sm:pt-6',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border',
            dominant
              ? 'border-brand-commissioner/25 bg-brand-commissioner/10 text-brand-commissioner'
              : 'border-brand-primary/20 bg-brand-primary/10 text-brand-primary',
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className={dominant ? 'text-[17px] font-black tracking-tight text-primary' : EXECUTIVE_VIZ_TYPOGRAPHY.title}>
            {title}
          </h3>
          {description ? <p className={cn('mt-0.5', EXECUTIVE_VIZ_TYPOGRAPHY.description)}>{description}</p> : null}
        </div>
      </div>
      {meta ? <div className="shrink-0 text-right">{meta}</div> : null}
    </div>
  )
}

/** Freshness stamp — "Updated Jul 10", reusing the Decision OS formatter so the whole app phrases
 * last-updated identically. Customer-facing wording only; never exposes a raw timestamp field name. */
export function ExecutiveFreshnessStamp({ updatedAt, includeTime = false }: { updatedAt: string; includeTime?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
      <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {formatDecisionOsUpdated(updatedAt, includeTime)}
    </span>
  )
}

/** Status legend. Defaults to the executive health legend, but accepts a custom entry list so other
 * future charts can supply their own series legend. */
export function ExecutiveLegend({
  entries = EXECUTIVE_LEGEND_ENTRIES,
  className,
}: {
  entries?: { status: keyof typeof EXECUTIVE_STATUS_DOT; label: string }[]
  className?: string
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)} aria-label="Legend">
      {entries.map((entry) => (
        <li key={entry.status} className={cn('inline-flex items-center gap-1.5', EXECUTIVE_VIZ_TYPOGRAPHY.legend)}>
          <span className={cn('h-2.5 w-2.5 rounded-full', EXECUTIVE_STATUS_DOT[entry.status])} aria-hidden />
          {entry.label}
        </li>
      ))}
    </ul>
  )
}

/** Loading placeholder — an honest "still loading", distinct from empty/unavailable. */
export function ExecutiveLoadingState({ rows = 5, label = 'Loading visualization' }: { rows?: number; label?: string }) {
  return (
    <div className="animate-pulse space-y-2.5 py-1 motion-reduce:animate-none" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="h-3 w-28 shrink-0 rounded bg-surface-muted" />
          <div className="h-3 flex-1 rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  )
}

/** Empty state — data pipeline is healthy, there is simply nothing to show yet. */
export function ExecutiveEmptyState({
  icon: Icon = Info,
  title,
  description,
}: {
  icon?: LucideIcon
  title: string
  description: string
}) {
  return (
    <div
      className="rounded-xl border border-dashed border-subtle bg-surface-muted p-6 text-center"
      role="status"
      data-testid="executive-viz-empty"
    >
      <Icon className="mx-auto mb-2 h-5 w-5 text-brand-primary" aria-hidden />
      <p className="text-sm font-bold text-primary">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-6 text-secondary">{description}</p>
    </div>
  )
}

/** Unavailable state — the backing data genuinely isn't present. Deliberately distinct from empty:
 * this is "we can't compute this honestly", not "there's nothing here yet". Never substitute sample data. */
export function ExecutiveUnavailableState({
  title = 'Data not available yet',
  description,
  missing,
}: {
  title?: string
  description: string
  missing?: string[]
}) {
  return (
    <div
      className="rounded-xl border border-status-warning/25 bg-status-warning/[0.06] p-5"
      role="status"
      data-testid="executive-viz-unavailable"
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary">{title}</p>
          <p className="mt-1 text-sm leading-6 text-secondary">{description}</p>
          {missing && missing.length > 0 ? (
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Waiting for: {missing.join(', ')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Error state — the visualization tried to load and failed. */
export function ExecutiveErrorState({ description }: { description: string }) {
  return (
    <div
      className="rounded-xl border border-status-danger/25 bg-status-danger/[0.06] p-5"
      role="alert"
      data-testid="executive-viz-error"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-danger" aria-hidden />
        <p className="text-sm leading-6 text-secondary">{description}</p>
      </div>
    </div>
  )
}
