import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import Matchup from '@/components/core-app/screens/Matchup'
import type { MatchupData } from '@/lib/core-app/matchup'

/*
 * The phone's sticky scorebar (2026-10-02). On a 375px phone the banner starts ~570px down and a
 * long board runs far below it, so scrolling the board meant losing the score. The bar appears only
 * once the banner has scrolled ABOVE the viewport, and tapping it returns there.
 */

type Cb = (entries: Array<{ isIntersecting: boolean; boundingClientRect: { top: number } }>) => void
let fire: Cb = () => {}
beforeEach(() => {
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(cb: Cb) { fire = cb }
    observe() {}
    disconnect() {}
  }
})
afterEach(() => {
  cleanup()
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
})

function data(): MatchupData {
  return {
    league: { id: 'l1', name: 'Test League', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 4, season: 2026, isFinal: false } },
    teams: {
      available: true,
      data: {
        you: { teamName: 'Mine', ownerName: 'me', record: '2-1', isYou: true, avatarUrl: null },
        opponent: { teamName: 'Theirs', ownerName: 'them', record: '2-1', isYou: false, avatarUrl: null },
      },
    },
    sides: { available: false, reason: 'not scored yet' },
    lineups: { available: false, reason: 'n/a' },
    identityNote: null,
    playerScoring: { available: false, reason: 'projections' },
    winProbability: { available: true, data: { pWin: 0.62, confidence: 'low', detail: 'x' } } as MatchupData['winProbability'],
    projectedFinal: { available: true, data: { you: 120.4, opponent: 111.0, unprojected: { you: 0, opponent: 0 } } } as MatchupData['projectedFinal'],
    yetToPlay: { available: false, reason: 'tally' },
    starterCountsBySide: null,
  }
}

describe('sticky scorebar', () => {
  it('is absent while the banner is on screen', () => {
    const { container } = render(<Matchup data={data()} />)
    act(() => fire([{ isIntersecting: true, boundingClientRect: { top: 40 } }]))
    expect(container.querySelector('.af-mu-sticky')).toBeNull()
  })

  it('appears once the banner has scrolled above the viewport, with both scores and the odds', () => {
    const { container } = render(<Matchup data={data()} />)
    act(() => fire([{ isIntersecting: false, boundingClientRect: { top: -300 } }]))
    const bar = container.querySelector('.af-mu-sticky')!
    expect([...bar.querySelectorAll('.af-mu-sticky-n')].map((n) => n.textContent)).toEqual(['120.4', '111.0'])
    expect(bar.querySelector('.af-mu-sticky-wp')?.textContent).toBe('62%')
    expect(bar.getAttribute('data-basis')).toBe('projected')
  })

  it('does NOT appear for a banner still BELOW the viewport (page not yet scrolled to it)', () => {
    const { container } = render(<Matchup data={data()} />)
    act(() => fire([{ isIntersecting: false, boundingClientRect: { top: 1400 } }]))
    expect(container.querySelector('.af-mu-sticky')).toBeNull()
  })

  it('tapping it scrolls back to the banner', () => {
    const { container } = render(<Matchup data={data()} />)
    const banner = container.querySelector('.af-mu-h2h') as HTMLElement
    const spy = vi.fn()
    banner.scrollIntoView = spy
    act(() => fire([{ isIntersecting: false, boundingClientRect: { top: -300 } }]))
    fireEvent.click(container.querySelector('.af-mu-sticky')!)
    expect(spy).toHaveBeenCalledOnce()
  })
})
