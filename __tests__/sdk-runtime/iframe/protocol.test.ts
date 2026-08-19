import { describe, expect, it } from 'vitest'
import {
  IFRAME_PROTOCOL_VERSION,
  PARENT_TO_CHILD_MESSAGE_TYPES,
  CHILD_TO_PARENT_MESSAGE_TYPES,
  isValidNonceFormat,
  buildInitPayloadFromSdkConfig,
  buildParentToChildMessage,
  buildChildToParentMessage,
  validateParentToChildMessage,
  validateChildToParentMessage,
} from '../../../sdk-runtime/iframe/src/index'
import { resolveSDKTheme, resolveRefreshStrategy, SDK_VERSION } from '../../../lib/decision-os/sdk/index'
import type { SDKConfig } from '../../../lib/decision-os/sdk/types'
import type {
  ChildToParentMessageType,
  ParentToChildMessageType,
} from '../../../sdk-runtime/iframe/src/index'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SECRET = 'tok_super_secret_embed_token_leak_test'

function makeSdkConfig(overrides: Partial<SDKConfig> = {}): SDKConfig {
  return {
    version: { sdkVersion: SDK_VERSION, presentationVersion: '7.0.0', widgetContractVersion: '7.3.0', apiVersion: 'v1' },
    auth: { method: 'signed_embed_token', credential: SECRET, tenantId: 'tenant_001', expiresAt: null, scopes: ['intelligence:league:read'] },
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

const NONCE = 'n0nce_abcdef123456'
const WIDGET_ID = 'widget_league_001_commissioner'

// ── Version ───────────────────────────────────────────────────────────────────

describe('IFRAME_PROTOCOL_VERSION', () => {
  it('is 1.0.0', () => {
    expect(IFRAME_PROTOCOL_VERSION).toBe('1.0.0')
  })
})

// ── Nonce format ──────────────────────────────────────────────────────────────

describe('isValidNonceFormat', () => {
  it('accepts a well-formed nonce', () => {
    expect(isValidNonceFormat('n0nce_abcdef123456')).toBe(true)
  })
  it('rejects an empty string', () => {
    expect(isValidNonceFormat('')).toBe(false)
  })
  it('rejects a too-short nonce', () => {
    expect(isValidNonceFormat('abc123')).toBe(false)
  })
  it('rejects a nonce with disallowed characters', () => {
    expect(isValidNonceFormat('nonce with spaces!!')).toBe(false)
  })
})

// ── buildInitPayloadFromSdkConfig — no credential leakage ─────────────────────

describe('buildInitPayloadFromSdkConfig', () => {
  it('extracts only the safe subset of fields', () => {
    const payload = buildInitPayloadFromSdkConfig(makeSdkConfig())
    expect(payload).toEqual({
      widgetMode: 'commissioner',
      entityId: 'league_001',
      entityType: 'league',
      theme: expect.any(Object),
      locale: expect.any(Object),
      presentationVersion: '7.0.0',
    })
  })

  it('never includes the credential', () => {
    const payload = buildInitPayloadFromSdkConfig(makeSdkConfig())
    expect(JSON.stringify(payload)).not.toContain(SECRET)
  })

  it('has no "auth" or "credential" key at all (structural, not just value absence)', () => {
    const payload = buildInitPayloadFromSdkConfig(makeSdkConfig()) as Record<string, unknown>
    expect(payload).not.toHaveProperty('auth')
    expect(payload).not.toHaveProperty('credential')
    expect(payload).not.toHaveProperty('tenantId')
  })

  it('is deterministic', () => {
    const config = makeSdkConfig()
    expect(buildInitPayloadFromSdkConfig(config)).toEqual(buildInitPayloadFromSdkConfig(config))
  })
})

// ── Message builders ───────────────────────────────────────────────────────────

describe('buildParentToChildMessage', () => {
  it('produces the correct envelope shape', () => {
    const message = buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {}, { timestamp: '2026-07-01T00:00:00.000Z' })
    expect(message).toEqual({
      direction: 'parent_to_child',
      type: 'refresh_request',
      protocolVersion: '1.0.0',
      nonce: NONCE,
      widgetId: WIDGET_ID,
      timestamp: '2026-07-01T00:00:00.000Z',
      payload: {},
    })
  })

  it('builds a valid message for every parent-to-child type', () => {
    const payloads: Record<ParentToChildMessageType, unknown> = {
      init: buildInitPayloadFromSdkConfig(makeSdkConfig()),
      refresh_request: {},
      visibility_change: { visible: true },
      theme_update: { theme: resolveSDKTheme('dark') },
      dispose: {},
    }
    for (const type of PARENT_TO_CHILD_MESSAGE_TYPES) {
      const message = buildParentToChildMessage(type, WIDGET_ID, NONCE, payloads[type] as never)
      expect(message.type).toBe(type)
      expect(message.direction).toBe('parent_to_child')
      expect(validateParentToChildMessage(message).valid).toBe(true)
    }
  })
})

describe('buildChildToParentMessage', () => {
  it('produces the correct envelope shape', () => {
    const message = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' }, { timestamp: '2026-07-01T00:00:00.000Z' })
    expect(message).toEqual({
      direction: 'child_to_parent',
      type: 'ready',
      protocolVersion: '1.0.0',
      nonce: NONCE,
      widgetId: WIDGET_ID,
      timestamp: '2026-07-01T00:00:00.000Z',
      payload: { sdkVersion: '7.4.0' },
    })
  })

  it('builds a valid message for every child-to-parent type', () => {
    const payloads: Record<ChildToParentMessageType, unknown> = {
      ready: { sdkVersion: '7.4.0' },
      lifecycle_change: { state: 'ready' },
      degraded: { completeness: 60 },
      error: { code: 'NETWORK', message: 'A network error occurred.', retryable: true },
      interaction: { target: 'recommendations' },
      resize: { heightPx: 320 },
    }
    for (const type of CHILD_TO_PARENT_MESSAGE_TYPES) {
      const message = buildChildToParentMessage(type, WIDGET_ID, NONCE, payloads[type] as never)
      expect(message.type).toBe(type)
      expect(message.direction).toBe('child_to_parent')
      expect(validateChildToParentMessage(message).valid).toBe(true)
    }
  })
})

// ── validateParentToChildMessage — invalid cases ──────────────────────────────

describe('validateParentToChildMessage — invalid envelopes', () => {
  const valid = buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {})

  it('rejects a non-object', () => {
    expect(validateParentToChildMessage('not an object').valid).toBe(false)
    expect(validateParentToChildMessage(null).valid).toBe(false)
    expect(validateParentToChildMessage(undefined).valid).toBe(false)
  })

  it('rejects the wrong direction', () => {
    const result = validateParentToChildMessage({ ...valid, direction: 'child_to_parent' })
    expect(result.valid).toBe(false)
  })

  it('rejects an unknown type', () => {
    const result = validateParentToChildMessage({ ...valid, type: 'bogus_type' })
    expect(result.valid).toBe(false)
  })

  it('rejects a child-to-parent type sent as parent_to_child (cross-direction type)', () => {
    const result = validateParentToChildMessage({ ...valid, type: 'ready' })
    expect(result.valid).toBe(false)
  })

  it('rejects a mismatched protocolVersion', () => {
    const result = validateParentToChildMessage({ ...valid, protocolVersion: '0.9.0' })
    expect(result.valid).toBe(false)
  })

  it('rejects a malformed nonce', () => {
    const result = validateParentToChildMessage({ ...valid, nonce: 'x' })
    expect(result.valid).toBe(false)
  })

  it('rejects an empty widgetId', () => {
    const result = validateParentToChildMessage({ ...valid, widgetId: '' })
    expect(result.valid).toBe(false)
  })

  it('rejects an invalid timestamp', () => {
    const result = validateParentToChildMessage({ ...valid, timestamp: 'not-a-date' })
    expect(result.valid).toBe(false)
  })

  it('rejects an init message missing required payload keys', () => {
    const result = validateParentToChildMessage(buildParentToChildMessage('init', WIDGET_ID, NONCE, {} as never))
    expect(result.valid).toBe(false)
  })

  it('rejects a visibility_change payload with a non-boolean visible field', () => {
    const result = validateParentToChildMessage(buildParentToChildMessage('visibility_change', WIDGET_ID, NONCE, { visible: 'yes' } as never))
    expect(result.valid).toBe(false)
  })
})

// ── validateChildToParentMessage — invalid cases ──────────────────────────────

describe('validateChildToParentMessage — invalid envelopes', () => {
  const valid = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' })

  it('rejects the wrong direction', () => {
    const result = validateChildToParentMessage({ ...valid, direction: 'parent_to_child' })
    expect(result.valid).toBe(false)
  })

  it('rejects a parent-to-child type sent as child_to_parent (cross-direction type)', () => {
    const result = validateChildToParentMessage({ ...valid, type: 'init' })
    expect(result.valid).toBe(false)
  })

  it('rejects an error payload missing required keys', () => {
    const result = validateChildToParentMessage(buildChildToParentMessage('error', WIDGET_ID, NONCE, {} as never))
    expect(result.valid).toBe(false)
  })

  it('rejects a degraded payload with a non-number completeness', () => {
    const result = validateChildToParentMessage(buildChildToParentMessage('degraded', WIDGET_ID, NONCE, { completeness: '60' } as never))
    expect(result.valid).toBe(false)
  })

  it('rejects a resize payload with a non-number heightPx', () => {
    const result = validateChildToParentMessage(buildChildToParentMessage('resize', WIDGET_ID, NONCE, { heightPx: 'tall' } as never))
    expect(result.valid).toBe(false)
  })
})

// ── Determinism ────────────────────────────────────────────────────────────────

describe('protocol determinism', () => {
  it('validateParentToChildMessage is deterministic', () => {
    const message = buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {})
    expect(validateParentToChildMessage(message)).toEqual(validateParentToChildMessage(message))
  })

  it('validateChildToParentMessage is deterministic', () => {
    const message = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' })
    expect(validateChildToParentMessage(message)).toEqual(validateChildToParentMessage(message))
  })
})

// ── No credential leakage across the whole protocol surface ──────────────────

describe('no credential leakage in built messages', () => {
  it('an init message built from an SDKConfig never contains the credential', () => {
    const payload = buildInitPayloadFromSdkConfig(makeSdkConfig())
    const message = buildParentToChildMessage('init', WIDGET_ID, NONCE, payload)
    expect(JSON.stringify(message)).not.toContain(SECRET)
  })

  it('an error message never contains a credential-shaped value', () => {
    const message = buildChildToParentMessage('error', WIDGET_ID, NONCE, {
      code: 'UNAUTHORIZED', message: 'The provided credentials are not authorized for this widget.', retryable: false,
    })
    expect(JSON.stringify(message)).not.toContain(SECRET)
  })
})
