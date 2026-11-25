import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 WITH NO ADP, AUTOPICK DRAFTED THE ALPHABET.
 *
 * The best-available sort was `adp ?? 999`, then the name. College basketball has no ADP that
 * matches a native league, so every player tied at 999 and a full-auto 54-team startup (production,
 * 2026-11-25) was about to take 918 players from "A.C. Kelly" downward. The pool now carries this
 * league's projected points per game, and autopick takes the highest one when ADP cannot decide.
 *
 * Same harness as autopick-warm-pool.test.ts.
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

import { submitBestAvailableAutopickForExpiredTimer } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'

/** A college pool entry as the snapshot stores it: no ADP, the league's points per game on `display.stats`. */
const entry = (name: string, proj: number | null, adp: number | null = null) => ({
  name,
  position: 'G',
  team: 'DUKE',
  adp,
  playerId: `id-${name}`,
  display: { playerId: `id-${name}`, stats: proj == null ? {} : { projectedPointsPerGame: proj } },
})

/** Alphabetical filler so the snapshot is deep enough to be used (75+ undrafted). */
const filler = (proj: (i: number) => number | null) =>
  Array.from({ length: 120 }, (_, i) => entry(`Bench Guard ${String(i).padStart(3, '0')}`, proj(i)))

const warm = (entries: unknown[]) => ({
  warm: true,
  source: 'db-cache',
  payload: { entries, sport: 'NCAAB', rosterConfigurationIncomplete: false },
  entryCount: entries.length,
  syncedAt: null,
  cacheKey: 'k',
})

beforeEach(() => {
  vi.clearAllMocks()
  hm.draftSessionFindFirst.mockResolvedValue({
    id: 'ds-1',
    leagueId: 'L1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 17,
    teamCount: 8,
    thirdRoundReversal: false,
    sportType: 'NCAAB',
    sessionKind: 'live',
    slotOrder: Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, rosterId: i === 0 ? 'on-clock' : `r${i + 1}`, displayName: `T${i + 1}` })),
    tradedPicks: [],
    picks: [],
    queues: [],
  })
  hm.leagueFindUnique.mockResolvedValue({ sport: 'NCAAB', isDynasty: true, settings: {} })
  hm.getAllowedPositionsAndRosterSize.mockResolvedValue({
    draftEligiblePositions: new Set(['G', 'F', 'C']),
    rosterUnionAllowedPositions: new Set(['G', 'F', 'C', 'UTIL', 'BN']),
    totalRosterSize: 17,
  })
  hm.getDraftUISettingsForLeague.mockResolvedValue({ autoPickEnabled: true, aiAdpEnabled: false })
  hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'queue-first' })
  hm.tryAiOpponentAutopickForExpiredTimer.mockResolvedValue({ ok: false })
  hm.getRosterSlotLabelsForLeagueDraft.mockResolvedValue(['G', 'G', 'F', 'F', 'C', 'UTIL', 'BN'])
  hm.submitPick.mockResolvedValue({ success: true })
})

describe('autopick with no ADP takes the highest projected player, not the first name', () => {
  it('picks the top projection out of a pool that is alphabetical by name', async () => {
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(
      warm([entry('A.C. Kelly', 6.2), ...filler((i) => 4 + (i % 7)), entry('Zvonimir Ivisic', 31.4)]),
    )

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Zvonimir Ivisic' } })
  })

  it('control: the same pool with no projections still falls to the alphabet', async () => {
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(
      warm([entry('A.C. Kelly', null), ...filler(() => null), entry('Zvonimir Ivisic', null)]),
    )

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'A.C. Kelly' } })
  })

  it('a player with a projection goes ahead of every player without one', async () => {
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(
      warm([entry('A.C. Kelly', null), ...filler(() => null), entry('Yusuf Scorer', 0.8)]),
    )

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Yusuf Scorer' } })
  })

  it('an ADP still decides before any projection', async () => {
    hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(
      warm([entry('A.C. Kelly', 6.2), ...filler((i) => 4 + (i % 7)), entry('Has Adp', 2, 12), entry('Zvonimir Ivisic', 31.4)]),
    )

    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')

    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Has Adp' } })
  })
})
