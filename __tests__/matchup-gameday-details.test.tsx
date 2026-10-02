import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import Matchup, { injuryTag } from '@/components/core-app/screens/Matchup'
import type { MatchupData, MatchupPlayerCell } from '@/lib/core-app/matchup'

/*
 * 2026-10-02 audit, league page: data the loader already read and threw away — a starter's injury
 * designation short of OUT, his kickoff and opponent — plus the head-to-head record and a week picker.
 */

afterEach(cleanup)

function cell(id: string, name: string, over: Partial<MatchupPlayerCell> = {}): MatchupPlayerCell {
  return {
    playerId: id, sleeperId: id, name, position: 'WR', team: 'KC', sport: 'NFL', imageUrl: null,
    projected: 14, afEngine: null, actual: null, empty: false, unavailable: null, gameState: 'upcoming', ...over,
  }
}

function data(over: Partial<MatchupData> = {}): MatchupData {
  return {
    league: { id: 'L1', name: 'Test League', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 4, season: 2026, isFinal: false } },
    weekNav: { prev: 3, next: 5 },
    teams: {
      available: true,
      data: {
        you: { teamName: 'Mine', ownerName: 'me', record: '2-1', isYou: true, avatarUrl: null },
        opponent: { teamName: 'Theirs', ownerName: 'them', record: '2-1', isYou: false, avatarUrl: null },
      },
    },
    sides: { available: false, reason: 'unplayed' },
    lineups: {
      available: true,
      data: [
        {
          slotLabel: 'WR',
          you: cell('1', 'Rashee Rice', { injury: 'Questionable', kickoff: '2026-10-04T17:00:00.000Z', opponentClub: 'BUF', home: true }),
          opponent: cell('2', 'Away Guy', { team: 'SF', kickoff: '2026-10-04T20:25:00.000Z', opponentClub: 'LAR', home: false }),
        },
        { slotLabel: 'RB', you: cell('3', 'Out Guy', { unavailable: 'out', injury: null, kickoff: '2026-10-04T17:00:00.000Z', opponentClub: 'BUF', home: true }), opponent: cell('4', 'Other', {}) },
      ],
    },
    identityNote: null,
    playerScoring: { available: false, reason: 'projections' },
    winProbability: { available: false, reason: 'n/a' },
    projectedFinal: { available: false, reason: 'n/a' },
    yetToPlay: { available: false, reason: 'tally' },
    starterCountsBySide: null,
    headToHead: { wins: 2, losses: 1, ties: 0, meetings: [{ season: 2026, week: 2, you: 132.4, them: 118 }] },
    ...over,
  }
}

const half = (name: string) => screen.getByText(name).closest('.af-mu-half') as HTMLElement

describe('injury designations short of OUT', () => {
  it('tags a questionable starter Q beside his name', () => {
    render(<Matchup data={data()} />)
    expect(half('Rashee Rice').querySelector('.af-mu-inj')?.textContent).toBe('Q')
  })
  it('shortens the feed’s words the way fantasy apps print them', () => {
    expect(['Questionable', 'Doubtful', 'Day-To-Day', 'Probable', 'Suspended indefinitely'].map(injuryTag)).toEqual(['Q', 'D', 'DTD', 'P', 'SUSP'])
  })
})

describe('kickoff and opponent under an unplayed starter', () => {
  it('names the opponent with home/away', () => {
    render(<Matchup data={data()} />)
    expect(half('Rashee Rice').querySelector('.af-mu-half-game')?.textContent).toMatch(/vs BUF/)
    expect(half('Away Guy').querySelector('.af-mu-half-game')?.textContent).toMatch(/@ LAR/)
  })
  it('formats the kickoff in the browser, as a <time> carrying the instant', () => {
    render(<Matchup data={data()} />)
    const t = half('Rashee Rice').querySelector('time')
    expect(t?.getAttribute('dateTime')).toBe('2026-10-04T17:00:00.000Z')
    expect(t?.textContent).toMatch(/\d/)
  })
  it('says nothing about a game for a starter ruled out', () => {
    render(<Matchup data={data()} />)
    expect(half('Out Guy').querySelector('.af-mu-half-game')).toBeNull()
  })
  it('drops the line once his game is final', () => {
    const d = data({ playerScoring: { available: true, data: { playersScored: 2, source: 'Sleeper' } } } as Partial<MatchupData>)
    if (d.lineups.available) d.lineups.data[0].you = cell('1', 'Rashee Rice', { actual: 9, gameState: 'final', kickoff: '2026-10-02T00:15:00.000Z', opponentClub: 'BUF', home: true })
    render(<Matchup data={d} />)
    expect(half('Rashee Rice').querySelector('.af-mu-half-game')).toBeNull()
  })
})

describe('week picker', () => {
  it('links to the stored weeks either side', () => {
    render(<Matchup data={data()} />)
    expect(screen.getByRole('link', { name: 'Week 3' }).getAttribute('href')).toBe('/core/matchup?league=L1&week=3')
    expect(screen.getByRole('link', { name: 'Week 5' }).getAttribute('href')).toBe('/core/matchup?league=L1&week=5')
  })
  it('offers no arrow toward a week with nothing stored', () => {
    render(<Matchup data={data({ weekNav: { prev: null, next: 5 } })} />)
    expect(screen.queryByRole('link', { name: 'Week 3' })).toBeNull()
  })
})

describe('head to head', () => {
  it('states the series and the last meeting', () => {
    render(<Matchup data={data()} />)
    const row = screen.getByText('Head to head').closest('li')!
    expect(row.textContent).toMatch(/2–1/)
    expect(row.textContent).toMatch(/last: W 132\.4–118\.0 \(wk 2\)/)
  })
  it('is absent with no meetings on file', () => {
    render(<Matchup data={data({ headToHead: { wins: 0, losses: 0, ties: 0, meetings: [] } })} />)
    expect(screen.queryByText('Head to head')).toBeNull()
  })
})
