import { describe, expect, it } from 'vitest'
import {
  buildWidgetConfigWithCredential,
  validateCreateWidgetInputs,
} from '../../../sdk-runtime/js-embed/src/config'
import type { JsEmbedWidgetConfig } from '../../../sdk-runtime/js-embed/src/types'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'

function makeConfig(overrides: Partial<JsEmbedWidgetConfig> = {}): JsEmbedWidgetConfig {
  return {
    mode: 'commissioner',
    entityId: 'league_123',
    entityType: 'league',
    tenantConfig: {
      tenantId: 'tenant_abc',
      allowedOrigins: [],
      rateLimitPerMinute: 60,
      featureFlags: {
        enableBenchmarkComparison: false,
        enableArchetypeLabel: false,
        enableBehavioralPatterns: false,
        enableCompanyIntelligence: false,
      },
      whiteLabelPlatform: null,
    },
    presentationVersion: '7.0.0',
    ...overrides,
  }
}

function makeAuth(overrides: Partial<SDKAuth> = {}): SDKAuth {
  return {
    method: 'api_key',
    credential: 'tok_test_secret_credential',
    tenantId: 'tenant_abc',
    expiresAt: null,
    scopes: ['intelligence:league:read'],
    ...overrides,
  }
}

describe('buildWidgetConfigWithCredential', () => {
  it('assembles a WidgetConfig carrying the injected apiKey', () => {
    const config = buildWidgetConfigWithCredential(makeConfig(), 'ak_test_key')
    expect(config.tenantConfig.apiKey).toBe('ak_test_key')
    expect(config.tenantConfig.tenantId).toBe('tenant_abc')
    expect(config.mode).toBe('commissioner')
  })

  it('never sources apiKey from the JsEmbedWidgetConfig itself', () => {
    // JsEmbedTenantConfig has no apiKey field at the type level; this proves
    // the RUNTIME behavior matches — an untyped caller sneaking an apiKey
    // into tenantConfig has it overwritten by the injected parameter.
    const sneaky = makeConfig({
      tenantConfig: { ...makeConfig().tenantConfig, apiKey: 'sneaky_key' } as unknown as JsEmbedWidgetConfig['tenantConfig'],
    })
    const config = buildWidgetConfigWithCredential(sneaky, 'ak_real_key')
    expect(config.tenantConfig.apiKey).toBe('ak_real_key')
  })
})

describe('validateCreateWidgetInputs', () => {
  it('is valid for well-formed config + auth + apiKey', () => {
    const result = validateCreateWidgetInputs(makeConfig(), makeAuth(), 'ak_test_key')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.config.tenantConfig.apiKey).toBe('ak_test_key')
    }
  })

  it('rejects a null config gracefully instead of throwing', () => {
    expect(() => validateCreateWidgetInputs(null, makeAuth(), 'ak_test_key')).not.toThrow()
    const result = validateCreateWidgetInputs(null, makeAuth(), 'ak_test_key')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('config'))).toBe(true)
  })

  it('rejects a config missing tenantConfig gracefully instead of throwing', () => {
    const malformed = { mode: 'commissioner', entityId: 'x', entityType: 'league' }
    expect(() => validateCreateWidgetInputs(malformed, makeAuth(), 'ak_test_key')).not.toThrow()
    const result = validateCreateWidgetInputs(malformed, makeAuth(), 'ak_test_key')
    expect(result.valid).toBe(false)
  })

  it('rejects a null auth gracefully instead of throwing', () => {
    expect(() => validateCreateWidgetInputs(makeConfig(), null, 'ak_test_key')).not.toThrow()
    const result = validateCreateWidgetInputs(makeConfig(), null, 'ak_test_key')
    expect(result.valid).toBe(false)
  })

  it('rejects an auth missing scopes gracefully instead of throwing', () => {
    const malformedAuth = { method: 'api_key', credential: 'x' }
    expect(() => validateCreateWidgetInputs(makeConfig(), malformedAuth, 'ak_test_key')).not.toThrow()
    const result = validateCreateWidgetInputs(makeConfig(), malformedAuth, 'ak_test_key')
    expect(result.valid).toBe(false)
  })

  it('rejects a missing apiKey', () => {
    const result = validateCreateWidgetInputs(makeConfig(), makeAuth(), undefined)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('apiKey'))).toBe(true)
  })

  it('rejects an empty-string apiKey', () => {
    const result = validateCreateWidgetInputs(makeConfig(), makeAuth(), '')
    expect(result.valid).toBe(false)
  })

  it('rejects a semantically invalid mode/entityType combination via the frozen validateWidgetConfig', () => {
    const result = validateCreateWidgetInputs(
      makeConfig({ mode: 'manager', entityType: 'league' }),
      makeAuth(),
      'ak_test_key',
    )
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('entityType'))).toBe(true)
  })

  it('rejects an SDKAuth that fails validateSDKAuth (missing credential for api_key)', () => {
    const result = validateCreateWidgetInputs(makeConfig(), makeAuth({ credential: null }), 'ak_test_key')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('credential'))).toBe(true)
  })

  it('never includes the raw apiKey or credential value in its error output', () => {
    const result = validateCreateWidgetInputs(
      makeConfig({ mode: 'manager', entityType: 'league' }),
      { ...makeAuth(), credential: 'tok_super_secret_xyz' },
      'ak_super_secret_xyz',
    )
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('tok_super_secret_xyz')
    expect(serialized).not.toContain('ak_super_secret_xyz')
  })
})
