import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const NOW = Date.parse('2026-10-04T12:00:00Z')
/*
 * 14 readable leagues — MORE than the loader's cap of ten, which is the point: 8 redraft, 4 dynasty,
 * 2 guillotine; 12 NFL + 2 NBA. The dynasty and NBA leagues sort LAST (later kickoffs), so a filter
 * that only searched the ten capped rows would find almost none of them.
 */
const spec = [
  ...Array.from({ length: 8 }, () => ({ leagueType: 'redraft', isDynasty: false, sport: 'NFL' })),
  ...Array.from({ length: 4 }, () => ({ leagueType: 'dynasty', isDynasty: true, sport: 'NFL' })),
  { leagueType: 'guillotine', isDynasty: false, sport: 'NBA' },
  { leagueType: 'guillotine', isDynasty: false, sport: 'NBA' },
]
const db = vi.hoisted(() => ({
  guillotineElimination: { findMany: vi.fn(async () => []) },
  leagueTeam: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  sportsPlayer: { findMany: vi.fn(async () => [{ sleeperId: 'healthy', name: 'Healthy Player', team: 'ATL' }]) },
  sportsInjury: { findMany: vi.fn(async () => []) },
  sportsGame: { findMany: vi.fn(async () => [{ homeTeam: 'ATL', awayTeam: 'GB', startTime: new Date('2026-10-05T17:00:00Z') }]) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 5, seasonType: 'regular' })) }))
vi.mock('@/lib/core-app/byeWeeks', () => ({ getByeWeeks: vi.fn(async () => ({ byWeek: new Map([[5, []]]) })) }))
vi.mock('@/lib/core-app/leagueHome', () => ({ leagueDisplayName: (name: string) => name }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { getMyTeamPulse } from '@/lib/core-app/myTeamPulse'
import { boardFilterFromParams } from '@/lib/core-app/myTeamBoardFilter'
import { MyTeamBoard } from '@/components/core-app/MyTeamBoard'

const leagueRows = (n = spec.length) => spec.slice(0, n).map((s, i) => ({
  leagueId: `L${i}`, externalId: '4', platformUserId: 'su', teamName: 'Mine',
  league: { id: `L${i}`, name: `League ${i}`, platform: 'sleeper', platformLeagueId: `${1000 + i}`, userId: 'user', season: 2026, updatedAt: new Date(), ...s },
}))
beforeEach(() => {
  vi.clearAllMocks()
  db.leagueTeam.findMany.mockResolvedValue(leagueRows())
  db.roster.findMany.mockResolvedValue(spec.map((_, i) => ({ leagueId: `L${i}`, platformUserId: 'su', playerData: { players: ['healthy'], starters: ['healthy'] } })))
})
afterEach(cleanup)

const chips = (c: HTMLElement) => [...c.querySelectorAll('.af-bd-chip')].map((b) => [b.textContent?.replace(/\s+/g, ' ').trim(), b.getAttribute('href'), b.getAttribute('aria-current')])
const rowIds = (c: HTMLElement) => [...c.querySelectorAll('.af-bd-rows > li a[href^="/core/my-team?league="]')].map((a) => a.getAttribute('href')!.replace('/core/my-team?league=', ''))
const board = (pulse: Awaited<ReturnType<typeof getMyTeamPulse>>) =>
  render(<MyTeamBoard pulse={pulse} now={NOW} allHref="/core/my-team?all=1" />).container

describe('filter chips', () => {
  it('counts every readable league, not the ten the loader sends', async () => {
    const pulse = await getMyTeamPulse('user', new Date(NOW))
    expect(pulse.set).toHaveLength(10)
    expect(pulse.filters?.map((o) => `${o.dim}:${o.label}:${o.count}`)).toEqual([
      'format:Redraft:8', 'format:Dynasty:4', 'format:Guillotine:2',
      'sport:NFL:12', 'sport:NBA:2',
    ])
    expect(chips(board(pulse))).toEqual([
      ['All 14', '/core/my-team', 'true'],
      ['Redraft 8', '/core/my-team?format=redraft', null],
      ['Dynasty 4', '/core/my-team?format=dynasty', null],
      ['Guillotine 2', '/core/my-team?format=guillotine', null],
      ['NFL 12', '/core/my-team?sport=NFL', null],
      ['NBA 2', '/core/my-team?sport=NBA', null],
    ])
  })

  it('filters BEFORE the cap — all four dynasty leagues, though none of them is in the default ten', async () => {
    const unfiltered = await getMyTeamPulse('user', new Date(NOW))
    const pulse = await getMyTeamPulse('user', new Date(NOW), undefined, { dim: 'format', value: 'dynasty' })
    expect(pulse.filter).toEqual({ dim: 'format', value: 'dynasty' })
    const c = board(pulse)
    expect(rowIds(c).sort()).toEqual(['L10', 'L11', 'L8', 'L9'])
    expect(unfiltered.set.map((r) => r.leagueId).filter((id) => ['L8', 'L9', 'L10', 'L11'].includes(id)).length).toBeLessThan(4)
    expect(chips(c).find(([t]) => t === 'Dynasty 4')?.[2]).toBe('true')
    expect(c.querySelector('.af-bd-note--filter')?.textContent).toContain('10 other lineups are hidden by this filter.')
    expect(c.querySelector('.af-bd-note--filter a')?.getAttribute('href')).toBe('/core/my-team')
    /* The ten the chip hides are not ALSO "more leagues not shown". */
    expect(c.textContent).not.toMatch(/\d+ more leagues? (is|are) not shown/)
  })

  it('ignores a param that names no chip on this board, rather than emptying it', async () => {
    const pulse = await getMyTeamPulse('user', new Date(NOW), undefined, { dim: 'format', value: 'zombie' })
    expect(pulse.filter).toBeNull()
    expect(pulse.filteredOut).toBe(0)
    expect(rowIds(board(pulse))).toHaveLength(10)
  })

  it('matches the URL value case-insensitively and reads one dimension, format first', () => {
    expect(boardFilterFromParams({ sport: 'nba', format: 'Dynasty' })).toEqual({ dim: 'format', value: 'Dynasty' })
    expect(boardFilterFromParams({ platform: ['espn', 'x'] })).toEqual({ dim: 'platform', value: 'espn' })
    expect(boardFilterFromParams({ all: '1' })).toBeNull()
  })

  it('applies `?sport=nba` to the NBA leagues', async () => {
    const pulse = await getMyTeamPulse('user', new Date(NOW), undefined, boardFilterFromParams({ sport: 'nba' }))
    expect(pulse.filter).toEqual({ dim: 'sport', value: 'NBA' })
    expect(rowIds(board(pulse)).sort()).toEqual(['L12', 'L13'])
  })

  it('draws no chips on an account whose leagues are all one format and sport', async () => {
    db.leagueTeam.findMany.mockResolvedValueOnce(leagueRows(3))
    const pulse = await getMyTeamPulse('user', new Date(NOW))
    expect(board(pulse).querySelector('.af-bd-filters')).toBeNull()
  })
})
