/**
 * Fantasy OS Suite — Phase V2.0: Executive Visualization Engine design tokens.
 *
 * A single configuration layer for the Executive Visualization Engine, so every current and future
 * executive graph (Commissioner / User / League / Trade / Waiver / Draft / Platform OS) shares one calm,
 * accessible, white-label-ready visual language instead of each chart hardcoding its own palette.
 *
 * The status palette deliberately reuses the Visual OS V1.1–V1.3 semantics: colors route through the
 * app's `status-*` / `content-*` semantic tokens (Tailwind `text-status-success`, `bg-status-danger`,
 * etc., backed by CSS variables), never a raw Tailwind hue, so light/dark themes and any later
 * white-label re-theme are honored automatically. `unavailable` is a first-class status — a neutral,
 * non-alarming treatment for "we genuinely don't have this data", distinct from a healthy green.
 */
import type { ExecutiveHealthStatus } from '@/lib/executive-viz/commissionerLeagueHealthViewModel'

/** Full Tailwind class bundle (border + tinted background + readable text) for a status region — the
 * same border/bg/text triplet shape the Decision OS tone primitives use, kept consistent on purpose. */
export const EXECUTIVE_STATUS_SURFACE: Record<ExecutiveHealthStatus, string> = {
  excellent: 'border-status-success/25 bg-status-success/10 text-status-success',
  healthy: 'border-status-success/20 bg-status-success/[0.06] text-status-success',
  watch: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
  at_risk: 'border-status-danger/20 bg-status-danger/[0.07] text-status-danger',
  critical: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
  unavailable: 'border-subtle bg-surface-muted text-muted',
}

/** The bar/series fill color only (no border/bg), for the animated readiness bars.
 *
 * SOLID status tokens only — no `/opacity` modifier. In this app's Tailwind config the opacity shorthand
 * on `status-*` CSS-variable colors resolves to transparent (verified live: `bg-status-danger/10` →
 * `rgba(0,0,0,0)`, a pre-existing condition the V1.0–V1.3 tone chips already live with by relying on
 * their solid text color). A readiness bar MUST be visible, so it uses the three solid semantic hues —
 * green / amber / red — plus a neutral. The precise 5-tier state is carried by the row's status chip
 * (label + solid dot), so collapsing the bar to three hues is a deliberate "communicate meaning, avoid
 * rainbow" choice, not a loss. */
export const EXECUTIVE_STATUS_BAR: Record<ExecutiveHealthStatus, string> = {
  excellent: 'bg-status-success',
  healthy: 'bg-status-success',
  watch: 'bg-status-warning',
  at_risk: 'bg-status-danger',
  critical: 'bg-status-danger',
  unavailable: 'bg-line-strong',
}

/** A small solid legend/indicator dot per status. Solid tokens only, same reason as the bar. */
export const EXECUTIVE_STATUS_DOT: Record<ExecutiveHealthStatus, string> = {
  excellent: 'bg-status-success',
  healthy: 'bg-status-success',
  watch: 'bg-status-warning',
  at_risk: 'bg-status-danger',
  critical: 'bg-status-danger',
  unavailable: 'bg-line-strong',
}

/** Plain-language, customer-facing status wording. No "resolver", "signal", "payload", "Decision OS". */
export const EXECUTIVE_STATUS_LABEL: Record<ExecutiveHealthStatus, string> = {
  excellent: 'Excellent',
  healthy: 'Stable',
  watch: 'Monitor',
  at_risk: 'Needs attention',
  critical: 'Critical',
  unavailable: 'Not available',
}

/** The legend only needs the meaningful, non-redundant buckets, coarsened for an executive read:
 * excellent+healthy collapse into one "Stable" swatch in the legend (they already share a hue), while
 * watch / needs-attention / critical / unavailable stay distinct. Order is best → worst → unavailable. */
export const EXECUTIVE_LEGEND_ENTRIES: { status: ExecutiveHealthStatus; label: string }[] = [
  { status: 'healthy', label: 'Stable' },
  { status: 'watch', label: 'Monitor' },
  { status: 'at_risk', label: 'Needs attention' },
  { status: 'critical', label: 'Critical' },
  { status: 'unavailable', label: 'Not available' },
]

/** Chart typography / spacing tokens, referenced by the shell so future charts stay visually consistent. */
export const EXECUTIVE_VIZ_TYPOGRAPHY = {
  title: 'text-[15px] font-black tracking-tight text-primary',
  description: 'text-[12px] leading-relaxed text-muted',
  seriesLabel: 'text-[13px] font-bold text-primary',
  valueLabel: 'text-[12px] font-semibold text-secondary',
  legend: 'text-[11px] font-medium text-secondary',
  metaLabel: 'text-[10px] font-bold uppercase tracking-[0.14em] text-muted',
} as const

/** Motion tokens. Durations/easing live here so every executive chart animates identically, and every
 * consumer pairs them with a `motion-reduce:*` fallback (reduced-motion is honored, never optional). */
export const EXECUTIVE_VIZ_MOTION = {
  /** Bar-grow / value-transition duration in seconds (framer-motion). */
  revealDurationSec: 0.55,
  /** Per-row stagger for the initial reveal, in seconds. */
  staggerSec: 0.05,
  /** Calm, executive easing — no bounce, no overshoot. */
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
} as const

export function executiveStatusSurface(status: ExecutiveHealthStatus): string {
  return EXECUTIVE_STATUS_SURFACE[status]
}

export function executiveStatusBar(status: ExecutiveHealthStatus): string {
  return EXECUTIVE_STATUS_BAR[status]
}

export function executiveStatusLabel(status: ExecutiveHealthStatus): string {
  return EXECUTIVE_STATUS_LABEL[status]
}
