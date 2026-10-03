import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'

function player(id: string, over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: id, name: `Player ${id}`, position: 'QB', team: 'WAS', sport: 'NFL', imageUrl: null,
    gameContext: 'WAS vs IND · Sun 10/4 9:30a ET', kickoff: new Date('2099-10-04T13:30:00Z'),
    preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 10,
    afProjectedPoints: 10, afEngineProjectedPoints: 10, indoors: false, weather: null,
    market: null, onBye: false, ...over,
  }
}
const slot = (label: string, p: LineupPlayer | null, extra: Partial<LineupSlot> = {}): LineupSlot => ({
  slotLabel: label, player: p, empty: p == null, unresolvedId: null, benchCheck: null, ...extra,
})
function data(starters: LineupSlot[]): MyTeamData {
  return {
    league: { id: 'league-kbfl', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: null },
    team: { available: false, reason: 'n/a' },
    starters: { available: true, data: starters },
    bench: { available: false, reason: 'none' },
    ir: { available: false, reason: 'none' },
    taxi: { available: false, reason: 'none' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: { available: false, reason: 'n/a' },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
  } as unknown as MyTeamData
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const BOARD = {
  state: 'ok',
  candidates: [
    { sleeperId: 'fa-qb', name: 'Backup Quarterback', position: 'QB', team: 'NYJ', projectedPoints: 14.2, gain: 14.2, displaces: { name: 'Jayden Daniels' } },
  ],
}

describe('free agents for a hole the bench cannot fill', () => {
  it('asks the waiver board, sending the OUT starter as unavailable, and lists who would start', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(BOARD), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(
      <MyTeam data={data([slot('QB', player('11566', { name: 'Jayden Daniels', ruledOut: true, injuryStatus: 'Out' }))])} />,
    )
    await waitFor(() => expect(container.querySelector('.af-mt-check-fa-list')).not.toBeNull())
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]), 'http://x')
    expect(url.pathname).toBe('/api/idp/players')
    expect(url.searchParams.get('view')).toBe('waiver-board')
    expect(url.searchParams.get('leagueId')).toBe('league-kbfl')
    expect(url.searchParams.get('unavailable')).toBe('11566')
    const fa = container.querySelector('.af-mt-check-fa')!
    expect(fa.textContent).toContain('Backup Quarterback')
    expect(fa.textContent).toContain('+14.2 pts')
    expect(fa.textContent).toContain('replaces Jayden Daniels')
    expect(fa.querySelector('a')?.getAttribute('href')).toBe('/core/waivers?league=league-kbfl')
  })

  it('does not ask when the bench already covers the hole', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <MyTeam
        data={data([
          slot('QB', player('11566', { ruledOut: true }), {
            benchCheck: { verdict: 'swap', benchName: 'Bench QB', benchProjected: 12, starterName: 'Player 11566', starterProjected: 0 },
          }),
        ])}
      />,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not ask when there is no hole at all', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<MyTeam data={data([slot('QB', player('ok'))])} />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says so when no free agent would start, and still links to Waivers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'ok', candidates: [] }), { status: 200 })))
    const { container } = render(<MyTeam data={data([slot('FLEX', null)])} />)
    await waitFor(() => expect(container.querySelector('.af-mt-check-fa')?.textContent).toContain('No free agent improves'))
    expect(container.querySelector('.af-mt-check-fa a')).not.toBeNull()
  })
})
