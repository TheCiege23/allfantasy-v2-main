import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CheckCircle2, Clock3, Info, ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DecisionOsConfidenceLabel = 'High' | 'Medium' | 'Low'

/** Local mirror of `AttentionSignalSeverity` (`lib/decision-os/attentionSignals.ts`) — kept as its own
 * literal union rather than importing that module, so this shared UI-primitives file stays free of any
 * business-domain import. Structurally identical, so callers passing a real `AttentionSignalSeverity`
 * value type-check against this without a cast. Shared here because, as of Phase OS-B4, three separate
 * components (`CommissionerAttentionQueue`, `TodaysBriefCard`, `NotificationCenter`) each needed the
 * exact same severity-to-color mapping — the third occurrence that justifies consolidating it. */
export type DecisionOsSeverityLabel = 'critical' | 'high' | 'medium' | 'low' | 'informational'

export const SEVERITY_DOT_CLASS: Record<DecisionOsSeverityLabel, string> = {
  critical: 'bg-rose-400',
  high: 'bg-orange-400',
  medium: 'bg-amber-400',
  low: 'bg-sky-400',
  informational: 'bg-emerald-400',
}

type EvidenceItem = {
  label: string
  value: string
  detail?: string
}

const evidenceColumnClass: Record<1 | 2 | 3, string> = {
  1: '',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
}

export const decisionOsCardClassName =
  'card-premium overflow-hidden p-0 transition duration-200 hover:border-brand-primary/25 hover:shadow-popover motion-reduce:transition-none'

export function formatDecisionOsUpdated(value: string, includeTime = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Updated just now'
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (!includeTime) return `Updated ${datePart}`
  return `Updated ${datePart} at ${date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

export function DecisionOsBadge({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full border border-brand-primary/25 bg-brand-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-primary',
        className,
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
      <span>{children}</span>
    </span>
  )
}

function confidenceClasses(label: DecisionOsConfidenceLabel) {
  if (label === 'High') {
    return 'border-status-success/25 bg-status-success/10 text-status-success'
  }
  if (label === 'Medium') {
    return 'border-status-warning/25 bg-status-warning/10 text-status-warning'
  }
  return 'border-status-info/25 bg-status-info/10 text-status-info'
}

export function DecisionOsConfidenceBadge({ label }: { label: DecisionOsConfidenceLabel }) {
  const Icon = label === 'Low' ? Info : CheckCircle2
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
        confidenceClasses(label),
      )}
      title="Confidence reflects available evidence coverage, not a guaranteed outcome."
      aria-label={`${label} confidence. Based on available evidence, not a guaranteed outcome.`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label} confidence
    </span>
  )
}

export function DecisionOsUpdatedStamp({ value, includeTime = false }: { value: string; includeTime?: boolean }) {
  return (
    <span className="ml-auto inline-flex min-h-7 items-center gap-1.5 text-[11px] font-medium text-muted">
      <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {formatDecisionOsUpdated(value, includeTime)}
    </span>
  )
}

export function DecisionOsTrustNote({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-subtle bg-surface/80 px-3 py-2 text-xs leading-5 text-secondary">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden />
      <p>{children}</p>
    </div>
  )
}

export function DecisionOsPanel({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-subtle bg-surface p-4', className)}>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{title}</p>
      {children}
    </div>
  )
}

export function DecisionOsWhyPanel({ children }: { children: ReactNode }) {
  return (
    <DecisionOsPanel title="Why am I seeing this?" className="bg-surface-muted">
      <p className="mt-2 text-sm leading-6 text-primary">{children}</p>
    </DecisionOsPanel>
  )
}

export function DecisionOsEvidenceGrid({
  title,
  items,
  columns = 2,
  emptyMessage = 'Evidence will appear here once enough supported data is available.',
}: {
  title: string
  items: EvidenceItem[]
  columns?: 1 | 2 | 3
  emptyMessage?: string
}) {
  return (
    <DecisionOsPanel title={title}>
      {items.length > 0 ? (
        <div className={cn('mt-3 grid gap-2', evidenceColumnClass[columns])}>
          {items.map((item) => (
            <div
              key={`${item.label}-${item.value}`}
              className="min-w-0 rounded-xl border border-subtle bg-surface-muted px-3 py-2"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                {item.label}
              </p>
              <p className="mt-1 break-words text-sm font-bold text-primary">{item.value}</p>
              {item.detail ? <p className="mt-1 text-xs leading-5 text-secondary">{item.detail}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-muted">{emptyMessage}</p>
      )}
    </DecisionOsPanel>
  )
}

export function DecisionOsInsufficientDataCallout({
  title,
  message,
  missing,
}: {
  title: string
  message: string
  missing: string[]
}) {
  return (
    <div className="rounded-xl border border-status-warning/30 bg-status-warning/10 p-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary">{title}</p>
          <p className="mt-1 text-sm leading-6 text-secondary">{message}</p>
          {missing.length > 0 ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Waiting for: {missing.join(', ')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function DecisionOsEmptyState({
  icon: Icon = Info,
  title,
  description,
}: {
  icon?: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-dashed border-subtle bg-surface-muted p-6 text-sm text-muted">
      <Icon className="mb-2 h-5 w-5 text-brand-primary" aria-hidden />
      <p className="font-bold text-primary">{title}</p>
      <p className="mt-1 leading-6 text-secondary">{description}</p>
    </div>
  )
}

/** Phase V1.0 — Visual OS shared tone system. A single source of truth for "this value is good /
 * needs attention / bad / informational / neutral," replacing the 6+ independent hand-rolled color
 * tables found across `MissionControlCard`, `LeaguePulseCard`, `DecisionRecommendationsCard`,
 * `CommissionerAttentionQueue`, and the legacy Commissioner Hub page (see
 * `docs/os/VISUAL_OS_V1_AUDIT.md` Finding 2). All colors route through the app's semantic status
 * tokens (`--status-success`/`--status-warning`/`--status-danger`/`--status-info`), never a hardcoded
 * Tailwind palette color, so every tone automatically respects the active theme. */
export type DecisionOsTone = 'good' | 'warning' | 'danger' | 'info' | 'neutral'

const TONE_CLASSES: Record<DecisionOsTone, string> = {
  good: 'border-status-success/25 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
  danger: 'border-status-danger/25 bg-status-danger/10 text-status-danger',
  info: 'border-status-info/25 bg-status-info/10 text-status-info',
  neutral: 'border-subtle bg-surface-muted text-secondary',
}

export function decisionOsToneClasses(tone: DecisionOsTone): string {
  return TONE_CLASSES[tone]
}

/** Deduplicated from the byte-for-byte identical private `StatChip` found in both
 * `CommissionerCommandCenterOverview.tsx` and `ManagerCommandCenterOverview.tsx`. Tone naming
 * (`'risk'`, not `'warning'`) preserved verbatim from the original; the warning-tone border opacity
 * now uses the shared `TONE_CLASSES` value (25%) rather than each file's own locally-picked 30%. */
export function DecisionOsStatChip({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: LucideIcon
  label: string
  value: number
  tone?: 'risk' | 'neutral'
}) {
  const toneClass = tone === 'risk' && value > 0 ? TONE_CLASSES.warning : 'border-subtle bg-surface-muted text-primary'
  return (
    <div className={cn('min-w-0 rounded-xl border px-4 py-3', toneClass)}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {label}
      </div>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  )
}

/** A section-level "still loading" skeleton, distinct from `DecisionOsEmptyState` (a real, resolved
 * "there is genuinely nothing here" state) and from silently rendering zero-value fallbacks — see
 * `docs/os/VISUAL_OS_V1_AUDIT.md` Finding 8. `rows` controls how many placeholder lines to render. */
export function DecisionOsLoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-14 rounded-xl border border-subtle bg-surface-muted" />
      ))}
    </div>
  )
}

/** Phase V1.1 — a genuinely additive extension, not a forced fit onto `DecisionOsTone`. Real severity
 * (`DecisionOsSeverityLabel`, above) is a 5-tier domain (critical > high > medium > low >
 * informational) that `SEVERITY_DOT_CLASS` already models for a small status dot; `CommissionerAttentionQueue`
 * needed the same 5-tier domain for a full border+background card treatment, which `DecisionOsTone`'s
 * 4 non-neutral buckets (good/warning/danger/info) cannot represent without collapsing "high" and
 * "medium" into the same color and losing a real, currently-visible distinction. Consolidated here
 * (rather than left as `CommissionerAttentionQueue`'s own private table) so any future 5-tier-severity
 * card reuses one source instead of re-hardcoding the same 5 colors. */
const SEVERITY_TONE_CLASS: Record<DecisionOsSeverityLabel, string> = {
  critical: 'border-rose-500/30 bg-rose-500/10',
  high: 'border-orange-500/30 bg-orange-500/10',
  medium: 'border-amber-500/30 bg-amber-500/10',
  low: 'border-sky-500/30 bg-sky-500/10',
  informational: 'border-emerald-500/30 bg-emerald-500/10',
}

export function decisionOsSeverityToneClasses(severity: DecisionOsSeverityLabel): string {
  return SEVERITY_TONE_CLASS[severity]
}

/** THE single canonical `OverallStatus` mapper (`lib/league-health/league-health-engine.ts`) — a real
 * 5-tier domain (excellent > healthy > watch > at_risk > critical) computed by ONE function,
 * `monitorLeagueHealth()`, and consumed by both `MissionControlCard.tsx` (via
 * `snapshot.leagueHealth.result.engine.overallStatus`) and `LeagueHealthDashboard`
 * (`CommissionerLeagueHealthSnapshot.overallStatus`, `lib/commissioner-hub/commissionerHubHealth.ts`) —
 * confirmed by tracing both call sites back to the same `monitorLeagueHealth()` call. Since it is
 * genuinely the same real-world fact in both places (not two different domains that happen to share
 * vocabulary), Phase V1.3 unified both components onto this ONE 5-color mapping, rather than leaving
 * them visually inconsistent for identical status values.
 *
 * History: Phase V1.1 first migrated `MissionControlCard`'s own private table onto the 4-value
 * `DecisionOsTone` system — a LOSSY collapse (excellent+healthy became one emerald; at_risk+critical
 * became one rose) that happened to be lossless for THAT table's own original colors, but not a
 * complete picture of the domain. Phase V1.2 then found `LeagueHealthDashboard`'s own private table
 * used all 5 colors distinctly and, correctly, did NOT collapse it — instead adding this function.
 * Phase V1.3 completed the picture: rather than leave `MissionControlCard` on the lossy 4-color version
 * while `LeagueHealthDashboard` used the full 5-color version for the identical underlying fact, this
 * phase migrated `MissionControlCard` onto this same 5-color function too. Per this phase's own
 * instruction ("Do not collapse five meaningful health states into fewer visibly indistinguishable
 * states merely to reuse an existing helper"), the unification went toward the richer, lossless
 * representation — never toward `DecisionOsTone`'s coarser 4-bucket system.
 *
 * Colors: the 5 hues (emerald/cyan/amber/orange/rose) are the original `HEALTH_STATUS_CLASSES` values
 * from `LeagueHealthDashboard`, unchanged. Only the TEXT shade was moved from a light `-300` pastel (a
 * light-mode contrast risk, the same defect class fixed repeatedly in V1.0–V1.2 — see
 * `docs/os/VISUAL_OS_V1_AUDIT.md`) to a readable, saturated `-600` — a contrast fix, not a semantic
 * change; borders/backgrounds are untouched. */
export type DecisionOsHealthStatusLabel = 'excellent' | 'healthy' | 'watch' | 'at_risk' | 'critical'

const HEALTH_STATUS_TONE_CLASS: Record<DecisionOsHealthStatusLabel, string> = {
  excellent: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600',
  healthy: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-600',
  watch: 'border-amber-500/25 bg-amber-500/10 text-amber-600',
  at_risk: 'border-orange-500/25 bg-orange-500/10 text-orange-600',
  critical: 'border-rose-500/30 bg-rose-500/10 text-rose-600',
}

export function decisionOsHealthStatusToneClasses(status: string): string {
  return (
    HEALTH_STATUS_TONE_CLASS[status as DecisionOsHealthStatusLabel] ??
    'border-subtle bg-surface-muted text-muted'
  )
}
