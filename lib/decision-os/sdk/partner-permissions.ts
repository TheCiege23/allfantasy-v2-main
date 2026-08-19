/**
 * Decision OS — Phase 7.19 White-Label Partner Onboarding: permissions.
 *
 * Pure, deterministic tier/permission lookups. Every decision is tier-rank,
 * explicit-allowlist, or explicit-boolean-preference based — never a
 * partner-identity branch (ADR D7).
 */

import type { WidgetMode } from '../presentation/widget-contracts'
import { resolveWidgetPrivacyRestrictions } from '../presentation/widget-contracts'
import type { WidgetPrivacyRestrictions } from '../presentation/widget-contracts'
import type { SDKEmbedTarget, SDKLicenseTier } from './types'
import type { PartnerPrivacyPreferences, PartnerTenantConfig } from './partner-types'

// ── License tier ranking (mirrors config.ts's LICENSE_TIER_RANK — see ADR D3) ──

const LICENSE_TIER_RANK: Record<SDKLicenseTier, number> = {
  standard: 0,
  premium: 1,
  enterprise: 2,
}

function tierMeetsMinimum(tier: SDKLicenseTier, minimum: SDKLicenseTier): boolean {
  return LICENSE_TIER_RANK[tier] >= LICENSE_TIER_RANK[minimum]
}

// ── Widget permissions by tier ──────────────────────────────────────────────────

const ALL_WIDGET_MODES: readonly WidgetMode[] = [
  'compact', 'sidebar', 'full_dashboard', 'popup', 'commissioner', 'manager', 'mobile', 'partner',
]

/**
 * Minimum license tier required to embed each widget mode. Same shape as
 * Phase 7.4's frozen `EXTENSION_POINT_MIN_TIER` (config.ts) — a new lookup
 * table, not a new pattern (ADR D3).
 */
export const WIDGET_MODE_MIN_TIER: Readonly<Record<WidgetMode, SDKLicenseTier>> = {
  compact: 'standard',
  popup: 'standard',
  mobile: 'standard',
  sidebar: 'premium',
  commissioner: 'premium',
  manager: 'premium',
  partner: 'premium',
  full_dashboard: 'enterprise',
}

export function isWidgetModeAllowedForTier(mode: WidgetMode, tier: SDKLicenseTier): boolean {
  return tierMeetsMinimum(tier, WIDGET_MODE_MIN_TIER[mode])
}

export function isWidgetModeAllowedForPartner(partner: PartnerTenantConfig, mode: WidgetMode): boolean {
  return isWidgetModeAllowedForTier(mode, partner.profile.licenseTier)
}

/** Every widget mode a license tier unlocks by default — the starting catalog before any per-widget customization. */
export function resolveDefaultWidgetCatalog(tier: SDKLicenseTier): WidgetMode[] {
  return ALL_WIDGET_MODES.filter((mode) => isWidgetModeAllowedForTier(mode, tier))
}

// ── Embed target permissions ───────────────────────────────────────────────────

export function isEmbedTargetAllowedForPartner(partner: PartnerTenantConfig, target: SDKEmbedTarget): boolean {
  return partner.embedPermissions.allowedEmbedTargets.includes(target)
}

// ── Rate limit tier ────────────────────────────────────────────────────────────

/**
 * Deterministic rate limit per license tier. Not a billing system (ADR D6,
 * "No public billing yet") — a fixed lookup table anchored to the SAME
 * SDKLicenseTier already used for extension-point gating, kept internally
 * consistent and ready to be wired to a real plan system later.
 */
export const RATE_LIMIT_PER_MINUTE_BY_TIER: Readonly<Record<SDKLicenseTier, number>> = {
  standard: 60,
  premium: 300,
  enterprise: 1200,
}

export function resolveRateLimitPerMinute(tier: SDKLicenseTier): number {
  return RATE_LIMIT_PER_MINUTE_BY_TIER[tier]
}

// ── Privacy ──────────────────────────────────────────────────────────────────

/**
 * Merges a widget mode's own baseline privacy restrictions
 * (`resolveWidgetPrivacyRestrictions`, Phase 7.3, frozen) with the partner's
 * preferences. Can only TIGHTEN, never loosen, the mode's defaults (ADR D5):
 * booleans are OR'd (any true wins), and the numeric cap takes the smaller
 * (stricter) of the two values.
 */
export function resolveEffectivePartnerPrivacySettings(
  mode: WidgetMode,
  preferences: PartnerPrivacyPreferences,
): WidgetPrivacyRestrictions {
  const base = resolveWidgetPrivacyRestrictions(mode)

  return {
    anonymizeManagerIds: base.anonymizeManagerIds || preferences.requireStrictPrivacy,
    anonymizeLeagueIds: base.anonymizeLeagueIds || preferences.requireStrictPrivacy,
    suppressAbsoluteEventCounts: base.suppressAbsoluteEventCounts || preferences.requireStrictPrivacy,
    requireConsentBanner: base.requireConsentBanner || preferences.requireStrictPrivacy,
    maxEntitiesExposed: mergeMaxEntitiesExposed(base.maxEntitiesExposed, preferences.maxEntitiesExposedOverride),
  }
}

function mergeMaxEntitiesExposed(base: number | null, override: number | null): number | null {
  if (base === null) return override
  if (override === null) return base
  return Math.min(base, override)
}
