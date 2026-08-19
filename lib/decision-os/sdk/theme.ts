/**
 * Decision OS — Phase 7.4 Widget SDK theme contracts.
 *
 * Semantic theme tokens only. No CSS, no Tailwind classes, no hex codes.
 * Runtimes resolve tokens to their own styling system.
 *
 * ADR: PHASE_7_4_WIDGET_SDK_ADR.md
 */

import type { SDKTheme, SDKThemeMode, SDKThemeTokens } from './types'

// ── Default token sets (semantic identifiers, not CSS) ─────────────────────────

const LIGHT_TOKENS: SDKThemeTokens = {
  colorTokenMap: {
    success: 'token.success.light',
    warning: 'token.warning.light',
    danger:  'token.danger.light',
    neutral: 'token.neutral.light',
    accent:  'token.accent.light',
    surface: 'token.surface.light',
  },
  iconTokenMap: {
    check: 'icon.check.outline',
    alert_triangle: 'icon.alert.outline',
  },
  radiusToken: 'soft',
  densityToken: 'comfortable',
}

const DARK_TOKENS: SDKThemeTokens = {
  colorTokenMap: {
    success: 'token.success.dark',
    warning: 'token.warning.dark',
    danger:  'token.danger.dark',
    neutral: 'token.neutral.dark',
    accent:  'token.accent.dark',
    surface: 'token.surface.dark',
  },
  iconTokenMap: {
    check: 'icon.check.filled',
    alert_triangle: 'icon.alert.filled',
  },
  radiusToken: 'soft',
  densityToken: 'comfortable',
}

const DEFAULT_TOKENS_BY_MODE: Record<SDKThemeMode, SDKThemeTokens> = {
  light: LIGHT_TOKENS,
  dark: DARK_TOKENS,
  auto: LIGHT_TOKENS,             // resolved to light|dark by the runtime at render time
  partner_override: LIGHT_TOKENS, // base before override is applied
  enterprise_branding: LIGHT_TOKENS,
}

export const VALID_THEME_MODES: readonly SDKThemeMode[] = [
  'light', 'dark', 'auto', 'partner_override', 'enterprise_branding',
]

const MODES_REQUIRING_BRAND_ID: readonly SDKThemeMode[] = ['partner_override', 'enterprise_branding']

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Resolves a full SDKTheme for a given mode, merging any token overrides.
 * Deterministic: same mode + overrides + brandId always produce the same result.
 */
export function resolveSDKTheme(
  mode: SDKThemeMode,
  overrides: Partial<SDKThemeTokens> = {},
  partnerBrandId: string | null = null,
): SDKTheme {
  const base = DEFAULT_TOKENS_BY_MODE[mode]
  const tokens: SDKThemeTokens = {
    colorTokenMap: { ...base.colorTokenMap, ...(overrides.colorTokenMap ?? {}) },
    iconTokenMap:  { ...base.iconTokenMap, ...(overrides.iconTokenMap ?? {}) },
    radiusToken:   overrides.radiusToken ?? base.radiusToken,
    densityToken:  overrides.densityToken ?? base.densityToken,
  }
  return {
    mode,
    tokens,
    partnerBrandId: MODES_REQUIRING_BRAND_ID.includes(mode) ? partnerBrandId : null,
  }
}

/**
 * Validates a theme contract. `partner_override` and `enterprise_branding`
 * require a non-null partnerBrandId; other modes must not carry one.
 */
export function validateSDKTheme(theme: SDKTheme): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!VALID_THEME_MODES.includes(theme.mode)) {
    errors.push(`mode '${theme.mode}' is not a valid theme mode`)
  }

  const requiresBrandId = MODES_REQUIRING_BRAND_ID.includes(theme.mode)
  if (requiresBrandId && (!theme.partnerBrandId || theme.partnerBrandId.trim() === '')) {
    errors.push(`mode '${theme.mode}' requires a non-empty partnerBrandId`)
  }
  if (!requiresBrandId && theme.partnerBrandId !== null) {
    errors.push(`mode '${theme.mode}' must not carry a partnerBrandId`)
  }

  const validRadius = ['sharp', 'soft', 'rounded', 'pill']
  if (!validRadius.includes(theme.tokens.radiusToken)) {
    errors.push(`radiusToken '${theme.tokens.radiusToken}' is invalid`)
  }
  const validDensity = ['compact', 'comfortable', 'spacious']
  if (!validDensity.includes(theme.tokens.densityToken)) {
    errors.push(`densityToken '${theme.tokens.densityToken}' is invalid`)
  }

  return { valid: errors.length === 0, errors }
}
