/**
 * What an account with NO leagues sees (2026-09-29).
 *
 * Trades, Waivers and Draft HQ (bottom-bar tabs) and Week each dead-ended in one sentence for a new
 * user — the first screens an App Store reviewer sees — and Home's Chimmy card said "you're clean
 * across every league". Every one now says no league is connected and offers a way forward.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {}, back() {}, forward() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import TradesBoard from '@/components/core-app/boards/TradesBoard'
import WaiversBoard from '@/components/core-app/boards/WaiversBoard'
import DraftHqBoard from '@/components/core-app/boards/DraftHqBoard'
import WeekBoard from '@/components/core-app/boards/WeekBoard'
import { NO_LEAGUE_ACTIONS } from '@/components/core-app/boards/BoardKit'
import { PickALeague } from '@/components/core-app/PickALeague'
import { Dash3AChimmy, connectedLeagueCount } from '@/components/core-app/screens/Dashboard3A'

const trades = { pending: [], windows: [], considered: 0, deadlineUnknown: 0, currentWeek: null } as never
const waivers = {
  rows: [], considered: 0, withheld: { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0 }, marketLeagues: 0, at: null,
} as never
const drafts = { rows: [], counts: { live: 0, upcoming: 0, done: 0, unknown: 0 }, withoutDraft: 0 } as never
const week = {
  season: 2026, week: 3, coinFlips: [], leaning: [], unprojected: [], eliminationWeeks: [],
  model: { basis: 'per-team scoring distributions', sampleSize: 0 }, withoutSchedule: 0, firstKickoffAt: null, leagueBoard: null,
} as never

const BOARDS = [
  ['Trades', (n: number) => <TradesBoard data={trades} allHref="/core/trades?all=1" totalLeagues={n} />, 'No team of yours is claimed'],
  ['Waivers', (n: number) => <WaiversBoard data={waivers} allHref="/core/waivers?all=1" totalLeagues={n} />, 'no wire to read'],
  ['Draft HQ', (n: number) => <DraftHqBoard data={drafts} allHref="/core/draft-hq?all=1" totalLeagues={n} picks={null as never} />, 'No draft to show yet'],
  ['Week', (n: number) => <WeekBoard board={week} outlook={null} rivalriesHref="/core/week?view=rivalries" allHref="/core/week?all=1" totalLeagues={n} />, 'not projected ahead in any league'],
] as const

const hrefs = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="board-no-leagues"] a')].map((a) => a.getAttribute('href'))

describe.each(BOARDS)('%s board with no leagues', (_name, draw, deadEnd) => {
  it('says no league is connected and offers the importer, a mock draft and the trade grader', () => {
    const { container } = render(draw(0))
    expect(container.textContent).toContain('No leagues connected yet.')
    expect(hrefs(container)).toEqual(NO_LEAGUE_ACTIONS.map((a) => a.href))
    // The old dead-end sentence is gone.
    expect(container.textContent).not.toContain(deadEnd)
  })

  /* The positive control: an account WITH leagues is untouched, even when its board is empty. */
  it('is not shown to an account that has leagues', () => {
    const { container } = render(draw(3))
    expect(container.querySelector('[data-testid="board-no-leagues"]')).toBeNull()
    expect(container.textContent).toContain(deadEnd)
  })
})

it('the Connect action is the primary button, and all three are real links', () => {
  expect(NO_LEAGUE_ACTIONS.map((a) => a.href)).toEqual(['/import', '/mock-draft', '/trade-evaluator'])
  expect(NO_LEAGUE_ACTIONS.filter((a) => a.primary).map((a) => a.href)).toEqual(['/import'])
})

describe('PickALeague with no leagues', () => {
  const pick = (leagues: Array<{ id: string; name: string }>) =>
    render(<PickALeague tabKey="trades" title="Trades" blurb="Per league." issues={[]} leagues={leagues as never} />).container

  it('offers a way forward instead of "Pick one below … 0 on file"', () => {
    const c = pick([])
    expect(c.querySelector('[data-testid="board-no-leagues"]')).not.toBeNull()
    expect(c.textContent).not.toContain('0 on file')
    expect(c.textContent).not.toContain('Nothing in your leagues is waiting')
  })

  it('still lists leagues when there are some', () => {
    const c = pick([{ id: 'l1', name: 'Ice Kings' }])
    expect(c.querySelector('[data-testid="board-no-leagues"]')).toBeNull()
    expect(c.textContent).toContain('Ice Kings')
  })
})

describe("Home's Chimmy card", () => {
  it('does not call an account with no leagues "clean"', () => {
    const { container } = render(<Dash3AChimmy openCount={0} leagueCount={0} />)
    expect(container.textContent).toContain('No leagues connected yet.')
    expect(container.textContent).not.toContain('clean across every league')
    expect(container.querySelector('a[href="/import"]')).not.toBeNull()
  })

  it('still says "clean" when leagues exist and nothing is open, and keeps the old line when the count is unknown', () => {
    expect(render(<Dash3AChimmy openCount={0} leagueCount={4} />).container.textContent).toContain('clean across every league')
    expect(render(<Dash3AChimmy openCount={0} />).container.textContent).toContain('clean across every league')
  })

  it('counts past seasons as connected — an account with only history is not "no leagues"', () => {
    expect(connectedLeagueCount({ totalLeagues: 0, legacyCount: 0 })).toBe(0)
    expect(connectedLeagueCount({ totalLeagues: 0, legacyCount: 3 })).toBe(3)
    expect(connectedLeagueCount({ totalLeagues: 5 })).toBe(5)
    expect(connectedLeagueCount(null)).toBeNull()
    expect(connectedLeagueCount({ totalLeagues: null })).toBeNull()
  })
})
