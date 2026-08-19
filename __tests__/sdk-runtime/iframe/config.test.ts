import { describe, expect, it } from 'vitest'
import { validateIframeEmbedConfig } from '../../../sdk-runtime/iframe/src/index'
import type { IframeEmbedConfig } from '../../../sdk-runtime/iframe/src/index'
import { resolveSDKTheme, resolveRefreshStrategy, SDK_VERSION } from '../../../lib/decision-os/sdk/index'
import type { SDKConfig } from '../../../lib/decision-os/sdk/types'

function makeSdkConfig(overrides: Partial<SDKConfig> = {}): SDKConfig {
  return {
    version: { sdkVersion: SDK_VERSION, presentationVersion: '7.0.0', widgetContractVersion: '7.3.0', apiVersion: 'v1' },
    auth: { method: 'signed_embed_token', credential: 'tok_abc123def456', tenantId: 'tenant_001', expiresAt: null, scopes: ['intelligence:league:read'] },
    theme: resolveSDKTheme('light'),
    locale: { locale: 'en-US', fallbackLocale: 'en-US', numberFormat: 'western', dateFormat: 'MDY' },
    embedTarget: 'iframe',
    widgetMode: 'commissioner',
    entityId: 'league_001',
    entityType: 'league',
    hostOrigin: 'https://partner.example.com',
    refreshStrategy: resolveRefreshStrategy('manual'),
    capabilities: {
      supportsInteractivity: true, supportsRefresh: true, supportsTelemetry: true,
      supportsThemeOverride: false, supportsOfflineCache: false, maxWidgetsPerHost: 5,
    },
    ...overrides,
  }
}

function makeEmbedConfig(overrides: Partial<IframeEmbedConfig> = {}): IframeEmbedConfig {
  return {
    sdkConfig: makeSdkConfig(),
    iframeOrigin: 'https://widgets.allfantasy.app',
    allowedOrigins: ['https://partner.example.com'],
    ...overrides,
  }
}

describe('validateIframeEmbedConfig — valid', () => {
  it('a fully valid config passes', () => {
    const result = validateIframeEmbedConfig(makeEmbedConfig())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

describe('validateIframeEmbedConfig — embedTarget', () => {
  it('fails when embedTarget is not iframe', () => {
    const result = validateIframeEmbedConfig(makeEmbedConfig({ sdkConfig: makeSdkConfig({ embedTarget: 'js_embed' }) }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('embedTarget'))).toBe(true)
  })
})

describe('validateIframeEmbedConfig — origins', () => {
  it('fails for a malformed iframeOrigin', () => {
    const result = validateIframeEmbedConfig(makeEmbedConfig({ iframeOrigin: 'not-a-url' }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('iframeOrigin:'))).toBe(true)
  })

  it('fails for a malformed hostOrigin', () => {
    const result = validateIframeEmbedConfig(makeEmbedConfig({ sdkConfig: makeSdkConfig({ hostOrigin: 'partner.example.com/path' }) }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('sdkConfig.hostOrigin:'))).toBe(true)
  })

  it('fails when allowedOrigins is empty', () => {
    const result = validateIframeEmbedConfig(makeEmbedConfig({ allowedOrigins: [] }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('allowedOrigins'))).toBe(true)
  })

  it('fails when hostOrigin is not a member of allowedOrigins', () => {
    const result = validateIframeEmbedConfig(makeEmbedConfig({ allowedOrigins: ['https://someone-else.example.com'] }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('not a member of allowedOrigins'))).toBe(true)
  })

  it('warns (not errors) when iframeOrigin equals hostOrigin', () => {
    const result = validateIframeEmbedConfig(
      makeEmbedConfig({ iframeOrigin: 'https://partner.example.com', allowedOrigins: ['https://partner.example.com'] }),
    )
    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.includes('identical'))).toBe(true)
  })
})

describe('validateIframeEmbedConfig — delegates to frozen validateSDKConfig', () => {
  it('an invalid inner SDKConfig (bad auth) propagates as a prefixed error', () => {
    const result = validateIframeEmbedConfig(
      makeEmbedConfig({ sdkConfig: makeSdkConfig({ auth: { method: 'signed_embed_token', credential: '', tenantId: 'tenant_001', expiresAt: null, scopes: [] } }) }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('sdkConfig:'))).toBe(true)
  })

  it('an incompatible presentationVersion propagates as a prefixed error', () => {
    const result = validateIframeEmbedConfig(
      makeEmbedConfig({ sdkConfig: makeSdkConfig({ version: { sdkVersion: SDK_VERSION, presentationVersion: '1.0.0', widgetContractVersion: '7.3.0', apiVersion: 'v1' } }) }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('sdkConfig:'))).toBe(true)
  })
})

describe('validateIframeEmbedConfig — no credential leakage in the result', () => {
  it('does not expose the credential in errors/warnings', () => {
    const secret = 'tok_super_secret_leak_check'
    const result = validateIframeEmbedConfig(
      makeEmbedConfig({ sdkConfig: makeSdkConfig({ auth: { method: 'signed_embed_token', credential: secret, tenantId: 'tenant_001', expiresAt: null, scopes: [] } }) }),
    )
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})

describe('validateIframeEmbedConfig — determinism', () => {
  it('is deterministic', () => {
    const config = makeEmbedConfig()
    expect(validateIframeEmbedConfig(config)).toEqual(validateIframeEmbedConfig(config))
  })
})
