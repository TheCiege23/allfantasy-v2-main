import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 EVERY AUTOPICK WAS A FULL COLD POOL BUILD.
 *
 * `loadFallbackCandidates` asked `getResolvedDraftPoolForLeague` for the pool minus this pick's
 * drafted names — a request no cache can serve — so each expired timer rebuilt the whole pool.
 * Measured 2026-10-13 on a test NBA league: 10–22s per pick (~1,350 players), ~2.5h for a 104-pick
 * board of autopicks. The draft room already holds a warm snapshot of the same pool.
 *
 * Autopick now reads that snapshot, builds it once when it is missing, and rebuilds with exclusions
 * only when the snapshot is too thin to choose from.
 */

const hm = vi.hoisted(() => ({
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

import {
  AUTOPICK_WARM_POOL_MIN_UNDRAFTED,
  submitBestAvailableAutopickForExpiredTimer,
} from '@/lib/live-draft-engine/autopickBestAvailableSubmit'

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
})

describe('autopick reads the warm pool snapshot instead of rebuilding the pool every pick', () => {
  it('a warm snapshot serves the pick with no pool rebuild', async () => {
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(warm(pool(200)))

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Top Center' } })
    expect(hm.getResolvedDraftPoolForLeague).not.toHaveBeenCalled()
    expect(hm.ensureDraftPoolReady).not.toHaveBeenCalled()
  })

  it('a cold pool is built ONCE through the cache, then read from it', async () => {
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValueOnce(cold).mockResolvedValueOnce(warm(pool(200)))
    hm.ensureDraftPoolReady.mockResolvedValue({ ok: true, source: 'rebuilt' })

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Top Center' } })
    expect(hm.ensureDraftPoolReady).toHaveBeenCalledTimes(1)
    expect(hm.getResolvedDraftPoolForLeague).not.toHaveBeenCalled()
  })

  it('never re-picks a player the snapshot still lists but who is already drafted', async () => {
    hm.draftSessionFindFirst.mockResolvedValue(
      session(Array.from({ length: 8 }, (_, i) => ({ playerName: i === 0 ? 'Top Center' : `Guard ${i + 1}`, position: i === 0 ? 'C' : 'PG', overall: i + 1 }))),
    )
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(warm(pool(200)))

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Guard 9' } })
    expect(hm.getResolvedDraftPoolForLeague).not.toHaveBeenCalled()
  })

  it('a snapshot with too few undrafted players falls back to a rebuild that excludes the drafted', async () => {
    const drafted = Array.from({ length: 8 }, (_, i) => ({ playerName: i === 0 ? 'Top Center' : `Guard ${i + 1}`, position: i === 0 ? 'C' : 'PG', overall: i + 1 }))
    hm.draftSessionFindFirst.mockResolvedValue(session(drafted))
    // Exactly one short of the threshold once the 8 drafted are removed.
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(warm(pool(AUTOPICK_WARM_POOL_MIN_UNDRAFTED - 1 + 8)))

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Rebuilt Pick' } })
    expect(hm.getResolvedDraftPoolForLeague).toHaveBeenCalledTimes(1)
    const opts = hm.getResolvedDraftPoolForLeague.mock.calls[0][1] as { excludeDraftedNames: Set<string> }
    expect([...opts.excludeDraftedNames]).toContain('top center')
  })

  it('[control] at exactly the threshold the snapshot is still used', async () => {
    const drafted = Array.from({ length: 8 }, (_, i) => ({ playerName: i === 0 ? 'Top Center' : `Guard ${i + 1}`, position: i === 0 ? 'C' : 'PG', overall: i + 1 }))
    hm.draftSessionFindFirst.mockResolvedValue(session(drafted))
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(warm(pool(AUTOPICK_WARM_POOL_MIN_UNDRAFTED + 8)))

    await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(hm.getResolvedDraftPoolForLeague).not.toHaveBeenCalled()
  })

  it('a cache failure falls back to the rebuild rather than failing the pick', async () => {
    hm.getWarmDraftPoolSnapshotFast.mockRejectedValue(new Error('db blip'))

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Rebuilt Pick' } })
    expect(hm.getResolvedDraftPoolForLeague).toHaveBeenCalledTimes(1)
  })
})
