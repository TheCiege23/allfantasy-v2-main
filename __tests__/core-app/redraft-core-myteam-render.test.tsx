/**
 * /core batch B2 rendered: My team and Your week emit the redraft hooks from REAL data only, and the
 * hooks are inert outside the shell stamp (the stylesheet half is redraftCoreMyTeam.test.ts).
 *
 * Fixtures are the harness's own (app/e2e/redraft-core/myteam/fixtures.ts), so the screenshots and these
 * assertions describe the same screens.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import YourWeekLeague from '@/components/core-app/screens/YourWeekLeague'
import { myTeamFixture, weekBoardFixture } from '@/app/e2e/redraft-core/myteam/fixtures'
import type { LineupSlot } from '@/lib/core-app/myTeam'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 503 }))))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const slotTones = (c: HTMLElement) =>
  [...c.querySelectorAll('#af-mt-starters .af-mt-slot')].map((el) => [el.textContent?.trim(), el.getAttribute('data-rd-pos')])

describe('My team — sport-correct position chips', () => {
  it('NHL: C is a centre (blue), G a goalie (red), D defence (amber)', () => {
    const { container } = render(<MyTeam data={myTeamFixture('NHL')} />)
    const tones = Object.fromEntries(slotTones(container))
    expect(tones).toMatchObject({ C: 'blue', G: 'red', D: 'amber', LW: 'green' })
  })
  it('MLB: C is a catcher (violet), SP red, RP amber', () => {
    const { container } = render(<MyTeam data={myTeamFixture('MLB')} />)
    expect(Object.fromEntries(slotTones(container))).toMatchObject({ C: 'violet', SP: 'red', RP: 'amber', OF: 'blue' })
  })
  it('soccer: DEF is a defender (blue), not a team defence', () => {
    const { container } = render(<MyTeam data={myTeamFixture('SOCCER')} />)
    expect(Object.fromEntries(slotTones(container))).toMatchObject({ DEF: 'blue', GKP: 'amber', FWD: 'red' })
  })
  it('an EMPTY slot (no player) still takes its tone from the league sport', () => {
    const { container } = render(<MyTeam data={myTeamFixture('NFL')} />)
    const empty = container.querySelector('.af-mt-row[data-empty="true"] .af-mt-slot')
    expect(empty?.getAttribute('data-rd-pos')).toBe('violet') // the K slot
  })
  it('the football data-pos chips are left as they were', () => {
    const { container } = render(<MyTeam data={myTeamFixture('NFL')} />)
    expect(container.querySelector('#af-mt-starters .af-mt-slot')?.getAttribute('data-pos')).toBe('qb')
  })
})

describe('My team — bye vs off day, from data only', () => {
  it('daily sport: a starter whose slate shows no game gets the off-day badge, once', () => {
    const { getAllByTestId } = render(<MyTeam data={myTeamFixture('NBA')} />)
    const badges = getAllByTestId('my-team-no-game')
    expect(badges).toHaveLength(1)
    expect(badges[0].getAttribute('data-kind')).toBe('offday')
    expect(badges[0].textContent).toBe('Off day')
  })
  it('a weekly idle team reads "No games"', () => {
    const data = myTeamFixture('NHL')
    const starters = (data.starters as { data: LineupSlot[] }).data
    starters[4] = { ...starters[4], player: { ...starters[4].player!, noGamePeriod: 'week' } }
    const { getByTestId } = render(<MyTeam data={data} />)
    expect(getByTestId('my-team-no-game').getAttribute('data-kind')).toBe('idle')
  })
  it('CONTROL: without noGamePeriod there is no badge — an unread slate is not an off day', () => {
    const data = myTeamFixture('NBA')
    for (const s of (data.starters as { data: LineupSlot[] }).data) if (s.player) delete s.player.noGamePeriod
    const { queryByTestId } = render(<MyTeam data={data} />)
    expect(queryByTestId('my-team-no-game')).toBeNull()
  })
  it('football: the bye badge, not the off-day one', () => {
    const { container, queryByTestId } = render(<MyTeam data={myTeamFixture('NFL')} />)
    expect(queryByTestId('my-team-no-game')).toBeNull()
    expect(container.querySelector('.af-mt-row[data-bye="true"] .af-mt-bye')).not.toBeNull()
  })
  it('DTD / GTD render as the sport says them', () => {
    const { container } = render(<MyTeam data={myTeamFixture('NBA')} />)
    const shorts = [...container.querySelectorAll('.af-mt-status')].map((e) => e.textContent)
    expect(shorts).toContain('DTD')
    expect(shorts).toContain('GTD')
  })
})

describe('My team — the period chip', () => {
  it('daily sport: names the one day the outlook priced', () => {
    const { getByTestId } = render(<MyTeam data={myTeamFixture('MLB')} />)
    const chip = getByTestId('my-team-lineup-period')
    expect(chip.getAttribute('data-kind')).toBe('day')
    expect(chip.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-30')
    expect(chip.textContent).toContain('Oct 30')
  })
  it('football (no outlook period): no chip at all', () => {
    const { queryByTestId } = render(<MyTeam data={myTeamFixture('NFL')} />)
    expect(queryByTestId('my-team-lineup-period')).toBeNull()
  })
})

describe('My team — the table footer, the alert card and the matchup link (design board MyTeam)', () => {
  type Proj = { available: true; data: { afTotal: number | null; afProjected: number; projected: number; unprojected: number } }
  it('the starters footer is the league-scored total, with how many starters it was built from', () => {
    const data = myTeamFixture('NFL')
    const proj = (data.projections as Proj).data
    const { getByTestId } = render(<MyTeam data={data} />)
    const total = getByTestId('my-team-starters-total')
    expect(total.closest('#af-mt-starters')).not.toBeNull()
    expect(total.querySelector('.af-mt-total-value')?.textContent).toBe(proj.afTotal!.toFixed(1))
    expect(total.textContent).toContain(`${proj.afProjected} of ${proj.projected + proj.unprojected} priced for this league`)
  })
  it('CONTROL: no league-scored total, no footer — never the standard number under its label', () => {
    const data = myTeamFixture('NFL')
    ;(data.projections as Proj).data.afTotal = null
    const { queryByTestId } = render(<MyTeam data={data} />)
    expect(queryByTestId('my-team-starters-total')).toBeNull()
  })
  it('the Lineup check heading carries its alert icon, hidden from screen readers, and still reads "Lineup check"', () => {
    const { container } = render(<MyTeam data={myTeamFixture('NFL')} />)
    const h2 = container.querySelector('.af-mt-check > h2')
    expect(h2?.querySelector('.af-mt-check-icon')?.getAttribute('aria-hidden')).toBe('true')
    expect(h2?.textContent).toBe('Lineup check')
  })
  it('the matchup card links through to this league’s Matchup screen', () => {
    const { container } = render(<MyTeam data={myTeamFixture('NFL')} />)
    const go = container.querySelector('.af-mt-matchup a.af-mt-mu-go')
    expect(go?.getAttribute('href')).toBe('/core/matchup?league=e2e-redraft-core')
    expect(go?.textContent).toBe('Go to matchup')
  })
})

describe('Your week — the season-race line', () => {
  it('week, your record, and your place by record (a tie said as one)', () => {
    const { getByTestId } = render(<YourWeekLeague board={weekBoardFixture('NFL')} allWeeksHref="/core/week" />)
    const race = getByTestId('week-season-race').textContent?.replace(/\s+/g, ' ')
    expect(race).toContain('9')
    expect(race).toContain('6—2')
    expect(race).toContain('T-1st of 10')
    expect(race).toContain('by record')
  })
  it('a team in the week with no record drops the place, keeps the record', () => {
    const board = weekBoardFixture('NFL')
    delete (board.records as Record<string, unknown>).r7
    const { getByTestId } = render(<YourWeekLeague board={board} allWeeksHref="/core/week" />)
    const race = getByTestId('week-season-race').textContent ?? ''
    expect(race).toContain('6—2')
    expect(race).not.toContain('by record')
  })
  it('no record for you at all: no race line', () => {
    const board = weekBoardFixture('NFL')
    board.records = {}
    const { queryByTestId } = render(<YourWeekLeague board={board} allWeeksHref="/core/week" />)
    expect(queryByTestId('week-season-race')).toBeNull()
  })
})
