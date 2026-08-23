import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The apex-to-www redirect leaked the server's listen port into the public
 * `Location` header, which took allfantasy.ai down for every visitor who typed
 * the bare domain.
 *
 * MEASURED IN PRODUCTION 2026-08-22:
 *   allfantasy.ai      -> 308  Location: https://www.allfantasy.ai:8080/  -> connection failed
 *   www.allfantasy.ai  -> 200  OK
 *
 * ⚠ WHY IT SURVIVED THE MOVE FROM VERCEL. `request.nextUrl` carries the port the
 * SERVER listens on. On Vercel that was 443, so `url.hostname = canonicalHost`
 * alone produced a correct URL and the missing `url.port = ''` was invisible.
 * Railway's container listens on 8080, so the identical code started emitting an
 * unpublished port. Nothing about the redirect changed — the environment did.
 *
 * ⚠ AND WHY MONITORING MISSED IT. Any check that requests `www` directly, or that
 * does not follow redirects, sees 200. The failure only appears on the apex, on
 * the hop the browser makes automatically.
 */

const middlewareSource = readFileSync(resolve(__dirname, '..', 'middleware.ts'), 'utf8')

describe('canonical host redirect — must not leak the listen port', () => {
  it('clears the port before redirecting', () => {
    // Source-level assertion: middleware.ts is not importable under vitest, and
    // this mirrors how preview-host-admin-magic.test.ts guards the same file.
    expect(middlewareSource).toMatch(/url\.port\s*=\s*['"]{2}/)
  })

  it('clears the port in the same block that sets the hostname', () => {
    // Guards against the fix drifting away from the assignment it protects.
    const block = middlewareSource.slice(
      middlewareSource.indexOf('url.hostname = canonicalHost'),
      middlewareSource.indexOf('NextResponse.redirect(url, 308)'),
    )
    expect(block).toMatch(/url\.port\s*=\s*['"]{2}/)
  })
})

describe('URL semantics that caused it', () => {
  it('setting hostname alone PRESERVES the port — the actual bug', () => {
    const url = new URL('https://allfantasy.ai:8080/live')
    url.hostname = 'www.allfantasy.ai'
    // This is what shipped: a public redirect to an unpublished port.
    expect(url.href).toBe('https://www.allfantasy.ai:8080/live')
  })

  it('clearing the port yields the correct public URL, path and query intact', () => {
    const url = new URL('https://allfantasy.ai:8080/live?scope=all')
    url.hostname = 'www.allfantasy.ai'
    url.port = ''
    expect(url.href).toBe('https://www.allfantasy.ai/live?scope=all')
  })

  it('is a no-op when no port is present, so Vercel-style URLs are unaffected', () => {
    const url = new URL('https://allfantasy.ai/live')
    url.hostname = 'www.allfantasy.ai'
    url.port = ''
    expect(url.href).toBe('https://www.allfantasy.ai/live')
  })
})
