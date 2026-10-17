import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'
import { isGuillotineLeague, isTeamEliminated } from '@/lib/core-app/teamElimination'

describe('one elimination rule for both My Team views', () => {
  const guillotineByVariant = { guillotineMode: false, leagueVariant: 'guillotine' }
  it('reads a guillotine league from either flag', () => {
    expect(isGuillotineLeague({ guillotineMode: true })).toBe(true)
    expect(isGuillotineLeague(guillotineByVariant)).toBe(true)
    expect(isGuillotineLeague({ leagueVariant: 'SURVIVOR_GUILLOTINE' })).toBe(true)
    expect(isGuillotineLeague({ guillotineMode: false, leagueVariant: 'dynasty' })).toBe(false)
  })
  it('an emptied roster is a chop in a guillotine league marked only by leagueVariant', () => {
    // The board used to read only guillotineMode, so this team stayed on it as "needs a lineup".
    expect(isTeamEliminated({ playerData: { players: [] }, league: guillotineByVariant, eliminationRecorded: false })).toBe(true)
  })
  it('a recorded elimination is enough on its own', () => {
    // The league view used to ignore the table, so a chopped team still got lineup advice.
    expect(isTeamEliminated({ playerData: { players: ['1', '2'] }, league: { guillotineMode: true }, eliminationRecorded: true })).toBe(true)
  })
  it('the provider flag is enough, and an empty roster outside guillotine is not a chop', () => {
    expect(isTeamEliminated({ playerData: { eliminated: true }, league: {}, eliminationRecorded: false })).toBe(true)
    expect(isTeamEliminated({ playerData: { players: [] }, league: { leagueVariant: 'redraft' }, eliminationRecorded: false })).toBe(false)
    expect(isTeamEliminated({ playerData: null, league: { guillotineMode: true }, eliminationRecorded: false })).toBe(false)
  })
})

function player(over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
    gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
    preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
    afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null,
    market: null, onBye: false, ...over,
  }
}

function data(over: Partial<MyTeamData> = {}): MyTeamData {
  return {
    league: { id: 'l1', name: 'KBFL', platform: 'manual', format: 'dynasty', sourceLink: null },
    team: {
      available: true,
      data: {
        teamName: 'BroVengers', ownerName: 'TheCiege24', managerAvatarUrl: null,
        record: 'No game in this league has been scored yet, so there is no record to read.',
        recordKnown: false, rank: 3, pointsFor: 0, pointsAgainst: 0, teamCount: 12,
      },
    },
    starters: { available: true, data: [{ slotLabel: 'FLEX', player: null, empty: true, unresolvedId: null }] },
    bench: { available: true, data: [] },
    ir: { available: true, data: [player({ sleeperId: 'ir1' })] },
    taxi: { available: false, reason: 'nobody on the taxi squad' },
    unidentified: { bench: 3, ir: 1, taxi: 0 },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: { available: false, reason: 'n/a' },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
    ...over,
  } as unknown as MyTeamData
}

describe('My Team correctness pass (league view)', () => {
  it('says unmatched bench and IR players exist instead of rendering an empty list', () => {
    const { container } = render(<MyTeam data={data()} />)
    const notes = [...container.querySelectorAll('.af-mt-unidentified')].map((n) => n.textContent ?? '')
    expect(notes).toHaveLength(2)
    expect(notes[0]).toContain('3 more players')
    expect(notes[1]).toContain('1 more player ')
  })

  it('prints no rank before a game is scored — it is import order', () => {
    const { container } = render(<MyTeam data={data()} />)
    const meta = container.querySelector('.af-mt-head-meta')!.textContent ?? ''
    expect(meta).not.toContain('3 of 12')
    expect(meta).toContain('12 teams')
  })

  it('prints the rank once the record exists', () => {
    const d = data()
    ;(d.team as { data: { recordKnown: boolean; record: string } }).data.recordKnown = true
    ;(d.team as { data: { recordKnown: boolean; record: string } }).data.record = '2-1'
    const { container } = render(<MyTeam data={d} />)
    expect(container.querySelector('.af-mt-head-meta')!.textContent).toContain('3 of 12')
  })

  it('never sends an empty slot to /core/sync when there is no platform link', () => {
    const { container } = render(<MyTeam data={data()} />)
    expect(container.querySelector('a[href="/core/sync"]')).toBeNull()
    expect(container.querySelector('.af-mt-fix-none')?.textContent).toContain('no platform link on file')
  })

  it('links the empty slot to the platform when there is a link', () => {
    const d = data({
      league: {
        id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty',
        sourceLink: { href: 'https://sleeper.com/leagues/1/team', label: 'Sleeper' },
      } as MyTeamData['league'],
    })
    const { container } = render(<MyTeam data={d} />)
    expect(container.querySelector('a.af-mt-fix')?.getAttribute('href')).toBe('https://sleeper.com/leagues/1/team')
  })
})
