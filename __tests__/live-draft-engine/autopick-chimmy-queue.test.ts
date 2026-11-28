import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Chimmy Queue (a manager's own AF Pro auto-pick mode, `ai_queue`): once the queue gives no pick,
 * Chimmy picks for the team's needs instead of the league's plain best available. Before 2026-11-23
 * the mode was saved and announced but never read at pick time.
 */

const hm = vi.hoisted(() => ({
  personalChimmyQueueOn: vi.fn(),
  tryDraftAsMePick: vi.fn(),
  draftSessionFindFirst: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindUnique: vi.fn(),
  getViewerAutopickPreference: vi.fn(),
  getDraftConfigForLeague: vi.fn(),
  getAllowedPositionsAndRosterSize: vi.fn(),
  getDraftUISettingsForLeague: vi.fn(),
  submitPick: vi.fn(),
  tryAiOpponentAutopickForExpiredTimer: vi.fn(),
  getRosterSlotLabelsForLeagueDraft: vi.fn(),
  getResolvedDraftPoolForLeague: vi.fn(),
  getWarmDraftPoolSnapshotFast: vi.fn(),
  ensureDraftPoolReady: vi.fn(),
}))

vi.mock('@/lib/draft-room/draftAsMeAutopick', () => ({ tryDraftAsMePick: hm.tryDraftAsMePick }))
// No Draft OS decision here, so these cover the recommender fallback; the decision path has its own suite
// (autopick-chimmy-queue-draft-os.test.ts).
vi.mock('@/lib/shared-services/draft/pickDecision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared-services/draft/pickDecision')>()),
  decideDraftPickForRoster: vi.fn(async () => ({ ok: false, reason: 'no_draft' })),
}))
vi.mock('@/lib/live-draft-engine/LiveDraftAutopickPreferenceService', () => ({
  getViewerAutopickPreference: hm.getViewerAutopickPreference,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: hm.draftSessionFindFirst, findFirst: hm.draftSessionFindFirst },
    league: { findUnique: hm.leagueFindUnique },
    roster: { findUnique: hm.rosterFindUnique },
  },
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({ getDraftConfigForLeague: hm.getDraftConfigForLeague }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: hm.getDraftUISettingsForLeague }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live-draft-engine/RosterFitValidation')>()),
  getAllowedPositionsAndRosterSize: hm.getAllowedPositionsAndRosterSize,
}))
vi.mock('@/lib/adp-data', () => ({ getLiveADP: vi.fn(async () => []) }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({
  getResolvedDraftPoolForLeague: hm.getResolvedDraftPoolForLeague,
}))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({
  getWarmDraftPoolSnapshotFast: hm.getWarmDraftPoolSnapshotFast,
  ensureDraftPoolReady: hm.ensureDraftPoolReady,
}))
vi.mock('@/lib/draft-room', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/draft-room')>()),
  getRosterSlotLabelsForLeagueDraft: hm.getRosterSlotLabelsForLeagueDraft,
}))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({ submitPick: hm.submitPick }))
vi.mock('@/lib/ai/opponents/liveDraftAiAutopick', () => ({
  tryAiOpponentAutopickForExpiredTimer: hm.tryAiOpponentAutopickForExpiredTimer,
}))

import { submitBestAvailableAutopickForExpiredTimer } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'
import { personalChimmyQueueOn } from '@/lib/live-draft-engine/chimmyQueueAutopick'

const entry = (name: string, position: string, adp: number) => ({
  name,
  position,
  team: 'BOS',
  adp,
  playerId: `id-${name}`,
  display: { playerId: `id-${name}` },
})

const warm = (entries: unknown[]) => ({
  warm: true,
  source: 'db-cache',
  payload: { entries, sport: 'NBA', rosterConfigurationIncomplete: false },
  entryCount: entries.length,
  syncedAt: null,
  cacheKey: 'k',
})

function session() {
  return {
    id: 'ds-1',
    leagueId: 'L1',
    status: 'in_progress',
    draftType: 'linear',
    rounds: 13,
    teamCount: 8,
    thirdRoundReversal: false,
    sportType: 'NBA',
    sessionKind: 'live',
    slotOrder: Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, rosterId: i === 0 ? 'on-clock' : `r${i + 1}`, displayName: `T${i + 1}` })),
    tradedPicks: [],
    picks: [],
    queues: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hm.draftSessionFindFirst.mockResolvedValue(session())
  hm.leagueFindUnique.mockResolvedValue({ sport: 'NBA', isDynasty: false, settings: {} })
  hm.rosterFindUnique.mockResolvedValue({ platformUserId: 'user-1', managerUserId: null })
  hm.getViewerAutopickPreference.mockResolvedValue({ enabled: true, mode: 'standard', isProEligible: true, updatedAt: null })
  hm.getAllowedPositionsAndRosterSize.mockResolvedValue({
    draftEligiblePositions: new Set(['PG', 'SG', 'SF', 'PF', 'C']),
    rosterUnionAllowedPositions: new Set(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'BN']),
    totalRosterSize: 13,
  })
  hm.getDraftUISettingsForLeague.mockResolvedValue({ autoPickEnabled: true, aiAdpEnabled: false })
  // The league's own fallback is plain best available — Chimmy Queue must not depend on it saying otherwise.
  hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'bpa' })
  hm.tryAiOpponentAutopickForExpiredTimer.mockResolvedValue({ ok: false })
  hm.getRosterSlotLabelsForLeagueDraft.mockResolvedValue(['PG', 'SG', 'SF', 'PF', 'C', 'UTIL', 'BN'])
  hm.submitPick.mockResolvedValue({ success: true })
  hm.getResolvedDraftPoolForLeague.mockResolvedValue({ entries: [], rosterConfigurationIncomplete: false })
  hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(
    warm([entry('Top Center', 'C', 1), ...Array.from({ length: 199 }, (_, i) => entry(`Guard ${i + 2}`, 'PG', i + 2))]),
  )
  hm.tryDraftAsMePick.mockResolvedValue(null)
})

describe('Chimmy Queue in the timeout pick', () => {
  it('with the queue spent, Chimmy picks for the team instead of the plain best available', async () => {
    hm.getViewerAutopickPreference.mockResolvedValue({ enabled: true, mode: 'ai_queue', isProEligible: true, updatedAt: null })
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { strategy: 'need-based', reason: expect.stringMatching(/^Chimmy's pick for your team: /) } })
    expect(hm.getViewerAutopickPreference).toHaveBeenCalledWith('ds-1', 'user-1')
    expect(hm.submitPick).toHaveBeenCalledWith(expect.objectContaining({ rosterId: 'on-clock', source: 'auto' }))
  })

  it('Standard mode keeps the league fallback (best available)', async () => {
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Top Center', strategy: 'bpa' } })
  })

  it('Chimmy Queue switched off (enabled: false) keeps the league fallback', async () => {
    hm.getViewerAutopickPreference.mockResolvedValue({ enabled: false, mode: 'ai_queue', isProEligible: true, updatedAt: null })
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { strategy: 'bpa' } })
  })

  it('a failed preference read never costs the pick', async () => {
    hm.getViewerAutopickPreference.mockRejectedValue(new Error('db down'))
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Top Center', strategy: 'bpa' } })
  })

  it("league Draft like me without enough history does not overwrite Chimmy's reason", async () => {
    hm.getViewerAutopickPreference.mockResolvedValue({ enabled: true, mode: 'ai_queue', isProEligible: true, updatedAt: null })
    hm.tryDraftAsMePick.mockImplementation(async (args: { onNotEnoughHistory?: (r: string) => void }) => {
      args.onNotEnoughHistory?.('Draft like me needs 10 of your own picks from past drafts and has 4.')
      return null
    })
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { strategy: 'need-based', reason: expect.stringMatching(/^Chimmy's pick for your team: /) } })
  })

  it('without Chimmy Queue the not-enough-history note still explains the fallback', async () => {
    hm.tryDraftAsMePick.mockImplementation(async (args: { onNotEnoughHistory?: (r: string) => void }) => {
      args.onNotEnoughHistory?.('Draft like me needs 10 of your own picks from past drafts and has 4.')
      return null
    })
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { strategy: 'bpa', reason: expect.stringMatching(/^Draft like me needs 10/) } })
  })

  it('Draft like me still goes before Chimmy Queue when it has an answer', async () => {
    hm.getViewerAutopickPreference.mockResolvedValue({ enabled: true, mode: 'ai_queue', isProEligible: true, updatedAt: null })
    hm.tryDraftAsMePick.mockResolvedValue({ playerName: 'Guard 9', position: 'PG', team: 'BOS', playerId: 'id-Guard 9', byeWeek: null, adp: 9, reason: 'Picked the way you draft.' })
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Guard 9', strategy: 'draft-as-me' } })
  })
})

describe('personalChimmyQueueOn', () => {
  it('is on only for an enabled ai_queue preference', async () => {
    hm.getViewerAutopickPreference.mockResolvedValue({ enabled: true, mode: 'ai_queue', isProEligible: true, updatedAt: null })
    expect(await personalChimmyQueueOn('ds-1', 'on-clock')).toBe(true)
    hm.getViewerAutopickPreference.mockResolvedValue({ enabled: true, mode: 'draft_as_me', isProEligible: true, updatedAt: null })
    expect(await personalChimmyQueueOn('ds-1', 'on-clock')).toBe(false)
  })

  it('an unowned or AI-managed team has no manager preference to read', async () => {
    hm.rosterFindUnique.mockResolvedValue({ platformUserId: 'orphan-3', managerUserId: null })
    expect(await personalChimmyQueueOn('ds-1', 'on-clock')).toBe(false)
    hm.rosterFindUnique.mockResolvedValue(null)
    expect(await personalChimmyQueueOn('ds-1', 'on-clock')).toBe(false)
    expect(hm.getViewerAutopickPreference).not.toHaveBeenCalled()
  })
})
