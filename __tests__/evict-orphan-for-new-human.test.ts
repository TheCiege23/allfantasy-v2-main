import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  draftSessionFindUnique: vi.fn(),
  draftSessionUpdate: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  rosterDelete: vi.fn(),
  draftPickUpdateMany: vi.fn(),
  draftPickCount: vi.fn(),
  draftPickAuditUpdateMany: vi.fn(),
  draftPickAuditCount: vi.fn(),
  prismaTransaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findUnique: hm.draftSessionFindUnique,
      findFirst: hm.draftSessionFindUnique,
      update: hm.draftSessionUpdate,
    },
    roster: {
      findFirst: hm.rosterFindFirst,
      findMany: hm.rosterFindMany,
      delete: hm.rosterDelete,
    },
    draftPick: {
      updateMany: hm.draftPickUpdateMany,
      count: hm.draftPickCount,
    },
    draftPickAuditLog: {
      updateMany: hm.draftPickAuditUpdateMany,
      count: hm.draftPickAuditCount,
    },
    $transaction: hm.prismaTransaction,
  },
}))

const HUMAN_ROSTER_ID = 'human-joiner-1'
const COMMISH_ROSTER_ID = 'commish-1'

function commissionerOrphanSlotOrder() {
  return [
    { slot: 1, rosterId: COMMISH_ROSTER_ID, displayName: 'Commish' },
    ...Array.from({ length: 11 }, (_, i) => ({
      slot: i + 2,
      rosterId: `orphan-slot-${i + 2}`,
      displayName: `Team ${i + 2}`,
    })),
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  hm.draftSessionUpdate.mockResolvedValue({})
  hm.rosterFindFirst.mockResolvedValue({ id: HUMAN_ROSTER_ID, platformUserId: 'user-joiner' })
  hm.draftPickUpdateMany.mockResolvedValue({ count: 0 })
  hm.draftPickAuditUpdateMany.mockResolvedValue({ count: 0 })
  hm.draftPickCount.mockResolvedValue(0)
  hm.draftPickAuditCount.mockResolvedValue(0)
  hm.rosterDelete.mockResolvedValue({})
  hm.prismaTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      draftSession: { update: hm.draftSessionUpdate },
      draftPick: { updateMany: hm.draftPickUpdateMany, count: hm.draftPickCount },
      draftPickAuditLog: {
        updateMany: hm.draftPickAuditUpdateMany,
        count: hm.draftPickAuditCount,
      },
      roster: { delete: hm.rosterDelete },
    }
    return fn(tx)
  })
})

describe('evictOrphanForNewHumanRoster (Slice 7.1)', () => {
  it('commissioner + 11 orphans → human claims slot 2, slot 1 untouched, orphan deleted when safe', async () => {
    const slotOrder = commissionerOrphanSlotOrder()
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      id: 'ds-1',
      status: 'pre_draft',
      slotOrder,
    })
    // mock roster rows for every slotOrder id: commish is a human (non-orphan platformUserId),
    // rest are orphan-*
    hm.rosterFindMany.mockResolvedValue([
      { id: COMMISH_ROSTER_ID, platformUserId: 'user-commish' },
      ...slotOrder.slice(1).map((s, i) => ({
        id: s.rosterId,
        platformUserId: `orphan-${i + 2}`,
      })),
    ])
    // After tx commit, mock the "re-read" of slotOrder to show the swap.
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      slotOrder: [
        slotOrder[0],
        { ...slotOrder[1], rosterId: HUMAN_ROSTER_ID, displayName: 'Team 2' },
        ...slotOrder.slice(2),
      ],
    })

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    const res = await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: HUMAN_ROSTER_ID,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rebalanced).toBe(true)
    expect(res.slotIndex).toBe(1)
    expect(res.evictedRosterId).toBe('orphan-slot-2')
    expect(res.orphanDeleted).toBe(true)

    // Session update persists new slotOrder with slot 1 unchanged
    const updateCall = hm.draftSessionUpdate.mock.calls[0][0]
    const newSlotOrder = updateCall.data.slotOrder
    expect(newSlotOrder[0].rosterId).toBe(COMMISH_ROSTER_ID)
    expect(newSlotOrder[1].rosterId).toBe(HUMAN_ROSTER_ID)
    // Orphan cleanly deleted (zero lingering refs)
    expect(hm.rosterDelete).toHaveBeenCalledWith({ where: { id: 'orphan-slot-2' } })
  })

  it('human already in slotOrder → no-op, no writes', async () => {
    const slotOrder = [
      { slot: 1, rosterId: COMMISH_ROSTER_ID, displayName: 'Commish' },
      { slot: 2, rosterId: HUMAN_ROSTER_ID, displayName: 'Joiner' },
    ]
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      id: 'ds-1',
      status: 'pre_draft',
      slotOrder,
    })

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    const res = await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: HUMAN_ROSTER_ID,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rebalanced).toBe(false)
    expect(res.reason).toBe('ALREADY_SEATED')
    expect(hm.prismaTransaction).not.toHaveBeenCalled()
    expect(hm.draftSessionUpdate).not.toHaveBeenCalled()
  })

  it('no orphan slots available (all humans) → rebalanced=false NO_ORPHAN_SLOT_AVAILABLE', async () => {
    const slotOrder = [
      { slot: 1, rosterId: COMMISH_ROSTER_ID, displayName: 'Commish' },
      { slot: 2, rosterId: 'human-b', displayName: 'User B' },
    ]
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      id: 'ds-1',
      status: 'pre_draft',
      slotOrder,
    })
    hm.rosterFindMany.mockResolvedValue([
      { id: COMMISH_ROSTER_ID, platformUserId: 'user-commish' },
      { id: 'human-b', platformUserId: 'user-b' },
    ])

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    const res = await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: HUMAN_ROSTER_ID,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rebalanced).toBe(false)
    expect(res.reason).toBe('NO_ORPHAN_SLOT_AVAILABLE')
    expect(hm.prismaTransaction).not.toHaveBeenCalled()
  })

  it('draft in_progress → DRAFT_ALREADY_STARTED, no writes', async () => {
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      id: 'ds-1',
      status: 'in_progress',
      slotOrder: commissionerOrphanSlotOrder(),
    })

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    const res = await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: HUMAN_ROSTER_ID,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rebalanced).toBe(false)
    expect(res.reason).toBe('DRAFT_ALREADY_STARTED')
    expect(hm.prismaTransaction).not.toHaveBeenCalled()
    expect(hm.draftPickUpdateMany).not.toHaveBeenCalled()
  })

  it('draft completed → DRAFT_ALREADY_STARTED, no writes', async () => {
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      id: 'ds-1',
      status: 'completed',
      slotOrder: commissionerOrphanSlotOrder(),
    })

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    const res = await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: HUMAN_ROSTER_ID,
    })

    expect(res.rebalanced).toBe(false)
    if (res.ok) expect(res.reason).toBe('DRAFT_ALREADY_STARTED')
  })

  it('paused draft with pre-draft ASSIGN picks is STILL allowed: picks + audit remapped to human', async () => {
    const slotOrder = commissionerOrphanSlotOrder()
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      id: 'ds-1',
      status: 'paused',
      slotOrder,
    })
    hm.rosterFindMany.mockResolvedValue([
      { id: COMMISH_ROSTER_ID, platformUserId: 'user-commish' },
      ...slotOrder.slice(1).map((s, i) => ({
        id: s.rosterId,
        platformUserId: `orphan-${i + 2}`,
      })),
    ])
    // There's a pre-draft ASSIGN pick on the orphan being evicted.
    hm.draftPickUpdateMany.mockResolvedValue({ count: 1 })
    hm.draftPickAuditUpdateMany.mockResolvedValue({ count: 1 })
    // After remap, no more refs to the evicted orphan.
    hm.draftPickCount.mockResolvedValue(0)
    hm.draftPickAuditCount.mockResolvedValue(0)
    hm.draftSessionFindUnique.mockResolvedValueOnce({ slotOrder: slotOrder })

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    const res = await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: HUMAN_ROSTER_ID,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rebalanced).toBe(true)
    expect(res.picksRemapped).toBe(1)
    // Picks updated FROM orphan-slot-2 TO the human roster
    expect(hm.draftPickUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 'ds-1', rosterId: 'orphan-slot-2' },
        data: { rosterId: HUMAN_ROSTER_ID },
      }),
    )
  })

  it('orphan NOT deleted when lingering references remain after remap', async () => {
    const slotOrder = commissionerOrphanSlotOrder()
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      id: 'ds-1',
      status: 'pre_draft',
      slotOrder,
    })
    hm.rosterFindMany.mockResolvedValue([
      { id: COMMISH_ROSTER_ID, platformUserId: 'user-commish' },
      ...slotOrder.slice(1).map((s, i) => ({
        id: s.rosterId,
        platformUserId: `orphan-${i + 2}`,
      })),
    ])
    // Simulate: a pick still references the evicted orphan after remap
    // (shouldn't happen in practice but test the safety gate).
    hm.draftPickCount.mockResolvedValue(1)
    hm.draftSessionFindUnique.mockResolvedValueOnce({ slotOrder: slotOrder })

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    const res = await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: HUMAN_ROSTER_ID,
    })

    expect(res.rebalanced).toBe(true)
    if (res.ok) expect(res.orphanDeleted).toBe(false)
    expect(hm.rosterDelete).not.toHaveBeenCalled()
  })

  it('roster not in this league → ROSTER_NOT_IN_LEAGUE, no writes', async () => {
    hm.rosterFindFirst.mockResolvedValueOnce(null)
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      id: 'ds-1',
      status: 'pre_draft',
      slotOrder: commissionerOrphanSlotOrder(),
    })

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    const res = await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: 'not-in-this-league',
    })
    expect(res.rebalanced).toBe(false)
    if (res.ok) expect(res.reason).toBe('ROSTER_NOT_IN_LEAGUE')
    expect(hm.prismaTransaction).not.toHaveBeenCalled()
  })

  it('session not found → SESSION_NOT_FOUND, no writes', async () => {
    hm.draftSessionFindUnique.mockResolvedValueOnce(null)

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    const res = await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: HUMAN_ROSTER_ID,
    })
    expect(res.rebalanced).toBe(false)
    if (res.ok) expect(res.reason).toBe('SESSION_NOT_FOUND')
    expect(hm.prismaTransaction).not.toHaveBeenCalled()
  })

  it('uses provided humanDisplayName to label the new slot', async () => {
    const slotOrder = commissionerOrphanSlotOrder()
    hm.draftSessionFindUnique.mockResolvedValueOnce({
      id: 'ds-1',
      status: 'pre_draft',
      slotOrder,
    })
    hm.rosterFindMany.mockResolvedValue([
      { id: COMMISH_ROSTER_ID, platformUserId: 'user-commish' },
      ...slotOrder.slice(1).map((s, i) => ({
        id: s.rosterId,
        platformUserId: `orphan-${i + 2}`,
      })),
    ])
    hm.draftSessionFindUnique.mockResolvedValueOnce({ slotOrder: slotOrder })

    const { evictOrphanForNewHumanRoster } = await import(
      '@/lib/league-setup/evictOrphanForNewHumanRoster'
    )
    await evictOrphanForNewHumanRoster({
      leagueId: 'league-1',
      humanRosterId: HUMAN_ROSTER_ID,
      humanDisplayName: 'Alice',
    })

    const updateCall = hm.draftSessionUpdate.mock.calls[0][0]
    expect(updateCall.data.slotOrder[1].displayName).toBe('Alice')
  })
})
