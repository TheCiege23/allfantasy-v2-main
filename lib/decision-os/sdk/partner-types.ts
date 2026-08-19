/**
 * Decision OS — Phase 7.19 White-Label Partner Onboarding: types.
 *
 * Pure types only — no runtime logic in this file. A "foundation" contract
 * layer: describes what AllFantasy needs to know about a partner BEFORE
 * issuing them a Phase 7.3 `WidgetTenantConfig` / Phase 7.4 `SDKAuth`. No
 * database, no admin UI — see PHASE_7_19_PARTNER_ONBOARDING_ADR.md.
 *
 * Reuses frozen types wherever the concept already exists (SDKLicenseTier,
 * SDKEmbedTarget, SDKTheme, WidgetFeatureFlags, IntelligenceApiScope) rather
 * than duplicating them — see the ADR's D3.
 */

import type { WidgetFeatureFlags } from '../presentation/widget-contracts'
import type { SDKEmbedTarget, SDKLicenseTier, SDKTheme, SDKThemeMode } from './types'
import type { IntelligenceApiScope } from '../behavioral/api/contracts'

export const PARTNER_ONBOARDING_VERSION = '7.19.0' as const

// ── Partner profile ────────────────────────────────────────────────────────────

export type PartnerStatus = 'pending' | 'active' | 'suspended' | 'archived'

export const ALL_PARTNER_STATUSES: readonly PartnerStatus[] = ['pending', 'active', 'suspended', 'archived']

export interface PartnerProfile {
  partnerId: string
  displayName: string
  status: PartnerStatus
  /** Drives widget-mode permissions, embed rate limit, and default widget catalog — see partner-permissions.ts. */
  licenseTier: SDKLicenseTier
  /** ISO 8601. */
  createdAt: string
}

// ── Allowed domains / origins ──────────────────────────────────────────────────

export interface PartnerAllowedOrigins {
  /** Exact-match origins only, e.g. 'https://partner.example.com' — no wildcards. */
  origins: string[]
}

// ── API key metadata (metadata only — NEVER the raw secret; see ADR D4) ───────

export type PartnerApiKeyEnvironment = 'test' | 'live'
export type PartnerApiKeyStatus = 'active' | 'revoked'

export interface PartnerApiKeyMetadata {
  keyId: string
  /** The short VISIBLE prefix only, e.g. 'afk_live_7f3a' — structurally never the full secret. */
  keyPrefix: string
  environment: PartnerApiKeyEnvironment
  status: PartnerApiKeyStatus
  scopes: IntelligenceApiScope[]
  /** ISO 8601. */
  issuedAt: string
  /** ISO 8601, or null = does not expire. */
  expiresAt: string | null
}

// ── Embed target permissions ───────────────────────────────────────────────────

export interface PartnerEmbedPermissions {
  allowedEmbedTargets: SDKEmbedTarget[]
}

// ── Privacy preferences (partner-level; merged with the mode baseline) ────────

export interface PartnerPrivacyPreferences {
  /** When true, every widget mode's privacy restrictions are forced to their strictest values, regardless of the mode's own baseline. */
  requireStrictPrivacy: boolean
  /** An additional cap on entities exposed, applied as a MINIMUM with the mode's own cap — never loosens it. Null = no additional cap. */
  maxEntitiesExposedOverride: number | null
}

// ── Branding / theme config (raw onboarding submission, pre-normalization) ────

export interface PartnerBrandingConfig {
  partnerBrandId: string
  preferredMode: SDKThemeMode
  colorOverrides: Partial<SDKTheme['tokens']['colorTokenMap']>
  radiusToken?: SDKTheme['tokens']['radiusToken']
  densityToken?: SDKTheme['tokens']['densityToken']
}

// ── Tenant configuration (the full onboarding record) ──────────────────────────

export interface PartnerTenantConfig {
  tenantId: string
  profile: PartnerProfile
  allowedOrigins: PartnerAllowedOrigins
  embedPermissions: PartnerEmbedPermissions
  branding: PartnerBrandingConfig
  privacy: PartnerPrivacyPreferences
  featureFlags: WidgetFeatureFlags
  /** Free-form, optional — never a hardcoded enum of named platforms (ADR D7). Identical shape to the frozen WidgetTenantConfig.whiteLabelPlatform. */
  whiteLabelPlatform: string | null
  apiKeys: PartnerApiKeyMetadata[]
}
