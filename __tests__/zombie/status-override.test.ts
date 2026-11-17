// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The commissioner's "Override status" tool. "Eliminated" is not a game status (lib/zombie/statusOverride.ts): the
 * 2025 NFL settlement throws on it every week. And a status never changes under a week that is settling or held.
 */

const m = vi.hoisted(() => ({
  league: { id: 'z1', leagueId: 'L', sport: 'NFL', currentWeek: 6, correctionHoldFromWeek: null as number | null },
  resolution: null as { status: string } | null,
  prev: { status: 'Survivor' },
  updates: [] as unknown[],
}))

vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u-comm' } }) }))
vi.mock('@/lib/league/commissionerAccess', () => ({ requireCommissionerAccess: async () => undefined }))
vi.mock('@/lib/zombie/auditService', () => ({ logAuditEntry: vi.fn(async () => undefined), getFullAuditTrail: vi.fn() }))
vi.mock('@/lib/zombie/rulesDocGenerator', () => ({ generateRulesDocument: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: vi.fn(async () => m.league) },
    roster: { findFirst: vi.fn(async () => ({ id: 'r1' })) },
    zombieLeagueTeam: {
      findUnique: vi.fn(async () => m.prev),
      update: vi.fn(async (args: unknown) => { m.updates.push(args); return {} }),
    },
    zombieWeeklyResolution: {
      findUnique: vi.fn(async ({ where }: { where: { zombieLeagueId_week: { zombieLeagueId: string; week: number } } }) =>
        where.zombieLeagueId_week.zombieLeagueId === 'z1' && where.zombieLeagueId_week.week === 6 ? m.resolution : null),
    },
  },
}))

import { POST } from '@/app/api/zombie/commissioner/route'
import { OVERRIDABLE_ZOMBIE_STATUSES } from '@/lib/zombie/statusOverride'

const post = (newStatus: string) =>
  POST(new Request('http://x/api/zombie/commissioner', { method: 'POST', body: JSON.stringify({ leagueId: 'L', action: 'override_status', userId: 'pu1', newStatus }) }))

beforeEach(() => {
  m.league = { id: 'z1', leagueId: 'L', sport: 'NFL', currentWeek: 6, correctionHoldFromWeek: null }
  m.resolution = null
  m.prev = { status: 'Survivor' }
  m.updates.length = 0
})

describe('override_status', () => {
  it('sets a real game status', async () => {
    const res = await post('Zombie')
    expect(res.status).toBe(200)
    expect(m.updates).toEqual([expect.objectContaining({ data: { status: 'Zombie' } })])
  })

  it('refuses "Eliminated" in every sport, writing nothing', async () => {
    for (const sport of ['NFL', 'NBA']) {
      m.league.sport = sport
      const res = await post('Eliminated')
      expect(res.status).toBe(400)
    }
    expect(m.updates).toEqual([])
    expect(OVERRIDABLE_ZOMBIE_STATUSES).not.toContain('Eliminated')
  })

  it('refuses while this week is settling or held for review; allows once pending or complete', async () => {
    for (const status of ['resolving', 'review_required']) {
      m.resolution = { status }
      expect((await post('Zombie')).status).toBe(409)
    }
    expect(m.updates).toEqual([])
    for (const status of ['pending', 'complete']) {
      m.resolution = { status }
      expect((await post('Zombie')).status).toBe(200)
    }
    expect(m.updates).toHaveLength(2)
  })

  it('every status it offers is one the 2025 NFL settlement can read — and "Eliminated" is the one it cannot', async () => {
    const { computeBeta2025Winnings } = await vi.importActual<typeof import('@/lib/zombie/beta2025Winnings')>('@/lib/zombie/beta2025Winnings')
    const settle = (status: string) =>
      computeBeta2025Winnings(
        [{ matchupId: 'm1', final: true, homeRosterId: 'a', awayRosterId: 'b', homeScore: 100, awayScore: 90 } as never],
        { policy: 'beta_2025', openingByRoster: { a: 10, b: 10 }, statusByRoster: { a: status, b: 'Survivor' } },
        { bashingThreshold: 50, maulingThreshold: 50 },
      )
    for (const s of OVERRIDABLE_ZOMBIE_STATUSES) expect(() => settle(s)).not.toThrow()
    expect(() => settle('Eliminated')).toThrow('ZOMBIE_WINNINGS_STATUS_REQUIRED')
  })
})
