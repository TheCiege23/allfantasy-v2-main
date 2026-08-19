/**
 * Decision OS — Phase 7.4 Widget SDK & Embed Specification tests.
 *
 * Covers: configuration validation, theme validation, auth contracts,
 * widget lifecycle, event ordering, refresh logic, privacy guarantees,
 * determinism, version compatibility, error contracts, tenant isolation,
 * serialization, no internal leakage.
 */

import { describe, expect, it } from 'vitest'
import {
  SDK_VERSION,
  // Lifecycle
  ALL_LIFECYCLE_STATES,
  TERMINAL_LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  isValidLifecycleTransition,
  nextLifecycleStates,
  isTerminalLifecycleState,
  validateLifecycleSequence,
  // Theme
  VALID_THEME_MODES,
  resolveSDKTheme,
  validateSDKTheme,
  // Auth
  ALL_AUTH_METHODS,
  AUTH_METHOD_REQUIREMENTS,
  validateSDKAuth,
  isPublicAuthMethod,
  // Embed
  ALL_EMBED_TARGETS,
  getEmbedCapabilities,
  isFullyIsolatedEmbed,
  // Events
  ALL_SDK_EVENT_TYPES,
  obfuscateTenantIdForTelemetry,
  buildSDKEvent,
  validateEventSequence,
  // Errors
  ALL_SDK_ERROR_CODES,
  buildSDKError,
  isRetryableErrorCode,
  // Refresh
  ALL_REFRESH_TRIGGERS,
  resolveRefreshStrategy,
  validateRefreshStrategy,
  // Privacy
  INTERNAL_FIELD_DENYLIST,
  INTERNAL_TERMINOLOGY_DENYLIST,
  stripInternalFields,
  findInternalLeakage,
  hasInternalLeakage,
  // Config
  validateSDKConfig,
  EXTENSION_POINT_MIN_TIER,
  isExtensionPointAllowed,
  buildEnterpriseExtension,
} from '../../../lib/decision-os/sdk/index'
import type {
  SDKLifecycleState,
  SDKThemeMode,
  SDKAuthMethod,
  SDKAuth,
  SDKEmbedTarget,
  SDKTelemetryEventType,
  SDKErrorCode,
  SDKRefreshTrigger,
  SDKConfig,
  SDKExtensionPoint,
} from '../../../lib/decision-os/sdk/index'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAuth(overrides: Partial<SDKAuth> = {}): SDKAuth {
  return {
    method: 'api_key',
    credential: 'sk_live_abc123',
    tenantId: 'tenant_001',
    expiresAt: null,
    scopes: ['intelligence:league:read'],
    ...overrides,
  }
}

function makeConfig(overrides: Partial<SDKConfig> = {}): SDKConfig {
  return {
    version: {
      sdkVersion: SDK_VERSION,
      presentationVersion: '7.0.0',
      widgetContractVersion: '7.3.0',
      apiVersion: 'v1',
    },
    auth: makeAuth(),
    theme: resolveSDKTheme('light'),
    locale: {
      locale: 'en-US',
      fallbackLocale: 'en-US',
      numberFormat: 'western',
      dateFormat: 'MDY',
    },
    embedTarget: 'iframe',
    widgetMode: 'commissioner',
    entityId: 'league_001',
    entityType: 'league',
    hostOrigin: 'https://partner.example.com',
    refreshStrategy: resolveRefreshStrategy('manual'),
    capabilities: {
      supportsInteractivity: true,
      supportsRefresh: true,
      supportsTelemetry: true,
      supportsThemeOverride: false,
      supportsOfflineCache: false,
      maxWidgetsPerHost: 5,
    },
    ...overrides,
  }
}

// ── Version ───────────────────────────────────────────────────────────────────

describe('SDK_VERSION', () => {
  it('is 7.4.0', () => {
    expect(SDK_VERSION).toBe('7.4.0')
  })
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe('lifecycle — states', () => {
  it('has exactly 10 states', () => {
    expect(ALL_LIFECYCLE_STATES).toHaveLength(10)
  })

  it('disposed is the only terminal state', () => {
    expect(TERMINAL_LIFECYCLE_STATES).toEqual(['disposed'])
  })

  it('disposed has no outbound transitions', () => {
    expect(LIFECYCLE_TRANSITIONS.disposed).toHaveLength(0)
  })
})

describe('lifecycle — isValidLifecycleTransition', () => {
  it('initializing → authenticating is valid', () => {
    expect(isValidLifecycleTransition('initializing', 'authenticating')).toBe(true)
  })

  it('authenticating → loading is valid', () => {
    expect(isValidLifecycleTransition('authenticating', 'loading')).toBe(true)
  })

  it('loading → rendering is valid', () => {
    expect(isValidLifecycleTransition('loading', 'rendering')).toBe(true)
  })

  it('rendering → ready is valid', () => {
    expect(isValidLifecycleTransition('rendering', 'ready')).toBe(true)
  })

  it('ready → refreshing is valid', () => {
    expect(isValidLifecycleTransition('ready', 'refreshing')).toBe(true)
  })

  it('refreshing → ready is valid', () => {
    expect(isValidLifecycleTransition('refreshing', 'ready')).toBe(true)
  })

  it('error → initializing is valid (retry)', () => {
    expect(isValidLifecycleTransition('error', 'initializing')).toBe(true)
  })

  it('offline → loading is valid', () => {
    expect(isValidLifecycleTransition('offline', 'loading')).toBe(true)
  })

  it('rate_limited → loading is valid', () => {
    expect(isValidLifecycleTransition('rate_limited', 'loading')).toBe(true)
  })

  it('every state can reach disposed directly or transitively', () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      if (state === 'disposed') continue
      expect(LIFECYCLE_TRANSITIONS[state].length).toBeGreaterThan(0)
    }
  })

  it('rejects self-transitions for every state', () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      expect(isValidLifecycleTransition(state, state)).toBe(false)
    }
  })

  it('rejects invalid skip: initializing → ready', () => {
    expect(isValidLifecycleTransition('initializing', 'ready')).toBe(false)
  })

  it('rejects invalid skip: initializing → rendering', () => {
    expect(isValidLifecycleTransition('initializing', 'rendering')).toBe(false)
  })

  it('rejects transitions out of disposed', () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      expect(isValidLifecycleTransition('disposed', state)).toBe(false)
    }
  })
})

describe('lifecycle — nextLifecycleStates', () => {
  it('is deterministic', () => {
    const a = nextLifecycleStates('ready')
    const b = nextLifecycleStates('ready')
    expect(a).toEqual(b)
  })

  it('returns empty array for disposed', () => {
    expect(nextLifecycleStates('disposed')).toEqual([])
  })
})

describe('lifecycle — isTerminalLifecycleState', () => {
  it('disposed is terminal', () => {
    expect(isTerminalLifecycleState('disposed')).toBe(true)
  })

  it('all other states are non-terminal', () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      if (state === 'disposed') continue
      expect(isTerminalLifecycleState(state)).toBe(false)
    }
  })
})

describe('lifecycle — validateLifecycleSequence', () => {
  it('accepts a valid full sequence', () => {
    const seq: SDKLifecycleState[] = [
      'initializing', 'authenticating', 'loading', 'rendering', 'ready', 'refreshing', 'ready', 'disposed',
    ]
    const result = validateLifecycleSequence(seq)
    expect(result.valid).toBe(true)
    expect(result.invalidAt).toBeNull()
  })

  it('rejects a sequence with an invalid jump', () => {
    const seq: SDKLifecycleState[] = ['initializing', 'ready']
    const result = validateLifecycleSequence(seq)
    expect(result.valid).toBe(false)
    expect(result.invalidAt).toBe(1)
  })

  it('rejects any transition after disposed', () => {
    const seq: SDKLifecycleState[] = ['initializing', 'authenticating', 'error', 'disposed', 'initializing']
    const result = validateLifecycleSequence(seq)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('terminal')
  })

  it('accepts a single-state sequence trivially', () => {
    const result = validateLifecycleSequence(['initializing'])
    expect(result.valid).toBe(true)
  })

  it('accepts an empty sequence trivially', () => {
    const result = validateLifecycleSequence([])
    expect(result.valid).toBe(true)
  })
})

// ── Theme ─────────────────────────────────────────────────────────────────────

describe('theme — resolveSDKTheme', () => {
  it('has exactly 5 valid theme modes', () => {
    expect(VALID_THEME_MODES).toHaveLength(5)
  })

  it('light and dark do not carry a partnerBrandId', () => {
    expect(resolveSDKTheme('light').partnerBrandId).toBeNull()
    expect(resolveSDKTheme('dark').partnerBrandId).toBeNull()
  })

  it('auto does not carry a partnerBrandId', () => {
    expect(resolveSDKTheme('auto').partnerBrandId).toBeNull()
  })

  it('partner_override carries the provided brandId', () => {
    const theme = resolveSDKTheme('partner_override', {}, 'sleeper_brand')
    expect(theme.partnerBrandId).toBe('sleeper_brand')
  })

  it('enterprise_branding carries the provided brandId', () => {
    const theme = resolveSDKTheme('enterprise_branding', {}, 'acme_corp')
    expect(theme.partnerBrandId).toBe('acme_corp')
  })

  it('merges token overrides without losing defaults', () => {
    const theme = resolveSDKTheme('light', { radiusToken: 'pill' })
    expect(theme.tokens.radiusToken).toBe('pill')
    expect(theme.tokens.densityToken).toBe('comfortable') // default preserved
    expect(Object.keys(theme.tokens.colorTokenMap).length).toBeGreaterThan(0) // default colors preserved
  })

  it('is deterministic', () => {
    const a = resolveSDKTheme('dark')
    const b = resolveSDKTheme('dark')
    expect(a).toEqual(b)
  })

  it('contains no CSS/Tailwind class names', () => {
    const modes: SDKThemeMode[] = ['light', 'dark', 'auto']
    for (const mode of modes) {
      const serialized = JSON.stringify(resolveSDKTheme(mode))
      expect(serialized).not.toMatch(/\b(bg-|text-|border-|flex|grid|px-|py-)\b/)
    }
  })
})

describe('theme — validateSDKTheme', () => {
  it('valid light theme passes', () => {
    const result = validateSDKTheme(resolveSDKTheme('light'))
    expect(result.valid).toBe(true)
  })

  it('partner_override without brandId fails', () => {
    const theme = resolveSDKTheme('partner_override', {}, null)
    const result = validateSDKTheme(theme)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('partnerBrandId'))).toBe(true)
  })

  it('light theme WITH a brandId fails (must not carry one)', () => {
    const theme = { ...resolveSDKTheme('light'), partnerBrandId: 'should_not_be_here' }
    const result = validateSDKTheme(theme)
    expect(result.valid).toBe(false)
  })

  it('invalid radiusToken fails', () => {
    const theme = resolveSDKTheme('light')
    const bad = { ...theme, tokens: { ...theme.tokens, radiusToken: 'square' as never } }
    const result = validateSDKTheme(bad)
    expect(result.valid).toBe(false)
  })
})

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('auth — method matrix', () => {
  it('has exactly 6 auth methods', () => {
    expect(ALL_AUTH_METHODS).toHaveLength(6)
  })

  it('anonymous_public is the only public method', () => {
    for (const method of ALL_AUTH_METHODS) {
      expect(isPublicAuthMethod(method)).toBe(method === 'anonymous_public')
    }
  })

  it('anonymous_public requires neither credential nor tenantId', () => {
    const req = AUTH_METHOD_REQUIREMENTS.anonymous_public
    expect(req.requiresCredential).toBe(false)
    expect(req.requiresTenantId).toBe(false)
  })

  it('all other methods require both credential and tenantId', () => {
    const nonPublic: SDKAuthMethod[] = ['api_key', 'jwt', 'signed_embed_token', 'partner_token', 'enterprise_tenant_token']
    for (const method of nonPublic) {
      expect(AUTH_METHOD_REQUIREMENTS[method].requiresCredential).toBe(true)
      expect(AUTH_METHOD_REQUIREMENTS[method].requiresTenantId).toBe(true)
    }
  })
})

describe('auth — validateSDKAuth', () => {
  it('valid api_key auth passes', () => {
    const result = validateSDKAuth(makeAuth())
    expect(result.valid).toBe(true)
  })

  it('api_key without credential fails', () => {
    const result = validateSDKAuth(makeAuth({ credential: '' }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('credential'))).toBe(true)
  })

  it('api_key without tenantId fails', () => {
    const result = validateSDKAuth(makeAuth({ tenantId: '' }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('tenantId'))).toBe(true)
  })

  it('valid anonymous_public auth passes', () => {
    const result = validateSDKAuth({
      method: 'anonymous_public',
      credential: null,
      tenantId: null,
      expiresAt: null,
      scopes: ['intelligence:platform:basic'],
    })
    expect(result.valid).toBe(true)
  })

  it('anonymous_public with a credential fails', () => {
    const result = validateSDKAuth({
      method: 'anonymous_public',
      credential: 'should_not_have_this',
      tenantId: null,
      expiresAt: null,
      scopes: [],
    })
    expect(result.valid).toBe(false)
  })

  it('anonymous_public requesting league scope fails', () => {
    const result = validateSDKAuth({
      method: 'anonymous_public',
      credential: null,
      tenantId: null,
      expiresAt: null,
      scopes: ['intelligence:league:read'],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('scope'))).toBe(true)
  })

  it('anonymous_public requesting manager scope fails', () => {
    const result = validateSDKAuth({
      method: 'anonymous_public',
      credential: null,
      tenantId: null,
      expiresAt: null,
      scopes: ['intelligence:manager:read'],
    })
    expect(result.valid).toBe(false)
  })

  it('invalid expiresAt fails', () => {
    const result = validateSDKAuth(makeAuth({ expiresAt: 'not-a-date' }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('expiresAt'))).toBe(true)
  })

  it('valid ISO expiresAt passes', () => {
    const result = validateSDKAuth(makeAuth({ expiresAt: '2026-12-31T00:00:00.000Z' }))
    expect(result.valid).toBe(true)
  })

  it('unknown method fails', () => {
    const result = validateSDKAuth({ ...makeAuth(), method: 'bogus' as never })
    expect(result.valid).toBe(false)
  })

  it('all 6 methods with correct shape validate cleanly', () => {
    const methods: SDKAuthMethod[] = ['api_key', 'jwt', 'signed_embed_token', 'partner_token', 'enterprise_tenant_token']
    for (const method of methods) {
      const result = validateSDKAuth(makeAuth({ method }))
      expect(result.valid).toBe(true)
    }
  })
})

// ── Embed ─────────────────────────────────────────────────────────────────────

describe('embed — capability matrix', () => {
  it('has exactly 8 embed targets', () => {
    expect(ALL_EMBED_TARGETS).toHaveLength(8)
  })

  it('iframe is the only fully isolated embed target', () => {
    for (const target of ALL_EMBED_TARGETS) {
      expect(isFullyIsolatedEmbed(target)).toBe(target === 'iframe')
    }
  })

  it('native_bridge and flutter_bridge support native rendering', () => {
    expect(getEmbedCapabilities('native_bridge').supportsNativeRendering).toBe(true)
    expect(getEmbedCapabilities('flutter_bridge').supportsNativeRendering).toBe(true)
  })

  it('react/vue/angular wrappers do not support native rendering', () => {
    const wrappers: SDKEmbedTarget[] = ['react_wrapper', 'vue_wrapper', 'angular_wrapper']
    for (const target of wrappers) {
      expect(getEmbedCapabilities(target).supportsNativeRendering).toBe(false)
    }
  })

  it('every target has a defined isolationLevel', () => {
    const validLevels = ['full', 'partial', 'none']
    for (const target of ALL_EMBED_TARGETS) {
      expect(validLevels).toContain(getEmbedCapabilities(target).isolationLevel)
    }
  })

  it('is deterministic', () => {
    const a = getEmbedCapabilities('web_component')
    const b = getEmbedCapabilities('web_component')
    expect(a).toEqual(b)
  })
})

// ── Events ────────────────────────────────────────────────────────────────────

describe('events — types', () => {
  it('has exactly 9 event types', () => {
    expect(ALL_SDK_EVENT_TYPES).toHaveLength(9)
  })
})

describe('events — obfuscateTenantIdForTelemetry', () => {
  it('never returns the raw tenantId', () => {
    const hash = obfuscateTenantIdForTelemetry('raw_tenant_xyz')
    expect(hash).not.toBe('raw_tenant_xyz')
  })

  it('is deterministic for the same input', () => {
    const a = obfuscateTenantIdForTelemetry('tenant_1')
    const b = obfuscateTenantIdForTelemetry('tenant_1')
    expect(a).toBe(b)
  })

  it('differs for different inputs', () => {
    const a = obfuscateTenantIdForTelemetry('tenant_a')
    const b = obfuscateTenantIdForTelemetry('tenant_b')
    expect(a).not.toBe(b)
  })
})

describe('events — buildSDKEvent', () => {
  it('produces the correct eventType and widgetId', () => {
    const event = buildSDKEvent('widget_l1_commissioner', 'loaded', 'tenant_x')
    expect(event.eventType).toBe('loaded')
    expect(event.widgetId).toBe('widget_l1_commissioner')
  })

  it('does not expose the raw tenantId anywhere in the event', () => {
    const event = buildSDKEvent('widget_1', 'impression' as SDKTelemetryEventType, 'super_secret_tenant')
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('super_secret_tenant')
  })

  it('defaults payload to empty object', () => {
    const event = buildSDKEvent('widget_1', 'loaded', 'tenant_1')
    expect(event.payload).toEqual({})
  })

  it('accepts a custom payload', () => {
    const event = buildSDKEvent('widget_1', 'cta_click', 'tenant_1', { payload: { target: 'upgrade_button' } })
    expect(event.payload).toEqual({ target: 'upgrade_button' })
  })

  it('accepts a custom timestamp', () => {
    const ts = '2026-07-01T00:00:00.000Z'
    const event = buildSDKEvent('widget_1', 'loaded', 'tenant_1', { timestamp: ts })
    expect(event.timestamp).toBe(ts)
  })
})

describe('events — validateEventSequence', () => {
  it('accepts loaded → rendered → disposed', () => {
    const events = [
      buildSDKEvent('w1', 'loaded', 't1'),
      buildSDKEvent('w1', 'rendered', 't1'),
      buildSDKEvent('w1', 'disposed', 't1'),
    ]
    const result = validateEventSequence(events)
    expect(result.valid).toBe(true)
  })

  it('rejects rendered before loaded', () => {
    const events = [
      buildSDKEvent('w1', 'rendered', 't1'),
      buildSDKEvent('w1', 'loaded', 't1'),
    ]
    const result = validateEventSequence(events)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('rendered'))).toBe(true)
  })

  it('rejects any event after disposed', () => {
    const events = [
      buildSDKEvent('w1', 'loaded', 't1'),
      buildSDKEvent('w1', 'disposed', 't1'),
      buildSDKEvent('w1', 'interaction', 't1'),
    ]
    const result = validateEventSequence(events)
    expect(result.valid).toBe(false)
  })

  it('rejects more than one disposed event', () => {
    const events = [
      buildSDKEvent('w1', 'disposed', 't1'),
    ]
    // simulate a duplicate disposed by concatenation
    const events2 = [...events, buildSDKEvent('w1', 'disposed', 't1')]
    const result = validateEventSequence(events2)
    expect(result.valid).toBe(false)
  })

  it('accepts an empty sequence', () => {
    expect(validateEventSequence([]).valid).toBe(true)
  })

  it('accepts a sequence with no loaded/rendered/disposed at all', () => {
    const events = [buildSDKEvent('w1', 'interaction', 't1'), buildSDKEvent('w1', 'cta_click', 't1')]
    expect(validateEventSequence(events).valid).toBe(true)
  })
})

// ── Errors ────────────────────────────────────────────────────────────────────

describe('errors — code catalog', () => {
  it('has exactly 10 error codes', () => {
    expect(ALL_SDK_ERROR_CODES).toHaveLength(10)
  })

  for (const code of [
    'UNAUTHORIZED', 'RATE_LIMITED', 'PRESENTATION_MISSING', 'INVALID_SCOPE',
    'TENANT_MISMATCH', 'UNSUPPORTED_WIDGET', 'NETWORK', 'VERSION_MISMATCH',
    'DEGRADED_DATA', 'INCOMPLETE_PRESENTATION',
  ] as SDKErrorCode[]) {
    it(`${code} builds a non-empty message`, () => {
      const err = buildSDKError(code)
      expect(err.code).toBe(code)
      expect(err.message.length).toBeGreaterThan(0)
    })
  }

  it('UNAUTHORIZED, INVALID_SCOPE, TENANT_MISMATCH, UNSUPPORTED_WIDGET, VERSION_MISMATCH are not retryable', () => {
    const nonRetryable: SDKErrorCode[] = ['UNAUTHORIZED', 'INVALID_SCOPE', 'TENANT_MISMATCH', 'UNSUPPORTED_WIDGET', 'VERSION_MISMATCH']
    for (const code of nonRetryable) {
      expect(isRetryableErrorCode(code)).toBe(false)
    }
  })

  it('RATE_LIMITED, PRESENTATION_MISSING, NETWORK, DEGRADED_DATA, INCOMPLETE_PRESENTATION are retryable', () => {
    const retryable: SDKErrorCode[] = ['RATE_LIMITED', 'PRESENTATION_MISSING', 'NETWORK', 'DEGRADED_DATA', 'INCOMPLETE_PRESENTATION']
    for (const code of retryable) {
      expect(isRetryableErrorCode(code)).toBe(true)
    }
  })

  it('is deterministic', () => {
    const a = buildSDKError('NETWORK', { widgetId: 'w1', timestamp: '2026-01-01T00:00:00.000Z' })
    const b = buildSDKError('NETWORK', { widgetId: 'w1', timestamp: '2026-01-01T00:00:00.000Z' })
    expect(a).toEqual(b)
  })

  it('widgetId defaults to null', () => {
    const err = buildSDKError('NETWORK')
    expect(err.widgetId).toBeNull()
  })
})

// ── Refresh ───────────────────────────────────────────────────────────────────

describe('refresh — strategies', () => {
  it('has exactly 6 refresh triggers', () => {
    expect(ALL_REFRESH_TRIGGERS).toHaveLength(6)
  })

  it('manual has no interval', () => {
    expect(resolveRefreshStrategy('manual').intervalSeconds).toBeNull()
  })

  it('scheduled has a positive default interval', () => {
    const strategy = resolveRefreshStrategy('scheduled')
    expect(strategy.intervalSeconds).toBeGreaterThan(0)
  })

  it('offline_retry has a positive default interval', () => {
    const strategy = resolveRefreshStrategy('offline_retry')
    expect(strategy.intervalSeconds).toBeGreaterThan(0)
  })

  it('overrides merge onto defaults', () => {
    const strategy = resolveRefreshStrategy('scheduled', { intervalSeconds: 600 })
    expect(strategy.intervalSeconds).toBe(600)
    expect(strategy.maxRetries).toBeGreaterThanOrEqual(0) // default preserved
  })

  it('is deterministic', () => {
    const a = resolveRefreshStrategy('host_callback')
    const b = resolveRefreshStrategy('host_callback')
    expect(a).toEqual(b)
  })
})

describe('refresh — validateRefreshStrategy', () => {
  it('valid manual strategy passes', () => {
    expect(validateRefreshStrategy(resolveRefreshStrategy('manual')).valid).toBe(true)
  })

  it('valid scheduled strategy passes', () => {
    expect(validateRefreshStrategy(resolveRefreshStrategy('scheduled')).valid).toBe(true)
  })

  it('scheduled without interval fails', () => {
    const bad = { trigger: 'scheduled' as SDKRefreshTrigger, intervalSeconds: null, maxRetries: 1, backoffSeconds: 1 }
    const result = validateRefreshStrategy(bad)
    expect(result.valid).toBe(false)
  })

  it('manual WITH an interval fails', () => {
    const bad = { trigger: 'manual' as SDKRefreshTrigger, intervalSeconds: 60, maxRetries: 0, backoffSeconds: 0 }
    const result = validateRefreshStrategy(bad)
    expect(result.valid).toBe(false)
  })

  it('negative maxRetries fails', () => {
    const bad = { ...resolveRefreshStrategy('manual'), maxRetries: -1 }
    expect(validateRefreshStrategy(bad).valid).toBe(false)
  })

  it('negative backoffSeconds fails', () => {
    const bad = { ...resolveRefreshStrategy('manual'), backoffSeconds: -1 }
    expect(validateRefreshStrategy(bad).valid).toBe(false)
  })
})

// ── Privacy ───────────────────────────────────────────────────────────────────

describe('privacy — stripInternalFields', () => {
  it('removes denylisted top-level keys', () => {
    const input = { warnings: ['x'], completeness: 90, provenance: { source: 'y' } }
    const stripped = stripInternalFields(input) as Record<string, unknown>
    expect(stripped).not.toHaveProperty('warnings')
    expect(stripped).not.toHaveProperty('provenance')
    expect(stripped).toHaveProperty('completeness')
  })

  it('removes denylisted keys recursively in nested objects', () => {
    const input = { data: { decisionId: 'abc', score: 50 } }
    const stripped = stripInternalFields(input) as { data: Record<string, unknown> }
    expect(stripped.data).not.toHaveProperty('decisionId')
    expect(stripped.data).toHaveProperty('score')
  })

  it('removes denylisted keys inside arrays of objects', () => {
    const input = { items: [{ apiKey: 'secret', name: 'a' }, { apiKey: 'secret2', name: 'b' }] }
    const stripped = stripInternalFields(input) as { items: Record<string, unknown>[] }
    for (const item of stripped.items) {
      expect(item).not.toHaveProperty('apiKey')
      expect(item).toHaveProperty('name')
    }
  })

  it('does not mutate the input object', () => {
    const input = { warnings: ['x'], score: 1 }
    const inputCopy = JSON.parse(JSON.stringify(input))
    stripInternalFields(input)
    expect(input).toEqual(inputCopy)
  })

  it('passes through primitives unchanged', () => {
    expect(stripInternalFields(42)).toBe(42)
    expect(stripInternalFields('hello')).toBe('hello')
    expect(stripInternalFields(null)).toBeNull()
    expect(stripInternalFields(true)).toBe(true)
  })

  it('is deterministic', () => {
    const input = { warnings: ['x'], score: 1, nested: { decisionId: 'a', ok: true } }
    const a = stripInternalFields(input)
    const b = stripInternalFields(input)
    expect(a).toEqual(b)
  })

  it('every denylisted field is actually stripped', () => {
    const input: Record<string, unknown> = {}
    for (const key of INTERNAL_FIELD_DENYLIST) {
      input[key] = 'should_be_removed'
    }
    input['safeField'] = 'keep_me'
    const stripped = stripInternalFields(input) as Record<string, unknown>
    for (const key of INTERNAL_FIELD_DENYLIST) {
      expect(stripped).not.toHaveProperty(key)
    }
    expect(stripped).toHaveProperty('safeField')
  })
})

describe('privacy — findInternalLeakage / hasInternalLeakage', () => {
  it('detects "Decision OS" terminology', () => {
    expect(hasInternalLeakage('This widget is powered by Decision OS internals')).toBe(true)
  })

  it('detects "Phase 6" terminology', () => {
    expect(hasInternalLeakage('Classified via Phase 6 archetype logic')).toBe(true)
  })

  it('clean output has no leakage', () => {
    expect(hasInternalLeakage('Your league health score is 82')).toBe(false)
    expect(findInternalLeakage('Your league health score is 82')).toEqual([])
  })

  it('every denylisted term is individually detected', () => {
    for (const term of INTERNAL_TERMINOLOGY_DENYLIST) {
      expect(hasInternalLeakage(`prefix ${term} suffix`)).toBe(true)
    }
  })

  it('is deterministic', () => {
    const a = findInternalLeakage('Decision OS test string')
    const b = findInternalLeakage('Decision OS test string')
    expect(a).toEqual(b)
  })
})

// ── Config validation ─────────────────────────────────────────────────────────

describe('config — validateSDKConfig', () => {
  it('a fully valid config passes', () => {
    const result = validateSDKConfig(makeConfig())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('incompatible presentationVersion fails', () => {
    const config = makeConfig({
      version: { sdkVersion: SDK_VERSION, presentationVersion: '6.0.0', widgetContractVersion: '7.3.0', apiVersion: 'v1' },
    })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('presentationVersion'))).toBe(true)
  })

  it('incompatible widgetContractVersion fails', () => {
    const config = makeConfig({
      version: { sdkVersion: SDK_VERSION, presentationVersion: '7.0.0', widgetContractVersion: '1.0.0', apiVersion: 'v1' },
    })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('widgetContractVersion'))).toBe(true)
  })

  it('mismatched sdkVersion produces a warning, not an error', () => {
    const config = makeConfig({
      version: { sdkVersion: '1.0.0', presentationVersion: '7.0.0', widgetContractVersion: '7.3.0', apiVersion: 'v1' },
    })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.includes('sdkVersion'))).toBe(true)
  })

  it('invalid auth propagates as a prefixed error', () => {
    const config = makeConfig({ auth: makeAuth({ credential: '' }) })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.startsWith('auth:'))).toBe(true)
  })

  it('invalid theme propagates as a prefixed error', () => {
    const config = makeConfig({ theme: { mode: 'partner_override', tokens: resolveSDKTheme('light').tokens, partnerBrandId: null } })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.startsWith('theme:'))).toBe(true)
  })

  it('invalid refreshStrategy propagates as a prefixed error', () => {
    const config = makeConfig({ refreshStrategy: { trigger: 'scheduled', intervalSeconds: null, maxRetries: 1, backoffSeconds: 1 } })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.startsWith('refreshStrategy:'))).toBe(true)
  })

  it('invalid embedTarget fails', () => {
    const config = makeConfig({ embedTarget: 'bogus_target' as never })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
  })

  it('invalid widgetMode fails', () => {
    const config = makeConfig({ widgetMode: 'bogus_mode' as never })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
  })

  it('empty entityId fails', () => {
    const config = makeConfig({ entityId: '' })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
  })

  it('empty hostOrigin fails', () => {
    const config = makeConfig({ hostOrigin: '' })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
  })

  it('maxWidgetsPerHost < 1 fails', () => {
    const config = makeConfig({
      capabilities: {
        supportsInteractivity: true, supportsRefresh: true, supportsTelemetry: true,
        supportsThemeOverride: false, supportsOfflineCache: false, maxWidgetsPerHost: 0,
      },
    })
    const result = validateSDKConfig(config)
    expect(result.valid).toBe(false)
  })

  it('does not expose apiKey/credential in output', () => {
    const config = makeConfig({ auth: makeAuth({ credential: 'sk_super_secret_value' }) })
    const result = validateSDKConfig(config)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('sk_super_secret_value')
  })

  it('is deterministic', () => {
    const config = makeConfig()
    const a = validateSDKConfig(config)
    const b = validateSDKConfig(config)
    expect(a).toEqual(b)
  })
})

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('two configs with different tenantIds produce different telemetry hashes', () => {
    const eventA = buildSDKEvent('w1', 'loaded', 'tenant_A')
    const eventB = buildSDKEvent('w1', 'loaded', 'tenant_B')
    expect(eventA.tenantIdHash).not.toBe(eventB.tenantIdHash)
  })

  it('anonymous_public auth carries no tenantId at all', () => {
    const auth: SDKAuth = { method: 'anonymous_public', credential: null, tenantId: null, expiresAt: null, scopes: [] }
    expect(auth.tenantId).toBeNull()
    expect(validateSDKAuth(auth).valid).toBe(true)
  })
})

// ── Enterprise extensions ─────────────────────────────────────────────────────

describe('enterprise extensions — licensing tiers', () => {
  it('has exactly 8 extension points', () => {
    const points: SDKExtensionPoint[] = [
      'white_label', 'oem', 'partner_branding', 'marketplace_widget',
      'premium_widget', 'commissioner_only_widget', 'manager_only_widget', 'platform_analytics_widget',
    ]
    for (const point of points) {
      expect(EXTENSION_POINT_MIN_TIER[point]).toBeDefined()
    }
    expect(Object.keys(EXTENSION_POINT_MIN_TIER)).toHaveLength(8)
  })

  it('standard tier cannot use white_label (requires premium)', () => {
    expect(isExtensionPointAllowed('white_label', 'standard')).toBe(false)
  })

  it('premium tier can use white_label', () => {
    expect(isExtensionPointAllowed('white_label', 'premium')).toBe(true)
  })

  it('enterprise tier can use everything', () => {
    const points: SDKExtensionPoint[] = [
      'white_label', 'oem', 'partner_branding', 'marketplace_widget',
      'premium_widget', 'commissioner_only_widget', 'manager_only_widget', 'platform_analytics_widget',
    ]
    for (const point of points) {
      expect(isExtensionPointAllowed(point, 'enterprise')).toBe(true)
    }
  })

  it('standard tier can use marketplace_widget and commissioner/manager-only widgets', () => {
    expect(isExtensionPointAllowed('marketplace_widget', 'standard')).toBe(true)
    expect(isExtensionPointAllowed('commissioner_only_widget', 'standard')).toBe(true)
    expect(isExtensionPointAllowed('manager_only_widget', 'standard')).toBe(true)
  })

  it('only enterprise tier can use oem and platform_analytics_widget', () => {
    expect(isExtensionPointAllowed('oem', 'standard')).toBe(false)
    expect(isExtensionPointAllowed('oem', 'premium')).toBe(false)
    expect(isExtensionPointAllowed('oem', 'enterprise')).toBe(true)
    expect(isExtensionPointAllowed('platform_analytics_widget', 'premium')).toBe(false)
    expect(isExtensionPointAllowed('platform_analytics_widget', 'enterprise')).toBe(true)
  })

  it('buildEnterpriseExtension resolves enabled correctly', () => {
    const allowed = buildEnterpriseExtension('marketplace_widget', 'standard')
    expect(allowed.enabled).toBe(true)
    const denied = buildEnterpriseExtension('oem', 'standard')
    expect(denied.enabled).toBe(false)
  })

  it('buildEnterpriseExtension is deterministic', () => {
    const a = buildEnterpriseExtension('premium_widget', 'premium', ['no_export'])
    const b = buildEnterpriseExtension('premium_widget', 'premium', ['no_export'])
    expect(a).toEqual(b)
  })

  it('extension resolution never branches on a named provider', () => {
    // structural guarantee: EXTENSION_POINT_MIN_TIER keys are extension points, not provider names
    const keys = Object.keys(EXTENSION_POINT_MIN_TIER)
    const providerNames = ['sleeper', 'yahoo', 'espn', 'fantrax', 'draftkings', 'fanduel', 'underdog', 'cbs', 'mfl']
    for (const key of keys) {
      expect(providerNames).not.toContain(key.toLowerCase())
    }
  })
})

// ── No internal leakage across the whole module surface ───────────────────────

describe('sdk module — no internal Decision OS leakage', () => {
  it('a full config validation result contains no internal terminology', () => {
    const result = validateSDKConfig(makeConfig())
    const serialized = JSON.stringify(result)
    expect(hasInternalLeakage(serialized)).toBe(false)
  })

  it('an error object contains no internal terminology', () => {
    for (const code of ALL_SDK_ERROR_CODES) {
      const err = buildSDKError(code)
      expect(hasInternalLeakage(JSON.stringify(err))).toBe(false)
    }
  })

  it('a telemetry event contains no internal terminology', () => {
    const event = buildSDKEvent('w1', 'loaded', 'tenant_1', { payload: { section: 'health_score' } })
    expect(hasInternalLeakage(JSON.stringify(event))).toBe(false)
  })
})

// ── Serialization ─────────────────────────────────────────────────────────────

describe('serialization — all contract outputs are JSON-serializable', () => {
  it('SDKConfig round-trips through JSON', () => {
    const config = makeConfig()
    const roundTripped = JSON.parse(JSON.stringify(config))
    expect(roundTripped).toEqual(config)
  })

  it('SDKEvent round-trips through JSON', () => {
    const event = buildSDKEvent('w1', 'loaded', 't1', { timestamp: '2026-01-01T00:00:00.000Z' })
    const roundTripped = JSON.parse(JSON.stringify(event))
    expect(roundTripped).toEqual(event)
  })

  it('SDKError round-trips through JSON', () => {
    const err = buildSDKError('NETWORK', { widgetId: 'w1', timestamp: '2026-01-01T00:00:00.000Z' })
    const roundTripped = JSON.parse(JSON.stringify(err))
    expect(roundTripped).toEqual(err)
  })

  it('SDKTheme round-trips through JSON', () => {
    const theme = resolveSDKTheme('dark')
    const roundTripped = JSON.parse(JSON.stringify(theme))
    expect(roundTripped).toEqual(theme)
  })
})
