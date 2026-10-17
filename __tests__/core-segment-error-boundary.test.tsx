import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The /core segment boundary. A Server Components error reaches the client with no stack, so the
 * digest is the only link to the server log. Both reporters must receive it.
 */

const h = vi.hoisted(() => ({
  sentryCapture: vi.fn(),
  posthogCapture: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: h.sentryCapture }))
vi.mock('posthog-js', () => ({ default: { captureException: h.posthogCapture } }))

import AfCoreError from '@/app/core/(shell)/[[...screen]]/error'

beforeEach(() => {
  h.sentryCapture.mockReset()
  h.posthogCapture.mockReset()
})

describe('AfCoreError', () => {
  it('sends the digest to PostHog with the exception', () => {
    const failure = Object.assign(new Error('An error occurred in the Server Components render'), {
      digest: '2154851329',
    })
    render(<AfCoreError error={failure} reset={() => {}} />)

    expect(screen.getByRole('alert')).toHaveTextContent('This screen did not load')
    expect(h.posthogCapture).toHaveBeenCalledTimes(1)
    expect(h.posthogCapture).toHaveBeenCalledWith(failure, {
      digest: '2154851329',
      'af.boundary': 'core-segment',
    })
    expect(h.sentryCapture).toHaveBeenCalledTimes(1)
  })

  it('does not report a redirect as a crash', () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })
    render(<AfCoreError error={redirect} reset={() => {}} />)

    expect(h.posthogCapture).not.toHaveBeenCalled()
    expect(h.sentryCapture).not.toHaveBeenCalled()
  })

  it('still renders the card when PostHog throws', () => {
    h.posthogCapture.mockImplementation(() => {
      throw new Error('not loaded')
    })
    render(<AfCoreError error={new Error('boom')} reset={() => {}} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
