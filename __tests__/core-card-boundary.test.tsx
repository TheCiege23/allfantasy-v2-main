import { Component, type ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The boundary around each streamed /core home card.
 *
 * Its whole point is the NEIGHBOURS: a card that throws must cost that card only. So the core
 * assertion renders a failing card beside a working one and requires the working one to survive —
 * which a test of the failing card alone could never show.
 */

const h = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: h.captureException }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }) }))

import CoreCardBoundary from '@/components/core-app/CoreCardBoundary'

function Thrower({ error }: { error: unknown }): ReactNode {
  throw error
}

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
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CoreCardBoundary', () => {
  it('costs the failing card only — its neighbour still renders — and reports it by card', () => {
    const failure = new Error('career card exploded')
    render(
      <>
        <CoreCardBoundary card="career" resetKey="|">
          <Thrower error={failure} />
        </CoreCardBoundary>
        <CoreCardBoundary card="rivals" resetKey="|">
          <p>rivalry radar</p>
        </CoreCardBoundary>
      </>,
    )

    expect(screen.getByText('rivalry radar')).toBeTruthy()
    expect(document.querySelector('[data-card-failed="career"]')).not.toBeNull()
    expect(document.querySelector('[data-card-failed="rivals"]')).toBeNull()
    expect(h.captureException).toHaveBeenCalledTimes(1)
    expect(h.captureException.mock.calls[0][0]).toBe(failure)
    expect(h.captureException.mock.calls[0][1]).toMatchObject({ tags: { 'af.boundary': 'core-card', 'af.card': 'career' } })
  })

  it.each([
    ['redirect()', 'NEXT_REDIRECT;replace;/login;307'],
    ['notFound()', 'NEXT_NOT_FOUND'],
  ])('lets %s through, unreported', (_label, digest) => {
    const signal = Object.assign(new Error(digest), { digest })
    const reachedOuter = vi.fn()
    render(
      <Outer onError={reachedOuter}>
        <CoreCardBoundary card="issues" resetKey="|">
          <Thrower error={signal} />
        </CoreCardBoundary>
      </Outer>,
    )
    expect(reachedOuter).toHaveBeenCalledWith(signal)
    expect(document.querySelector('[data-card-failed]')).toBeNull()
    expect(h.captureException).not.toHaveBeenCalled()
  })

  it('clears on a new URL, and holds through a re-render of the same one', async () => {
    const view = render(
      <CoreCardBoundary card="exposure" resetKey="|">
        <Thrower error={new Error('boom')} />
      </CoreCardBoundary>,
    )
    expect(document.querySelector('[data-card-failed="exposure"]')).not.toBeNull()

    // Same URL, new children (a game-day refresh): the note stays, and nothing is reported again.
    await act(async () => {
      view.rerender(
        <CoreCardBoundary card="exposure" resetKey="|">
          <Thrower error={new Error('boom again')} />
        </CoreCardBoundary>,
      )
    })
    expect(document.querySelector('[data-card-failed="exposure"]')).not.toBeNull()
    expect(h.captureException).toHaveBeenCalledTimes(1)

    await act(async () => {
      view.rerender(
        <CoreCardBoundary card="exposure" resetKey="|view=all">
          <p>exposure card</p>
        </CoreCardBoundary>,
      )
    })
    expect(screen.getByText('exposure card')).toBeTruthy()
  })
})
