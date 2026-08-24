import { describe, expect, it } from 'vitest'
import {
  isAppRouterControlFlowSignal,
  isAppRouterRedirectError,
} from '@/lib/next/is-app-router-redirect-error'

/**
 * Guards the predicate that keeps Next's routing signals out of the error tracker.
 *
 * ⚠ THE BUG THIS EXISTS FOR: lib/error-tracking/frontend.ts captured EVERY
 * `window.error` and forwarded it to Sentry. `redirect()` unwinds by throwing, so
 * a signed-out visit to a gated route reported a crash — observed on /dashboard,
 * which is where the entire signed-out funnel points, meaning the volume scaled
 * with how many visitors were NOT logged in. An error tracker whose top event is a
 * routing success is one nobody reads.
 *
 * Both halves matter and the second is the one that would be dropped as
 * redundant: the predicate must also KEEP reporting genuine errors. A filter that
 * over-matches turns a noisy tracker into a blind one, which is strictly worse.
 */
describe('isAppRouterControlFlowSignal', () => {
  it('matches a redirect thrown with a digest, as the server sees it', () => {
    const error = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    })
    expect(isAppRouterControlFlowSignal(error)).toBe(true)
  })

  it('matches a redirect that reached the browser with only its message', () => {
    /*
     * ⚠ THIS CASE IS WHY THE PREDICATE TESTS `message` AND NOT JUST `digest`.
     * The existing isAppRouterRedirectError checks the digest, which is correct
     * for a server catch block. By the time the same throw surfaces on
     * `window.error` it can be re-wrapped with the digest gone — and that is
     * exactly the shape that was being reported as a crash.
     */
    const error = new Error('NEXT_REDIRECT;replace;/login;307;')
    expect(isAppRouterControlFlowSignal(error)).toBe(true)
    expect(isAppRouterRedirectError(error)).toBe(false)
  })

  it('matches notFound(), which is a routing outcome rather than a failure', () => {
    const error = Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' })
    expect(isAppRouterControlFlowSignal(error)).toBe(true)
  })

  it('does NOT match a genuine error — the tracker must not go blind', () => {
    expect(isAppRouterControlFlowSignal(new Error('Cannot read properties of undefined'))).toBe(
      false,
    )
    expect(isAppRouterControlFlowSignal(new TypeError('fetch failed'))).toBe(false)
  })

  it('does not match an error that merely mentions a redirect', () => {
    // Substring matching would swallow this; the predicate anchors at the start.
    expect(
      isAppRouterControlFlowSignal(new Error('Login failed after NEXT_REDIRECT handling')),
    ).toBe(false)
  })

  it('is safe on the non-Error values a global handler can receive', () => {
    for (const value of [null, undefined, 'NEXT_REDIRECT', 42, {}, []]) {
      expect(isAppRouterControlFlowSignal(value)).toBe(false)
    }
  })

  it('leaves isAppRouterRedirectError’s server contract unchanged', () => {
    // The two server callers (app/dashboard, app/league/[leagueId]) depend on this.
    const redirect = Object.assign(new Error('x'), { digest: 'NEXT_REDIRECT;replace;/x;307;' })
    expect(isAppRouterRedirectError(redirect)).toBe(true)
    expect(isAppRouterRedirectError(new Error('boom'))).toBe(false)
    // notFound is NOT a redirect, and this function should keep saying so.
    expect(isAppRouterRedirectError(Object.assign(new Error('y'), { digest: 'NEXT_NOT_FOUND' }))).toBe(
      false,
    )
  })
})
