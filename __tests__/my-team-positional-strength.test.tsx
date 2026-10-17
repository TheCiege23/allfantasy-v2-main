import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))
const rosterFindMany = vi.hoisted(() => vi.fn())
const loadSnapshots = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findMany: rosterFindMany } } }))
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({ loadLatestPlayerValueSnapshots: loadSnapshots }))
vi.mock('@/lib/trade-intel/valueLedger', () => ({ BASELINE_SCORING: {}, buildValueLedger: vi.fn(async () => new Map()) }))

import { getRosterGrade, type RosterGrade } from '@/lib/core-app/rosterGrade'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { MyTeamData } from '@/lib/core-app/myTeam'

/*
 * Four teams, three positions. Prices are chosen so "me" is 1st at RB, 2nd at WR and 4th at TE,
 * with the WR median between t2 and t3.
 */
const PRICE: Record<string, { value: number; position: string }> = {
  myRB: { value: 900, position: 'RB' }, myWR: { value: 600, position: 'WR' }, myTE: { value: 50, position: 'TE' },
  t2RB: { value: 500, position: 'RB' }, t2WR: { value: 700, position: 'WR' }, t2TE: { value: 300, position: 'TE' },
  t3RB: { value: 400, position: 'RB' }, t3WR: { value: 300, position: 'WR' }, t3TE: { value: 200, position: 'TE' },
  t4RB: { value: 100, position: 'RB' }, t4WR: { value: 200, position: 'WR' }, t4TE: { value: 100, position: 'TE' },
}
const TEAMS: Array<[string, string[]]> = [
  ['me', ['myRB', 'myWR', 'myTE']],
  ['t2', ['t2RB', 't2WR', 't2TE']],
  ['t3', ['t3RB', 't3WR', 't3TE']],
  ['t4', ['t4RB', 't4WR', 't4TE']],
]

beforeEach(() => {
  vi.clearAllMocks()
  rosterFindMany.mockResolvedValue(
    TEAMS.map(([platformUserId, players]) => ({ platformUserId, playerData: { players }, league: { platform: 'sleeper' } })),
  )
  loadSnapshots.mockImplementation(async (args: { sleeperIds: string[] }) =>
    args.sleeperIds.filter((id) => PRICE[id]).map((sleeperId) => ({ sleeperId, ...PRICE[sleeperId], capturedAt: new Date('2026-09-20T00:00:00Z') })),
  )
})

describe('getRosterGrade returns every position, not only the ends', () => {
  it('ranks each position with the league median beside it, strongest first', async () => {
    const grade = await getRosterGrade({ leagueId: 'L1', myPlatformUserIds: ['me'], isDynasty: true, starters: ['RB', 'WR', 'TE'] })
    expect(grade).not.toBeNull()
    expect(grade!.positions?.map((p) => `${p.position}:${p.rank}/${p.outOf}:${p.median}`)).toEqual([
      'RB:1/4:450', // 900, 500, 400, 100 → median 450
      'WR:2/4:450', // 700, 600, 300, 200 → median 450
      'TE:4/4:150', // 300, 200, 100, 50  → median 150
    ])
    // The two ends the header tile already used are still the list's ends.
    expect(grade!.strongest?.position).toBe('RB')
    expect(grade!.weakest?.position).toBe('TE')
  })
})

function data(grade: RosterGrade): MyTeamData {
  return {
    league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: null },
    team: { available: false, reason: 'n/a' },
    starters: { available: false, reason: 'n/a' },
    bench: { available: false, reason: 'n/a' },
    ir: { available: false, reason: 'n/a' },
    taxi: { available: false, reason: 'n/a' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: { available: false, reason: 'n/a' },
    upcomingByes: [],
    rosterGrade: { available: true, data: grade },
    liveScore: { available: false, reason: 'n/a' },
  } as unknown as MyTeamData
}

describe('the Positional strength card', () => {
  const grade = (positions: RosterGrade['positions']): RosterGrade => ({
    rank: 2, outOf: 4, value: 1550, median: 1250, strongest: positions?.[0] ?? null, weakest: positions?.at(-1) ?? null,
    positions, pricedPlayers: 3, totalPlayers: 3,
    basis: { format: 'DYNASTY', qbFormat: 'ONE_QB', capturedAt: null, leagueScored: false },
  })

  it('lists every position with its rank, tone and value against the median', () => {
    const { container } = render(
      <MyTeam
        data={data(grade([
          { position: 'RB', value: 900, rank: 1, outOf: 4, playerCount: 1, median: 450 },
          { position: 'WR', value: 600, rank: 2, outOf: 4, playerCount: 1, median: 450 },
          { position: 'TE', value: 50, rank: 4, outOf: 4, playerCount: 1, median: 150 },
        ]))}
      />,
    )
    const rows = [...container.querySelectorAll('.af-mt-posstr-list li')]
    expect(rows.map((r) => r.getAttribute('data-tone'))).toEqual(['good', 'mid', 'bad'])
    expect(rows[0].textContent).toContain('1st of 4')
    expect(rows[2].textContent).toContain('50 vs median 150')
    // Last place still draws a visible sliver, never a zero-width bar.
    expect((rows[2].querySelector('.af-mt-posstr-bar > span') as HTMLElement).style.width).toBe('25%')
    expect(container.querySelector('.af-mt-posstr-note')?.textContent).toContain('12-team PPR market prices')
  })

  it('is absent with a single rankable position — the header tile already says it', () => {
    const { container } = render(
      <MyTeam data={data(grade([{ position: 'WR', value: 600, rank: 2, outOf: 4, playerCount: 1, median: 450 }]))} />,
    )
    expect(container.querySelector('.af-mt-posstr')).toBeNull()
  })
})
