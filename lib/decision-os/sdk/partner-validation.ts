/**
 * Decision OS — Phase 7.19 White-Label Partner Onboarding: validation.
 *
 * Pure, deterministic validators — no network calls, no database. Every
 * function returns a result object; nothing throws on malformed input.
 */

import { ALL_EMBED_TARGETS } from './embed'
import type { SDKLicenseTier } from './types'
import { ALL_PARTNER_STATUSES } from './partner-types'
import type { PartnerApiKeyMetadata, PartnerProfile, PartnerTenantConfig } from './partner-types'

export const ALL_LICENSE_TIERS: readonly SDKLicenseTier[] = ['standard', 'premium', 'enterprise']
const VALID_LICENSE_TIERS = ALL_LICENSE_TIERS

export interface PartnerValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ── Origin format ──────────────────────────────────────────────────────────────

/**
 * Origin format check, deliberately duplicated (not imported) from
 * sdk-runtime/iframe/src/origin.ts — lib/decision-os must never depend on
 * sdk-runtime (the dependency direction runs the other way: sdk-runtime
 * consumes these frozen contracts, never the reverse).
 */
const ORIGIN_FORMAT_RE = /^https?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::\d+)?$/

export function isValidPartnerOriginFormat(origin: string): boolean {
  return ORIGIN_FORMAT_RE.test(origin)
}

// ── API key prefix format ──────────────────────────────────────────────────────

/** Matches the `afk_{test|live}_*` format documented in PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md. */
const API_KEY_PREFIX_RE = /^afk_(test|live)_[A-Za-z0-9]+$/

export function isValidApiKeyPrefixFormat(prefix: string): boolean {
  return API_KEY_PREFIX_RE.test(prefix)
}

// ── Profile ────────────────────────────────────────────────────────────────────

export function validatePartnerProfile(profile: PartnerProfile): PartnerValidationResult {
  const errors: string[] = []

  if (!profile.partnerId || profile.partnerId.trim() === '') {
    errors.push('partnerId is required')
  }
  if (!profile.displayName || profile.displayName.trim() === '') {
    errors.push('displayName is required')
  }
  if (!ALL_PARTNER_STATUSES.includes(profile.status)) {
    errors.push(`status '${profile.status}' is not a valid partner status`)
  }
  if (!VALID_LICENSE_TIERS.includes(profile.licenseTier)) {
    errors.push(`licenseTier '${profile.licenseTier}' is not a valid license tier`)
  }
  if (Number.isNaN(Date.parse(profile.createdAt))) {
    errors.push(`createdAt '${profile.createdAt}' is not a valid ISO 8601 timestamp`)
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

// ── API key metadata ──────────────────────────────────────────────────────────

export function validateApiKeyMetadata(key: PartnerApiKeyMetadata): PartnerValidationResult {
  const errors: string[] = []

  if (!key.keyId || key.keyId.trim() === '') {
    errors.push('keyId is required')
  }
  if (!key.keyPrefix || !isValidApiKeyPrefixFormat(key.keyPrefix)) {
    errors.push(`keyPrefix '${key.keyPrefix}' does not match the expected afk_{test|live}_* format`)
  }
  if (key.environment !== 'test' && key.environment !== 'live') {
    errors.push(`environment '${key.environment}' is not valid`)
  }
  if (key.status !== 'active' && key.status !== 'revoked') {
    errors.push(`status '${key.status}' is not valid`)
  }
  if (key.environment === 'test' && !key.keyPrefix.startsWith('afk_test_')) {
    errors.push(`keyPrefix '${key.keyPrefix}' does not match environment 'test'`)
  }
  if (key.environment === 'live' && !key.keyPrefix.startsWith('afk_live_')) {
    errors.push(`keyPrefix '${key.keyPrefix}' does not match environment 'live'`)
  }
  if (key.scopes.length === 0) {
    errors.push('scopes must include at least one scope')
  }
  if (Number.isNaN(Date.parse(key.issuedAt))) {
    errors.push(`issuedAt '${key.issuedAt}' is not a valid ISO 8601 timestamp`)
  }
  if (key.expiresAt !== null && Number.isNaN(Date.parse(key.expiresAt))) {
    errors.push(`expiresAt '${key.expiresAt}' is not a valid ISO 8601 timestamp`)
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

// ── Full tenant config ────────────────────────────────────────────────────────

export function validatePartnerTenantConfig(config: PartnerTenantConfig): PartnerValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const profileResult = validatePartnerProfile(config.profile)
  errors.push(...profileResult.errors.map((e) => `profile: ${e}`))

  if (!config.tenantId || config.tenantId.trim() === '') {
    errors.push('tenantId is required')
  }

  if (config.allowedOrigins.origins.length === 0) {
    warnings.push('no allowedOrigins configured — widget embeds from any origin will be rejected until at least one is added')
  }
  for (const origin of config.allowedOrigins.origins) {
    if (!isValidPartnerOriginFormat(origin)) {
      errors.push(`allowedOrigins: '${origin}' is not a valid origin format`)
    }
  }

  if (config.embedPermissions.allowedEmbedTargets.length === 0) {
    errors.push('embedPermissions.allowedEmbedTargets must include at least one embed target')
  }
  for (const target of config.embedPermissions.allowedEmbedTargets) {
    if (!ALL_EMBED_TARGETS.includes(target)) {
      errors.push(`embedPermissions: '${target}' is not a valid embed target`)
    }
  }

  for (const key of config.apiKeys) {
    const keyResult = validateApiKeyMetadata(key)
    errors.push(...keyResult.errors.map((e) => `apiKeys[${key.keyId || '?'}]: ${e}`))
  }

  return { valid: errors.length === 0, errors, warnings }
}
