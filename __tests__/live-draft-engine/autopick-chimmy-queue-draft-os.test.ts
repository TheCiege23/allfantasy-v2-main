import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Chimmy Queue's timeout pick IS the Draft OS pick decision — the player the draft card (`DraftDecisionOsCard`) and
 * Chimmy recommend (`decideDraftPickForRoster` → `engineResultForDecision`) — taken from the clock's vetted pool.
 * Until 2026-11-24 it ran the recommender itself with its own roster slots, so the clock could pick someone else
 * under the label "Chimmy's pick for your team". With no decision pick it falls back to that recommender.
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
  decideDraftPickForRoster: vi.fn(),
  computeDraftRecommendation: vi.fn(),
}))

vi.mock('@/lib/shared-services/draft/pickDecision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared-services/draft/pickDecision')>()),
  decideDraftPickForRoster: hm.decideDraftPickForRoster,
}))
vi.mock('@/lib/draft-helper/RecommendationEngine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/draft-helper/RecommendationEngine')>()
  hm.computeDraftRecommendation.mockImplementation(real.computeDraftRecommendation)
  return { ...real, computeDraftRecommendation: hm.computeDraftRecommendation }
})

vi.mock('@/lib/draft-room/draftAsMeAutopick', () => ({ tryDraftAsMePick: hm.tryDraftAsMePick }))
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
import { draftOsChimmyQueuePick } from '@/lib/live-draft-engine/chimmyQueueAutopick'

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
  hm.decideDraftPickForRoster.mockResolvedValue({ ok: false, reason: 'no_draft' })
})

const player = (name: string, position: string, adp: number) => ({ name, position, team: 'BOS', adp })

/** A decision whose engine ranked `top` first, then `alts`; `illegalTop` = the live rules refused `top`. */
function decision(top: ReturnType<typeof player>, alts: ReturnType<typeof player>[], illegalTop = false) {
  const actions = [top, ...alts].map((p, i) => ({ rank: i + 1, playerName: p.name, position: p.position, team: p.team, adp: p.adp, adpIsReal: i === 0 ? true : null, reason: `reason for ${p.name}`, confidence: 70 }))
  return {
    ok: true,
    decision: {
      recommended_actions: actions,
      rule_verdicts: illegalTop ? [{ rule: 'draft.legality.roster_fit', verdict: 'illegal', message: 'No open slot.' }] : [],
    },
    engineResult: {
      recommendation: { player: top, reason: `reason for ${top.name}`, confidence: 70, needScore: 1, adpEdge: 0, adpIsReal: true },
      alternatives: alts.map((p) => ({ player: p, reason: `reason for ${p.name}`, confidence: 60 })),
      reachWarning: null,
      valueWarning: null,
    },
    context: { plannedFor: null },
    forOverall: 1,
  }
}

const chimmyOn = () =>
  hm.getViewerAutopickPreference.mockResolvedValue({ enabled: true, mode: 'ai_queue', isProEligible: true, updatedAt: null })


describe('Chimmy Queue picks the Draft OS decision', () => {
  it("picks the decision's own top choice, for this manager's roster, and says Draft OS chose", async () => {
    chimmyOn()
    hm.decideDraftPickForRoster.mockResolvedValue(decision(player('Guard 7', 'PG', 7), [player('Guard 8', 'PG', 8)]))
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({
      ok: true,
      pick: { playerName: 'Guard 7', position: 'PG', playerId: 'id-Guard 7', strategy: 'need-based', source: 'draft-os', reason: "Chimmy's pick for your team: reason for Guard 7" },
    })
    expect(hm.decideDraftPickForRoster).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'user-1', rosterId: 'on-clock' })
    // The clock's own recommender is not consulted when the decision has a pick.
    expect(hm.computeDraftRecommendation).not.toHaveBeenCalled()
    expect(hm.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        playerName: 'Guard 7',
        source: 'auto',
        pickMetadata: { autopick: { strategy: 'need-based', reason: "Chimmy's pick for your team: reason for Guard 7", source: 'draft-os' } },
      }),
    )
  })

  it('a top choice the live rules refused is skipped, exactly as the card says ("Skip X; consider Y")', async () => {
    chimmyOn()
    hm.decideDraftPickForRoster.mockResolvedValue(decision(player('Top Center', 'C', 1), [player('Guard 5', 'PG', 5)], true))
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Guard 5', source: 'draft-os' } })
  })

  it("a decision player the clock's pool does not hold gives way to the decision's next one", async () => {
    chimmyOn()
    hm.decideDraftPickForRoster.mockResolvedValue(decision(player('Not In Pool', 'PG', 3), [player('Guard 11', 'PG', 11)]))
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Guard 11', source: 'draft-os' } })
  })

  it('no decision pick → the existing recommender still picks, and says so', async () => {
    chimmyOn()
    hm.decideDraftPickForRoster.mockResolvedValue({ ok: false, reason: 'context_unavailable' })
    const r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { strategy: 'need-based', source: 'recommender', reason: expect.stringMatching(/^Chimmy's pick for your team: /) } })
    expect(hm.computeDraftRecommendation).toHaveBeenCalledTimes(1)
  })

  it('a decision with nobody on the board, or one that throws, never costs the pick', async () => {
    chimmyOn()
    hm.decideDraftPickForRoster.mockResolvedValue(decision(player('Ghost', 'PG', 1), []))
    expect(await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')).toMatchObject({ ok: true, pick: { source: 'recommender' } })
    hm.decideDraftPickForRoster.mockRejectedValue(new Error('pool build failed'))
    expect(await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')).toMatchObject({ ok: true, pick: { source: 'recommender' } })
  })

  it('Standard mode and the commissioner need-based setting are unchanged: no Draft OS read, no source', async () => {
    let r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { playerName: 'Top Center', strategy: 'bpa' } })
    expect((r as { pick: { source?: string } }).pick.source).toBeUndefined()
    hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'need-based' })
    r = await submitBestAvailableAutopickForExpiredTimer('L1', 'on-clock')
    expect(r).toMatchObject({ ok: true, pick: { strategy: 'need-based' } })
    expect((r as { pick: { source?: string; reason: string } }).pick.source).toBeUndefined()
    expect((r as { pick: { reason: string } }).pick.reason).not.toMatch(/Chimmy/)
    expect(hm.decideDraftPickForRoster).not.toHaveBeenCalled()
  })
})

describe('draftOsChimmyQueuePick', () => {
  const board = [{ playerName: 'A', position: 'PG' }, { playerName: 'B', position: 'C' }]

  it('a slow decision is dropped at the budget', async () => {
    const decide = vi.fn(() => new Promise<never>(() => {})) as never
    const t0 = Date.now()
    expect(await draftOsChimmyQueuePick({ leagueId: 'L1', userId: 'u', rosterId: 'r', draftType: 'snake', board }, { decide, budgetMs: 30 })).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('an auction is never decided here', async () => {
    const decide = vi.fn()
    expect(await draftOsChimmyQueuePick({ leagueId: 'L1', userId: 'u', rosterId: 'r', draftType: 'auction', board }, { decide: decide as never, effective: vi.fn() as never })).toBeNull()
    expect(decide).not.toHaveBeenCalled()
  })
})
