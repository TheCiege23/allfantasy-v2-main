import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import WeekBoard from '@/components/core-app/boards/WeekBoard'
import YourWeek from '@/components/core-app/screens/YourWeek'
import type { EliminationWeek, WeekBoard as WeekBoardData } from '@/lib/core-app/weekBoard'
import type { EliminationSettle } from '@/lib/core-app/eliminationSettle'

/*
 * The elimination card's value column (2026-09-28). A guillotine week read "+41.2 clear" for a
 * user whose starters, and the last team's, had all finished — they could not be chopped. With a
 * settle verdict the card says SAFE · decided; while open it says what is still to play; with no
 * verdict it is exactly what it was.
 */
function elim(settle?: EliminationSettle | null, over: Partial<EliminationWeek> = {}): EliminationWeek {
  return {
    leagueId: 'g1', platformLeagueId: 'p-g1', yourRosterId: '4', leagueName: 'Chop Shop', platform: 'sleeper', leagueImageUrl: null,
    season: 2026, week: 3, yourScore: 87.74, cutLine: 46.54, rank: 4, fieldSize: 16, margin: 41.2, onTheBlock: false, labelled: true,
    href: '/core/matchup?league=g1',
    ...(settle !== undefined ? { settle } : {}),
    ...over,
  }
}

function board(e: EliminationWeek): WeekBoardData {
  return {
    season: 2026, week: 3, coinFlips: [], leaning: [], unprojected: [], eliminationWeeks: [e],
    model: { basis: 'per-team scoring distributions', sampleSize: 40 }, withoutSchedule: 0, firstKickoffAt: null, leagueBoard: null,
  }
}

const SAFE: EliminationSettle = { verdict: 'safe', finishedBelow: 7, chops: 1 }
const OPEN_MINE: EliminationSettle = { verdict: 'open', yourUpcoming: 1, yourLive: 1, yourUnknown: 0, finishedBelow: 0, chops: 1, cutLinePending: 3 }
const OPEN_LAST: EliminationSettle = { verdict: 'open', yourUpcoming: 0, yourLive: 0, yourUnknown: 0, finishedBelow: 0, chops: 1, cutLinePending: 2 }
const CHOPPED: EliminationSettle = { verdict: 'chopped', chops: 1 }

const renderBoard = (e: EliminationWeek) =>
  render(<WeekBoard board={board(e)} outlook={null} rivalriesHref="/core/week?view=rivalries" allHref="/core/week?all=1" totalLeagues={1} />).container
const renderWeek = (e: EliminationWeek) =>
  render(<YourWeek data={board(e)} rivalriesHref="/core/week?view=rivalries" />).container

describe.each([
  ['WeekBoard', renderBoard, '.af-bd-val'],
  ['YourWeek', renderWeek, '.af-wk-lean-prob'],
] as const)('%s elimination value', (_name, draw, selector) => {
  const value = (e: EliminationWeek) => draw(e).querySelector<HTMLElement>(selector)!

  it('a decided week reads SAFE · decided, not a margin', () => {
    const v = value(elim(SAFE))
    expect(v.textContent).toContain('SAFE')
    expect(v.textContent).toContain('decided')
    expect(v.textContent).not.toContain('+41.2')
    expect(v.getAttribute('data-settled')).toBe('true')
    expect(v.getAttribute('data-tone')).toBe('up')
  })

  it('an open week keeps the margin and says what is still to play', () => {
    expect(value(elim(OPEN_MINE)).textContent).toMatch(/\+41\.2\s*2 to play/)
    expect(value(elim(OPEN_LAST)).textContent).toMatch(/\+41\.2\s*last team playing/)
  })

  it('a week decided against you reads OUT · decided', () => {
    const v = value(elim(CHOPPED, { yourScore: 40, cutLine: 40, margin: 0, onTheBlock: true, rank: 16 }))
    expect(v.textContent).toMatch(/OUT\s*decided/)
    expect(v.getAttribute('data-tone')).toBe('down')
  })

  it('with no verdict (unread, or a failed read) the card is exactly what it was', () => {
    for (const s of [undefined, null]) {
      const v = value(elim(s))
      expect(v.textContent).toMatch(/\+41\.2\s*clear/)
      expect(v.getAttribute('data-settled')).toBeNull()
    }
  })
})
