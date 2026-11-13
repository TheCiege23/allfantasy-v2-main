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

/** Plain-language, customer-facing status wording. No "resolver", "signal", "payload", "Decision OS". */
export const EXECUTIVE_STATUS_LABEL: Record<ExecutiveHealthStatus, string> = {
  excellent: 'Excellent',
  healthy: 'Stable',
  watch: 'Monitor',
  at_risk: 'Needs attention',
  critical: 'Critical',
  unavailable: 'Not available',
}

/** Chart typography / spacing tokens, referenced by the shell so future charts stay visually consistent. */
export const EXECUTIVE_VIZ_TYPOGRAPHY = {
  title: 'text-[15px] font-black tracking-tight text-primary',
  description: 'text-[12px] leading-relaxed text-muted',
  seriesLabel: 'text-[13px] font-bold text-primary',
  valueLabel: 'text-[12px] font-semibold text-secondary',
  legend: 'text-[11px] font-medium text-secondary',
  metaLabel: 'text-[11px] font-bold uppercase tracking-[0.14em] text-muted',
} as const

