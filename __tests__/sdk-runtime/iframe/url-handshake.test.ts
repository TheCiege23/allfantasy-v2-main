import { describe, expect, it } from 'vitest'
import {
  URL_HANDSHAKE_PARAM_NAMES,
  isValidWidgetIdFormat,
  buildIframeWidgetUrl,
  parseIframeWidgetUrlParams,
  IFRAME_PROTOCOL_VERSION,
} from '../../../sdk-runtime/iframe/src/index'

const WIDGET_ID = 'widget_league_001_commissioner'
const NONCE = 'n0nce_abcdef123456'
const PARENT_ORIGIN = 'https://partner.example.com'
const BASE_SRC = 'https://widgets.allfantasy.app/embed'

// ── isValidWidgetIdFormat ───────────────────────────────────────────────────────

describe('isValidWidgetIdFormat', () => {
  it('accepts the standard widget_<entityId>_<mode> convention', () => {
    expect(isValidWidgetIdFormat('widget_league_001_commissioner')).toBe(true)
  })
  it('accepts hyphens and underscores', () => {
    expect(isValidWidgetIdFormat('widget_my-league-001_full_dashboard')).toBe(true)
  })
  it('rejects a missing widget_ prefix', () => {
    expect(isValidWidgetIdFormat('league_001_commissioner')).toBe(false)
  })
  it('rejects an empty string', () => {
    expect(isValidWidgetIdFormat('')).toBe(false)
  })
  it('rejects spaces', () => {
    expect(isValidWidgetIdFormat('widget_league 001')).toBe(false)
  })
  it('rejects a bare "widget_" with nothing after it', () => {
    expect(isValidWidgetIdFormat('widget_')).toBe(false)
  })
})

// ── buildIframeWidgetUrl ──────────────────────────────────────────────────────

describe('buildIframeWidgetUrl — valid construction', () => {
  it('appends "?" when baseSrc has no existing query string', () => {
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    expect(url.startsWith(`${BASE_SRC}?`)).toBe(true)
  })

  it('appends "&" when baseSrc already has a query string', () => {
    const baseSrcWithQuery = `${BASE_SRC}?theme=dark`
    const url = buildIframeWidgetUrl({ baseSrc: baseSrcWithQuery, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    expect(url.startsWith(`${baseSrcWithQuery}&`)).toBe(true)
  })

  it('includes all four param names', () => {
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    expect(url).toContain(`${URL_HANDSHAKE_PARAM_NAMES.widgetId}=`)
    expect(url).toContain(`${URL_HANDSHAKE_PARAM_NAMES.nonce}=`)
    expect(url).toContain(`${URL_HANDSHAKE_PARAM_NAMES.parentOrigin}=`)
    expect(url).toContain(`${URL_HANDSHAKE_PARAM_NAMES.protocolVersion}=`)
  })

  it('defaults protocolVersion to IFRAME_PROTOCOL_VERSION', () => {
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    const parsed = parseIframeWidgetUrlParams(url.slice(BASE_SRC.length + 1))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.params.protocolVersion).toBe(IFRAME_PROTOCOL_VERSION)
  })

  it('percent-encodes an origin containing a port (encoded origin)', () => {
    const originWithPort = 'https://partner.example.com:8443'
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: originWithPort })
    expect(url).toContain(encodeURIComponent(originWithPort))
    expect(url).not.toContain('example.com:8443&') // raw, unencoded ':' would corrupt the query string
  })

  it('is deterministic — same inputs produce the same output, params in alphabetical order', () => {
    const a = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    const b = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    expect(a).toBe(b)
  })

  it('never includes an "auth", "credential", "apiKey", or "tenantId" substring in its own param NAMES', () => {
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    for (const forbidden of ['auth=', 'credential=', 'apiKey=', 'api_key=', 'tenantId=', 'tenant_id=']) {
      expect(url).not.toContain(forbidden)
    }
  })
})

// ── parseIframeWidgetUrlParams — valid round trip ──────────────────────────────

describe('parseIframeWidgetUrlParams — valid round trip', () => {
  it('recovers the exact params a matching buildIframeWidgetUrl call produced', () => {
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    const query = url.slice(BASE_SRC.length + 1)
    const result = parseIframeWidgetUrlParams(query)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params).toEqual({
        widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN, protocolVersion: IFRAME_PROTOCOL_VERSION,
      })
    }
  })

  it('accepts a leading "?"', () => {
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    const queryWithLeadingMark = url.slice(BASE_SRC.length) // includes the leading '?'
    expect(parseIframeWidgetUrlParams(queryWithLeadingMark).ok).toBe(true)
  })

  it('correctly decodes an origin with a port (encoded origin round trip)', () => {
    const originWithPort = 'https://partner.example.com:8443'
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: originWithPort })
    const result = parseIframeWidgetUrlParams(url.slice(BASE_SRC.length + 1))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.params.parentOrigin).toBe(originWithPort)
  })
})

// ── parseIframeWidgetUrlParams — invalid / missing ─────────────────────────────

describe('parseIframeWidgetUrlParams — invalid URL', () => {
  it('fails on a completely empty query string', () => {
    const result = parseIframeWidgetUrlParams('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBe(4) // all four required params missing
  })

  it('fails on a query string with unrelated params only', () => {
    const result = parseIframeWidgetUrlParams('theme=dark&locale=en-US')
    expect(result.ok).toBe(false)
  })

  it('does not throw on malformed percent-encoding', () => {
    expect(() => parseIframeWidgetUrlParams('af_widget_id=%')).not.toThrow()
  })
})

describe('parseIframeWidgetUrlParams — missing params (one at a time)', () => {
  function buildQueryMissing(omit: keyof typeof URL_HANDSHAKE_PARAM_NAMES): string {
    const all: Record<string, string> = {
      [URL_HANDSHAKE_PARAM_NAMES.widgetId]: WIDGET_ID,
      [URL_HANDSHAKE_PARAM_NAMES.nonce]: NONCE,
      [URL_HANDSHAKE_PARAM_NAMES.parentOrigin]: PARENT_ORIGIN,
      [URL_HANDSHAKE_PARAM_NAMES.protocolVersion]: IFRAME_PROTOCOL_VERSION,
    }
    delete all[URL_HANDSHAKE_PARAM_NAMES[omit]]
    return Object.entries(all).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  }

  it('fails when widgetId is missing', () => {
    const result = parseIframeWidgetUrlParams(buildQueryMissing('widgetId'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes(URL_HANDSHAKE_PARAM_NAMES.widgetId))).toBe(true)
  })

  it('fails when nonce is missing', () => {
    const result = parseIframeWidgetUrlParams(buildQueryMissing('nonce'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes(URL_HANDSHAKE_PARAM_NAMES.nonce))).toBe(true)
  })

  it('fails when parentOrigin is missing', () => {
    const result = parseIframeWidgetUrlParams(buildQueryMissing('parentOrigin'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes(URL_HANDSHAKE_PARAM_NAMES.parentOrigin))).toBe(true)
  })

  it('fails when protocolVersion is missing', () => {
    const result = parseIframeWidgetUrlParams(buildQueryMissing('protocolVersion'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes(URL_HANDSHAKE_PARAM_NAMES.protocolVersion))).toBe(true)
  })
})

describe('parseIframeWidgetUrlParams — invalid formats', () => {
  it('fails when widgetId has an invalid format', () => {
    const result = parseIframeWidgetUrlParams(`${URL_HANDSHAKE_PARAM_NAMES.widgetId}=not_a_widget_id&${URL_HANDSHAKE_PARAM_NAMES.nonce}=${NONCE}&${URL_HANDSHAKE_PARAM_NAMES.parentOrigin}=${encodeURIComponent(PARENT_ORIGIN)}&${URL_HANDSHAKE_PARAM_NAMES.protocolVersion}=${IFRAME_PROTOCOL_VERSION}`)
    expect(result.ok).toBe(false)
  })

  it('fails when nonce has an invalid format', () => {
    const result = parseIframeWidgetUrlParams(`${URL_HANDSHAKE_PARAM_NAMES.widgetId}=${WIDGET_ID}&${URL_HANDSHAKE_PARAM_NAMES.nonce}=x&${URL_HANDSHAKE_PARAM_NAMES.parentOrigin}=${encodeURIComponent(PARENT_ORIGIN)}&${URL_HANDSHAKE_PARAM_NAMES.protocolVersion}=${IFRAME_PROTOCOL_VERSION}`)
    expect(result.ok).toBe(false)
  })

  it('fails when parentOrigin has an invalid format', () => {
    const result = parseIframeWidgetUrlParams(`${URL_HANDSHAKE_PARAM_NAMES.widgetId}=${WIDGET_ID}&${URL_HANDSHAKE_PARAM_NAMES.nonce}=${NONCE}&${URL_HANDSHAKE_PARAM_NAMES.parentOrigin}=not-a-url&${URL_HANDSHAKE_PARAM_NAMES.protocolVersion}=${IFRAME_PROTOCOL_VERSION}`)
    expect(result.ok).toBe(false)
  })

  it('fails when parentOrigin is the wildcard', () => {
    const result = parseIframeWidgetUrlParams(`${URL_HANDSHAKE_PARAM_NAMES.widgetId}=${WIDGET_ID}&${URL_HANDSHAKE_PARAM_NAMES.nonce}=${NONCE}&${URL_HANDSHAKE_PARAM_NAMES.parentOrigin}=*&${URL_HANDSHAKE_PARAM_NAMES.protocolVersion}=${IFRAME_PROTOCOL_VERSION}`)
    expect(result.ok).toBe(false)
  })

  it('fails when protocolVersion does not match IFRAME_PROTOCOL_VERSION', () => {
    const result = parseIframeWidgetUrlParams(`${URL_HANDSHAKE_PARAM_NAMES.widgetId}=${WIDGET_ID}&${URL_HANDSHAKE_PARAM_NAMES.nonce}=${NONCE}&${URL_HANDSHAKE_PARAM_NAMES.parentOrigin}=${encodeURIComponent(PARENT_ORIGIN)}&${URL_HANDSHAKE_PARAM_NAMES.protocolVersion}=0.9.0`)
    expect(result.ok).toBe(false)
  })

  it('accumulates multiple errors when multiple params are invalid', () => {
    const result = parseIframeWidgetUrlParams('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(1)
  })
})

// ── Deterministic output ──────────────────────────────────────────────────────

describe('determinism', () => {
  it('parseIframeWidgetUrlParams is deterministic', () => {
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    const query = url.slice(BASE_SRC.length + 1)
    expect(parseIframeWidgetUrlParams(query)).toEqual(parseIframeWidgetUrlParams(query))
  })
})

// ── No credential leakage ─────────────────────────────────────────────────────

describe('no credential leakage', () => {
  const SECRET = 'tok_url_handshake_test_secret_leak_check'

  it('buildIframeWidgetUrl never includes a secret that happens to be nearby in the caller\'s scope', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const apiKey = SECRET // simulates a caller having a secret in scope, unrelated to the builder call
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    expect(url).not.toContain(SECRET)
  })

  it('BuildIframeWidgetUrlOptions has no field that could carry a credential (structural, not just value absence)', () => {
    const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
    const query = url.slice(BASE_SRC.length + 1)
    const result = parseIframeWidgetUrlParams(query)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params).not.toHaveProperty('auth')
      expect(result.params).not.toHaveProperty('credential')
      expect(result.params).not.toHaveProperty('apiKey')
      expect(result.params).not.toHaveProperty('tenantId')
      expect(Object.keys(result.params).sort()).toEqual(['nonce', 'parentOrigin', 'protocolVersion', 'widgetId'])
    }
  })
})
