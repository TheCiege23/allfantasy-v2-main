/**
 * Seats the old orphan-teams "Assign AI manager" button left as `ai-manager-…` go back to ordinary
 * empty seats (league roster AND season roster) and are handed to Chimmy. Idempotent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  rosters: [] as Array<{ id: string; leagueId: string; platformUserId: string }>,
  redraftUpdates: [] as Array<Record<string, unknown>>,
  platform: 'allfantasy',
  apply: vi.fn(async () => ({ ok: true, managed: true }) as Record<string, unknown>),
}))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ applyChimmyAutopilot: h.apply }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    roster: {
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; platformUserId: string }; data: { platformUserId: string } }) => {
        const row = h.rosters.find((r) => r.id === where.id && r.platformUserId === where.platformUserId)
        if (!row) return { count: 0 }
        row.platformUserId = data.platformUserId
        return { count: 1 }
      }),
    },
    redraftRoster: { updateMany: vi.fn(async (args: Record<string, unknown>) => { h.redraftUpdates.push(args); return { count: 1 } }) },
  }
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      roster: { findMany: vi.fn(async () => h.rosters.filter((r) => r.platformUserId.startsWith('ai-manager-')).map((r) => ({ ...r }))) },
      league: { findUnique: vi.fn(async () => ({ platform: h.platform, userId: 'owner' })) },
    },
  }
})

import { repairAiManagerSeats } from '@/lib/inactive-manager/repairAiManagerSeats'

beforeEach(() => {
  h.rosters = [{ id: 'r1', leagueId: 'L', platformUserId: 'ai-manager-r1' }, { id: 'r2', leagueId: 'L', platformUserId: 'real-user' }]
  h.redraftUpdates = []
  h.platform = 'allfantasy'
  h.apply.mockClear()
})

describe('repairing ai-manager seats', () => {
  it('turns the seat back into an empty seat, on both rosters, and hands it to Chimmy', async () => {
    expect(await repairAiManagerSeats()).toEqual({ found: 1, repaired: 1, chimmy: 1, chimmyRefused: [] })
    expect(h.rosters[0].platformUserId).toBe('orphan-r1')
    expect(h.redraftUpdates[0]).toEqual({ where: { leagueId: 'L', ownerId: 'ai-manager-r1' }, data: { ownerId: 'orphan-r1' } })
    expect(h.apply).toHaveBeenCalledWith('L', 'owner', 'r1', undefined)
    expect(h.rosters[1].platformUserId).toBe('real-user')
  })

  it('runs to nothing the second time', async () => {
    await repairAiManagerSeats()
    h.apply.mockClear()
    expect(await repairAiManagerSeats()).toEqual({ found: 0, repaired: 0, chimmy: 0, chimmyRefused: [] })
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('still repairs the seat when Chimmy cannot take it, and says why', async () => {
    h.apply.mockResolvedValueOnce({ ok: false, status: 409, error: 'Chimmy can run up to 4 teams in a league.' })
    expect(await repairAiManagerSeats()).toEqual({ found: 1, repaired: 1, chimmy: 0, chimmyRefused: [{ rosterId: 'r1', error: 'Chimmy can run up to 4 teams in a league.' }] })
    expect(h.rosters[0].platformUserId).toBe('orphan-r1')
  })

  it('leaves leagues AllFantasy does not run alone', async () => {
    h.platform = 'sleeper'
    expect(await repairAiManagerSeats()).toMatchObject({ found: 1, repaired: 0 })
    expect(h.rosters[0].platformUserId).toBe('ai-manager-r1')
  })
})
