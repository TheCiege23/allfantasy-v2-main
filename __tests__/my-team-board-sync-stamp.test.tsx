import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const league = (i: number, extra: Record<string, unknown>) => ({
  leagueId: `L${i}`, externalId: '4', platformUserId: 'su', teamName: 'Mine',
  league: { id: `L${i}`, name: `League ${i}`, sport: 'NFL', platform: 'sleeper', platformLeagueId: `${1000 + i}`, userId: 'user', season: 2026, updatedAt: new Date(), ...extra },
})
const db = vi.hoisted(() => ({
  guillotineElimination: { findMany: vi.fn(async () => []) },
  leagueTeam: { findMany: vi.fn() },
  roster: { findMany: vi.fn(async () => [0, 1, 2].map((i) => ({ leagueId: `L${i}`, platformUserId: 'su', playerData: { players: ['healthy'], starters: ['healthy'] } }))) },
  sportsPlayer: { findMany: vi.fn(async () => [{ sleeperId: 'healthy', name: 'Healthy Player', team: 'ATL' }]) },
  sportsInjury: { findMany: vi.fn(async () => []) },
  sportsGame: { findMany: vi.fn(async () => [{ homeTeam: 'ATL', awayTeam: 'GB', startTime: new Date('2026-10-04T17:00:00Z') }]) },
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
import { MyTeamBoard } from '@/components/core-app/MyTeamBoard'

beforeEach(() => {
  vi.clearAllMocks()
  db.leagueTeam.findMany.mockResolvedValue([
    league(0, { lastSyncedAt: new Date(NOW - 3 * 3600_000), syncStatus: 'synced' }), // fresh
    league(1, { lastSyncedAt: new Date(NOW - 2 * 86_400_000), syncStatus: 'synced' }), // stale
    league(2, { lastSyncedAt: new Date(NOW - 3600_000), syncStatus: 'failed' }), // failed
  ])
})

describe('board row freshness', () => {
  it('carries when each league was last synced, and whether that sync failed', async () => {
    const pulse = await getMyTeamPulse('user', new Date(NOW))
    const byId = new Map([...pulse.needs, ...pulse.set].map((r) => [r.leagueId, r]))
    expect(byId.get('L0')).toMatchObject({ syncedAt: new Date(NOW - 3 * 3600_000).toISOString(), syncFailed: false })
    expect(byId.get('L2')).toMatchObject({ syncFailed: true })
  })

  it('reads both failure spellings — prod holds `failed`, the sync route writes `error`', async () => {
    db.leagueTeam.findMany.mockResolvedValueOnce([
      league(0, { lastSyncedAt: new Date(NOW - 3600_000), syncStatus: 'error' }),
      league(1, { lastSyncedAt: new Date(NOW - 3600_000), syncStatus: 'manual' }),
    ])
    const pulse = await getMyTeamPulse('user', new Date(NOW))
    const byId = new Map([...pulse.needs, ...pulse.set].map((r) => [r.leagueId, r]))
    expect(byId.get('L0')?.syncFailed).toBe(true)
    expect(byId.get('L1')?.syncFailed).toBe(false)
  })

  it('stamps each row, warns on stale and failed ones, and points to one re-sync', async () => {
    const pulse = await getMyTeamPulse('user', new Date(NOW))
    const { container } = render(<MyTeamBoard pulse={pulse} now={NOW} allHref="/core/my-team?all=1" />)
    const stamps = [...container.querySelectorAll('.af-bd-sync')].map((s) => [s.textContent?.trim(), s.getAttribute('data-stale')])
    expect(stamps).toEqual(expect.arrayContaining([
      ['· synced 3h ago', 'false'],
      ['· synced 2d ago', 'true'],
      ['· last sync failed', 'true'],
    ]))
    const note = container.querySelector('.af-bd-note--stale')!
    expect(note.textContent).toContain('2 of the leagues shown were last synced over a day ago or failed to sync')
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/core/sync')
  })

  it('says nothing extra when every row is fresh', async () => {
    db.leagueTeam.findMany.mockResolvedValueOnce([league(0, { lastSyncedAt: new Date(NOW - 600_000), syncStatus: 'synced' })])
    const pulse = await getMyTeamPulse('user', new Date(NOW))
    const { container } = render(<MyTeamBoard pulse={pulse} now={NOW} allHref="/core/my-team?all=1" />)
    expect(container.querySelector('.af-bd-note--stale')).toBeNull()
    expect(container.querySelector('.af-bd-sync')?.textContent).toContain('synced 10 min ago')
  })
})
