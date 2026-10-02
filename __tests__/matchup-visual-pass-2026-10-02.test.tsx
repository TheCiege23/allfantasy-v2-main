import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import Matchup, { slotEdges } from '@/components/core-app/screens/Matchup'
import type { MatchupData, MatchupPlayerCell } from '@/lib/core-app/matchup'

/*
 * 2026-10-02 audit of /core/matchup?league=, measured on production:
 *
 *  1. A live week whose matchup nobody had played yet read "0.0 – 0.0 · Level" under
 *     "Win probability 99%" — the platform's 0–0 placeholder was treated as a score.
 *  2. Every unplayed starter read "○ 0.0": Sleeper writes a 0 for each starter when the week
 *     opens, so a yet-to-play marker sat beside what looked like a bust.
 *  3. The board totals printed 0.0 for a side with no priced cell.
 */

afterEach(cleanup)

function cell(id: string, name: string, over: Partial<MatchupPlayerCell> = {}): MatchupPlayerCell {
  return {
    playerId: id, sleeperId: id, name, position: 'RB', team: 'DET', sport: 'NFL', imageUrl: null,
    projected: 12, afEngine: null, actual: null, empty: false, unavailable: null, gameState: 'upcoming', ...over,
  }
}

function data(over: Partial<MatchupData> = {}): MatchupData {
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
    sides: {
      available: true,
      data: {
        you: { teamName: 'Mine', ownerName: 'me', record: '2-1', points: 0, isYou: true, avatarUrl: null },
        opponent: { teamName: 'Theirs', ownerName: 'them', record: '2-1', points: 0, isYou: false, avatarUrl: null },
      },
    },
    lineups: {
      available: true,
      data: [
        { slotLabel: 'QB', you: cell('1', 'Sunday Guy', { projected: 23, actual: 0 }), opponent: cell('2', 'Monday Guy', { projected: 18, actual: 0 }) },
        { slotLabel: 'RB', you: cell('3', 'Other Guy', { projected: 15, actual: 0 }), opponent: cell('4', 'Hurt Guy', { projected: 0, actual: 0, unavailable: 'out', gameState: 'final' }) },
      ],
    },
    identityNote: null,
    playerScoring: { available: true, data: { playersScored: 4, source: 'Sleeper' } },
    winProbability: { available: true, data: { pWin: 0.99, confidence: 'low', detail: '19 yet to start' } } as MatchupData['winProbability'],
    projectedFinal: { available: true, data: { you: 187.4, opponent: 113.1, unprojected: { you: 0, opponent: 0 } } } as MatchupData['projectedFinal'],
    yetToPlay: { available: false, reason: 'tally' },
    starterCountsBySide: {
      you: { upcoming: 2, live: 0, final: 0, unknown: 0 },
      opponent: { upcoming: 1, live: 0, final: 1, unknown: 0 },
    },
    ...over,
  }
}

const scores = (c: HTMLElement) => [...c.querySelectorAll('.af-mu-score')].map((n) => n.textContent)

describe('🛑 a 0–0 placeholder before anyone has played is not a score', () => {
  it('shows the projected finals, labelled, instead of 0.0 – 0.0', () => {
    const { container } = render(<Matchup data={data()} />)
    expect(scores(container)).toEqual(['187.4', '113.1'])
    for (const n of container.querySelectorAll('.af-mu-score')) expect(n.getAttribute('data-basis')).toBe('projected')
  })

  it('never puts "Level" beside a 99% win probability', () => {
    render(<Matchup data={data()} />)
    expect(screen.queryByText('Level')).toBeNull()
    expect(screen.getByText(/Projected ahead by/)).toBeTruthy()
  })

  it('keeps a real 0–0 once a starter has actually played', () => {
    const d = data()
    if (d.lineups.available) d.lineups.data[0].opponent = cell('2', 'Monday Guy', { actual: 0, gameState: 'final' })
    const { container } = render(<Matchup data={d} />)
    expect(scores(container)).toEqual(['0.0', '0.0'])
    expect(screen.getByText('Level')).toBeTruthy()
  })

  it('a ruled-out starter does not count as having played', () => {
    // Hurt Guy is final+unavailable in the fixture — the banner must still fall back.
    const { container } = render(<Matchup data={data()} />)
    expect(container.querySelector('.af-mu-score')?.getAttribute('data-basis')).toBe('projected')
  })
})

describe('🛑 an unplayed starter has no points, not zero points', () => {
  it('renders "—" with a labelled projection, not 0.0', () => {
    render(<Matchup data={data()} />)
    const half = screen.getByText('Sunday Guy').closest('.af-mu-half')!
    const pts = half.querySelector('.af-mu-half-pts')!
    expect(pts.getAttribute('data-unpriced')).toBe('true')
    expect(pts.textContent).not.toMatch(/0\.0/)
    expect(half.querySelector('.af-mu-half-proj')?.textContent).toBe('proj 23.0')
  })

  it('shows a played zero as 0.0', () => {
    const d = data()
    if (d.lineups.available) d.lineups.data[0].you = cell('1', 'Sunday Guy', { actual: 0, gameState: 'final' })
    render(<Matchup data={d} />)
    const pts = screen.getByText('Sunday Guy').closest('.af-mu-half')!.querySelector('.af-mu-half-pts')!
    expect(pts.textContent).toMatch(/0\.0/)
  })

  it('prints "—" for a board total with nothing priced on that side', () => {
    const { container } = render(<Matchup data={data()} />)
    const totals = [...container.querySelectorAll('.af-mu-board-foot .af-mu-foot-total')].map((n) => n.textContent)
    expect(totals[0]).toBe('—')
  })
})

describe('slot edges', () => {
  it('compares projections before kickoff and points once played', () => {
    const slot = { slotLabel: 'QB', you: cell('1', 'A', { projected: 20, actual: 9, gameState: 'final' }), opponent: cell('2', 'B', { projected: 10, actual: 14, gameState: 'final' }) }
    expect(slotEdges(slot, false)).toEqual({ you: 'ahead', opponent: 'behind' })
    expect(slotEdges(slot, true)).toEqual({ you: 'behind', opponent: 'ahead' })
  })

  it('refuses to call a slot where either side has not played', () => {
    const slot = { slotLabel: 'QB', you: cell('1', 'A', { actual: 9, gameState: 'final' }), opponent: cell('2', 'B', { actual: 0, gameState: 'upcoming' }) }
    expect(slotEdges(slot, true)).toBeNull()
  })

  it('tallies the comparable slots above the board', () => {
    const d = data({ playerScoring: { available: false, reason: 'projections' } } as Partial<MatchupData>)
    const { container } = render(<Matchup data={d} />)
    expect(container.querySelector('.af-mu-tally-n')?.textContent).toBe('2')
    expect(container.querySelector('.af-mu-tally')?.getAttribute('data-leader')).toBe('you')
  })
})

describe('win probability bar', () => {
  it('draws your share as a bar beside the number', () => {
    const { container } = render(<Matchup data={data()} />)
    expect((container.querySelector('.af-mu-wp-you') as HTMLElement).style.width).toBe('99%')
    expect(screen.getByRole('img', { name: 'Win probability 99%' })).toBeTruthy()
  })
})
