/**
 * `/api/players/rolling-insights/batch` used to return `PlayerIdentityMap.status || SportsPlayer.status`
 * as `injuryStatus` — for Rolling Insights that is the roster code "ACT" / "INACT", and the league
 * Players tab drew an amber "Injury status: ACT" dot on healthy players. It must return a live
 * designation from the injury read port, or null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  identityFindMany: vi.fn(),
  statsFindMany: vi.fn(),
  sportsPlayerFindMany: vi.fn(),
  injuryFindMany: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: mocks.identityFindMany },
    playerSeasonStats: { findMany: mocks.statsFindMany },
    sportsPlayer: { findMany: mocks.sportsPlayerFindMany },
    sportsInjury: { findMany: mocks.injuryFindMany },
  },
}))

import { POST } from '@/app/api/players/rolling-insights/batch/route'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

function req(body: unknown) {
  return { json: async () => body } as any
}

async function call() {
  const res = await POST(req({ sport: 'NFL', sleeperIds: ['s1', 's2'] }))
  return (await res.json()) as { bySleeperId: Record<string, { injuryStatus: string | null }> }
}

describe('RI batch route — injuryStatus is a live designation or null, never a roster code', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.identityFindMany.mockResolvedValue([
      // `status` is what the old route read; present so a regression has something to leak.
      { sleeperId: 's1', rollingInsightsId: 'ri1', canonicalName: 'Healthy Guy', currentTeam: 'KC', position: 'WR', status: 'ACT' },
      { sleeperId: 's2', rollingInsightsId: 'ri2', canonicalName: 'Hurt Guy', currentTeam: 'KC', position: 'RB', status: 'ACT' },
    ])
    mocks.statsFindMany.mockResolvedValue([])
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'ri1', status: 'ACT' },
      { externalId: 'ri2', status: 'INACT' },
    ])
  })

  it('no live injury rows → null for everyone, not "ACT"', async () => {
    mocks.injuryFindMany.mockResolvedValue([])
    const body = await call()
    expect(body.bySleeperId.s1!.injuryStatus).toBeNull()
    expect(body.bySleeperId.s2!.injuryStatus).toBeNull()
  })

  it('a live designation is returned for the matching player only; "Active" is not one', async () => {
    mocks.injuryFindMany.mockResolvedValue([
      {
        playerName: 'Hurt Guy',
        status: 'Questionable',
        type: 'Ankle',
        description: null,
        date: hoursAgo(3),
        week: 6,
        source: 'rolling_insights',
        fetchedAt: hoursAgo(1),
        team: 'Kansas City Chiefs',
        position: null,
      },
      {
        playerName: 'Healthy Guy',
        status: 'Active',
        type: null,
        description: null,
        date: hoursAgo(3),
        week: 6,
        source: 'espn',
        fetchedAt: hoursAgo(1),
        team: 'KC',
        position: null,
      },
    ])
    const body = await call()
    expect(body.bySleeperId.s1!.injuryStatus).toBeNull()
    expect(body.bySleeperId.s2!.injuryStatus).toBe('Questionable')
  })
})
