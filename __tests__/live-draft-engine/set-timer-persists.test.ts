/**
 * 2026-11-24: a pick timer changed in the room used to last one pick. `setTimerSeconds` wrote only the
 * draft session, and resume / reset re-derive the clock from LeagueSettings and the draft config, so
 * the old length came back for every later pick. The new length is now written there too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  sessionFindFirst: vi.fn(),
  lsUpdateMany: vi.fn(),
  updateSessionWithArchive: vi.fn(),
  updateDraftConfigForLeague: vi.fn(),
  timerMode: 'per_pick' as string,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: hm.sessionFindFirst },
    leagueSettings: { updateMany: hm.lsUpdateMany },
  },
}))
vi.mock('@/lib/draft-archive/events', () => ({ updateSessionWithArchive: hm.updateSessionWithArchive, recordArchiveEvent: vi.fn() }))
vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({ loadSeasonDraftContext: vi.fn(async () => null) }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: vi.fn(async () => ({ timerMode: hm.timerMode })) }))
vi.mock('@/lib/draft-defaults/DraftVariantSettingsHub', () => ({ updateDraftConfigForLeague: hm.updateDraftConfigForLeague }))

import { setTimerSeconds } from '@/lib/live-draft-engine/DraftSessionService'

beforeEach(() => {
  vi.clearAllMocks()
  hm.timerMode = 'per_pick'
  hm.sessionFindFirst.mockResolvedValue({ id: 'ds', leagueId: 'L', status: 'in_progress', draftType: 'snake', auctionState: null })
})

describe('setTimerSeconds', () => {
  it('writes the new length to the session, LeagueSettings and the draft config', async () => {
    expect(await setTimerSeconds('L', 120, { resetCurrentTimer: true })).toBe(true)
    expect(hm.updateSessionWithArchive.mock.calls[0][1]).toMatchObject({ timerSeconds: 120 })
    // 120s is the "2 minutes" preset.
    expect(hm.lsUpdateMany).toHaveBeenCalledWith({ where: { leagueId: 'L' }, data: { pickTimerPreset: expect.any(String), pickTimerCustomValue: null } })
    expect(hm.updateDraftConfigForLeague).toHaveBeenCalledWith('L', { timer_seconds: 120 })
  })

  it('a length with no preset is stored as custom', async () => {
    await setTimerSeconds('L', 47)
    expect(hm.lsUpdateMany).toHaveBeenCalledWith({ where: { leagueId: 'L' }, data: { pickTimerPreset: 'custom', pickTimerCustomValue: 47 } })
  })

  it('a slow draft also stores it as the slow-draft length', async () => {
    hm.timerMode = 'overnight_pause'
    await setTimerSeconds('L', 7200)
    expect(hm.updateDraftConfigForLeague).toHaveBeenCalledWith('L', { timer_seconds: 7200, slow_timer_seconds: 7200 })
  })

  it('a failed league write does not fail the change: the session already has it', async () => {
    hm.lsUpdateMany.mockRejectedValueOnce(new Error('db down'))
    expect(await setTimerSeconds('L', 120)).toBe(true)
    expect(hm.updateSessionWithArchive).toHaveBeenCalled()
  })
})
