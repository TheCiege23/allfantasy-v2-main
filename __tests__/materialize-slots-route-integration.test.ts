import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  assertLeagueActionGate: vi.fn(),
  leagueFindUnique: vi.fn(),
  draftSessionFindUnique: vi.fn(),
  draftSessionUpdate: vi.fn(),
  rosterFindMany: vi.fn(),
  rosterCreate: vi.fn(),
  leagueEntrySlotUpdateMany: vi.fn(),
  prismaTransaction: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/server/services/leagueActionGate', () => ({
  assertLeagueActionGate: hm.assertLeagueActionGate,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: hm.leagueFindUnique },
    draftSession: {
      findUnique: hm.draftSessionFindUnique,
      findFirst: hm.draftSessionFindUnique,
      update: hm.draftSessionUpdate,
    },
    roster: { findMany: hm.rosterFindMany, create: hm.rosterCreate },
    $transaction: hm.prismaTransaction,
  },
}))

async function call(body?: Record<string, unknown>) {
  const { POST } = await import(
    '@/app/api/leagues/[leagueId]/setup/materialize-slots/route'
  )
  const req = createMockNextRequest(
    'http://localhost/api/leagues/league-1/setup/materialize-slots',
    { method: 'POST', body: body ?? {} },
  )
  return POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
}

function slotOrder12WithHumanAtSlot1(humanRosterId: string) {
  return Array.from({ length: 12 }, (_, i) => ({
    slot: i + 1,
    rosterId: i === 0 ? humanRosterId : `placeholder-${i + 1}`,
    displayName: `Team ${i + 1}`,
  }))
}

let rosterAutoCounter = 0

beforeEach(() => {
  vi.clearAllMocks()
  rosterAutoCounter = 0
  hm.getServerSession.mockResolvedValue({ user: { id: 'commish-1' } })
  hm.assertLeagueActionGate.mockResolvedValue({ ok: true })
  hm.leagueFindUnique.mockResolvedValue({ id: 'league-1' })
  hm.rosterCreate.mockImplementation(async () => {
    rosterAutoCounter += 1
    return { id: `real-${rosterAutoCounter}` }
  })
  hm.leagueEntrySlotUpdateMany.mockResolvedValue({ count: 1 })
  hm.draftSessionUpdate.mockResolvedValue({})
  hm.prismaTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      roster: { create: hm.rosterCreate },
      draftSession: { update: hm.draftSessionUpdate },
      leagueEntrySlot: { updateMany: hm.leagueEntrySlotUpdateMany },
    }
    return fn(tx)
  })
})

describe('POST /api/leagues/[leagueId]/setup/materialize-slots', () => {
  it('returns 401 when unauthenticated', async () => {
    hm.getServerSession.mockResolvedValue(null)
    hm.draftSessionFindUnique.mockResolvedValue(null)
    hm.rosterFindMany.mockResolvedValue([])
    const res = await call()
    expect(res.status).toBe(401)
  })

  it('returns 403 when not commissioner', async () => {
    hm.assertLeagueActionGate.mockResolvedValue({
      ok: false,
      err: { status: 403, error: 'Forbidden', code: 'FORBIDDEN' },
    })
    hm.draftSessionFindUnique.mockResolvedValue(null)
    hm.rosterFindMany.mockResolvedValue([])
    const res = await call()
    expect(res.status).toBe(403)
  })

  it('returns 404 when draft session is missing', async () => {
    hm.draftSessionFindUnique.mockResolvedValue(null)
    hm.rosterFindMany.mockResolvedValue([])
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('no-op when no placeholders exist', async () => {
    const realSlotOrder = Array.from({ length: 12 }, (_, i) => ({
      slot: i + 1,
      rosterId: `roster-${i + 1}`,
      displayName: `Team ${i + 1}`,
    }))
    hm.draftSessionFindUnique.mockResolvedValue({
      id: 'ds-1',
      slotOrder: realSlotOrder,
      teamCount: 12,
    })
    hm.rosterFindMany.mockResolvedValue(
      realSlotOrder.map((e) => ({ id: e.rosterId, platformUserId: `u-${e.slot}` })),
    )
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      createdCount: 0,
      replacedCount: 0,
      alreadyMaterializedCount: 12,
    })
    expect(hm.rosterCreate).not.toHaveBeenCalled()
    expect(hm.prismaTransaction).not.toHaveBeenCalled()
  })

  it('creates real rosters for placeholder slots and rewrites slotOrder preserving order', async () => {
    const slotOrder = slotOrder12WithHumanAtSlot1('human-roster-1')
    hm.draftSessionFindUnique.mockResolvedValue({ id: 'ds-1', slotOrder, teamCount: 12 })
    hm.rosterFindMany.mockResolvedValue([{ id: 'human-roster-1', platformUserId: 'user-1' }])

    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.createdCount).toBe(11)
    expect(body.replacedCount).toBe(11)
    expect(body.alreadyMaterializedCount).toBe(1)
    // Preserves slot ordering
    expect(body.slotOrder.map((s: any) => s.slot)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    )
    // Slot 1 still references the human roster
    expect(body.slotOrder[0]).toMatchObject({ slot: 1, rosterId: 'human-roster-1' })
    // Slots 2..12 now have non-placeholder ids
    for (const s of body.slotOrder.slice(1)) {
      expect(typeof s.rosterId).toBe('string')
      expect(s.rosterId.startsWith('placeholder-')).toBe(false)
    }
    // Each created roster has orphan- platformUserId + ai-managed settings
    for (const callArgs of hm.rosterCreate.mock.calls) {
      expect(callArgs[0].data.platformUserId).toMatch(/^orphan-/)
      expect(callArgs[0].data.settings).toMatchObject({ aiManaged: true })
    }
    // Session is updated with new slotOrder + version bump
    const updateArgs = hm.draftSessionUpdate.mock.calls[0][0]
    expect(updateArgs.data.version).toEqual({ increment: 1 })
    expect(Array.isArray(updateArgs.data.slotOrder)).toBe(true)
  })

  it('is idempotent: a second run with the new slotOrder creates nothing', async () => {
    const slotOrder = slotOrder12WithHumanAtSlot1('human-roster-1')
    hm.draftSessionFindUnique.mockResolvedValue({ id: 'ds-1', slotOrder, teamCount: 12 })
    hm.rosterFindMany.mockResolvedValue([{ id: 'human-roster-1', platformUserId: 'user-1' }])
    const first = await call()
    const firstBody = await first.json()
    expect(firstBody.createdCount).toBe(11)
    const nextSlotOrder: Array<{ slot: number; rosterId: string; displayName: string }> = firstBody.slotOrder

    // Simulate the second run: DB now returns the new slotOrder + all 12 real rosters.
    hm.draftSessionFindUnique.mockResolvedValue({
      id: 'ds-1',
      slotOrder: nextSlotOrder,
      teamCount: 12,
    })
    hm.rosterFindMany.mockResolvedValue(
      nextSlotOrder.map((e) => ({ id: e.rosterId, platformUserId: `pu-${e.slot}` })),
    )
    hm.rosterCreate.mockClear()
    hm.prismaTransaction.mockClear()

    const second = await call()
    const secondBody = await second.json()
    expect(secondBody.createdCount).toBe(0)
    expect(secondBody.replacedCount).toBe(0)
    expect(secondBody.alreadyMaterializedCount).toBe(12)
    expect(hm.rosterCreate).not.toHaveBeenCalled()
    expect(hm.prismaTransaction).not.toHaveBeenCalled()
  })

  it('does not delete or overwrite the existing human roster', async () => {
    const slotOrder = slotOrder12WithHumanAtSlot1('human-roster-1')
    hm.draftSessionFindUnique.mockResolvedValue({ id: 'ds-1', slotOrder, teamCount: 12 })
    hm.rosterFindMany.mockResolvedValue([{ id: 'human-roster-1', platformUserId: 'user-1' }])
    await call()
    // Every roster.create call is for a NEW roster; none reference the human id.
    for (const callArgs of hm.rosterCreate.mock.calls) {
      expect(callArgs[0].data.platformUserId).not.toBe('user-1')
    }
  })

  it('returns 500 on unexpected error', async () => {
    hm.draftSessionFindUnique.mockRejectedValue(new Error('boom'))
    hm.rosterFindMany.mockResolvedValue([])
    const res = await call()
    expect(res.status).toBe(500)
  })
})
