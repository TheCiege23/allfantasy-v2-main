// @vitest-environment node
/**
 * Phase 2: the enforced CSP must keep loading everything a WEEK of production reports
 * showed the site really uses (csp-report log 2026-11-07 → 11-12, 1,503 reports). Each
 * origin below was a live violation in that log; if one is dropped, that tag breaks for
 * every visitor on the next deploy, silently. This list is the regression guard.
 */
import { describe, expect, it } from 'vitest'
import {
  CSP_ENFORCED_DIRECTIVES,
  CSP_ENFORCED_POLICY,
  CSP_REPORT_PATH,
  cspMode,
} from '@/lib/security/cspReportOnly'

const MEASURED_SCRIPT_ORIGINS = [
  'https://analytics.tiktok.com',
  'https://static.cloudflareinsights.com',
  'https://www.redditstatic.com',
  'https://googleads.g.doubleclick.net',
  'https://www.googletagmanager.com',
  'https://connect.facebook.net',
  'https://allfantasy.ai', // apex assets while the page is on www
]

/** Script hosts the app loads outside GTM (from the repo, not the log). */
const KNOWN_SCRIPT_ORIGINS = ['https://js.stripe.com', 'https://sdk.scdn.co', 'https://platform.twitter.com']

describe('the ENFORCED policy', () => {
  it('allows every script origin production was measured loading', () => {
    for (const origin of [...MEASURED_SCRIPT_ORIGINS, ...KNOWN_SCRIPT_ORIGINS]) {
      expect(CSP_ENFORCED_DIRECTIVES['script-src'], origin).toContain(origin)
    }
  })

  it("allows GTM's eval (98 inline reports) and inline script", () => {
    expect(CSP_ENFORCED_DIRECTIVES['script-src']).toContain("'unsafe-eval'")
    expect(CSP_ENFORCED_DIRECTIVES['script-src']).toContain("'unsafe-inline'")
  })

  it('still restricts scripts to a host list — never a scheme wildcard', () => {
    const scripts = CSP_ENFORCED_DIRECTIVES['script-src']
    expect(scripts).not.toContain('https:')
    expect(scripts).not.toContain('*')
    expect(scripts).not.toContain('http:')
  })

  it('lets beacons reach the regional and rotating hosts a host list cannot enumerate', () => {
    // www.google.es / .ca / .lk and *.a.run.app were all live in the log.
    expect(CSP_ENFORCED_DIRECTIVES['connect-src']).toEqual(["'self'", 'https:', 'wss:'])
  })

  it('lets the Meta pixel submit its form and Stripe open its 3-D Secure frame', () => {
    expect(CSP_ENFORCED_DIRECTIVES['form-action']).toEqual(["'self'", 'https://www.facebook.com'])
    expect(CSP_ENFORCED_DIRECTIVES['frame-src']).toContain('https://hooks.stripe.com')
    expect(CSP_ENFORCED_DIRECTIVES['frame-src']).toContain('https://js.stripe.com')
  })

  it('enforces the framing, plugin and <base> protections, and keeps reporting', () => {
    expect(CSP_ENFORCED_POLICY).toContain("frame-ancestors 'none'")
    expect(CSP_ENFORCED_POLICY).toContain("object-src 'none'")
    expect(CSP_ENFORCED_POLICY).toContain("base-uri 'self'")
    expect(CSP_ENFORCED_POLICY).toContain(`report-uri ${CSP_REPORT_PATH}`)
    expect(CSP_ENFORCED_POLICY).not.toContain('report-to')
  })

  it('serialises as one header value', () => {
    expect(CSP_ENFORCED_POLICY).not.toMatch(/[\r\n]/)
    expect(CSP_ENFORCED_POLICY).not.toMatch(/;\s*;/)
  })
})

describe('cspMode', () => {
  it('defaults to enforce (the allowlist) unless explicitly set', () => {
    // Every mode except report-only ENFORCES the allowlist or stricter, so an unset or
    // mistyped variable can never loosen the site.
    expect(cspMode(undefined)).toBe('enforce')
    expect(cspMode('')).toBe('enforce')
    expect(cspMode('garbage')).toBe('enforce')
    expect(cspMode('nonce-report')).toBe('nonce-report')
    expect(cspMode('enforce')).toBe('enforce')
    expect(cspMode('nonce')).toBe('nonce')
    expect(cspMode('report-only')).toBe('report-only')
    expect(cspMode(' Report-Only ')).toBe('report-only')
  })
})
