import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  draftSessionFindUnique: vi.fn(),
  draftSessionUpdate: vi.fn(),
  buildSlotOrderForLeague: vi.fn(),
  materializeDraftSlots: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findUnique: hm.draftSessionFindUnique,
      findFirst: hm.draftSessionFindUnique,
      update: hm.draftSessionUpdate,
    },
  },
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSlotOrderForLeague: hm.buildSlotOrderForLeague,
}))

vi.mock('@/lib/league-setup/materializeDraftSlots', () => ({
  materializeDraftSlots: hm.materializeDraftSlots,
}))

beforeEach(() => {
  vi.clearAllMocks()
  hm.draftSessionUpdate.mockResolvedValue({})
})

describe('autoMaterializeDraftForLeague (Slice 7)', () => {
  it('returns a failure when draft session is missing', async () => {
    hm.draftSessionFindUnique.mockResolvedValue(null)
    const { autoMaterializeDraftForLeague } = await import(
      '@/lib/league-setup/autoMaterializeDraftForLeague'
    )
    const res = await autoMaterializeDraftForLeague('league-1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/not found/)
    expect(hm.buildSlotOrderForLeague).not.toHaveBeenCalled()
    expect(hm.materializeDraftSlots).not.toHaveBeenCalled()
  })

  it('seeds slotOrder from rosters + placeholders when the session has an empty slotOrder (fresh league)', async () => {
    hm.draftSessionFindUnique.mockResolvedValue({ id: 'ds-1', teamCount: 12, slotOrder: [] })
    const seeded = [
      { slot: 1, rosterId: 'human-1', displayName: 'Commish' },
      ...Array.from({ length: 11 }, (_, i) => ({
        slot: i + 2,
        rosterId: `placeholder-${i + 2}`,
        displayName: `Team ${i + 2}`,
      })),
    ]
    hm.buildSlotOrderForLeague.mockResolvedValue(seeded)
    const finalOrder = seeded.map((s, i) =>
      i === 0 ? s : { ...s, rosterId: `real-${i + 1}` },
    )
    hm.materializeDraftSlots.mockResolvedValue({
      ok: true,
      createdCount: 11,
      replacedCount: 11,
      alreadyMaterializedCount: 1,
      slotOrder: finalOrder,
    })
    const { autoMaterializeDraftForLeague } = await import(
      '@/lib/league-setup/autoMaterializeDraftForLeague'
    )
    const res = await autoMaterializeDraftForLeague('league-1')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.slotOrderSeeded).toBe(true)
      expect(res.materializedCreated).toBe(11)
      expect(res.materializedAlready).toBe(1)
      // Slot 1 in the final layout is still the human roster — never replaced.
      expect(res.finalSlotOrder[0]).toMatchObject({ slot: 1, rosterId: 'human-1' })
      // All subsequent slots are real ids, no placeholders.
      for (const entry of res.finalSlotOrder.slice(1)) {
        expect(entry.rosterId.startsWith('placeholder-')).toBe(false)
      }
    }
    expect(hm.draftSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slotOrder: seeded,
          version: { increment: 1 },
        }),
      }),
    )
  })

  it('multi-human league: seats every joined human before any AI/orphan is created', async () => {
    hm.draftSessionFindUnique.mockResolvedValue({ id: 'ds-1', teamCount: 12, slotOrder: [] })
    // buildSlotOrderForLeague (Slice 5 patched) returns 4 real rosters + 8 placeholders.
    const seeded = [
      { slot: 1, rosterId: 'human-1', displayName: 'Alice' },
      { slot: 2, rosterId: 'human-2', displayName: 'Bob' },
      { slot: 3, rosterId: 'human-3', displayName: 'Carol' },
      { slot: 4, rosterId: 'human-4', displayName: 'Dave' },
      ...Array.from({ length: 8 }, (_, i) => ({
        slot: i + 5,
        rosterId: `placeholder-${i + 5}`,
        displayName: `Team ${i + 5}`,
      })),
    ]
    hm.buildSlotOrderForLeague.mockResolvedValue(seeded)
    const finalOrder = seeded.map((s) =>
      s.rosterId.startsWith('placeholder-')
        ? { ...s, rosterId: `real-ai-${s.slot}` }
        : s,
    )
    hm.materializeDraftSlots.mockResolvedValue({
      ok: true,
      createdCount: 8,
      replacedCount: 8,
      alreadyMaterializedCount: 4,
      slotOrder: finalOrder,
    })
    const { autoMaterializeDraftForLeague } = await import(
      '@/lib/league-setup/autoMaterializeDraftForLeague'
    )
    const res = await autoMaterializeDraftForLeague('league-1')
    expect(res.ok).toBe(true)
    if (res.ok) {
      // All 4 humans still seated in their original slots
      expect(res.finalSlotOrder[0].rosterId).toBe('human-1')
      expect(res.finalSlotOrder[1].rosterId).toBe('human-2')
      expect(res.finalSlotOrder[2].rosterId).toBe('human-3')
      expect(res.finalSlotOrder[3].rosterId).toBe('human-4')
      // Only slots 5..12 became AI/orphan
      for (const entry of res.finalSlotOrder.slice(4)) {
        expect(entry.rosterId.startsWith('real-ai-')).toBe(true)
      }
      expect(res.materializedCreated).toBe(8)
      expect(res.materializedAlready).toBe(4)
    }
  })

  it('idempotent: when slotOrder is already fully materialized, no seed and no creates', async () => {
    const finalOrder = Array.from({ length: 12 }, (_, i) => ({
      slot: i + 1,
      rosterId: `real-${i + 1}`,
      displayName: `Team ${i + 1}`,
    }))
    hm.draftSessionFindUnique.mockResolvedValue({
      id: 'ds-1',
      teamCount: 12,
      slotOrder: finalOrder,
    })
    hm.materializeDraftSlots.mockResolvedValue({
      ok: true,
      createdCount: 0,
      replacedCount: 0,
      alreadyMaterializedCount: 12,
      slotOrder: finalOrder,
    })
    const { autoMaterializeDraftForLeague } = await import(
      '@/lib/league-setup/autoMaterializeDraftForLeague'
    )
    const res = await autoMaterializeDraftForLeague('league-1')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.slotOrderSeeded).toBe(false)
      expect(res.materializedCreated).toBe(0)
      expect(res.materializedAlready).toBe(12)
    }
    expect(hm.buildSlotOrderForLeague).not.toHaveBeenCalled()
    expect(hm.draftSessionUpdate).not.toHaveBeenCalled()
  })

  it('does not reseed slotOrder when league has a curated slot order (draft-order settings / lottery)', async () => {
    // Simulated curated order of length === teamCount already persisted
    const curated = Array.from({ length: 12 }, (_, i) => ({
      slot: i + 1,
      rosterId: `real-${i + 1}`,
      displayName: `Team ${i + 1}`,
    }))
    hm.draftSessionFindUnique.mockResolvedValue({
      id: 'ds-1',
      teamCount: 12,
      slotOrder: curated,
    })
    hm.materializeDraftSlots.mockResolvedValue({
      ok: true,
      createdCount: 0,
      replacedCount: 0,
      alreadyMaterializedCount: 12,
      slotOrder: curated,
    })
    const { autoMaterializeDraftForLeague } = await import(
      '@/lib/league-setup/autoMaterializeDraftForLeague'
    )
    const res = await autoMaterializeDraftForLeague('league-1')
    expect(res.ok).toBe(true)
    expect(hm.buildSlotOrderForLeague).not.toHaveBeenCalled()
    expect(hm.draftSessionUpdate).not.toHaveBeenCalled()
  })

  it('bubbles up a failure when materializeDraftSlots returns an error', async () => {
    hm.draftSessionFindUnique.mockResolvedValue({ id: 'ds-1', teamCount: 12, slotOrder: [] })
    hm.buildSlotOrderForLeague.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        slot: i + 1,
        rosterId: i === 0 ? 'human-1' : `placeholder-${i + 1}`,
        displayName: `Team ${i + 1}`,
      })),
    )
    hm.materializeDraftSlots.mockResolvedValue({ ok: false, status: 500, error: 'boom' })
    const { autoMaterializeDraftForLeague } = await import(
      '@/lib/league-setup/autoMaterializeDraftForLeague'
    )
    const res = await autoMaterializeDraftForLeague('league-1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('boom')
  })

  it('AI/orphan never replaces a human: when materializer returns, slot 1 rosterId is preserved', async () => {
    hm.draftSessionFindUnique.mockResolvedValue({ id: 'ds-1', teamCount: 12, slotOrder: [] })
    const seeded = [
      { slot: 1, rosterId: 'human-1', displayName: 'Commish' },
      ...Array.from({ length: 11 }, (_, i) => ({
        slot: i + 2,
        rosterId: `placeholder-${i + 2}`,
        displayName: `Team ${i + 2}`,
      })),
    ]
    hm.buildSlotOrderForLeague.mockResolvedValue(seeded)
    const finalOrder = seeded.map((s, i) =>
      i === 0 ? s : { ...s, rosterId: `orphan-${i + 1}` },
    )
    hm.materializeDraftSlots.mockResolvedValue({
      ok: true,
      createdCount: 11,
      replacedCount: 11,
      alreadyMaterializedCount: 1,
      slotOrder: finalOrder,
    })
    const { autoMaterializeDraftForLeague } = await import(
      '@/lib/league-setup/autoMaterializeDraftForLeague'
    )
    const res = await autoMaterializeDraftForLeague('league-1')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.finalSlotOrder[0].rosterId).toBe('human-1')
      // Sanity: no placeholder ids remain anywhere
      for (const entry of res.finalSlotOrder) {
        expect(entry.rosterId.startsWith('placeholder-')).toBe(false)
      }
    }
  })
})
