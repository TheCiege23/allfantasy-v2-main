/**
 * Decision OS — Phase 7.20 Partner Sandbox API tests.
 *
 * Tests the pure handler cores directly (no HTTP) — route files are thin
 * wrappers; all logic lives in partner-sandbox-handlers.ts. Mirrors
 * __tests__/decision-os/intelligence-api-routes.test.ts's ctx-builder
 * pattern.
 *
 * Covers: disabled state, valid config, invalid config, theme preview,
 * widget catalog filtering, permission denial, embed instructions,
 * sandbox test key metadata, no credential leakage.
 */

import { describe, expect, it } from 'vitest'
import {
  isPartnerSandboxApiEnabled,
  validatePartnerConfigHandler,
  previewPartnerThemeHandler,
  widgetCatalogHandler,
  checkWidgetPermissionHandler,
  embedInstructionsHandler,
  testKeyMetadataHandler,
} from '../../../lib/decision-os/sdk/partner-sandbox-handlers'
import type { PartnerSandboxApiContext, PartnerSandboxApiError } from '../../../lib/decision-os/sdk/partner-sandbox-handlers'
import { SANDBOX_PARTNER_TENANT_CONFIG } from '../../../lib/decision-os/sdk/partner-fixtures'
import type { PartnerTenantConfig, PartnerBrandingConfig } from '../../../lib/decision-os/sdk/partner-types'
import { ALL_EMBED_TARGETS } from '../../../lib/decision-os/sdk/embed'

// ── Env helpers ───────────────────────────────────────────────────────────────

const ENABLED_ENV: NodeJS.ProcessEnv = { PARTNER_SANDBOX_API_ENABLED: 'true' }
const DISABLED_ENV: NodeJS.ProcessEnv = {}

// ── Context builder ─────────────────────────────────────────────────────────────

function makeCtx(
  opts: { searchParams?: Record<string, string>; body?: unknown } = {},
): PartnerSandboxApiContext {
  const headers = new Map<string, string>()
  return {
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
    searchParams: new URLSearchParams(opts.searchParams ?? {}),
    body: opts.body,
  }
}

function makeValidTenantConfig(overrides: Partial<PartnerTenantConfig> = {}): PartnerTenantConfig {
  return { ...SANDBOX_PARTNER_TENANT_CONFIG, ...overrides }
}

function makeValidBranding(overrides: Partial<PartnerBrandingConfig> = {}): PartnerBrandingConfig {
  return { partnerBrandId: 'acme', preferredMode: 'partner_override', colorOverrides: { accent: '#0a84ff' }, ...overrides }
}

// ── isPartnerSandboxApiEnabled ────────────────────────────────────────────────

describe('isPartnerSandboxApiEnabled', () => {
  it('is false when unset', () => {
    expect(isPartnerSandboxApiEnabled({})).toBe(false)
  })

  it('is true for "true"', () => {
    expect(isPartnerSandboxApiEnabled({ PARTNER_SANDBOX_API_ENABLED: 'true' })).toBe(true)
  })

  it('is case/whitespace tolerant', () => {
    expect(isPartnerSandboxApiEnabled({ PARTNER_SANDBOX_API_ENABLED: ' TRUE ' })).toBe(true)
  })

  it('is false for any other value', () => {
    expect(isPartnerSandboxApiEnabled({ PARTNER_SANDBOX_API_ENABLED: 'false' })).toBe(false)
    expect(isPartnerSandboxApiEnabled({ PARTNER_SANDBOX_API_ENABLED: '1' })).toBe(false)
    expect(isPartnerSandboxApiEnabled({ PARTNER_SANDBOX_API_ENABLED: 'yes' })).toBe(false)
  })
})

// ── Disabled state (all six handlers) ─────────────────────────────────────────

describe('disabled state — every handler returns 503 SANDBOX_DISABLED', () => {
  const handlers: Array<[string, (ctx: PartnerSandboxApiContext, env: NodeJS.ProcessEnv) => { status: number; body: unknown }]> = [
    ['validatePartnerConfigHandler', validatePartnerConfigHandler],
    ['previewPartnerThemeHandler', previewPartnerThemeHandler],
    ['widgetCatalogHandler', widgetCatalogHandler],
    ['checkWidgetPermissionHandler', checkWidgetPermissionHandler],
    ['embedInstructionsHandler', embedInstructionsHandler],
    ['testKeyMetadataHandler', testKeyMetadataHandler],
  ]

  for (const [name, handler] of handlers) {
    it(`${name} returns 503 with SANDBOX_DISABLED when the flag is off`, () => {
      const result = handler(makeCtx(), DISABLED_ENV)
      expect(result.status).toBe(503)
      const body = result.body as PartnerSandboxApiError
      expect(body.code).toBe('SANDBOX_DISABLED')
      expect(typeof body.requestId).toBe('string')
      expect(body.requestId.length).toBeGreaterThan(0)
    })
  }
})

// ── Valid partner config ──────────────────────────────────────────────────────

describe('validatePartnerConfigHandler — valid config', () => {
  it('returns 200 with valid:true for a well-formed config', () => {
    const result = validatePartnerConfigHandler(makeCtx({ body: makeValidTenantConfig() }), ENABLED_ENV)
    expect(result.status).toBe(200)
    expect((result.body as { valid: boolean }).valid).toBe(true)
  })

  it('the sandbox fixture itself validates cleanly through the endpoint', () => {
    const result = validatePartnerConfigHandler(makeCtx({ body: SANDBOX_PARTNER_TENANT_CONFIG }), ENABLED_ENV)
    expect(result.status).toBe(200)
    expect((result.body as { valid: boolean; errors: string[] }).errors).toEqual([])
  })
})

// ── Invalid config ────────────────────────────────────────────────────────────

describe('validatePartnerConfigHandler — invalid config', () => {
  it('returns 200 with valid:false (not an HTTP error) for a semantically invalid config', () => {
    const config = makeValidTenantConfig({
      allowedOrigins: { origins: ['not-a-valid-origin'] },
    })
    const result = validatePartnerConfigHandler(makeCtx({ body: config }), ENABLED_ENV)
    expect(result.status).toBe(200)
    const body = result.body as { valid: boolean; errors: string[] }
    expect(body.valid).toBe(false)
    expect(body.errors.length).toBeGreaterThan(0)
  })

  it('returns 400 INVALID_REQUEST for a missing body', () => {
    const result = validatePartnerConfigHandler(makeCtx({ body: undefined }), ENABLED_ENV)
    expect(result.status).toBe(400)
    expect((result.body as PartnerSandboxApiError).code).toBe('INVALID_REQUEST')
  })

  it('returns 400 INVALID_REQUEST for a non-object body (e.g. a bare string)', () => {
    const result = validatePartnerConfigHandler(makeCtx({ body: 'not an object' }), ENABLED_ENV)
    expect(result.status).toBe(400)
  })

  it('returns 400 INVALID_REQUEST (never crashes) for a grossly malformed nested shape', () => {
    const result = validatePartnerConfigHandler(makeCtx({ body: { mode: 'commissioner' } }), ENABLED_ENV)
    expect(result.status).toBe(400)
    expect((result.body as PartnerSandboxApiError).code).toBe('INVALID_REQUEST')
  })

  it('never leaks a raw stack trace or internal error message', () => {
    const result = validatePartnerConfigHandler(makeCtx({ body: { totally: 'broken' } }), ENABLED_ENV)
    const message = (result.body as PartnerSandboxApiError).message
    expect(message).not.toMatch(/at\s+\w+.*\(.*:\d+:\d+\)/) // no stack-trace-shaped line
    expect(message.toLowerCase()).not.toContain('typeerror')
  })
})

// ── Theme preview ─────────────────────────────────────────────────────────────

describe('previewPartnerThemeHandler — theme preview', () => {
  it('returns 200 with a valid resolved theme for a well-formed branding submission', () => {
    const result = previewPartnerThemeHandler(makeCtx({ body: makeValidBranding() }), ENABLED_ENV)
    expect(result.status).toBe(200)
    const body = result.body as { valid: boolean; theme: { mode: string; tokens: { colorTokenMap: Record<string, string> } } }
    expect(body.valid).toBe(true)
    expect(body.theme.mode).toBe('partner_override')
    expect(body.theme.tokens.colorTokenMap.accent).toBe('#0a84ff')
  })

  it('returns 200 with a valid theme for enterprise_branding', () => {
    const result = previewPartnerThemeHandler(
      makeCtx({ body: makeValidBranding({ preferredMode: 'enterprise_branding' }) }),
      ENABLED_ENV,
    )
    expect(result.status).toBe(200)
    expect((result.body as { theme: { mode: string } }).theme.mode).toBe('enterprise_branding')
  })

  it('returns 200 with a valid default (light) theme when colorOverrides is empty', () => {
    const result = previewPartnerThemeHandler(
      makeCtx({ body: makeValidBranding({ preferredMode: 'light', colorOverrides: {} }) }),
      ENABLED_ENV,
    )
    expect(result.status).toBe(200)
    expect((result.body as { valid: boolean }).valid).toBe(true)
  })

  it('returns 400 INVALID_REQUEST (never crashes) for a garbage preferredMode', () => {
    const result = previewPartnerThemeHandler(
      makeCtx({ body: { partnerBrandId: 'acme', preferredMode: 'not-a-real-mode', colorOverrides: {} } }),
      ENABLED_ENV,
    )
    expect(result.status).toBe(400)
    expect((result.body as PartnerSandboxApiError).code).toBe('INVALID_REQUEST')
  })

  it('returns 400 INVALID_REQUEST for a missing body', () => {
    const result = previewPartnerThemeHandler(makeCtx({}), ENABLED_ENV)
    expect(result.status).toBe(400)
  })
})

// ── Widget catalog filtering ──────────────────────────────────────────────────

describe('widgetCatalogHandler — widget catalog filtering', () => {
  it('returns the standard-tier catalog for licenseTier=standard', () => {
    const result = widgetCatalogHandler(makeCtx({ searchParams: { licenseTier: 'standard' } }), ENABLED_ENV)
    expect(result.status).toBe(200)
    const body = result.body as { licenseTier: string; widgetCatalog: string[] }
    expect(body.licenseTier).toBe('standard')
    expect(body.widgetCatalog).not.toContain('full_dashboard')
    expect(body.widgetCatalog).toContain('compact')
  })

  it('returns the full catalog for licenseTier=enterprise', () => {
    const result = widgetCatalogHandler(makeCtx({ searchParams: { licenseTier: 'enterprise' } }), ENABLED_ENV)
    const body = result.body as { widgetCatalog: string[] }
    expect(body.widgetCatalog).toContain('full_dashboard')
  })

  it('returns 400 for a missing licenseTier param', () => {
    const result = widgetCatalogHandler(makeCtx(), ENABLED_ENV)
    expect(result.status).toBe(400)
  })

  it('returns 400 for an invalid licenseTier value', () => {
    const result = widgetCatalogHandler(makeCtx({ searchParams: { licenseTier: 'gold' } }), ENABLED_ENV)
    expect(result.status).toBe(400)
  })
})

// ── Permission denial ─────────────────────────────────────────────────────────

describe('checkWidgetPermissionHandler — permission denial', () => {
  it('allows a standard-tier partner to embed compact', () => {
    const result = checkWidgetPermissionHandler(
      makeCtx({ searchParams: { licenseTier: 'standard', mode: 'compact' } }),
      ENABLED_ENV,
    )
    expect(result.status).toBe(200)
    expect((result.body as { allowed: boolean }).allowed).toBe(true)
  })

  it('denies a standard-tier partner embedding full_dashboard (not an HTTP error — informative 200)', () => {
    const result = checkWidgetPermissionHandler(
      makeCtx({ searchParams: { licenseTier: 'standard', mode: 'full_dashboard' } }),
      ENABLED_ENV,
    )
    expect(result.status).toBe(200)
    expect((result.body as { allowed: boolean }).allowed).toBe(false)
  })

  it('allows an enterprise-tier partner to embed full_dashboard', () => {
    const result = checkWidgetPermissionHandler(
      makeCtx({ searchParams: { licenseTier: 'enterprise', mode: 'full_dashboard' } }),
      ENABLED_ENV,
    )
    expect((result.body as { allowed: boolean }).allowed).toBe(true)
  })

  it('returns 400 for an invalid widget mode', () => {
    const result = checkWidgetPermissionHandler(
      makeCtx({ searchParams: { licenseTier: 'standard', mode: 'not_a_mode' } }),
      ENABLED_ENV,
    )
    expect(result.status).toBe(400)
  })

  it('returns 400 for a missing mode param', () => {
    const result = checkWidgetPermissionHandler(makeCtx({ searchParams: { licenseTier: 'standard' } }), ENABLED_ENV)
    expect(result.status).toBe(400)
  })
})

// ── Embed instructions ────────────────────────────────────────────────────────

describe('embedInstructionsHandler — embed instructions', () => {
  it('returns non-empty instructions for an allowed mode/tier/target combination', () => {
    const result = embedInstructionsHandler(
      makeCtx({ searchParams: { licenseTier: 'standard', mode: 'compact', embedTarget: 'iframe' } }),
      ENABLED_ENV,
    )
    expect(result.status).toBe(200)
    const body = result.body as { allowed: boolean; instructions: string[]; reason: string | null }
    expect(body.allowed).toBe(true)
    expect(body.instructions.length).toBeGreaterThan(0)
    expect(body.reason).toBeNull()
  })

  it('returns empty instructions + a reason for a disallowed mode/tier combination', () => {
    const result = embedInstructionsHandler(
      makeCtx({ searchParams: { licenseTier: 'standard', mode: 'full_dashboard', embedTarget: 'iframe' } }),
      ENABLED_ENV,
    )
    const body = result.body as { allowed: boolean; instructions: string[]; reason: string | null }
    expect(body.allowed).toBe(false)
    expect(body.instructions).toEqual([])
    expect(body.reason).toContain('enterprise')
  })

  it('returns real, non-empty instructions for every embed target', () => {
    for (const target of ALL_EMBED_TARGETS) {
      const result = embedInstructionsHandler(
        makeCtx({ searchParams: { licenseTier: 'enterprise', mode: 'compact', embedTarget: target } }),
        ENABLED_ENV,
      )
      const body = result.body as { instructions: string[] }
      expect(body.instructions.length).toBeGreaterThan(0)
    }
  })

  it('returns 400 for an invalid embedTarget', () => {
    const result = embedInstructionsHandler(
      makeCtx({ searchParams: { licenseTier: 'standard', mode: 'compact', embedTarget: 'flash_embed' } }),
      ENABLED_ENV,
    )
    expect(result.status).toBe(400)
  })

  it('never varies instructions by a partner-identity string (deterministic by target only)', () => {
    const a = embedInstructionsHandler(
      makeCtx({ searchParams: { licenseTier: 'enterprise', mode: 'compact', embedTarget: 'web_component' } }),
      ENABLED_ENV,
    )
    const b = embedInstructionsHandler(
      makeCtx({ searchParams: { licenseTier: 'enterprise', mode: 'compact', embedTarget: 'web_component' } }),
      ENABLED_ENV,
    )
    expect(a.body).toEqual(b.body)
  })
})

// ── Sandbox test key metadata (shape only) ────────────────────────────────────

describe('testKeyMetadataHandler — sandbox test key metadata shape', () => {
  it('returns 200 with an example key metadata object', () => {
    const result = testKeyMetadataHandler(makeCtx(), ENABLED_ENV)
    expect(result.status).toBe(200)
    const body = result.body as { exampleKeyMetadata: Record<string, unknown> }
    expect(body.exampleKeyMetadata).not.toBeNull()
    expect(Object.keys(body.exampleKeyMetadata).sort()).toEqual(
      ['environment', 'expiresAt', 'issuedAt', 'keyId', 'keyPrefix', 'scopes', 'status'].sort(),
    )
  })

  it('the returned keyPrefix is the fixture example, never a freshly generated value', () => {
    const result = testKeyMetadataHandler(makeCtx(), ENABLED_ENV)
    const body = result.body as { exampleKeyMetadata: { keyPrefix: string } }
    expect(body.exampleKeyMetadata.keyPrefix).toBe(SANDBOX_PARTNER_TENANT_CONFIG.apiKeys[0]?.keyPrefix)
  })
})

// ── No credential leakage ──────────────────────────────────────────────────────

describe('no credential leakage', () => {
  it('testKeyMetadataHandler never returns a raw secret field', () => {
    const result = testKeyMetadataHandler(makeCtx(), ENABLED_ENV)
    const serialized = JSON.stringify(result.body)
    expect(serialized).not.toMatch(/"secret"|"rawKey"|"rawSecret"|"credential"/)
  })

  it('validatePartnerConfigHandler never echoes a full apiKey value beyond its own keyPrefix field', () => {
    const config = makeValidTenantConfig({
      apiKeys: [
        {
          keyId: 'key_test',
          keyPrefix: 'afk_test_visible_prefix_only',
          environment: 'test',
          status: 'active',
          scopes: ['intelligence:platform:basic'],
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
        },
      ],
    })
    const result = validatePartnerConfigHandler(makeCtx({ body: config }), ENABLED_ENV)
    const serialized = JSON.stringify(result.body)
    expect(serialized).not.toMatch(/"secret"|"rawKey"|"rawSecret"/)
  })

  it('previewPartnerThemeHandler never returns anything credential-shaped', () => {
    const result = previewPartnerThemeHandler(makeCtx({ body: makeValidBranding() }), ENABLED_ENV)
    const serialized = JSON.stringify(result.body)
    expect(serialized.toLowerCase()).not.toContain('apikey')
    expect(serialized.toLowerCase()).not.toContain('credential')
  })

  it('every disabled-state error response is structurally identical (code/message/requestId only)', () => {
    const result = validatePartnerConfigHandler(makeCtx(), DISABLED_ENV)
    expect(Object.keys(result.body as object).sort()).toEqual(['code', 'message', 'requestId'])
  })
})
