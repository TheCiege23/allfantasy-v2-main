import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canAccessLeagueDraft: vi.fn(),
  getCurrentUserRosterIdForLeague: vi.fn(),
  draftSessionFindUnique: vi.fn(),
  leagueFindUnique: vi.fn(),
  getAllowedPositionsAndRosterSize: vi.fn(),
  getLiveADP: vi.fn(),
  getDraftUISettingsForLeague: vi.fn(),
  getDraftConfigForLeague: vi.fn(),
  submitPick: vi.fn(),
  buildSessionSnapshot: vi.fn(),
  appendPickToRosterDraftSnapshot: vi.fn(),
  tryAiOpponentAutopickForExpiredTimer: vi.fn(),
  publishDraftIntelForUpcomingManagers: vi.fn(),
  sendDraftIntelDm: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: hm.getServerSession,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: hm.canAccessLeagueDraft,
  getCurrentUserRosterIdForLeague: hm.getCurrentUserRosterIdForLeague,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: hm.draftSessionFindUnique, findFirst: hm.draftSessionFindUnique },
    league: { findUnique: hm.leagueFindUnique },
  },
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

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: hm.getDraftUISettingsForLeague,
}))

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: hm.getDraftConfigForLeague,
}))

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: hm.submitPick,
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: hm.buildSessionSnapshot,
}))

vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  appendPickToRosterDraftSnapshot: hm.appendPickToRosterDraftSnapshot,
}))

vi.mock('@/lib/ai/opponents/liveDraftAiAutopick', () => ({
  tryAiOpponentAutopickForExpiredTimer: hm.tryAiOpponentAutopickForExpiredTimer,
}))

vi.mock('@/lib/draft-notifications', () => ({
  notifyDraftIntelOnClockUrgent: vi.fn().mockResolvedValue(undefined),
  notifyDraftIntelPickConfirmation: vi.fn().mockResolvedValue(undefined),
  notifyDraftIntelPlayerTaken: vi.fn().mockResolvedValue(undefined),
  notifyDraftIntelQueueReady: vi.fn().mockResolvedValue(undefined),
  notifyDraftIntelTierBreak: vi.fn().mockResolvedValue(undefined),
  notifyAutoPickFired: vi.fn().mockResolvedValue(undefined),
  notifyOnTheClockAfterPick: vi.fn().mockResolvedValue(undefined),
  notifyQueuePlayerUnavailable: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: hm.publishDraftIntelForUpcomingManagers,
  sendDraftIntelDm: hm.sendDraftIntelDm,
}))

/** Integration test prisma is partial; force legacy ADP path without throwing in resolved pool. */
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({
  getResolvedDraftPoolForLeague: vi.fn().mockResolvedValue({
    entries: [],
    sport: 'NFL',
    count: 0,
    rosterConfigurationIncomplete: true,
  }),
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

describe('POST /api/leagues/[leagueId]/draft/autopick-expired (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    hm.canAccessLeagueDraft.mockResolvedValue(true)
    hm.getCurrentUserRosterIdForLeague.mockResolvedValue('roster-on-clock')
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
    hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'queue-first' })
    hm.tryAiOpponentAutopickForExpiredTimer.mockResolvedValue({ ok: false })
    hm.submitPick.mockResolvedValue({
      success: true,
      snapshot: {
        rosterId: 'roster-on-clock',
        overall: 1,
        pickLabel: '1.01',
        sessionId: 'ds-1',
      },
    })
    hm.buildSessionSnapshot
      .mockResolvedValueOnce({
        currentPick: { overall: 2, pickLabel: '1.02' },
        picks: [{ playerName: 'Star Rb', position: 'RB' }],
      } as any)
      .mockResolvedValue({
        currentPick: { overall: 2, pickLabel: '1.02' },
        picks: [{ playerName: 'Star Rb', position: 'RB' }],
        version: 2,
      } as any)
    hm.appendPickToRosterDraftSnapshot.mockResolvedValue(undefined)
    hm.publishDraftIntelForUpcomingManagers.mockResolvedValue([])
    hm.sendDraftIntelDm.mockResolvedValue(null)
  })

  it('empty queue + BPA skips K when no K starter slot; submits next eligible RB and returns session', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/draft/autopick-expired/route')
    const req = createMockNextRequest('http://localhost/api/leagues/league-1/draft/autopick-expired', {
      method: 'POST',
    })
    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.submittedPlayerName).toBe('Star Rb')
    expect(body.strategy).toBe('bpa')

    expect(hm.getAllowedPositionsAndRosterSize).toHaveBeenCalledWith('league-1')
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
    expect(hm.getLiveADP).toHaveBeenCalled()
    const submittedPositions = hm.submitPick.mock.calls.map((c) => c[0]?.position)
    expect(submittedPositions).not.toContain('K')
    expect(submittedPositions).toContain('RB')

    expect(body.session).toBeDefined()
    expect(hm.buildSessionSnapshot).toHaveBeenCalled()
  })
})
