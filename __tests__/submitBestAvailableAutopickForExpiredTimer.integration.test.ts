import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  draftSessionFindUnique: vi.fn(),
  leagueFindUnique: vi.fn(),
  getDraftConfigForLeague: vi.fn(),
  getAllowedPositionsAndRosterSize: vi.fn(),
  getDraftUISettingsForLeague: vi.fn(),
  getLiveADP: vi.fn(),
  submitPick: vi.fn(),
  tryAiOpponentAutopickForExpiredTimer: vi.fn(),
  getRosterSlotLabelsForLeagueDraft: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: hm.draftSessionFindUnique, findFirst: hm.draftSessionFindUnique },
    league: { findUnique: hm.leagueFindUnique },
  },
}))

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: hm.getDraftConfigForLeague,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: hm.getDraftUISettingsForLeague,
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/live-draft-engine/RosterFitValidation')>()
  return {
    ...actual,
    getAllowedPositionsAndRosterSize: hm.getAllowedPositionsAndRosterSize,
  }
})

vi.mock('@/lib/adp-data', () => ({
  getLiveADP: hm.getLiveADP,
}))

vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({
  getResolvedDraftPoolForLeague: vi.fn().mockResolvedValue({
    entries: [],
    sport: 'NFL',
    count: 0,
    rosterConfigurationIncomplete: true,
  }),
}))

vi.mock('@/lib/draft-room', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/draft-room')>()
  return {
    ...actual,
    getRosterSlotLabelsForLeagueDraft: hm.getRosterSlotLabelsForLeagueDraft,
  }
})

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: hm.submitPick,
}))

vi.mock('@/lib/ai/opponents/liveDraftAiAutopick', () => ({
  tryAiOpponentAutopickForExpiredTimer: hm.tryAiOpponentAutopickForExpiredTimer,
}))

function nflDraftSessionFixture() {
  const slotOrder = Array.from({ length: 12 }, (_, i) => ({
    slot: i + 1,
    rosterId: i === 0 ? 'roster-on-clock' : `roster-${i + 1}`,
    displayName: `T${i + 1}`,
  }))
  return {
    id: 'ds-1',
    leagueId: 'league-1',
    status: 'in_progress' as const,
    draftType: 'snake' as const,
    rounds: 15,
    teamCount: 12,
    thirdRoundReversal: false,
    sportType: 'NFL',
    sessionKind: 'live',
    slotOrder,
    tradedPicks: [],
    picks: [],
    queues: [] as { userId: string; order: unknown }[],
  }
}

describe('submitBestAvailableAutopickForExpiredTimer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.draftSessionFindUnique.mockResolvedValue(nflDraftSessionFixture())
    hm.leagueFindUnique.mockResolvedValue({ sport: 'NFL', isDynasty: false, settings: {} })
    hm.getAllowedPositionsAndRosterSize.mockResolvedValue({
      draftEligiblePositions: new Set(['QB', 'RB', 'WR', 'TE', 'DST']),
      rosterUnionAllowedPositions: new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'BN']),
      totalRosterSize: 16,
    })
    hm.getLiveADP.mockResolvedValue([
      { name: 'Justin Tucker', position: 'K', team: 'BAL', adp: 1, bye: 8 },
      { name: 'Star Rb', position: 'RB', team: 'DAL', adp: 2, bye: 9 },
    ])
    hm.getDraftUISettingsForLeague.mockResolvedValue({
      autoPickEnabled: true,
      aiAdpEnabled: false,
    })
    hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'bpa' })
    hm.tryAiOpponentAutopickForExpiredTimer.mockResolvedValue({ ok: false })
    hm.getRosterSlotLabelsForLeagueDraft.mockResolvedValue(['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'])
    hm.submitPick.mockResolvedValue({ success: true })
  })

  it('submits RB when K has best ADP but K is not starter-eligible (cron / slow-draft BPA path)', async () => {
    const { submitBestAvailableAutopickForExpiredTimer } = await import(
      '@/lib/live-draft-engine/autopickBestAvailableSubmit'
    )
    const res = await submitBestAvailableAutopickForExpiredTimer('league-1', 'roster-on-clock')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.pick.position.toUpperCase()).toMatch(/RB|WR|TE/)
    expect(res.pick.position.toUpperCase()).not.toBe('K')

    expect(hm.submitPick).toHaveBeenCalledTimes(1)
    expect(hm.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        rosterId: 'roster-on-clock',
        playerName: 'Star Rb',
        position: 'RB',
        source: 'auto',
      }),
    )
    const submittedPositions = hm.submitPick.mock.calls.map((c) => c[0]?.position)
    expect(submittedPositions).not.toContain('K')
  })
})
