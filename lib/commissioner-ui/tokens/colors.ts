/**
 * Commissioner OS semantic color tokens.
 *
 * Values are never duplicated here — every entry below is the name of a CSS
 * custom property defined in app/globals.css (see the "Commissioner OS —
 * design tokens" section there), themed automatically across light/dark/
 * legacy via var() alias resolution. This file exists so components
 * reference token names through a typed, autocomplete-safe surface instead
 * of hand-typing CSS variable strings — consistent with this codebase's
 * existing convention of consuming theme variables via `var(--name)` in
 * inline styles (see components/auth/OAuthButtonRow.tsx).
 *
 * Maps directly onto the Design Language & Experience System's Color
 * System (§11) and Severity model (§8).
 */

export type SeverityTier = 'critical' | 'elevated' | 'standard' | 'advisory' | 'positive'

interface ColorTokenTriplet {
  text: string
  bg: string
  border: string
}

export const severityTokens: Record<SeverityTier, ColorTokenTriplet> = {
  critical: { text: '--severity-critical-text', bg: '--severity-critical-bg', border: '--severity-critical-border' },
  elevated: { text: '--severity-elevated-text', bg: '--severity-elevated-bg', border: '--severity-elevated-border' },
  standard: { text: '--severity-standard-text', bg: '--severity-standard-bg', border: '--severity-standard-border' },
  advisory: { text: '--severity-advisory-text', bg: '--severity-advisory-bg', border: '--severity-advisory-border' },
  positive: { text: '--severity-positive-text', bg: '--severity-positive-bg', border: '--severity-positive-border' },
}

export type StatusRole = 'information' | 'opportunity' | 'disabled'

export const statusTokens: Record<StatusRole, ColorTokenTriplet> = {
  information: { text: '--status-information-text', bg: '--status-information-bg', border: '--status-information-border' },
  opportunity: { text: '--status-opportunity-text', bg: '--status-opportunity-bg', border: '--status-opportunity-border' },
  disabled: { text: '--status-disabled-text', bg: '--status-disabled-bg', border: '--status-disabled-border' },
}

/**
 * Reserved exclusively for benchmarking contexts, per Design Language §11 —
 * never reuse these for generic good/neutral/bad, even though the
 * underlying CSS values are shared with severity tokens. Keeping the names
 * distinct is what prevents benchmarking from blurring into severity
 * language.
 */
export type BenchmarkComparison = 'above' | 'equal' | 'below'

export const benchmarkTokens: Record<BenchmarkComparison, string> = {
  above: '--benchmark-above',
  equal: '--benchmark-equal',
  below: '--benchmark-below',
}

/**
 * Wraps a token name in a ready-to-use var() reference.
 * cssVar(severityTokens.critical.text) -> "var(--severity-critical-text)"
 */
export function cssVar(tokenName: string): string {
  return `var(${tokenName})`
}
