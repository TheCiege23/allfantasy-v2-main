/**
 * Decision OS — Phase 7.8 React Adapter: default theme tokens.
 * Phase 7.18 — SDKTheme.partner_override / enterprise_branding wiring.
 *
 * Resolves IPM semantic ColorTokens (Phase 7.0) to plain CSS color values —
 * deliberately NOT Tailwind utility classes. `sdk-runtime/react` is meant to
 * be embeddable on a partner site with no Tailwind installed at all
 * (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md), so styling here is applied via
 * inline `style` rather than assuming any CSS framework is present.
 *
 * `resolveColorTokenHex(token)` is UNCHANGED from Phase 7.8 — same
 * signature, same values, always the dark default palette — so every
 * existing caller (including the 70 Phase 7.8 tests) keeps behaving
 * identically. `resolveThemedColorTokenHex(token, theme)` is the new,
 * additive Phase 7.18 entry point: pass an `SDKTheme` and it picks a
 * light/dark default palette by `theme.mode`, then — ONLY for
 * `partner_override`/`enterprise_branding` — lets `theme.tokens.colorTokenMap`
 * override individual tokens. Passing `undefined`/`null` (or omitting the
 * theme entirely) is always a graceful, fully-default fallback.
 */

import type { ColorToken } from '../../../lib/decision-os/presentation/types'
import type { SDKTheme, SDKThemeMode } from '../../../lib/decision-os/sdk/types'

// ── Default palettes ────────────────────────────────────────────────────────────

/** The Phase 7.8 palette, unchanged — used whenever no theme (or a dark/auto/override-without-a-value theme) applies. */
export const DEFAULT_COLOR_HEX_DARK: Readonly<Record<ColorToken, string>> = {
  success: '#34d399',
  healthy: '#22d3ee',
  positive: '#2dd4bf',
  warning: '#fbbf24',
  danger: '#fb923c',
  critical: '#f87171',
  neutral: '#94a3b8',
  benchmark_above: '#34d399',
  benchmark_equal: '#22d3ee',
  benchmark_below: '#f87171',
  accent: '#67e8f9',
  surface: 'rgba(255,255,255,0.06)',
  surface_elevated: 'rgba(255,255,255,0.1)',
  muted: 'rgba(255,255,255,0.4)',
}

/** New in Phase 7.18 — selected only when `theme.mode === 'light'`. */
export const DEFAULT_COLOR_HEX_LIGHT: Readonly<Record<ColorToken, string>> = {
  success: '#059669',
  healthy: '#0891b2',
  positive: '#0d9488',
  warning: '#d97706',
  danger: '#ea580c',
  critical: '#dc2626',
  neutral: '#334155',
  benchmark_above: '#059669',
  benchmark_equal: '#0891b2',
  benchmark_below: '#dc2626',
  accent: '#0e7490',
  surface: 'rgba(15,23,42,0.04)',
  surface_elevated: 'rgba(15,23,42,0.08)',
  muted: 'rgba(15,23,42,0.45)',
}

/** Alias kept for backward compatibility with any existing reference to the Phase 7.8 name. */
export const DEFAULT_COLOR_HEX = DEFAULT_COLOR_HEX_DARK

export function resolveColorTokenHex(token: ColorToken): string {
  return DEFAULT_COLOR_HEX_DARK[token]
}

// ── Theme-aware resolution (Phase 7.18) ───────────────────────────────────────

const OVERRIDE_ELIGIBLE_MODES: ReadonlySet<SDKThemeMode> = new Set(['partner_override', 'enterprise_branding'])

function resolveDefaultPalette(mode: SDKThemeMode | undefined): Readonly<Record<ColorToken, string>> {
  // 'dark' and 'auto' — and no theme at all — resolve to the same palette
  // that has always been the default (a pure function has no real
  // `prefers-color-scheme` signal to resolve 'auto' against, so it
  // deterministically matches 'dark', documented here rather than guessed).
  return mode === 'light' ? DEFAULT_COLOR_HEX_LIGHT : DEFAULT_COLOR_HEX_DARK
}

/**
 * Resolves a ColorToken to a hex/CSS color, theme-aware.
 *   - No theme (undefined/null): identical to `resolveColorTokenHex` — the
 *     unchanged Phase 7.8 dark default.
 *   - `theme.mode` is 'light': the light default palette.
 *   - `theme.mode` is 'dark' or 'auto': the dark default palette.
 *   - `theme.mode` is 'partner_override' or 'enterprise_branding': the
 *     default palette (by mode) UNLESS `theme.tokens.colorTokenMap[token]`
 *     is a non-empty string, in which case that value wins. A missing,
 *     empty, or non-string override for a given token is not an error —
 *     it just falls through to the default for that one token, so a
 *     partner can override e.g. only `accent` and still get sensible
 *     defaults for every other token.
 */
export function resolveThemedColorTokenHex(token: ColorToken, theme?: SDKTheme | null): string {
  const palette = resolveDefaultPalette(theme?.mode)
  if (theme && OVERRIDE_ELIGIBLE_MODES.has(theme.mode)) {
    const override = theme.tokens.colorTokenMap[token]
    if (typeof override === 'string' && override.trim() !== '') {
      return override
    }
  }
  return palette[token]
}

// ── Widget chrome tokens (Phase 7.18) ─────────────────────────────────────────

/**
 * The widget's own chrome — container background/text/border — as opposed
 * to per-datapoint severity colors (danger/warning/success, already real
 * ColorTokens). "primary"/"background"/"surface"/"text"/"muted text"/
 * "border" have no 1:1 equivalent in the frozen 14-value ColorToken union
 * (lib/decision-os/presentation/types.ts, inside the Architecture Freeze) —
 * rather than inventing new SDK-level token names (which would require
 * modifying frozen Decision OS files), each chrome slot maps onto the
 * closest EXISTING ColorToken:
 *
 *   primary / accent → 'accent'            ("Platform accent / brand color")
 *   background       → 'surface'           ("Background surface")
 *   surface          → 'surface_elevated'  ("Elevated card surface")
 *   text             → 'neutral'           ("No strong signal — gray/muted"; the closest existing token to a body-text tone)
 *   textMuted        → 'muted'             ("Disabled / inactive state")
 *   border           → 'muted'             (a subtle border commonly reuses the same de-emphasized tone as muted text)
 *
 * A partner_override/enterprise_branding theme therefore controls every
 * chrome slot just by setting the corresponding entries
 * (accent/surface/surface_elevated/neutral/muted) in
 * `SDKTheme.tokens.colorTokenMap` — no parallel token vocabulary needed,
 * and every value still traces back to a real, frozen ColorToken.
 */
export interface WidgetChromeHex {
  primary: string
  accent: string
  background: string
  surface: string
  text: string
  textMuted: string
  border: string
  danger: string
  warning: string
  success: string
}

export function resolveWidgetChromeHex(theme?: SDKTheme | null): WidgetChromeHex {
  const at = (token: ColorToken) => resolveThemedColorTokenHex(token, theme)
  return {
    primary: at('accent'),
    accent: at('accent'),
    background: at('surface'),
    surface: at('surface_elevated'),
    text: at('neutral'),
    textMuted: at('muted'),
    border: at('muted'),
    danger: at('danger'),
    warning: at('warning'),
    success: at('success'),
  }
}
