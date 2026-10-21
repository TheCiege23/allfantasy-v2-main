import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirst = vi.fn()
const updateMany = vi.fn()
const getComputedDraftRounds = vi.fn()
const getDraftConfigForLeague = vi.fn()
const updateDraftVariantSettings = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { draftSession: { findFirst: (...a: unknown[]) => findFirst(...a) }, leagueSettings: { updateMany: (...a: unknown[]) => updateMany(...a) } },
}))
vi.mock('@/lib/draft-room/currentDraftSession', () => ({ CURRENT_DRAFT_SESSION_ORDER: [] }))
vi.mock('@/lib/draft/computedDraftRounds', () => ({ getComputedDraftRounds: (...a: unknown[]) => getComputedDraftRounds(...a) }))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({ getDraftConfigForLeague: (...a: unknown[]) => getDraftConfigForLeague(...a) }))
vi.mock('@/lib/draft-defaults/DraftVariantSettingsHub', () => ({ updateDraftVariantSettings: (...a: unknown[]) => updateDraftVariantSettings(...a) }))

import { syncDraftRoundsToRoster } from '@/lib/draft/syncDraftRoundsToRoster'

/** 4 UTIL + 1 SU starters, 3 BN, 2 IL (excluded) → 8 rounds. */
const after = { rounds: 8, rosterSpots: 8, starters: 5, bench: 3, taxiDevyCounted: 0, irExcluded: 2, taxiDevyExcluded: 0, countsTaxiAndDevy: false }
const before = { ...after, rounds: 13, rosterSpots: 13, starters: 10 }

describe('syncDraftRoundsToRoster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findFirst.mockResolvedValue({ status: 'pre_draft' })
    getComputedDraftRounds.mockResolvedValue(after)
    getDraftConfigForLeague.mockResolvedValue({ rounds: 13 })
  })

  it('moves the draft to the new roster size before the draft starts', async () => {
    const r = await syncDraftRoundsToRoster('L1', { before, keepManualOverride: false })
    expect(r).toEqual({ synced: true, rounds: 8, previousRounds: 13 })
    expect(updateDraftVariantSettings).toHaveBeenCalledWith('L1', { config: { rounds: 8 } })
    expect(updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' }, data: { rounds: 8 } })
  })

  it('fixes a stale round count even when the old one was never in step', async () => {
    getDraftConfigForLeague.mockResolvedValue({ rounds: 15 })
    const r = await syncDraftRoundsToRoster('L1', { before, keepManualOverride: false })
    expect(r).toMatchObject({ synced: true, rounds: 8, previousRounds: 15 })
  })

  it('never resizes a draft that has started', async () => {
    findFirst.mockResolvedValue({ status: 'in_progress' })
    expect(await syncDraftRoundsToRoster('L1', { before, keepManualOverride: false })).toEqual({ synced: false, reason: 'draft_started' })
    expect(updateDraftVariantSettings).not.toHaveBeenCalled()
  })

  it("keeps an AF Commissioner's deliberate override", async () => {
    getDraftConfigForLeague.mockResolvedValue({ rounds: 20 })
    expect(await syncDraftRoundsToRoster('L1', { before, keepManualOverride: true })).toEqual({ synced: false, reason: 'manual_override' })
    expect(updateDraftVariantSettings).not.toHaveBeenCalled()
  })

  it('still follows the roster for an AF Commissioner whose rounds matched the old roster', async () => {
    const r = await syncDraftRoundsToRoster('L1', { before, keepManualOverride: true })
    expect(r).toMatchObject({ synced: true, rounds: 8 })
  })

  it('does nothing when already in step or without a template', async () => {
    getDraftConfigForLeague.mockResolvedValue({ rounds: 8 })
    expect(await syncDraftRoundsToRoster('L1', { before, keepManualOverride: false })).toEqual({ synced: false, reason: 'unchanged' })
    getComputedDraftRounds.mockResolvedValue(null)
    expect(await syncDraftRoundsToRoster('L1', { before, keepManualOverride: false })).toEqual({ synced: false, reason: 'no_template' })
    expect(updateDraftVariantSettings).not.toHaveBeenCalled()
  })
})
