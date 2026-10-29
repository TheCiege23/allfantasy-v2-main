import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Autopick's last-chance guard for starting lineups: best available, until a team's remaining picks
 * only just cover its open starting spots. The MLB Survivor rehearsal (2026-10-28) drafted 176
 * pitchers for 80 pitcher slots and left 43 of 260 starting spots empty all season.
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
  getLeagueDraftTemplatePayload: vi.fn(),
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
vi.mock('@/lib/league/league-draft-template-payload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league/league-draft-template-payload')>()),
  getLeagueDraftTemplatePayload: hm.getLeagueDraftTemplatePayload,
}))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({ submitPick: hm.submitPick }))
vi.mock('@/lib/ai/opponents/liveDraftAiAutopick', () => ({
  tryAiOpponentAutopickForExpiredTimer: hm.tryAiOpponentAutopickForExpiredTimer,
}))

import { submitBestAvailableAutopickForExpiredTimer } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'
import { fitsOpenStarterSlot, mustFillStarter, openStarterSlots, starterSlotsFromTemplate } from '@/lib/live-draft-engine/autopickStarterNeeds'

/** A pool entry in the shape `getResolvedDraftPoolForLeague` returns (and the snapshot stores). */
const entry = (name: string, position: string, adp: number) => ({
  name,
  position,
  team: 'BOS',
  adp,
  playerId: `id-${name}`,
  display: { playerId: `id-${name}` },
})


const cold = { warm: false, source: 'cold', entryCount: 0, syncedAt: null, cacheKey: 'k' }

function session(own: string[] = [], rounds = 6) {
  const picks = own.flatMap((position, i) => [
    { playerName: `Mine ${i}`, position, overall: i * 2 + 1, rosterId: 'on-clock' },
    { playerName: `Theirs ${i}`, position: 'P', overall: i * 2 + 2, rosterId: 'r2' },
  ])
  return sessionWith(picks, rounds)
}

function sessionWith(picks: Array<{ playerName: string; position: string; overall: number; rosterId: string }>, rounds: number) {
  return {
    id: 'ds-1',
    leagueId: 'L1',
    status: 'in_progress',
    draftType: 'linear',
    rounds,
    teamCount: 2,
    thirdRoundReversal: false,
    sportType: 'MLB',
    sessionKind: 'live',
    slotOrder: [{ slot: 1, rosterId: 'on-clock', displayName: 'T1' }, { slot: 2, rosterId: 'r2', displayName: 'T2' }],
    tradedPicks: [],
    picks: picks.map((p) => ({ ...p, pickMetadata: null })),
    queues: [],
  }
}

const pitchers = Array.from({ length: 10 }, (_, i) => entry(`Ace ${i + 1}`, 'P', i + 1))
const hitters = [entry('Designated Hitter', 'DH', 40), entry('Best Catcher', 'C', 50), entry('First Baseman', '1B', 60), entry('Shortstop', 'SS', 70)]

/** C, 1B, SS and two P starters, one bench spot: six rounds. */
const template = {
  templateId: 't', sportType: 'MLB', name: 'survivor', formatType: 'survivor',
  slots: [
    { slotName: 'C', allowedPositions: ['C'], starterCount: 1, benchCount: 0, slotOrder: 1 },
    { slotName: '1B', allowedPositions: ['1B'], starterCount: 1, benchCount: 0, slotOrder: 2 },
    { slotName: 'SS', allowedPositions: ['SS'], starterCount: 1, benchCount: 0, slotOrder: 3 },
    { slotName: 'P', allowedPositions: ['SP', 'RP', 'P'], starterCount: 2, benchCount: 0, slotOrder: 4 },
    { slotName: 'BN', allowedPositions: ['C', '1B', 'SS', 'DH', 'P'], starterCount: 0, benchCount: 1, slotOrder: 5 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  hm.draftSessionFindFirst.mockResolvedValue(session())
  hm.leagueFindUnique.mockResolvedValue({ sport: 'MLB', isDynasty: false, settings: {} })
  hm.getAllowedPositionsAndRosterSize.mockResolvedValue({
    draftEligiblePositions: new Set(['C', '1B', 'SS', 'DH', 'P']),
    rosterUnionAllowedPositions: new Set(['C', '1B', 'SS', 'DH', 'P', 'BN']),
    totalRosterSize: 6,
  })
  hm.getDraftUISettingsForLeague.mockResolvedValue({ autoPickEnabled: true, aiAdpEnabled: false })
  hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'bpa' })
  hm.tryAiOpponentAutopickForExpiredTimer.mockResolvedValue({ ok: false })
  hm.getRosterSlotLabelsForLeagueDraft.mockResolvedValue(['C', '1B', 'SS', 'P', 'P', 'BN'])
  hm.submitPick.mockResolvedValue({ success: true })
  // Too small for the warm snapshot, so the pool comes from the rebuild.
  hm.getWarmDraftPoolSnapshotFast.mockResolvedValue(cold)
  hm.ensureDraftPoolReady.mockResolvedValue({ ok: false })
  hm.getResolvedDraftPoolForLeague.mockResolvedValue({ entries: [...pitchers, ...hitters], rosterConfigurationIncomplete: false })
  hm.tryDraftAsMePick.mockResolvedValue(null)
  hm.getLeagueDraftTemplatePayload.mockResolvedValue({ template })
})

describe('autopick fills the starting lineup before it runs out of picks', () => {
  it('takes the best player available while the starters can still be filled later', async () => {
    // Two pitchers drafted: C, 1B and SS still open, four picks left.
    hm.draftSessionFindFirst.mockResolvedValue(session(['P', 'P']))
    expect(await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')).toMatchObject({ ok: true, pick: { playerName: 'Ace 1', strategy: 'bpa' } })
  })

  it('takes only a player who starts once the picks left only just cover the open starting spots', async () => {
    // A third pitcher went to the bench: three open starting spots, three picks left. The DH ranks
    // ahead of every open position but cannot start in one of them.
    hm.draftSessionFindFirst.mockResolvedValue(session(['P', 'P', 'P']))
    expect(await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')).toMatchObject({ ok: true, pick: { playerName: 'Best Catcher' } })
    expect(hm.submitPick).toHaveBeenCalledWith(expect.objectContaining({ playerName: 'Best Catcher', position: 'C', rosterId: 'on-clock' }))
  })

  it('still makes a pick when nobody left can start in an open spot', async () => {
    hm.draftSessionFindFirst.mockResolvedValue(session(['P', 'P', 'P']))
    hm.getResolvedDraftPoolForLeague.mockResolvedValue({ entries: [...pitchers, entry('Designated Hitter', 'DH', 40)], rosterConfigurationIncomplete: false })
    expect(await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')).toMatchObject({ ok: true, pick: { playerName: 'Ace 1' } })
  })

  it('a league without a template keeps best available', async () => {
    hm.draftSessionFindFirst.mockResolvedValue(session(['P', 'P', 'P']))
    hm.getLeagueDraftTemplatePayload.mockRejectedValue(new Error('no template'))
    expect(await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')).toMatchObject({ ok: true, pick: { playerName: 'Ace 1' } })
  })
})

describe('open starting slots', () => {
  const slots = starterSlotsFromTemplate([
    { slotName: 'OF', allowedPositions: ['OF', 'LF', 'CF', 'RF'], starterCount: 2 },
    { slotName: 'UTIL', allowedPositions: ['C', '1B', 'OF', 'LF', 'CF', 'RF', 'DH'], starterCount: 1 },
    { slotName: 'BN', allowedPositions: ['C', '1B', 'OF', 'DH'], starterCount: 0 },
  ])
  it('ignores the bench and seats each pick in the most restrictive slot it fits', () => {
    expect(slots.map((s) => s.slotName)).toEqual(['OF', 'UTIL'])
    // A DH can only start at UTIL; the outfielders take OF and leave UTIL for him.
    expect(openStarterSlots(slots, ['LF', 'DH', 'CF'])).toEqual([])
    expect(openStarterSlots(slots, ['DH'])).toEqual([{ slotName: 'OF', allowedPositions: ['OF', 'LF', 'CF', 'RF'], count: 2 }])
  })
  it('forces a starter only when the picks left are no more than the open spots', () => {
    const open = openStarterSlots(slots, ['DH'])
    expect(mustFillStarter(open, 3)).toBe(false)
    expect(mustFillStarter(open, 2)).toBe(true)
    expect(mustFillStarter([], 1)).toBe(false)
    expect(fitsOpenStarterSlot('CF', open)).toBe(true)
    expect(fitsOpenStarterSlot('DH', open)).toBe(false)
  })
})
