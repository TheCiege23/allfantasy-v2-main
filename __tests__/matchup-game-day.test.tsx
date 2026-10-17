import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// The week banner's refresh control calls useRouter, which needs an app router outside one.
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import Matchup from '@/components/core-app/screens/Matchup'
import type { MatchupData, MatchupPlayerCell } from '@/lib/core-app/matchup'

/*
 * Game day on one league's Matchup page (2026-10-01 audit).
 *
 * ⚠ WHAT WAS MISSING. Mid-week a starter who had not played read "—", the same mark as one we
 * could not price, so the page could not say who was still to play — the question it exists for.
 * The per-side counts were loaded and never shown, and the page never refreshed itself while the
 * all-leagues board beside it did. These pin all three, and that none of it shows before kickoff
 * or after the final whistle.
 */

afterEach(cleanup)

function cell(id: string, name: string, over: Partial<MatchupPlayerCell> = {}): MatchupPlayerCell {
  return {
    playerId: id, sleeperId: id, name, position: 'RB', team: 'DET', sport: 'NFL', imageUrl: null,
    projected: 12, afEngine: null, actual: null, empty: false, unavailable: null, gameState: 'upcoming', ...over,
  }
}

type Counts = { upcoming: number; live: number; final: number; unknown: number }
const zero: Counts = { upcoming: 0, live: 0, final: 0, unknown: 0 }

function data(state: 'upcoming' | 'live' | 'final', bySide: { you: Counts; opponent: Counts } | null = null): MatchupData {
  const scored = state !== 'upcoming'
  return {
    league: { id: 'l1', name: 'Test League', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 5, season: 2026, isFinal: state === 'final' } },
    teams: {
      available: true,
      data: {
        you: { teamName: 'Mine', ownerName: 'me', record: '3-1', isYou: true, avatarUrl: null },
        opponent: { teamName: 'Theirs', ownerName: 'them', record: '2-2', isYou: false, avatarUrl: null },
      },
    },
    sides: scored
      ? { available: true, data: {
          you: { teamName: 'Mine', ownerName: 'me', record: '3-1', points: 90, isYou: true, avatarUrl: null },
          opponent: { teamName: 'Theirs', ownerName: 'them', record: '2-2', points: 80, isYou: false, avatarUrl: null },
        } }
      : { available: false, reason: 'not scored yet' },
    lineups: {
      available: true,
      data: [
        { slotLabel: 'QB', you: cell('1', 'Done Guy', { actual: 20, gameState: 'final' }), opponent: cell('2', 'Playing Guy', { actual: 4, gameState: 'live' }) },
        { slotLabel: 'RB', you: cell('3', 'Waiting Guy', { gameState: 'upcoming' }), opponent: cell('4', 'Out Guy', { projected: 0, actual: 0, unavailable: 'out', gameState: 'final' }) },
      ],
    },
    identityNote: null,
    playerScoring: scored ? { available: true, data: { playersScored: 3, source: 'Sleeper' } } : { available: false, reason: 'projections' },
    winProbability: { available: false, reason: 'n/a' },
    projectedFinal: { available: false, reason: 'n/a' },
    yetToPlay: { available: false, reason: 'tally' },
    starterCountsBySide: bySide,
  }
}

const marker = (name: string) =>
  screen.getByText(name).closest('.af-mu-half')?.querySelector('.af-mu-gs')?.getAttribute('data-state') ?? null

describe('per-player game state on a live board', () => {
  it('marks who is playing now and who is yet to play, and nobody whose game is over', () => {
    render(<Matchup data={data('live')} />)
    expect(marker('Playing Guy')).toBe('live')
    expect(marker('Waiting Guy')).toBe('upcoming')
    expect(marker('Done Guy')).toBeNull()
    // Ruled out is a certain zero — nothing left to play, so no marker beside his OUT.
    expect(marker('Out Guy')).toBeNull()
    expect(screen.getByRole('img', { name: 'Yet to play' })).toBeTruthy()
  })

  it('explains the markers once, above the board', () => {
    const { container } = render(<Matchup data={data('live')} />)
    expect(container.querySelector('.af-mu-gs-key')?.textContent).toMatch(/playing now.*yet to play/)
  })

  it('shows no markers before kickoff, when every starter is yet to play', () => {
    const { container } = render(<Matchup data={data('upcoming')} />)
    expect(container.querySelectorAll('.af-mu-board-row .af-mu-gs')).toHaveLength(0)
    expect(container.querySelector('.af-mu-gs-key')).toBeNull()
  })
})

describe('left to play, under each live score', () => {
  it('counts yet-to-play and playing-now starters for each side', () => {
    const { container } = render(
      <Matchup data={data('live', { you: { ...zero, upcoming: 1, final: 1 }, opponent: { ...zero, live: 1, final: 1 } })} />,
    )
    expect([...container.querySelectorAll('.af-mu-left')].map((n) => n.textContent)).toEqual(['1 left to play', '1 left to play'])
  })

  it('says All played when a side has nothing left', () => {
    const { container } = render(
      <Matchup data={data('live', { you: { ...zero, final: 2 }, opponent: { ...zero, upcoming: 2 } })} />,
    )
    expect([...container.querySelectorAll('.af-mu-left')].map((n) => n.textContent)).toEqual(['All played', '2 left to play'])
  })

  it('🛑 shows no count for a side with any starter we could not place — "fewer left" would be false', () => {
    const { container } = render(
      <Matchup data={data('live', { you: { ...zero, upcoming: 1, unknown: 1 }, opponent: { ...zero, upcoming: 2 } })} />,
    )
    expect([...container.querySelectorAll('.af-mu-left')].map((n) => n.textContent)).toEqual(['2 left to play'])
  })

  it('is absent before kickoff and once the week is final', () => {
    const counts = { you: { ...zero, upcoming: 2 }, opponent: { ...zero, upcoming: 2 } }
    for (const state of ['upcoming', 'final'] as const) {
      const { container, unmount } = render(<Matchup data={data(state, counts)} />)
      expect(container.querySelectorAll('.af-mu-left')).toHaveLength(0)
      unmount()
    }
  })
})

describe('the page keeps itself current during games', () => {
  const live = (c: HTMLElement) => c.querySelector('.af-mu-week .af-mp-live')

  /*
   * 🛑 LIVE MEANS A STARTER'S GAME IS IN PROGRESS, NOT A STARTER LEFT (2026-10-02). Counting starters
   * still to kick off held this page on 20s from Thursday night to Monday; an unknown state held it
   * there all season for every non-NFL league. Idle now means two minutes, and a refresh at kickoff.
   */
  it('polls at the live cadence while a starter is playing', () => {
    const { container } = render(<Matchup data={data('live', { you: { ...zero, live: 1 }, opponent: zero })} />)
    expect(live(container)?.getAttribute('data-inplay')).toBe('true')
    expect(screen.getByRole('button', { name: 'Refresh this matchup' })).toBeTruthy()
  })

  it('🛑 idles while starters are only still to play — Friday after a Thursday game', () => {
    const { container } = render(<Matchup data={data('live', { you: { ...zero, upcoming: 1, final: 1 }, opponent: { ...zero, upcoming: 2 } })} />)
    expect(live(container)?.getAttribute('data-inplay')).toBe('false')
    /* Still refreshable by hand, and still on the idle cadence. */
    expect(screen.getByRole('button', { name: 'Refresh this matchup' })).toBeTruthy()
  })

  it('🛑 an unknown game state idles (refreshed every two minutes), it does not hold 20s', () => {
    const { container } = render(<Matchup data={data('live', { you: { ...zero, unknown: 1 }, opponent: { ...zero, final: 2 } })} />)
    expect(live(container)?.getAttribute('data-inplay')).toBe('false')
  })

  it('idles before kickoff, and offers no refresh at all once the week is final', () => {
    const before = render(<Matchup data={data('upcoming')} />)
    expect(live(before.container)?.getAttribute('data-inplay')).toBe('false')
    before.unmount()
    const after = render(<Matchup data={data('final')} />)
    expect(live(after.container)).toBeNull()
  })
})
