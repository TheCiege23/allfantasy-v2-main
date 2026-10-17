import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

/*
 * The same fixture the pulse's deadline suite uses: 65 Sleeper leagues, each starting the same
 * ruled-out player (Omar Cooper, IR, NYJ — kickoff Sun 2026-09-27 17:00Z).
 */
const db = vi.hoisted(() => ({
  guillotineElimination: { findMany: vi.fn(async () => []) },
  leagueTeam: { findMany: vi.fn(async () => Array.from({ length: 65 }, (_, i) => ({ leagueId: `L${i}`, externalId: '4', platformUserId: 'su', teamName: 'Mine', league: { id: `L${i}`, name: `League ${i}`, sport: 'NFL', platform: 'sleeper', platformLeagueId: `${1000 + i}`, userId: 'user', season: 2026, updatedAt: new Date() } }))) },
  roster: { findMany: vi.fn(async () => Array.from({ length: 65 }, (_, i) => ({ leagueId: `L${i}`, platformUserId: 'su', playerData: { players: ['healthy', 'out'], starters: ['healthy', 'out'] } }))) },
  sportsPlayer: { findMany: vi.fn(async () => [{ sleeperId: 'healthy', name: 'Healthy Player', team: 'ATL' }, { sleeperId: 'out', name: 'Omar Cooper', team: 'NYJ' }]) },
  sportsInjury: { findMany: vi.fn(async () => [{ sport: 'NFL', playerName: 'Omar Cooper Jr.', status: 'IR', team: 'NYJ' }]) },
  sportsGame: { findMany: vi.fn(async () => [{ homeTeam: 'ATL', awayTeam: 'GB', startTime: new Date('2026-09-25T00:15:00Z') }, { homeTeam: 'NYJ', awayTeam: 'DET', startTime: new Date('2026-09-27T17:00:00Z') }]) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 3, seasonType: 'regular' })) }))
vi.mock('@/lib/core-app/byeWeeks', () => ({ getByeWeeks: vi.fn(async () => ({ byWeek: new Map([[3, []]]) })) }))
vi.mock('@/lib/core-app/leagueHome', () => ({ leagueDisplayName: (name: string) => name }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { getMyTeamPulse } from '@/lib/core-app/myTeamPulse'
import { MyTeamBoard } from '@/components/core-app/MyTeamBoard'

beforeEach(() => vi.clearAllMocks())

describe('players hurting more than one lineup', () => {
  it('names the one player flagged in all 65 lineups, once, with a link to his row in each', async () => {
    const pulse = await getMyTeamPulse('user', new Date('2026-09-27T12:00:00Z'))
    expect(pulse.crossLeague).toHaveLength(1)
    const [flag] = pulse.crossLeague!
    expect(flag).toMatchObject({ id: 'out', name: 'Omar Cooper', status: 'out' })
    expect(flag.leagues).toHaveLength(65)
    expect(flag.leagues[0].href).toBe('/core/my-team?league=L0#lineup-player-out')
    // Same status the rows counted — he is also on every row.
    expect(pulse.needs.every((r) => r.out === 1)).toBe(true)
  })

  it('drops him once his game has kicked off — a locked starter is not an action', async () => {
    const pulse = await getMyTeamPulse('user', new Date('2026-09-27T18:00:00Z'))
    expect(pulse.crossLeague).toEqual([])
  })

  it('needs two lineups: a player flagged in one league is that row’s news, not cross-league', async () => {
    db.leagueTeam.findMany.mockResolvedValueOnce([{ leagueId: 'L0', externalId: '4', platformUserId: 'su', teamName: 'Mine', league: { id: 'L0', name: 'Solo', sport: 'NFL', platform: 'sleeper', platformLeagueId: '1000', userId: 'user', season: 2026, updatedAt: new Date() } }] as never)
    const pulse = await getMyTeamPulse('user', new Date('2026-09-27T12:00:00Z'))
    expect(pulse.crossLeague).toEqual([])
  })

  it('renders the strip above the ranked rows', async () => {
    const pulse = await getMyTeamPulse('user', new Date('2026-09-27T12:00:00Z'))
    const { container } = render(<MyTeamBoard pulse={pulse} now={Date.parse('2026-09-27T12:00:00Z')} allHref="/core/my-team?all=1" />)
    const strip = container.querySelector('.af-bd-xl')!
    expect(strip.textContent).toContain('Hurting more than one lineup')
    expect(strip.textContent).toContain('Omar Cooper')
    expect(strip.textContent).toContain('in 65 lineups:')
    expect(strip.querySelectorAll('a')).toHaveLength(65)
    // Above the rows, not after them.
    const rows = container.querySelector('.af-bd-rows')!
    expect(strip.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the board footer says the split, not "either/or"', () => {
  it('counts set and unreadable leagues separately', async () => {
    // 65 claimed; L0 has no roster on file → unreadable; 10 rows shown; 54 hidden and set.
    db.roster.findMany.mockResolvedValueOnce(
      Array.from({ length: 64 }, (_, i) => ({ leagueId: `L${i + 1}`, platformUserId: 'su', playerData: { players: ['healthy'], starters: ['healthy'] } })) as never,
    )
    const pulse = await getMyTeamPulse('user', new Date('2026-09-27T12:00:00Z'))
    const { container } = render(<MyTeamBoard pulse={pulse} now={Date.parse('2026-09-27T12:00:00Z')} allHref="/core/my-team?all=1" />)
    const text = container.textContent ?? ''
    expect(text).toContain('55 more leagues are not shown: 54 set, 1 could not be read')
    expect(text).not.toContain('either set or could not be read')
  })
})
