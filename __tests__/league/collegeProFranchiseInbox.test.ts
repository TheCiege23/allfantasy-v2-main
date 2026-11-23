// @vitest-environment node
/**
 * The notification inbox treats a paired college + pro league (C2C / Devy) as ONE league: a league
 * scope reads both halves, and every row from either half carries the franchise it belongs to.
 */
import { describe, it, expect, vi } from 'vitest'

const findMany = vi.fn()
const count = vi.fn(async () => 0)
const pair = (role: 'pro' | 'college', otherLeagueId: string) => ({ collegeProPair: { role, otherLeagueId, linkedByUserId: 'commish', linkedAt: '' } })
const LEAGUES: Record<string, { id: string; name: string; settings: Record<string, unknown> }> = {
  peach: { id: 'peach', name: 'Peach Bowl (C2C)', settings: pair('pro', 'cream') },
  cream: { id: 'cream', name: 'Cream Bowl', settings: pair('college', 'peach') },
  solo: { id: 'solo', name: 'Road to glory', settings: {} },
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformNotification: { findMany: (...a: unknown[]) => findMany(...a), count: (...a: unknown[]) => count(...(a as [])) },
    discordLeagueChannel: { findFirst: vi.fn(async () => null) },
    league: {
      findUnique: vi.fn(async (q: { where: { id: string } }) => LEAGUES[q.where.id] ?? null),
      findMany: vi.fn(async (q: { where: { id: { in: string[] } } }) => q.where.id.in.map((id) => LEAGUES[id]).filter(Boolean)),
    },
  },
}))

import { getNotificationsCenter } from '@/lib/core-app/notificationsCenter'

const row = (id: string, leagueId: string, name: string, platform: string) => ({
  id, type: 'trade_proposal', title: 'Trade offer', body: 'You have an offer', severity: 'info',
  createdAt: new Date('2026-11-22T12:00:00Z'), readAt: null, leagueId, meta: null,
  league: { name, platform, platformLeagueId: 'x', season: 2026 },
})
const NOW = new Date('2026-11-22T18:00:00Z')

describe('the inbox and a paired college + pro league', () => {
  it('a league scope reads both halves', async () => {
    findMany.mockResolvedValue([row('a', 'cream', 'Cream Bowl', 'fantrax'), row('b', 'peach', 'Peach Bowl (C2C)', 'sleeper')])
    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: NOW, leagueId: 'peach' })
    expect(findMany.mock.calls.at(-1)?.[0]).toMatchObject({ where: { userId: 'u1', leagueId: { in: ['peach', 'cream'] } } })
    expect(data.rest).toHaveLength(2)
  })

  it('rows from either half carry one franchise; an unpaired league’s rows carry none', async () => {
    findMany.mockResolvedValue([row('a', 'cream', 'Cream Bowl', 'fantrax'), row('b', 'peach', 'Peach Bowl (C2C)', 'sleeper'), row('c', 'solo', 'Road to glory', 'sleeper')])
    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: NOW })
    expect(data.rest.map((r) => [r.id, r.leagueName, r.franchiseId ?? null, r.franchiseName ?? null])).toEqual([
      ['a', 'Cream Bowl', 'peach', 'Peach Bowl (C2C) + Cream Bowl'],
      ['b', 'Peach Bowl (C2C)', 'peach', 'Peach Bowl (C2C) + Cream Bowl'],
      ['c', 'Road to glory', null, null],
    ])
  })
})
