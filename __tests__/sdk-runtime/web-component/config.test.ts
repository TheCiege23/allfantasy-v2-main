import { describe, expect, it } from 'vitest'
import { buildWidgetConfigFromAttributes, validateElementConfig } from '../../../sdk-runtime/web-component/src/config'
import { parseElementAttributes } from '../../../sdk-runtime/web-component/src/attributes'
import type { AttributeGetter, ParsedElementAttributes } from '../../../sdk-runtime/web-component/src/attributes'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'

const VALID_ATTRS: Record<string, string> = {
  mode: 'commissioner',
  'entity-id': 'league_123',
  'entity-type': 'league',
  'tenant-id': 'tenant_abc',
  'base-url': 'https://api.allfantasy.test',
}

function makeGetter(overrides: Record<string, string | null> = {}): AttributeGetter {
  const merged: Record<string, string | null> = { ...VALID_ATTRS, ...overrides }
  return (name: string) => (name in merged ? merged[name] : null)
}

function parsedOrThrow(overrides: Record<string, string | null> = {}): ParsedElementAttributes {
  const result = parseElementAttributes(makeGetter(overrides))
  if (!result.ok) throw new Error(`fixture attributes failed to parse: ${result.errors.join(', ')}`)
  return result.parsed
}

function makeValidAuth(): SDKAuth {
  return {
    method: 'api_key',
    credential: 'tok_test_secret_credential',
    tenantId: 'tenant_abc',
    expiresAt: null,
    scopes: ['intelligence:league:read'],
  }
}

describe('buildWidgetConfigFromAttributes', () => {
  it('assembles a WidgetConfig from parsed attributes + apiKey', () => {
    const parsed = parsedOrThrow()
    const config = buildWidgetConfigFromAttributes(parsed, 'ak_test_key')
    expect(config.mode).toBe('commissioner')
    expect(config.entityId).toBe('league_123')
    expect(config.entityType).toBe('league')
    expect(config.tenantConfig.tenantId).toBe('tenant_abc')
    expect(config.tenantConfig.apiKey).toBe('ak_test_key')
    expect(config.presentationVersion).toBe('7.0.0')
  })

  it('carries feature flags and allowedOrigins through unchanged', () => {
    const parsed = parsedOrThrow({
      'allowed-origins': 'https://partner.example.com',
      'enable-archetype-label': '',
    })
    const config = buildWidgetConfigFromAttributes(parsed, 'ak_test_key')
    expect(config.tenantConfig.allowedOrigins).toEqual(['https://partner.example.com'])
    expect(config.tenantConfig.featureFlags.enableArchetypeLabel).toBe(true)
  })
})

describe('validateElementConfig', () => {
  it('is valid for a well-formed config + auth pair', () => {
    const config = buildWidgetConfigFromAttributes(parsedOrThrow(), 'ak_test_key')
    const result = validateElementConfig(config, makeValidAuth())
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports errors for a mode/entityType combination validateWidgetConfig rejects', () => {
    // 'manager' mode only accepts entityType 'manager' (Phase 7.3 MODE_VALID_ENTITY_TYPES).
    const parsed = parsedOrThrow({ mode: 'manager', 'entity-type': 'league' })
    const config = buildWidgetConfigFromAttributes(parsed, 'ak_test_key')
    const result = validateElementConfig(config, makeValidAuth())
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('entityType'))).toBe(true)
  })

  it('reports errors for an SDKAuth that fails validateSDKAuth (missing credential for api_key)', () => {
    const config = buildWidgetConfigFromAttributes(parsedOrThrow(), 'ak_test_key')
    const invalidAuth: SDKAuth = {
      method: 'api_key',
      credential: null,
      tenantId: 'tenant_abc',
      expiresAt: null,
      scopes: [],
    }
    const result = validateElementConfig(config, invalidAuth)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('credential'))).toBe(true)
  })

  it('aggregates errors from both config AND auth validation when both fail', () => {
    const parsed = parsedOrThrow({ mode: 'manager', 'entity-type': 'league' })
    const config = buildWidgetConfigFromAttributes(parsed, 'ak_test_key')
    const invalidAuth: SDKAuth = {
      method: 'api_key',
      credential: null,
      tenantId: null,
      expiresAt: null,
      scopes: [],
    }
    const result = validateElementConfig(config, invalidAuth)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('never includes the raw apiKey or credential value in its output', () => {
    const config = buildWidgetConfigFromAttributes(parsedOrThrow(), 'ak_super_secret_key_xyz')
    const auth: SDKAuth = { ...makeValidAuth(), credential: 'tok_super_secret_credential_xyz' }
    const result = validateElementConfig(config, auth)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('ak_super_secret_key_xyz')
    expect(serialized).not.toContain('tok_super_secret_credential_xyz')
  })
})
