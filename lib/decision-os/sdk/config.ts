/**
 * Decision OS — Phase 7.4 Widget SDK config validation.
 *
 * Ties together version, auth, theme, embed, and refresh contracts into a
 * single deterministic `validateSDKConfig`. Pure — no network calls.
 *
 * ADR: PHASE_7_4_WIDGET_SDK_ADR.md
 */

import type { SDKConfig, SDKEnterpriseExtension, SDKExtensionPoint, SDKLicenseTier } from './types'
import { validateSDKAuth } from './auth'
import { validateSDKTheme } from './theme'
import { validateRefreshStrategy } from './refresh'
import { ALL_EMBED_TARGETS } from './embed'
import { SDK_VERSION } from './types'

const VALID_WIDGET_MODES = [
  'compact', 'sidebar', 'full_dashboard', 'popup', 'commissioner', 'manager', 'mobile', 'partner',
] as const

const VALID_ENTITY_TYPES = ['manager', 'league', 'platform', 'company'] as const

const EXPECTED_PRESENTATION_VERSION = '7.0.0'
const EXPECTED_WIDGET_CONTRACT_VERSION = '7.3.0'

export interface SDKConfigValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validates a full SDKConfig by delegating to each sub-contract validator
 * and checking version compatibility + widget mode/entity type shape.
 * Deterministic: same config → same result.
 */
export function validateSDKConfig(config: SDKConfig): SDKConfigValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Version compatibility
  if (config.version.sdkVersion !== SDK_VERSION) {
    warnings.push(`sdkVersion '${config.version.sdkVersion}' differs from current '${SDK_VERSION}'`)
  }
  if (config.version.presentationVersion !== EXPECTED_PRESENTATION_VERSION) {
    errors.push(`presentationVersion '${config.version.presentationVersion}' is incompatible (expected '${EXPECTED_PRESENTATION_VERSION}')`)
  }
  if (config.version.widgetContractVersion !== EXPECTED_WIDGET_CONTRACT_VERSION) {
    errors.push(`widgetContractVersion '${config.version.widgetContractVersion}' is incompatible (expected '${EXPECTED_WIDGET_CONTRACT_VERSION}')`)
  }

  // Auth
  const authResult = validateSDKAuth(config.auth)
  errors.push(...authResult.errors.map(e => `auth: ${e}`))

  // Theme
  const themeResult = validateSDKTheme(config.theme)
  errors.push(...themeResult.errors.map(e => `theme: ${e}`))

  // Refresh
  const refreshResult = validateRefreshStrategy(config.refreshStrategy)
  errors.push(...refreshResult.errors.map(e => `refreshStrategy: ${e}`))

  // Embed target
  if (!ALL_EMBED_TARGETS.includes(config.embedTarget)) {
    errors.push(`embedTarget '${config.embedTarget}' is not a valid embed target`)
  }

  // Widget mode
  if (!VALID_WIDGET_MODES.includes(config.widgetMode)) {
    errors.push(`widgetMode '${config.widgetMode}' is not a valid widget mode`)
  }

  // Entity type
  if (!VALID_ENTITY_TYPES.includes(config.entityType)) {
    errors.push(`entityType '${config.entityType}' is not a valid entity type`)
  }

  // Required fields
  if (!config.entityId || config.entityId.trim() === '') {
    errors.push('entityId is required')
  }
  if (!config.hostOrigin || config.hostOrigin.trim() === '') {
    errors.push('hostOrigin is required')
  }

  // Capabilities sanity
  if (config.capabilities.maxWidgetsPerHost < 1) {
    errors.push('capabilities.maxWidgetsPerHost must be >= 1')
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ── Enterprise extensions ─────────────────────────────────────────────────────

const LICENSE_TIER_RANK: Record<SDKLicenseTier, number> = {
  standard: 0,
  premium: 1,
  enterprise: 2,
}

/** Minimum license tier required to enable each extension point. */
export const EXTENSION_POINT_MIN_TIER: Readonly<Record<SDKExtensionPoint, SDKLicenseTier>> = {
  white_label:                'premium',
  oem:                        'enterprise',
  partner_branding:           'premium',
  marketplace_widget:         'standard',
  premium_widget:             'premium',
  commissioner_only_widget:   'standard',
  manager_only_widget:        'standard',
  platform_analytics_widget:  'enterprise',
}

/**
 * Whether a tenant's license tier meets the minimum required for an
 * extension point. Deterministic tier comparison — never a named-partner
 * branch.
 */
export function isExtensionPointAllowed(
  extensionPoint: SDKExtensionPoint,
  tenantTier: SDKLicenseTier,
): boolean {
  return LICENSE_TIER_RANK[tenantTier] >= LICENSE_TIER_RANK[EXTENSION_POINT_MIN_TIER[extensionPoint]]
}

/**
 * Builds an SDKEnterpriseExtension descriptor, resolving `enabled` from the
 * tenant's license tier against the extension point's minimum requirement.
 */
export function buildEnterpriseExtension(
  extensionPoint: SDKExtensionPoint,
  tenantTier: SDKLicenseTier,
  restrictions: string[] = [],
): SDKEnterpriseExtension {
  return {
    extensionPoint,
    enabled: isExtensionPointAllowed(extensionPoint, tenantTier),
    licenseTier: tenantTier,
    restrictions,
  }
}
