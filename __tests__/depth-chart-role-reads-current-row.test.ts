import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { depthChart: { findMany } } }))

import { getDepthRole } from '@/lib/trade-intel/depthChartRole'

const LIVE = { fetchedAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 3_600_000) }
const MAY = { fetchedAt: new Date('2026-05-01T00:46:18Z'), expiresAt: new Date('2026-05-01T12:46:18Z') }

describe('getDepthRole through the real lib/depth-charts reader', () => {
  beforeEach(() => findMany.mockReset())

  it('finds a player in an object-shaped row (NFL GraphQL / REST) -- String(object) never matched', async () => {
    findMany.mockResolvedValue([
      {
        team: 'KC', position: 'WR', source: 'rolling_insights', ...LIVE,
        players: [
          { id: '1', player: 'Rashee Rice', position: 'WR' },
          { id: '6779', player: 'Skyy Moore', position: 'WR' },
        ],
      },
    ])
    const role = await getDepthRole({ playerName: 'Skyy Moore', team: 'KC', position: 'WR', sport: 'NFL' })
    expect(role).toMatchObject({ rank: 2, listed: 2, role: 'backup' })
  })

  it('reads the October chart, not the May one, when both exist for the team/position', async () => {
    findMany.mockResolvedValue([
      { team: 'GSW', position: 'C', source: 'rolling_insights', ...MAY, players: ['Kevon Looney', 'Draymond Green'] },
      {
        team: 'GSW', position: 'C', source: 'rolling_insights_rest', ...LIVE,
        players: [
          { id: '143', rank: 1, player: 'Draymond Green', position: 'C' },
          { id: '1501', rank: 2, player: 'Quinten Post', position: 'C' },
        ],
      },
    ])
    const role = await getDepthRole({ playerName: 'Draymond Green', team: 'GSW', position: 'C', sport: 'NBA' })
    expect(role).toMatchObject({ rank: 1, listed: 2, role: 'starter' })
  })
})
