// @vitest-environment node
/**
 * "Fill empty slots" hands a hosted league's empty seats to Chimmy
 * (lib/inactive-manager/handOpenSeatsToChimmy.ts). It used to answer "All slots are already filled".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosters: [] as Array<{ id: string; platformUserId: string }>,
  settings: {} as Record<string, unknown>,
  apply: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: vi.fn(async () => h.rosters) },
    league: { findUnique: vi.fn(async () => ({ settings: h.settings })) },
    appUser: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => id.startsWith('u')).map((id) => ({ id }))) },
  },
}))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ applyChimmyAutopilot: h.apply }))

import { handOpenSeatsToChimmy, openSeatsForChimmy } from '@/lib/inactive-manager/handOpenSeatsToChimmy'

const autopilot = (owner: string) => ({ since: '2026-11-01T00:00:00Z', byUserId: 'u1', ownerUserId: owner, autopilot: { style: 'dynasty_owner', since: '2026-11-01T00:00:00Z', byUserId: 'u1' } })

beforeEach(() => {
  h.rosters = [{ id: 'r1', platformUserId: 'u1' }, { id: 'r2', platformUserId: 'open-slot-L-2' }, { id: 'r3', platformUserId: 'open-slot-L-3' }, { id: 'r4', platformUserId: 'open-slot-L-4' }]
  h.settings = {}
  h.apply.mockReset()
  h.apply.mockResolvedValue({ ok: true })
})

describe('openSeatsForChimmy', () => {
  it('an empty seat is one with no account behind it; a seat Chimmy already runs is not handed over again', () => {
    const managed = { r3: autopilot('open-slot-L-3') } as never
    expect(openSeatsForChimmy(h.rosters, new Set(['u1']), managed)).toEqual({ toHand: ['r2', 'r4'], already: ['r3'] })
  })
  it('a full league has nothing to hand over', () => {
    expect(openSeatsForChimmy([{ id: 'r1', platformUserId: 'u1' }], new Set(['u1']), {} as never)).toEqual({ toHand: [], already: [] })
  })
})

describe('handOpenSeatsToChimmy', () => {
  it('🛑 one manager and three empty seats: all three go to Chimmy, the manager is untouched', async () => {
    const out = await handOpenSeatsToChimmy('L', 'u1')
    expect(out).toEqual({ openSeats: 3, handed: ['r2', 'r3', 'r4'], alreadyChimmy: 0, stoppedBy: null })
    expect(h.apply.mock.calls.map((c) => c[2])).toEqual(['r2', 'r3', 'r4'])
  })
  it('stops at the first refusal and reports it; seats handed before it stay handed', async () => {
    h.apply.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 402, error: 'Chimmy runs 1 team for free. The AF Commissioner plan lets it run up to 4.' })
    const out = await handOpenSeatsToChimmy('L', 'u1')
    expect(out.handed).toEqual(['r2'])
    expect(out.stoppedBy).toEqual({ status: 402, error: 'Chimmy runs 1 team for free. The AF Commissioner plan lets it run up to 4.' })
    expect(h.apply).toHaveBeenCalledTimes(2)
  })
})

describe('the fill route uses it when every seat already has a team', () => {
  const route = readFileSync(join(process.cwd(), 'app/api/leagues/[leagueId]/fill-empty-slots/handler.ts'), 'utf8')
  it('hands the empty seats over before answering "already filled"', () => {
    const hand = route.indexOf('const chimmy = await handOpenSeatsToChimmy(leagueId, userId)')
    expect(hand).toBeGreaterThan(route.indexOf('if (emptySlotCount <= 0) {'))
    expect(hand).toBeLessThan(route.indexOf("message: 'All slots are already filled'"))
  })
})
