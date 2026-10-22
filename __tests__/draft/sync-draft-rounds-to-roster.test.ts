import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirst = vi.fn()
const updateMany = vi.fn()
const leagueFindUnique = vi.fn()
const getComputedDraftRounds = vi.fn()
const getDraftConfigForLeague = vi.fn()
const updateDraftVariantSettings = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a) }, draftSession: { findFirst: (...a: unknown[]) => findFirst(...a) }, leagueSettings: { updateMany: (...a: unknown[]) => updateMany(...a) } },
}))
vi.mock('@/lib/draft-room/currentDraftSession', () => ({ CURRENT_DRAFT_SESSION_ORDER: [] }))
vi.mock('@/lib/draft/computedDraftRounds', () => ({ getComputedDraftRounds: (...a: unknown[]) => getComputedDraftRounds(...a) }))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({ getDraftConfigForLeague: (...a: unknown[]) => getDraftConfigForLeague(...a) }))
vi.mock('@/lib/draft-defaults/DraftVariantSettingsHub', () => ({ updateDraftVariantSettings: (...a: unknown[]) => updateDraftVariantSettings(...a) }))

import { syncDraftRoundsToRoster } from '@/lib/draft/syncDraftRoundsToRoster'

/** 4 UTIL + 1 SU starters, 3 BN, 2 IL (excluded) → 8 rounds. */
const after = { rounds: 8, rosterSpots: 8, starters: 5, bench: 3, taxiDevyCounted: 0, irExcluded: 2, taxiDevyExcluded: 0, countsTaxiAndDevy: false }

describe('syncDraftRoundsToRoster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findFirst.mockResolvedValue({ status: 'pre_draft' })
    getComputedDraftRounds.mockResolvedValue(after)
    getDraftConfigForLeague.mockResolvedValue({ rounds: 13 })
    leagueFindUnique.mockResolvedValue({ settings: {} })
  })

  it('moves the draft to the new roster size before the draft starts', async () => {
    const r = await syncDraftRoundsToRoster('L1', { keepManualOverride: false })
    expect(r).toEqual({ synced: true, rounds: 8, previousRounds: 13 })
    expect(updateDraftVariantSettings).toHaveBeenCalledWith('L1', { config: { rounds: 8 } })
    expect(updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' }, data: { rounds: 8 } })
  })

  it('fixes a stale round count even when the old one was never in step', async () => {
    getDraftConfigForLeague.mockResolvedValue({ rounds: 15 })
    const r = await syncDraftRoundsToRoster('L1', { keepManualOverride: false })
    expect(r).toMatchObject({ synced: true, rounds: 8, previousRounds: 15 })
  })

  it('never resizes a draft that has started', async () => {
    findFirst.mockResolvedValue({ status: 'in_progress' })
    expect(await syncDraftRoundsToRoster('L1', { keepManualOverride: false })).toEqual({ synced: false, reason: 'draft_started' })
    expect(updateDraftVariantSettings).not.toHaveBeenCalled()
  })

  it("keeps an AF Commissioner's override that the Draft tab saved on purpose", async () => {
    getDraftConfigForLeague.mockResolvedValue({ rounds: 20 })
    leagueFindUnique.mockResolvedValue({ settings: { draft_rounds_manual: true } })
    expect(await syncDraftRoundsToRoster('L1', { keepManualOverride: true })).toEqual({ synced: false, reason: 'manual_override' })
    expect(updateDraftVariantSettings).not.toHaveBeenCalled()
  })

  it('follows the roster for an AF Commissioner whose rounds were only ever the creation default', async () => {
    // NBA guillotine: creation seeds the sport default (13) while the template has 11 spots. That
    // mismatch used to read as a manual override and the roster change never reached the draft.
    const r = await syncDraftRoundsToRoster('L1', { keepManualOverride: true })
    expect(r).toMatchObject({ synced: true, rounds: 8, previousRounds: 13 })
  })

  it('ignores the override flag for a reset or import (keepManualOverride: false)', async () => {
    leagueFindUnique.mockResolvedValue({ settings: { draft_rounds_manual: true } })
    expect(await syncDraftRoundsToRoster('L1', { keepManualOverride: false })).toMatchObject({ synced: true, rounds: 8 })
  })

  it('does nothing when already in step or without a template', async () => {
    getDraftConfigForLeague.mockResolvedValue({ rounds: 8 })
    expect(await syncDraftRoundsToRoster('L1', { keepManualOverride: false })).toEqual({ synced: false, reason: 'unchanged' })
    getComputedDraftRounds.mockResolvedValue(null)
    expect(await syncDraftRoundsToRoster('L1', { keepManualOverride: false })).toEqual({ synced: false, reason: 'no_template' })
    expect(updateDraftVariantSettings).not.toHaveBeenCalled()
  })
})
