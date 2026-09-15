import { Component, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The boundary around the streamed /core screen.
 *
 * Its failure modes are all silent in the direction that matters: swallow a `redirect()` and the
 * user sees "did not load" instead of being sent to sign in; report nothing and a broken screen is
 * invisible in Sentry; forget to reset and the error panel follows the user to the next screen.
 * Each is asserted here through a real render, with a thrower standing in for the server body.
 */

const h = vi.hoisted(() => ({
  captureException: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: h.captureException }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: h.refresh, push() {}, replace() {}, prefetch() {} }),
}))

import CoreScreenErrorBoundary from '@/components/core-app/CoreScreenErrorBoundary'

function Thrower({ error }: { error: unknown }): ReactNode {
  throw error
}

/** Stands in for Next's own boundaries above the page: records what reaches it. */
class Outer extends Component<{ children: ReactNode; onError: (error: unknown) => void }, { caught: boolean }> {
  state = { caught: false }
  static getDerivedStateFromError() {
    return { caught: true }
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error)
  }
  render() {
    return this.state.caught ? <p>outer boundary</p> : this.props.children
  }
}

beforeEach(() => {
  h.captureException.mockClear()
  h.refresh.mockClear()
  // React logs every caught render error; the assertions below are what matter.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CoreScreenErrorBoundary', () => {
  it('contains a failed screen and reports it', () => {
    const failure = Object.assign(new Error('loader exploded'), { digest: '1234567890' })
    render(
      <CoreScreenErrorBoundary resetKey="trades|L1">
        <Thrower error={failure} />
      </CoreScreenErrorBoundary>,
    )

    expect(screen.getByRole('alert').textContent).toContain('This screen did not load')
    expect(h.captureException).toHaveBeenCalledTimes(1)
    expect(h.captureException.mock.calls[0][0]).toBe(failure)
    expect(h.captureException.mock.calls[0][1]).toMatchObject({ tags: { 'af.boundary': 'core-screen' } })
  })

  it.each([
    ['redirect()', 'NEXT_REDIRECT;replace;/login;307'],
    ['notFound()', 'NEXT_NOT_FOUND'],
  ])('lets %s through to the boundaries above it, unreported', (_label, digest) => {
    const signal = Object.assign(new Error(digest), { digest })
    const reachedOuter = vi.fn()
    render(
      <Outer onError={reachedOuter}>
        <CoreScreenErrorBoundary resetKey="home|">
          <Thrower error={signal} />
        </CoreScreenErrorBoundary>
      </Outer>,
    )

    expect(reachedOuter).toHaveBeenCalledWith(signal)
    expect(screen.queryByText('This screen did not load')).toBeNull()
    expect(h.captureException).not.toHaveBeenCalled()
  })

  it('reports a failure on the next screen once, not twice', async () => {
    // Resetting after commit (componentDidUpdate) renders the failing screen, resets, and renders it
    // again — two reports for one failure. The reset belongs in the same render.
    const view = render(
      <CoreScreenErrorBoundary resetKey="trades|league=L1">
        <p>trades screen</p>
      </CoreScreenErrorBoundary>,
    )
    await act(async () => {
      view.rerender(
        <CoreScreenErrorBoundary resetKey="trades|league=L2">
          <Thrower error={new Error('boom')} />
        </CoreScreenErrorBoundary>,
      )
    })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(h.captureException).toHaveBeenCalledTimes(1)
  })

  it('renders the next screen when the URL changes', async () => {
    const view = render(
      <CoreScreenErrorBoundary resetKey="trades|L1">
        <Thrower error={new Error('boom')} />
      </CoreScreenErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()

    await act(async () => {
      view.rerender(
        <CoreScreenErrorBoundary resetKey="waivers|L1">
          <p>waivers screen</p>
        </CoreScreenErrorBoundary>,
      )
    })
    expect(screen.getByText('waivers screen')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the panel through a re-render of the same URL', async () => {
    // A game-day refresh re-renders with new children under the same key. Resetting on that would
    // re-render the failing screen and report it again on every refresh.
    const view = render(
      <CoreScreenErrorBoundary resetKey="trades|league=L1">
        <Thrower error={new Error('boom')} />
      </CoreScreenErrorBoundary>,
    )
    await act(async () => {
      view.rerender(
        <CoreScreenErrorBoundary resetKey="trades|league=L1">
          <Thrower error={new Error('boom again')} />
        </CoreScreenErrorBoundary>,
      )
    })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(h.captureException).toHaveBeenCalledTimes(1)
  })

  it('asks the router for a fresh render when the user retries', async () => {
    render(
      <CoreScreenErrorBoundary resetKey="trades|L1">
        <Thrower error={new Error('boom')} />
      </CoreScreenErrorBoundary>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })
})
