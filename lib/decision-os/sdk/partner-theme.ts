/**
 * Decision OS — Phase 7.19 White-Label Partner Onboarding: theme normalization.
 *
 * Normalizes a partner's raw branding submission into a validated `SDKTheme`,
 * reusing the frozen `resolveSDKTheme`/`validateSDKTheme` (Phase 7.4) — this
 * module never resolves tokens to hex/CSS itself (that is sdk-runtime/react's
 * job, Phase 7.18); it only assembles and validates the CONTRACT shape.
 */

import { resolveSDKTheme, validateSDKTheme } from './theme'
import type { SDKTheme } from './types'
import type { PartnerBrandingConfig } from './partner-types'

export interface PartnerThemeNormalizationResult {
  theme: SDKTheme
  valid: boolean
  errors: string[]
}

/**
 * Assembles + validates an `SDKTheme` from a partner's raw branding
 * submission. Deterministic — same input always produces the same theme.
 * Never throws: an invalid submission still produces a best-effort `theme`
 * object (so a caller always has something renderable), with `valid: false`
 * and `errors` describing what's wrong (the frozen `validateSDKTheme`'s own
 * output — never reimplemented here).
 */
export function normalizePartnerBranding(config: PartnerBrandingConfig): PartnerThemeNormalizationResult {
  const overrides: Parameters<typeof resolveSDKTheme>[1] = {
    colorTokenMap: config.colorOverrides,
  }
  if (config.radiusToken) overrides.radiusToken = config.radiusToken
  if (config.densityToken) overrides.densityToken = config.densityToken

  const theme = resolveSDKTheme(config.preferredMode, overrides, config.partnerBrandId)
  const validation = validateSDKTheme(theme)

  return { theme, valid: validation.valid, errors: validation.errors }
}
