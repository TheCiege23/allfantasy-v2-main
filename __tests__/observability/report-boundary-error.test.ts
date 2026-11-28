/**
 * lib/observability/reportBoundaryError.ts — the crash screens used to log only to the viewer's own
 * browser console, so a crash left no record (owner report, 2026-11-28).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ sentry: vi.fn(), posthog: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: h.sentry }))
vi.mock('posthog-js', () => ({ default: { captureException: h.posthog } }))

import { reportBoundaryError } from '@/lib/observability/reportBoundaryError'

beforeEach(() => vi.clearAllMocks())

describe('reportBoundaryError', () => {
  it('sends a crash to Sentry and PostHog with its boundary and digest', () => {
    const err = Object.assign(new Error('boom'), { digest: 'abc123' })
    reportBoundaryError(err, 'global')
    expect(h.sentry).toHaveBeenCalledWith(err, { tags: { 'af.boundary': 'global' }, contexts: { react: { digest: 'abc123' } } })
    expect(h.posthog).toHaveBeenCalledWith(err, { digest: 'abc123', 'af.boundary': 'global' })
  })

  it('does not report a redirect or notFound, which are not crashes', () => {
    reportBoundaryError(Object.assign(new Error('r'), { digest: 'NEXT_REDIRECT;replace;/login;307;' }), 'app')
    reportBoundaryError(Object.assign(new Error('n'), { digest: 'NEXT_NOT_FOUND' }), 'app')
    expect(h.sentry).not.toHaveBeenCalled()
  })

  it('never throws when a reporter does', () => {
    h.sentry.mockImplementationOnce(() => { throw new Error('sentry down') })
    expect(() => reportBoundaryError(new Error('boom'), 'league-route')).not.toThrow()
    expect(h.posthog).toHaveBeenCalledTimes(1)
  })
})
