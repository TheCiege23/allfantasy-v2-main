import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Draft as me (AF Commissioner): a live draft's missed pick is made the way that manager drafts,
 * before the ordinary need-based / best-available autopick, and only when that step has an answer.
 */

const hm = vi.hoisted(() => ({
  tryDraftAsMePick: vi.fn(),
  draftSessionFindFirst: vi.fn(),
  leagueFindUnique: vi.fn(),
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
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: hm.draftSessionFindFirst, findFirst: hm.draftSessionFindFirst },
    league: { findUnique: hm.leagueFindUnique },
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

/** A pool entry in the shape `getResolvedDraftPoolForLeague` returns (and the snapshot stores). */
const entry = (name: string, position: string, adp: number) => ({
  name,
  position,
  team: 'BOS',
  adp,
  playerId: `id-${name}`,
  display: { playerId: `id-${name}` },
})

/** `n` filler guards ranked behind a clear #1 centre. */
function pool(n: number) {
  return [entry('Top Center', 'C', 1), ...Array.from({ length: n - 1 }, (_, i) => entry(`Guard ${i + 2}`, 'PG', i + 2))]
}

const warm = (entries: unknown[]) => ({
  warm: true,
  source: 'db-cache',
  payload: { entries, sport: 'NBA', rosterConfigurationIncomplete: false },
  entryCount: entries.length,
  syncedAt: null,
  cacheKey: 'k',
})
const cold = { warm: false, source: 'cold', entryCount: 0, syncedAt: null, cacheKey: 'k' }

function session(picks: Array<{ playerName: string; position: string; overall: number }> = []) {
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
    // Every earlier pick lands on another team, so the clock comes back round to slot 1.
    picks: picks.map((p) => ({ ...p, rosterId: 'r2', pickMetadata: null })),
    queues: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hm.draftSessionFindFirst.mockResolvedValue(session())
  hm.leagueFindUnique.mockResolvedValue({ sport: 'NBA', isDynasty: false, settings: {} })
  hm.getAllowedPositionsAndRosterSize.mockResolvedValue({
    draftEligiblePositions: new Set(['PG', 'SG', 'SF', 'PF', 'C']),
    rosterUnionAllowedPositions: new Set(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'BN']),
    totalRosterSize: 13,
  })
  hm.getDraftUISettingsForLeague.mockResolvedValue({ autoPickEnabled: true, aiAdpEnabled: false })
  hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'bpa' })
  hm.tryAiOpponentAutopickForExpiredTimer.mockResolvedValue({ ok: false })
  hm.getRosterSlotLabelsForLeagueDraft.mockResolvedValue(['PG', 'SG', 'SF', 'PF', 'C', 'UTIL', 'BN'])
  hm.submitPick.mockResolvedValue({ success: true })
  hm.getResolvedDraftPoolForLeague.mockResolvedValue({ entries: [entry('Rebuilt Pick', 'C', 1)], rosterConfigurationIncomplete: false })
  hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(warm(pool(200)))
  hm.tryDraftAsMePick.mockResolvedValue(null)
})

describe('draft as me in the autopick', () => {
  it('a manager with a style gets the pick they would make, and it is submitted as theirs', async () => {
    hm.tryDraftAsMePick.mockResolvedValue({ playerName: 'Guard 9', position: 'PG', team: 'BOS', playerId: 'id-Guard 9', byeWeek: null, adp: 9, reason: 'Picked the way you draft: you usually draft close to ADP.' })
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Guard 9', strategy: 'draft-as-me', reason: expect.stringContaining('the way you draft') } })
    expect(hm.submitPick).toHaveBeenCalledWith(expect.objectContaining({ playerName: 'Guard 9', rosterId: 'on-clock', source: 'auto' }))
    expect(hm.tryDraftAsMePick).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', rosterId: 'on-clock', overall: 1 }))
  })

  it('no style (no plan, no history) falls through to the ordinary autopick', async () => {
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Top Center', strategy: 'bpa' } })
  })

  it('a failure in the style step never costs the pick', async () => {
    hm.tryDraftAsMePick.mockRejectedValue(new Error('db down'))
    expect(await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')).toMatchObject({ ok: true, pick: { playerName: 'Top Center' } })
  })

  it('mock drafts are left alone', async () => {
    hm.draftSessionFindFirst.mockResolvedValue({ ...session(), sessionKind: 'mock' })
    hm.tryDraftAsMePick.mockResolvedValue({ playerName: 'Guard 9', position: 'PG', team: 'BOS', playerId: null, byeWeek: null, adp: 9, reason: 'x' })
    await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(hm.tryDraftAsMePick).not.toHaveBeenCalled()
  })
})
