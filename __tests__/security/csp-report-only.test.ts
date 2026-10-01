// @vitest-environment node
/**
 * Phase 1 of the script-restricting CSP is Report-Only (lib/security/cspReportOnly.ts):
 * it must never block, must keep the enforced frame-ancestors header untouched, and
 * the report sink must log origins and paths only — never a query string, which can
 * carry a token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  CSP_REPORT_ONLY_DIRECTIVES,
  CSP_REPORT_ONLY_POLICY,
  CSP_REPORT_PATH,
  redactUrl,
  summarizeCspReports,
} from '@/lib/security/cspReportOnly'

describe('the Report-Only policy', () => {
  it('restricts scripts by host and reports to our own endpoint', () => {
    expect(CSP_REPORT_ONLY_POLICY).toContain("script-src 'self' 'unsafe-inline' ")
    expect(CSP_REPORT_ONLY_POLICY).toContain("object-src 'none'")
    expect(CSP_REPORT_ONLY_POLICY).toContain(`report-uri ${CSP_REPORT_PATH}`)
    // report-to would make Chrome ignore report-uri; see the note in cspReportOnly.ts.
    expect(CSP_REPORT_ONLY_POLICY).not.toContain('report-to')
  })

  it("does not carry frame-ancestors, which stays in the ENFORCED header", () => {
    expect(CSP_REPORT_ONLY_DIRECTIVES['frame-ancestors']).toBeUndefined()
  })

  it('allows every third-party script host the app is known to load', () => {
    for (const host of [
      'https://www.googletagmanager.com', // gtag + GTM
      'https://connect.facebook.net', // Meta Pixel
      'https://js.stripe.com', // /support buy button
      'https://sdk.scdn.co', // Spotify player
    ]) {
      expect(CSP_REPORT_ONLY_DIRECTIVES['script-src']).toContain(host)
    }
  })

  it('serialises without a stray separator or a newline (one header value)', () => {
    expect(CSP_REPORT_ONLY_POLICY).not.toMatch(/[\r\n]/)
    expect(CSP_REPORT_ONLY_POLICY).not.toMatch(/;\s*;/)
    expect(CSP_REPORT_ONLY_POLICY.endsWith(';')).toBe(false)
  })
})

describe('redactUrl', () => {
  it('keeps only the origin of a third party and drops query strings', () => {
    expect(redactUrl('https://evil.example/x.js?token=SECRET#frag', 'origin')).toBe('https://evil.example')
  })

  it('keeps only the path of our own page, never its query', () => {
    expect(redactUrl('https://allfantasy.ai/league/abc?invite=SECRET', 'path')).toBe('/league/abc')
  })

  it('passes CSP keywords through and collapses data/blob URLs', () => {
    expect(redactUrl('inline', 'origin')).toBe('inline')
    expect(redactUrl('eval', 'origin')).toBe('eval')
    expect(redactUrl('data:image/png;base64,AAAA', 'origin')).toBe('data')
    expect(redactUrl('blob:https://allfantasy.ai/123', 'origin')).toBe('blob')
  })

  it('returns null for missing values', () => {
    expect(redactUrl(undefined, 'origin')).toBeNull()
    expect(redactUrl('', 'origin')).toBeNull()
  })
})

describe('summarizeCspReports', () => {
  it('reads the legacy report-uri shape', () => {
    const [v] = summarizeCspReports({
      'csp-report': {
        'document-uri': 'https://allfantasy.ai/core?tab=SECRET',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://cdn.unknown.example/lib.js?k=SECRET',
        'source-file': 'https://www.googletagmanager.com/gtm.js?id=GTM-X',
        disposition: 'report',
      },
    })
    expect(v).toEqual({
      directive: 'script-src-elem',
      blocked: 'https://cdn.unknown.example',
      page: '/core',
      source: 'https://www.googletagmanager.com',
      disposition: 'report',
    })
    expect(JSON.stringify(v)).not.toContain('SECRET')
  })

  it('reads the Reporting API shape and ignores non-CSP reports', () => {
    const out = summarizeCspReports([
      { type: 'deprecation', body: { id: 'x' } },
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://allfantasy.ai/pricing',
          effectiveDirective: 'connect-src',
          blockedURL: 'https://api.unknown.example/v1?key=SECRET',
          disposition: 'report',
        },
      },
    ])
    expect(out).toEqual([
      { directive: 'connect-src', blocked: 'https://api.unknown.example', page: '/pricing', source: null, disposition: 'report' },
    ])
  })

  it('yields nothing for garbage', () => {
    expect(summarizeCspReports(null)).toEqual([])
    expect(summarizeCspReports('nope')).toEqual([])
    expect(summarizeCspReports({ hello: 'world' })).toEqual([])
    expect(summarizeCspReports([1, 2, { type: 'csp-violation' }])).toEqual([])
  })
})

describe('POST /api/security/csp-report', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  async function post(body: string, ip = '198.51.100.7', contentType = 'application/csp-report') {
    const { POST } = await import('@/app/api/security/csp-report/route')
    return POST(
      new NextRequest('https://allfantasy.ai/api/security/csp-report', {
        method: 'POST',
        body,
        headers: { 'content-type': contentType, 'x-forwarded-for': ip },
      }),
    )
  }

  const report = (blocked: string) =>
    JSON.stringify({
      'csp-report': {
        'document-uri': 'https://allfantasy.ai/core?x=SECRET',
        'effective-directive': 'script-src-elem',
        'blocked-uri': blocked,
      },
    })

  it('logs one sanitised line and answers 204', async () => {
    const res = await post(report('https://cdn.unknown.example/a.js?k=SECRET'))
    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = warn.mock.calls[0]!.join(' ')
    expect(line).toContain('[csp-report]')
    expect(line).toContain('https://cdn.unknown.example')
    expect(line).not.toContain('SECRET')
  })

  it('logs a repeated violation once per window', async () => {
    const { POST } = await import('@/app/api/security/csp-report/route')
    const send = () =>
      POST(
        new NextRequest('https://allfantasy.ai/api/security/csp-report', {
          method: 'POST',
          body: report('https://cdn.unknown.example/a.js'),
          headers: { 'x-forwarded-for': '198.51.100.8' },
        }),
      )
    await send()
    await send()
    await send()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('answers 204 and logs nothing for garbage, an empty body or an oversized one', async () => {
    expect((await post('not json')).status).toBe(204)
    expect((await post('')).status).toBe(204)
    expect((await post('x'.repeat(20_000))).status).toBe(204)
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts the Reporting API content type', async () => {
    const body = JSON.stringify([
      {
        type: 'csp-violation',
        body: { documentURL: 'https://allfantasy.ai/', effectiveDirective: 'connect-src', blockedURL: 'https://x.example/' },
      },
    ])
    expect((await post(body, '198.51.100.9', 'application/reports+json')).status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
