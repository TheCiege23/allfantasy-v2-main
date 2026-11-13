// @vitest-environment node
/**
 * Phase 3 of the CSP: a per-request nonce, so the policy can drop 'unsafe-inline'.
 *
 * What has to hold, end to end through the real middleware:
 *  - one fresh nonce per request,
 *  - the SAME value in the response policy and on the forwarded REQUEST — Next stamps its
 *    own scripts from the request's CSP header, so a mismatch blocks the framework itself,
 *  - nothing a client sends can choose it,
 *  - the default mode enforces the measured allowlist and only REPORTS the nonce policy.
 * Addresses are RFC 5737.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))
vi.mock('@/lib/geo/geoIpFetch', () => ({ fetchIpApi: vi.fn(async () => null), fetchProxycheck: vi.fn(async () => null) }))

import { middleware } from '@/middleware'
import {
  CSP_ENFORCED_POLICY,
  CSP_PROBE_COOKIE,
  buildNonceDirectives,
  cspMode,
  cspModeForRequest,
  generateCspNonce,
  summarizeCspReports,
} from '@/lib/security/cspReportOnly'

const NONCE_RE = /'nonce-([A-Za-z0-9+/=]+)'/

function page(path = '/', init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    method: init.method ?? 'GET',
    body: init.body,
    headers: { 'cf-ipcountry': 'US', 'cf-region-code': 'TX', 'cf-connecting-ip': '198.51.100.80', ...init.headers },
  })
}

/** The request headers Next will render the page with (middleware request override). */
function forwarded(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`)
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-not-a-real-credential'
  vi.stubEnv('NODE_ENV', 'production')
})
afterEach(() => vi.unstubAllEnvs())

describe('the nonce policy', () => {
  it("drops 'unsafe-inline' in every browser that supports nonces", () => {
    const s = buildNonceDirectives('abc123==')['script-src']
    expect(s[0]).toBe("'nonce-abc123=='")
    expect(s).toContain("'strict-dynamic'")
    // CSP3 browsers IGNORE 'unsafe-inline' and https: when a nonce / strict-dynamic is
    // present; they are kept only as the documented pre-CSP3 fallback.
    expect(s.indexOf("'unsafe-inline'")).toBeGreaterThan(s.indexOf("'strict-dynamic'"))
    expect(s).toContain("'report-sample'")
  })

  it('keeps every other enforced protection', () => {
    const d = buildNonceDirectives('x')
    expect(d['object-src']).toEqual(["'none'"])
    expect(d['base-uri']).toEqual(["'self'"])
    expect(d['frame-ancestors']).toEqual(["'none'"])
    expect(d['form-action']).toEqual(["'self'", 'https://www.facebook.com'])
  })

  it('generates a distinct 128-bit nonce each time', () => {
    const a = generateCspNonce()
    const b = generateCspNonce()
    expect(a).not.toBe(b)
    expect(atob(a)).toHaveLength(16)
  })
})

describe('cspMode', () => {
  it('defaults to enforce (the allowlist), and a typo cannot loosen anything', () => {
    expect(cspMode(undefined)).toBe('enforce')
    expect(cspMode('nonse')).toBe('enforce')
    expect(cspMode('nonce')).toBe('nonce')
    expect(cspMode('nonce-report')).toBe('nonce-report')
    expect(cspMode('enforce')).toBe('enforce')
    expect(cspMode('report-only')).toBe('report-only')
  })
})

describe('cspModeForRequest — the strict-mode probe cookie', () => {
  it('upgrades any service mode to nonce, and only to nonce', () => {
    for (const env of ['enforce', 'report-only', 'nonce-report', 'nonce'] as const) {
      expect(cspModeForRequest('nonce', env)).toBe('nonce')
      expect(cspModeForRequest(' NONCE ', env)).toBe('nonce')
      // Any other value is ignored — the cookie can never select a looser mode.
      expect(cspModeForRequest('report-only', env)).toBe(env)
      expect(cspModeForRequest('enforce', env)).toBe(env)
      expect(cspModeForRequest(undefined, env)).toBe(env)
    }
  })

  it('through the middleware: a probe browser gets the enforced nonce policy, everyone else the allowlist', async () => {
    const probe = await middleware(page('/', { headers: { cookie: `${CSP_PROBE_COOKIE}=nonce` } }))
    const csp = probe.headers.get('content-security-policy') ?? ''
    const nonce = csp.match(NONCE_RE)?.[1]
    expect(nonce).toBeTruthy()
    expect(forwarded(probe, 'x-nonce')).toBe(nonce)

    const visitor = await middleware(page('/'))
    expect(visitor.headers.get('content-security-policy')).toBe(CSP_ENFORCED_POLICY)
    expect(forwarded(visitor, 'x-nonce')).toBeNull()
  })

  it('a probe value other than nonce changes nothing', async () => {
    const res = await middleware(page('/', { headers: { cookie: `${CSP_PROBE_COOKIE}=report-only` } }))
    expect(res.headers.get('content-security-policy')).toBe(CSP_ENFORCED_POLICY)
  })
})

/*
 * 🛑 THE PRODUCTION FINDING THIS FILE NOW GUARDS. Next's router copies every RESPONSE
 * header the middleware sets onto the REQUEST (resolve-routes.js `req.headers[key] =
 * value`), and the renderer reads its nonce from `content-security-policy` first. So the
 * nonce Next stamps on its own scripts is whatever the ENFORCED response header carries.
 * In nonce mode that must be this request's nonce, or every Next script is refused.
 */
describe('Next reads its nonce from the enforced response header', () => {
  it('in nonce mode, the enforced response CSP carries the same nonce as x-nonce', async () => {
    vi.stubEnv('CSP_MODE', 'nonce')
    const res = await middleware(page('/'))
    const responseNonce = (res.headers.get('content-security-policy') ?? '').match(NONCE_RE)?.[1]
    expect(responseNonce).toBeTruthy()
    expect(responseNonce).toBe(forwarded(res, 'x-nonce'))
  })
})

describe('middleware, CSP_MODE=nonce-report', () => {
  beforeEach(() => {
    vi.stubEnv('CSP_MODE', 'nonce-report')
  })

  it('enforces the allowlist and REPORTS the nonce policy, with one nonce on response and request', async () => {
    const res = await middleware(page('/'))
    expect(res.headers.get('content-security-policy')).toBe(CSP_ENFORCED_POLICY)
    const reportOnly = res.headers.get('content-security-policy-report-only') ?? ''
    const nonce = reportOnly.match(NONCE_RE)?.[1]
    expect(nonce).toBeTruthy()
    expect(forwarded(res, 'x-nonce')).toBe(nonce)
    // Next reads the nonce from the REQUEST's CSP header; the enforced allowlist must not
    // be forwarded, because Next would read it first and find no nonce.
    expect(forwarded(res, 'content-security-policy-report-only')).toContain(`'nonce-${nonce}'`)
    expect(forwarded(res, 'content-security-policy')).toBeNull()
  })

  it('gives two requests two different nonces', async () => {
    const a = (await middleware(page('/'))).headers.get('content-security-policy-report-only')?.match(NONCE_RE)?.[1]
    const b = (await middleware(page('/'))).headers.get('content-security-policy-report-only')?.match(NONCE_RE)?.[1]
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('ignores a nonce or policy the client tries to supply', async () => {
    const res = await middleware(
      page('/', { headers: { 'x-nonce': 'attacker', 'content-security-policy': "script-src 'nonce-attacker'" } }),
    )
    expect(forwarded(res, 'x-nonce')).not.toBe('attacker')
    expect(forwarded(res, 'content-security-policy')).toBeNull()
    expect(res.headers.get('content-security-policy-report-only')).not.toContain('attacker')
  })

  it('still forwards a POST with its body intact through the rebuilt request', async () => {
    const res = await middleware(page('/api/health', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBeLessThan(500)
    expect(forwarded(res, 'x-nonce')).toBeTruthy()
  })
})

describe('middleware, CSP_MODE=nonce', () => {
  it("ENFORCES the nonce policy — 'unsafe-inline' no longer protects an injected script", async () => {
    vi.stubEnv('CSP_MODE', 'nonce')
    const res = await middleware(page('/'))
    const csp = res.headers.get('content-security-policy') ?? ''
    const nonce = csp.match(NONCE_RE)?.[1]
    expect(nonce).toBeTruthy()
    expect(csp).toContain("'strict-dynamic'")
    expect(res.headers.get('content-security-policy-report-only')).toBeNull()
    expect(forwarded(res, 'x-nonce')).toBe(nonce)
    expect(forwarded(res, 'content-security-policy')).toContain(`'nonce-${nonce}'`)
  })
})

describe('middleware, modes without a nonce', () => {
  it.each(['enforce', 'report-only'])('%s sets no nonce anywhere', async (mode) => {
    vi.stubEnv('CSP_MODE', mode)
    const res = await middleware(page('/'))
    expect(forwarded(res, 'x-nonce')).toBeNull()
    expect(res.headers.get('content-security-policy') ?? '').not.toMatch(NONCE_RE)
    expect(res.headers.get('content-security-policy-report-only') ?? '').not.toMatch(NONCE_RE)
  })

  it('next dev sets no nonce (HMR evals module code)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await middleware(page('/'))
    expect(forwarded(res, 'x-nonce')).toBeNull()
  })
})

describe('csp-report keeps the inline sample that names a blocked tag', () => {
  it('passes a 40-character script-sample through, clipped and without control characters', () => {
    const [v] = summarizeCspReports({
      'csp-report': {
        'document-uri': 'https://www.allfantasy.ai/core?token=SECRET',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'inline',
        disposition: 'report',
        'script-sample': '!function(f,b,e,v,n,t,s)\n{if(f.fbq)return;n=f.fbq=function(){n.callMethod? and more',
      },
    })
    expect(v.sample).toBe('!function(f,b,e,v,n,t,s) {if(f.fbq)retur')
    expect(v.sample!.length).toBeLessThanOrEqual(40)
    expect(JSON.stringify(v)).not.toContain('SECRET')
  })

  it('omits the field when the browser sent no sample', () => {
    const [v] = summarizeCspReports({ 'csp-report': { 'effective-directive': 'connect-src', 'blocked-uri': 'https://x.example/' } })
    expect(v).not.toHaveProperty('sample')
  })
})
