import React from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'

/*
 * My Team phone audit, 2026-10-01 — the behaviour half (layout is pinned in my-team-phone-css).
 *
 *  - the platform read "sleeper" in "Fix in sleeper" and "Lineup from sleeper";
 *  - the lock banner's "Fix it in Sleeper" was a span styled like a link, and did nothing;
 *  - the lock time was printed in UTC whatever the reader's zone;
 *  - the empty-slot "Fix in" button had drifted OUT of the cell its CSS was written for.
 */

const NOW = new Date('2026-10-01T20:00:00Z')
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(cleanup)

const LINEUP_URL = 'https://sleeper.com/leagues/123/team'

function player(over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
    gameContext: 'DEN vs MIA', kickoff: new Date('2026-10-04T17:00:00Z'), preseason: false, venue: null,
    injuryStatus: null, ruledOut: false, projectedPoints: 19.8, afProjectedPoints: 22.4, indoors: false,
    weather: null, market: null, onBye: false, ...over,
  }
}

function data(over: Partial<MyTeamData> & { emptySlot?: boolean; link?: boolean } = {}): MyTeamData {
  const { emptySlot = true, link = true, ...rest } = over
  const starters: LineupSlot[] = [
    { slotLabel: 'QB', benchCheck: null, player: player(), empty: false, unresolvedId: null },
    ...(emptySlot ? [{ slotLabel: 'DEF', benchCheck: null, player: null, empty: true, unresolvedId: null }] : []),
  ]
  return {
    league: {
      id: 'l1', name: 'SF TEP.5', platform: 'sleeper', format: 'dynasty',
      sourceLink: link ? ({ href: LINEUP_URL, label: 'Fix Lineup in SF TEP.5' } as never) : null,
    },
    team: { available: true, data: { teamName: 'Mine', ownerName: 'me', managerAvatarUrl: null, record: '3-1', recordKnown: true, rank: 2, pointsFor: 400, pointsAgainst: 380, teamCount: 12 } },
    starters: { available: true, data: starters },
    identityNote: null,
    bench: { available: false, reason: 'none' },
    ir: { available: false, reason: 'none' },
    taxi: { available: false, reason: 'none' },
    lock: { available: true, data: { at: new Date('2026-10-02T00:15:00Z'), anyEmptySlot: emptySlot, week: 5, season: 2026, daysAway: 0 } },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: true },
    nextMatchup: { available: false, reason: 'n/a' },
    rosterGrade: { available: false, reason: 'n/a' },
    upcomingByes: [],
    liveScore: { available: false, reason: 'n/a' },
    ...rest,
  }
}

describe('the platform is named, not given as its id', () => {
  it('reads "Fix in Sleeper" on an empty slot, and "Lineup from Sleeper" above the starters', () => {
    const { container } = render(<MyTeam data={data()} />)
    expect(container.querySelector('.af-mt-fix')?.textContent?.trim()).toBe('Fix in Sleeper')
    expect(container.textContent).toContain('Lineup from Sleeper.')
    expect(container.textContent).not.toMatch(/\bsleeper\b/)
  })
})

describe('the empty-slot fix button', () => {
  it('sits INSIDE the empty cell its CSS lays out, not loose in the row grid', () => {
    const { container } = render(<MyTeam data={data()} />)
    const fix = container.querySelector('.af-mt-fix')!
    expect(fix.parentElement?.classList.contains('af-mt-empty-text')).toBe(true)
  })
})

describe('the lineup-lock banner', () => {
  it('🛑 "Fix it in Sleeper" is a real link to the lineup screen, opened like every provider hand-off', () => {
    const { container } = render(<MyTeam data={data()} />)
    const fix = container.querySelector('.af-mt-lock-fix')!
    expect(fix.tagName).toBe('A')
    expect(fix.getAttribute('href')).toBe(LINEUP_URL)
    expect(fix.getAttribute('target')).toBe('_blank')
    expect(fix.getAttribute('rel')).toContain('noopener')
  })

  it('stays plain text when no provider screen was resolved — never a link to nowhere', () => {
    const { container } = render(<MyTeam data={data({ link: false })} />)
    expect(container.querySelector('.af-mt-lock-fix')?.tagName).toBe('SPAN')
  })

  it('prints the lock time in the reader’s own clock after mount, not a UTC timestamp', () => {
    render(<MyTeam data={data()} />)
    const note = document.querySelector('.af-mt-lock-note')!.textContent ?? ''
    // `toUTCString()` reads "Fri, 02 Oct 2026 00:15 UTC"; the local form reads "Thu, Oct 1, 8:15 PM EDT".
    expect(note).not.toMatch(/\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} UTC/)
    expect(note).toMatch(/\d{1,2}:\d{2}/)
    expect(screen.getByText(/confirm individual locks/)).toBeTruthy()
  })
})
