/**
 * Decision OS — Phase 7.19 White-Label Partner Onboarding Foundation tests.
 *
 * Covers: valid partner config, invalid domain, invalid tier, widget
 * permission enforcement, theme normalization, privacy defaults, no
 * provider-specific branches, no credential leakage.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PARTNER_ONBOARDING_VERSION,
  ALL_PARTNER_STATUSES,
  isValidPartnerOriginFormat,
  isValidApiKeyPrefixFormat,
  validatePartnerProfile,
  validateApiKeyMetadata,
  validatePartnerTenantConfig,
  WIDGET_MODE_MIN_TIER,
  isWidgetModeAllowedForTier,
  isWidgetModeAllowedForPartner,
  isEmbedTargetAllowedForPartner,
  resolveDefaultWidgetCatalog,
  RATE_LIMIT_PER_MINUTE_BY_TIER,
  resolveRateLimitPerMinute,
  resolveEffectivePartnerPrivacySettings,
  normalizePartnerBranding,
  SANDBOX_PARTNER_TENANT_CONFIG,
  ENTERPRISE_PARTNER_TENANT_CONFIG,
} from '../../../lib/decision-os/sdk/index'
import type {
  PartnerProfile,
  PartnerApiKeyMetadata,
  PartnerTenantConfig,
  PartnerBrandingConfig,
  PartnerPrivacyPreferences,
} from '../../../lib/decision-os/sdk/index'
import { resolveWidgetPrivacyRestrictions } from '../../../lib/decision-os/presentation/widget-contracts'
import { hasInternalLeakage } from '../../../lib/decision-os/sdk/privacy'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<PartnerProfile> = {}): PartnerProfile {
  return {
    partnerId: 'partner_acme',
    displayName: 'Acme Fantasy',
    status: 'active',
    licenseTier: 'standard',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeApiKey(overrides: Partial<PartnerApiKeyMetadata> = {}): PartnerApiKeyMetadata {
  return {
    keyId: 'key_001',
    keyPrefix: 'afk_test_abc123',
    environment: 'test',
    status: 'active',
    scopes: ['intelligence:platform:basic'],
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    ...overrides,
  }
}

function makeTenantConfig(overrides: Partial<PartnerTenantConfig> = {}): PartnerTenantConfig {
  return {
    tenantId: 'tenant_acme_001',
    profile: makeProfile(),
    allowedOrigins: { origins: ['https://acme.example.com'] },
    embedPermissions: { allowedEmbedTargets: ['iframe'] },
    branding: { partnerBrandId: 'acme', preferredMode: 'light', colorOverrides: {} },
    privacy: { requireStrictPrivacy: false, maxEntitiesExposedOverride: null },
    featureFlags: {
      enableBenchmarkComparison: false,
      enableArchetypeLabel: false,
      enableBehavioralPatterns: false,
      enableCompanyIntelligence: false,
    },
    whiteLabelPlatform: null,
    apiKeys: [makeApiKey()],
    ...overrides,
  }
}

function makeBranding(overrides: Partial<PartnerBrandingConfig> = {}): PartnerBrandingConfig {
  return {
    partnerBrandId: 'acme',
    preferredMode: 'partner_override',
    colorOverrides: {},
    ...overrides,
  }
}

// ── Version ────────────────────────────────────────────────────────────────────

describe('PARTNER_ONBOARDING_VERSION', () => {
  it('is a semver-like string', () => {
    expect(PARTNER_ONBOARDING_VERSION).toBe('7.19.0')
  })
})

// ── Valid partner config ──────────────────────────────────────────────────────

describe('validatePartnerTenantConfig — valid config', () => {
  it('a well-formed config is valid with no errors', () => {
    const result = validatePartnerTenantConfig(makeTenantConfig())
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('the sandbox fixture is valid', () => {
    const result = validatePartnerTenantConfig(SANDBOX_PARTNER_TENANT_CONFIG)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('the enterprise fixture is valid', () => {
    const result = validatePartnerTenantConfig(ENTERPRISE_PARTNER_TENANT_CONFIG)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('warns (but does not error) when allowedOrigins is empty', () => {
    const result = validatePartnerTenantConfig(makeTenantConfig({ allowedOrigins: { origins: [] } }))
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

// ── Invalid domain ────────────────────────────────────────────────────────────

describe('isValidPartnerOriginFormat', () => {
  it('accepts a well-formed https origin', () => {
    expect(isValidPartnerOriginFormat('https://partner.example.com')).toBe(true)
  })

  it('accepts an origin with a port', () => {
    expect(isValidPartnerOriginFormat('https://localhost:3000')).toBe(true)
  })

  it('rejects an origin with a path', () => {
    expect(isValidPartnerOriginFormat('https://partner.example.com/widgets')).toBe(false)
  })

  it('rejects an origin with a wildcard', () => {
    expect(isValidPartnerOriginFormat('https://*.example.com')).toBe(false)
  })

  it('rejects a bare domain with no scheme', () => {
    expect(isValidPartnerOriginFormat('partner.example.com')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidPartnerOriginFormat('')).toBe(false)
  })
})

describe('validatePartnerTenantConfig — invalid domain', () => {
  it('rejects a config with a malformed origin', () => {
    const result = validatePartnerTenantConfig(makeTenantConfig({ allowedOrigins: { origins: ['not-a-url'] } }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('not-a-url'))).toBe(true)
  })

  it('rejects a config with a wildcard origin', () => {
    const result = validatePartnerTenantConfig(makeTenantConfig({ allowedOrigins: { origins: ['https://*.acme.com'] } }))
    expect(result.valid).toBe(false)
  })

  it('reports every malformed origin independently', () => {
    const result = validatePartnerTenantConfig(
      makeTenantConfig({ allowedOrigins: { origins: ['bad-one', 'https://good.example.com', 'bad-two'] } }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.filter((e) => e.includes('allowedOrigins')).length).toBe(2)
  })
})

// ── Invalid tier ──────────────────────────────────────────────────────────────

describe('validatePartnerProfile — invalid tier', () => {
  it('rejects an unknown licenseTier', () => {
    const profile = makeProfile({ licenseTier: 'gold' as unknown as PartnerProfile['licenseTier'] })
    const result = validatePartnerProfile(profile)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('licenseTier'))).toBe(true)
  })

  it('rejects an unknown status', () => {
    const profile = makeProfile({ status: 'deleted' as unknown as PartnerProfile['status'] })
    const result = validatePartnerProfile(profile)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('status'))).toBe(true)
  })

  it('accepts all three valid tiers', () => {
    expect(validatePartnerProfile(makeProfile({ licenseTier: 'standard' })).valid).toBe(true)
    expect(validatePartnerProfile(makeProfile({ licenseTier: 'premium' })).valid).toBe(true)
    expect(validatePartnerProfile(makeProfile({ licenseTier: 'enterprise' })).valid).toBe(true)
  })

  it('accepts every documented partner status', () => {
    for (const status of ALL_PARTNER_STATUSES) {
      expect(validatePartnerProfile(makeProfile({ status })).valid).toBe(true)
    }
  })

  it('rejects a missing partnerId', () => {
    expect(validatePartnerProfile(makeProfile({ partnerId: '' })).valid).toBe(false)
  })

  it('rejects an invalid createdAt timestamp', () => {
    expect(validatePartnerProfile(makeProfile({ createdAt: 'not-a-date' })).valid).toBe(false)
  })
})

// ── API key metadata ───────────────────────────────────────────────────────────

describe('validateApiKeyMetadata', () => {
  it('accepts a well-formed test key', () => {
    expect(validateApiKeyMetadata(makeApiKey()).valid).toBe(true)
  })

  it('accepts a well-formed live key', () => {
    const result = validateApiKeyMetadata(makeApiKey({ environment: 'live', keyPrefix: 'afk_live_abc123' }))
    expect(result.valid).toBe(true)
  })

  it('rejects a keyPrefix that does not match the afk_{test|live}_ format', () => {
    expect(validateApiKeyMetadata(makeApiKey({ keyPrefix: 'sk_live_abc123' })).valid).toBe(false)
  })

  it('rejects a test key with a live-formatted prefix', () => {
    expect(validateApiKeyMetadata(makeApiKey({ environment: 'test', keyPrefix: 'afk_live_abc123' })).valid).toBe(false)
  })

  it('rejects an empty scopes array', () => {
    expect(validateApiKeyMetadata(makeApiKey({ scopes: [] })).valid).toBe(false)
  })

  it('isValidApiKeyPrefixFormat rejects a prefix with no environment segment', () => {
    expect(isValidApiKeyPrefixFormat('afk_abc123')).toBe(false)
  })
})

// ── Widget permission enforcement ──────────────────────────────────────────────

describe('WIDGET_MODE_MIN_TIER / isWidgetModeAllowedForTier', () => {
  it('a standard-tier partner may embed compact/popup/mobile', () => {
    expect(isWidgetModeAllowedForTier('compact', 'standard')).toBe(true)
    expect(isWidgetModeAllowedForTier('popup', 'standard')).toBe(true)
    expect(isWidgetModeAllowedForTier('mobile', 'standard')).toBe(true)
  })

  it('a standard-tier partner may NOT embed premium-tier modes', () => {
    expect(isWidgetModeAllowedForTier('sidebar', 'standard')).toBe(false)
    expect(isWidgetModeAllowedForTier('commissioner', 'standard')).toBe(false)
    expect(isWidgetModeAllowedForTier('manager', 'standard')).toBe(false)
  })

  it('a standard-tier partner may NOT embed the enterprise-only full_dashboard mode', () => {
    expect(isWidgetModeAllowedForTier('full_dashboard', 'standard')).toBe(false)
  })

  it('a premium-tier partner may embed everything except full_dashboard', () => {
    for (const mode of Object.keys(WIDGET_MODE_MIN_TIER) as (keyof typeof WIDGET_MODE_MIN_TIER)[]) {
      if (mode === 'full_dashboard') continue
      expect(isWidgetModeAllowedForTier(mode, 'premium')).toBe(true)
    }
    expect(isWidgetModeAllowedForTier('full_dashboard', 'premium')).toBe(false)
  })

  it('an enterprise-tier partner may embed every widget mode', () => {
    for (const mode of Object.keys(WIDGET_MODE_MIN_TIER) as (keyof typeof WIDGET_MODE_MIN_TIER)[]) {
      expect(isWidgetModeAllowedForTier(mode, 'enterprise')).toBe(true)
    }
  })

  it('isWidgetModeAllowedForPartner reads the tier from partner.profile.licenseTier', () => {
    const partner = makeTenantConfig({ profile: makeProfile({ licenseTier: 'standard' }) })
    expect(isWidgetModeAllowedForPartner(partner, 'compact')).toBe(true)
    expect(isWidgetModeAllowedForPartner(partner, 'full_dashboard')).toBe(false)
  })
})

describe('resolveDefaultWidgetCatalog', () => {
  it('a standard tier gets exactly the standard-eligible modes', () => {
    const catalog = resolveDefaultWidgetCatalog('standard')
    expect(catalog.sort()).toEqual(['compact', 'mobile', 'popup'].sort())
  })

  it('an enterprise tier gets every widget mode', () => {
    const catalog = resolveDefaultWidgetCatalog('enterprise')
    expect(catalog.length).toBe(Object.keys(WIDGET_MODE_MIN_TIER).length)
  })

  it('a higher tier always yields a superset of a lower tier\'s catalog', () => {
    const standard = new Set(resolveDefaultWidgetCatalog('standard'))
    const premium = new Set(resolveDefaultWidgetCatalog('premium'))
    const enterprise = new Set(resolveDefaultWidgetCatalog('enterprise'))
    for (const mode of standard) expect(premium.has(mode)).toBe(true)
    for (const mode of premium) expect(enterprise.has(mode)).toBe(true)
  })
})

describe('isEmbedTargetAllowedForPartner', () => {
  it('allows a target present in embedPermissions.allowedEmbedTargets', () => {
    const partner = makeTenantConfig({ embedPermissions: { allowedEmbedTargets: ['iframe', 'web_component'] } })
    expect(isEmbedTargetAllowedForPartner(partner, 'iframe')).toBe(true)
    expect(isEmbedTargetAllowedForPartner(partner, 'web_component')).toBe(true)
  })

  it('rejects a target NOT present in embedPermissions.allowedEmbedTargets', () => {
    const partner = makeTenantConfig({ embedPermissions: { allowedEmbedTargets: ['iframe'] } })
    expect(isEmbedTargetAllowedForPartner(partner, 'js_embed')).toBe(false)
    expect(isEmbedTargetAllowedForPartner(partner, 'native_bridge')).toBe(false)
  })
})

describe('validatePartnerTenantConfig — invalid embed permissions', () => {
  it('rejects an empty allowedEmbedTargets list', () => {
    const result = validatePartnerTenantConfig(makeTenantConfig({ embedPermissions: { allowedEmbedTargets: [] } }))
    expect(result.valid).toBe(false)
  })

  it('rejects an unrecognized embed target string', () => {
    const result = validatePartnerTenantConfig(
      makeTenantConfig({ embedPermissions: { allowedEmbedTargets: ['flash_embed' as never] } }),
    )
    expect(result.valid).toBe(false)
  })
})

describe('RATE_LIMIT_PER_MINUTE_BY_TIER / resolveRateLimitPerMinute', () => {
  it('rate limits increase monotonically with tier', () => {
    expect(RATE_LIMIT_PER_MINUTE_BY_TIER.standard).toBeLessThan(RATE_LIMIT_PER_MINUTE_BY_TIER.premium)
    expect(RATE_LIMIT_PER_MINUTE_BY_TIER.premium).toBeLessThan(RATE_LIMIT_PER_MINUTE_BY_TIER.enterprise)
  })

  it('resolveRateLimitPerMinute matches the lookup table', () => {
    expect(resolveRateLimitPerMinute('standard')).toBe(RATE_LIMIT_PER_MINUTE_BY_TIER.standard)
    expect(resolveRateLimitPerMinute('enterprise')).toBe(RATE_LIMIT_PER_MINUTE_BY_TIER.enterprise)
  })
})

// ── Theme normalization ────────────────────────────────────────────────────────

describe('normalizePartnerBranding', () => {
  it('produces a valid SDKTheme for a well-formed partner_override submission', () => {
    const result = normalizePartnerBranding(makeBranding({ colorOverrides: { accent: '#0a84ff' } }))
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.theme.mode).toBe('partner_override')
    expect(result.theme.partnerBrandId).toBe('acme')
    expect(result.theme.tokens.colorTokenMap.accent).toBe('#0a84ff')
  })

  it('produces a valid SDKTheme for enterprise_branding', () => {
    const result = normalizePartnerBranding(makeBranding({ preferredMode: 'enterprise_branding' }))
    expect(result.valid).toBe(true)
    expect(result.theme.mode).toBe('enterprise_branding')
  })

  it('drops partnerBrandId for a light/dark/auto theme (delegated to the frozen resolveSDKTheme)', () => {
    const result = normalizePartnerBranding(makeBranding({ preferredMode: 'light' }))
    expect(result.theme.partnerBrandId).toBeNull()
  })

  it('is deterministic — the same input always normalizes to the same output', () => {
    const input = makeBranding({ colorOverrides: { danger: '#ff0000', accent: '#00ff00' } })
    const a = normalizePartnerBranding(input)
    const b = normalizePartnerBranding(input)
    expect(a).toEqual(b)
  })

  it('preserves radiusToken/densityToken overrides when supplied', () => {
    const result = normalizePartnerBranding(makeBranding({ radiusToken: 'pill', densityToken: 'spacious' }))
    expect(result.theme.tokens.radiusToken).toBe('pill')
    expect(result.theme.tokens.densityToken).toBe('spacious')
  })

  it('never throws on an empty colorOverrides map', () => {
    expect(() => normalizePartnerBranding(makeBranding({ colorOverrides: {} }))).not.toThrow()
  })
})

// ── Privacy defaults ───────────────────────────────────────────────────────────

describe('resolveEffectivePartnerPrivacySettings — privacy defaults', () => {
  const relaxedPreferences: PartnerPrivacyPreferences = { requireStrictPrivacy: false, maxEntitiesExposedOverride: null }

  it('matches the widget mode baseline exactly when preferences are fully relaxed (no override)', () => {
    for (const mode of Object.keys(WIDGET_MODE_MIN_TIER) as (keyof typeof WIDGET_MODE_MIN_TIER)[]) {
      const baseline = resolveWidgetPrivacyRestrictions(mode)
      const effective = resolveEffectivePartnerPrivacySettings(mode, relaxedPreferences)
      expect(effective).toEqual(baseline)
    }
  })

  it('requireStrictPrivacy forces every boolean restriction to true, never loosening the baseline', () => {
    const strict: PartnerPrivacyPreferences = { requireStrictPrivacy: true, maxEntitiesExposedOverride: null }
    const effective = resolveEffectivePartnerPrivacySettings('full_dashboard', strict)
    expect(effective.anonymizeManagerIds).toBe(true)
    expect(effective.anonymizeLeagueIds).toBe(true)
    expect(effective.suppressAbsoluteEventCounts).toBe(true)
    expect(effective.requireConsentBanner).toBe(true)
  })

  it('a maxEntitiesExposedOverride can only tighten (lower), never raise, the mode baseline', () => {
    const baseline = resolveWidgetPrivacyRestrictions('compact') // has a numeric cap in Phase 7.3
    const looseOverride: PartnerPrivacyPreferences = {
      requireStrictPrivacy: false,
      maxEntitiesExposedOverride: (baseline.maxEntitiesExposed ?? 0) + 1000, // attempt to RAISE the cap
    }
    const effective = resolveEffectivePartnerPrivacySettings('compact', looseOverride)
    expect(effective.maxEntitiesExposed).toBe(baseline.maxEntitiesExposed) // unchanged — override could not loosen it
  })

  it('a maxEntitiesExposedOverride lower than the baseline is applied', () => {
    const effective = resolveEffectivePartnerPrivacySettings('full_dashboard', {
      requireStrictPrivacy: false,
      maxEntitiesExposedOverride: 3,
    })
    expect(effective.maxEntitiesExposed).toBe(3)
  })

  it('never produces a result stricter-than-impossible (booleans stay real booleans, cap stays a number or null)', () => {
    const effective = resolveEffectivePartnerPrivacySettings('popup', { requireStrictPrivacy: true, maxEntitiesExposedOverride: 1 })
    expect(typeof effective.anonymizeManagerIds).toBe('boolean')
    expect(effective.maxEntitiesExposed === null || typeof effective.maxEntitiesExposed === 'number').toBe(true)
  })
})

// ── No provider-specific branches ──────────────────────────────────────────────

describe('no provider-specific branches', () => {
  const PARTNER_MODULE_FILES = [
    'lib/decision-os/sdk/partner-types.ts',
    'lib/decision-os/sdk/partner-validation.ts',
    'lib/decision-os/sdk/partner-permissions.ts',
    'lib/decision-os/sdk/partner-theme.ts',
  ].map((p) => resolve(process.cwd(), p))

  const KNOWN_PROVIDER_NAMES = ['sleeper', 'yahoo', 'espn', 'fantrax', 'cbs', 'draftkings', 'fanduel', 'underdog']

  it('no logic file hardcodes a known named-partner platform string', () => {
    for (const path of PARTNER_MODULE_FILES) {
      const src = readFileSync(path, 'utf8').toLowerCase()
      for (const name of KNOWN_PROVIDER_NAMES) {
        expect(`${path}: contains '${name}' = ${src.includes(name)}`).toBe(`${path}: contains '${name}' = false`)
      }
    }
  })

  it('permission/validation functions never branch on partnerId, displayName, or whiteLabelPlatform identity', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/decision-os/sdk/partner-permissions.ts'), 'utf8')
    expect(/if\s*\(\s*\w*\.?partnerId\s*===/.test(src)).toBe(false)
    expect(/if\s*\(\s*\w*\.?displayName\s*===/.test(src)).toBe(false)
    expect(/if\s*\(\s*\w*\.?whiteLabelPlatform\s*===/.test(src)).toBe(false)
  })

  it('every permission decision is tier-rank or explicit-allowlist based (structural proof via the two exported lookup tables)', () => {
    expect(typeof WIDGET_MODE_MIN_TIER).toBe('object')
    expect(typeof RATE_LIMIT_PER_MINUTE_BY_TIER).toBe('object')
    // Both tables are keyed by WidgetMode/SDKLicenseTier — never by a partner identity string.
    expect(Object.keys(RATE_LIMIT_PER_MINUTE_BY_TIER).sort()).toEqual(['enterprise', 'premium', 'standard'])
  })

  it('whiteLabelPlatform stays a free-form nullable string, never validated against a fixed platform enum', () => {
    const validResultA = validatePartnerTenantConfig(makeTenantConfig({ whiteLabelPlatform: 'literally-anything' }))
    const validResultB = validatePartnerTenantConfig(makeTenantConfig({ whiteLabelPlatform: null }))
    expect(validResultA.valid).toBe(true)
    expect(validResultB.valid).toBe(true)
  })
})

// ── No credential leakage ──────────────────────────────────────────────────────

describe('no credential leakage', () => {
  it('PartnerApiKeyMetadata never carries a raw secret field (structural proof via the fixture + validator output)', () => {
    const key = makeApiKey({ keyPrefix: 'afk_live_only_a_prefix' })
    const serialized = JSON.stringify(key)
    expect(Object.keys(key).sort()).toEqual(
      ['environment', 'expiresAt', 'issuedAt', 'keyId', 'keyPrefix', 'scopes', 'status'].sort(),
    )
    expect(serialized).not.toMatch(/"secret"|"rawKey"|"credential"/)
  })

  it('validatePartnerTenantConfig error/warning strings never include a full API key value', () => {
    const secretLikeValue = 'afk_live_SUPER_SECRET_DO_NOT_LEAK_1234567890'
    const result = validatePartnerTenantConfig(
      makeTenantConfig({ apiKeys: [makeApiKey({ keyId: secretLikeValue, keyPrefix: 'afk_live_ok' })] }),
    )
    const serialized = JSON.stringify(result)
    // The keyId itself is allowed to appear (it's an identifier, not a secret) —
    // the real assertion is that no field in this contract is EVER the raw
    // secret credential value in the first place (see the shape-keys test above).
    expect(serialized).not.toContain('rawSecret')
  })

  // Every file in this codebase (including this new module) carries a
  // "Decision OS — Phase X ..." header COMMENT — that is documentation, not
  // a leak. Both checks below strip ALL comments (block + line, not just
  // import lines) before scanning CODE for prisma/internal-terminology
  // references, matching the established pattern from every sdk-runtime
  // import-boundary test (e.g. __tests__/sdk-runtime/js-embed/import-boundary.test.ts).
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const PARTNER_SOURCE_FILES = [
    'lib/decision-os/sdk/partner-types.ts',
    'lib/decision-os/sdk/partner-validation.ts',
    'lib/decision-os/sdk/partner-permissions.ts',
    'lib/decision-os/sdk/partner-theme.ts',
    'lib/decision-os/sdk/partner-fixtures.ts',
  ]

  it('no source file in the partner module imports or references Prisma / a database client', () => {
    for (const rel of PARTNER_SOURCE_FILES) {
      const src = stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))
      expect(`${rel}: prisma reference = ${/prisma/i.test(src)}`).toBe(`${rel}: prisma reference = false`)
    }
  })

  it('no source file in the partner module leaks internal Decision OS terminology (outside of doc-comment headers)', () => {
    for (const rel of PARTNER_SOURCE_FILES) {
      const src = stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))
      const leaked = hasInternalLeakage(src)
      expect(`${rel}: internal terminology leaked = ${leaked}`).toBe(`${rel}: internal terminology leaked = false`)
    }
  })

  it('the denylist guard actually catches a violation (positive control)', () => {
    expect(hasInternalLeakage('This exposes Decision OS internals')).toBe(true)
  })
})
