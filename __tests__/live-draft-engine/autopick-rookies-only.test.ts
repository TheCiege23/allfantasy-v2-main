/**
 * Autopick in a rookies-only draft must choose from the same rookie verdict pick validation applies
 * to `auto` picks. A refused autopick is retried with the same player on the next tick, so a
 * candidate list that disagrees with the server check stalls the clock instead of losing one pick.
 *
 * The scenario: the warm snapshot was built before the draft was set to rookies-only (the cache key
 * does not include the pool mode), so it still holds veterans, and a veteran ranks first.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Harness copied from autopick-warm-pool.test.ts.

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
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', async (importOriginal) => ({
  normalizeDraftPoolNameForDedupe: (await importOriginal<typeof import('@/lib/draft-room/getResolvedDraftPoolForLeague')>())
    .normalizeDraftPoolNameForDedupe,
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

const rookie = (name: string, adp: number) => ({ ...entry(name, 'PG', adp), isRookie: true })
const vet = (name: string, adp: number) => ({ ...entry(name, 'C', adp), isRookie: false })
/** Veteran ranked #1, then enough rookies to stay above the warm-pool depth floor. */
const mixedBoard = () => [
  vet('Veteran Star', 1),
  ...Array.from({ length: AUTOPICK_WARM_POOL_MIN_UNDRAFTED + 5 }, (_, i) => rookie(`Rookie ${i + 2}`, i + 2)),
]

describe('autopick honours a rookies-only / veterans-only pool', () => {
  it('rookies-only: skips the top-ranked veteran and takes the best rookie', async () => {
    hm.draftSessionFindFirst.mockResolvedValue({ ...session(), playerPool: 'rookies_only' })
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(warm(mixedBoard()))

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Rookie 2' } })
    expect(hm.submitPick.mock.calls[0][0]).toMatchObject({ playerName: 'Rookie 2', source: 'auto' })
  })

  it('veterans-only: skips the top-ranked rookie and takes the best veteran', async () => {
    hm.draftSessionFindFirst.mockResolvedValue({ ...session(), playerPool: 'veterans_only' })
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(
      warm([
        rookie('Top Rookie', 0),
        ...Array.from({ length: AUTOPICK_WARM_POOL_MIN_UNDRAFTED + 5 }, (_, i) => vet(`Vet ${i + 2}`, i + 2)),
      ]),
    )

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Vet 2' } })
  })

  it('every other pool mode is untouched: the veteran ranked first is taken', async () => {
    hm.draftSessionFindFirst.mockResolvedValue({ ...session(), playerPool: 'all' })
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(warm(mixedBoard()))

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Veteran Star' } })
  })
})
