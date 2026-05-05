import { beforeEach, describe, expect, it, vi } from 'vitest'

const now = new Date('2026-01-15T12:00:00.000Z')

const hm = vi.hoisted(() => ({
  draftSessionFindMany: vi.fn(),
  draftSessionFindUnique: vi.fn(),
  draftPickFindFirst: vi.fn(),
  isLeagueRosterDraftReady: vi.fn(),
  getDraftUISettingsForLeague: vi.fn(),
  getDraftConfigForLeague: vi.fn(),
  tryQueueAutoPick: vi.fn(),
  submitBestAvailableAutopickForExpiredTimer: vi.fn(),
  submitPick: vi.fn(),
  appendPickToRosterDraftSnapshot: vi.fn(),
  invalidateLeagueDraftCaches: vi.fn(),
  buildSessionSnapshot: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findMany: hm.draftSessionFindMany,
      findUnique: hm.draftSessionFindUnique,
    },
    draftPick: { findFirst: hm.draftPickFindFirst },
  },
}))

vi.mock('@/lib/league/league-roster-draft-gate', () => ({
  isLeagueRosterDraftReady: hm.isLeagueRosterDraftReady,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/draft-defaults/DraftUISettingsResolver')>()
  return {
    ...mod,
    getDraftUISettingsForLeague: hm.getDraftUISettingsForLeague,
  }
})

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: hm.getDraftConfigForLeague,
}))

vi.mock('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService', () => ({
  tryQueueAutoPick: hm.tryQueueAutoPick,
}))

vi.mock('@/lib/live-draft-engine/autopickBestAvailableSubmit', () => ({
  submitBestAvailableAutopickForExpiredTimer: hm.submitBestAvailableAutopickForExpiredTimer,
}))

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: hm.submitPick,
}))

vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  appendPickToRosterDraftSnapshot: hm.appendPickToRosterDraftSnapshot,
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: hm.buildSessionSnapshot,
  reconcileOvernightDraftTimerForLeague: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({
  invalidateLeagueDraftCaches: hm.invalidateLeagueDraftCaches,
}))

vi.mock('@/lib/draft-notifications', () => ({
  notifyAutoPickFired: vi.fn(),
  notifyDraftIntelPickConfirmation: vi.fn(),
  notifyDraftIntelOnClockUrgent: vi.fn(),
  notifyDraftIntelQueueReady: vi.fn(),
  notifyOnTheClockAfterPick: vi.fn(),
  notifyQueuePlayerUnavailable: vi.fn(),
}))

vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: vi.fn().mockResolvedValue([]),
  sendDraftIntelDm: vi.fn().mockResolvedValue(null),
}))

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ds-1',
    leagueId: 'league-1',
    version: 0,
    status: 'in_progress',
    draftType: 'snake',
    cpuAutoPick: true,
    timerEndAt: new Date('2026-01-15T11:55:00.000Z'),
    timerSeconds: 90,
    pausedRemainingSeconds: null,
    rounds: 15,
    teamCount: 12,
    thirdRoundReversal: false,
    slotOrder: [
      { slot: 1, rosterId: 'r1', displayName: 'T1' },
      { slot: 2, rosterId: 'r2', displayName: 'T2' },
    ],
    tradedPicks: [],
    picks: [],
    queues: [],
    ...overrides,
  }
}

describe('processExpiredDraftPicks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.isLeagueRosterDraftReady.mockResolvedValue(true)
    hm.getDraftUISettingsForLeague.mockResolvedValue({
      autoPickEnabled: true,
      timerMode: 'per_pick',
      slowDraftPauseWindow: null,
    })
    hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'queue-first' })
    hm.tryQueueAutoPick.mockResolvedValue({ success: false })
    hm.submitBestAvailableAutopickForExpiredTimer.mockResolvedValue({
      ok: true,
      pick: {
        playerName: 'Bpa Rb',
        position: 'RB',
        team: 'DAL',
        playerId: 'p-bpa',
        byeWeek: 7,
        reason: 'bpa',
        strategy: 'bpa',
      },
    })
    hm.submitPick.mockResolvedValue({ success: true })
    hm.draftPickFindFirst.mockResolvedValue({
      playerName: 'Queue Guy',
      position: 'WR',
      team: 'NYG',
      playerId: 'q1',
      byeWeek: 8,
    })
  })

  it('processes an expired in-progress draft via BPA when queue is empty', async () => {
    hm.draftSessionFindMany.mockResolvedValue([{ leagueId: 'league-1' }])
    hm.draftSessionFindUnique
      .mockResolvedValueOnce(baseSession())
      .mockResolvedValueOnce({
        version: 0,
        status: 'in_progress',
        timerEndAt: new Date('2026-01-15T11:55:00.000Z'),
        _count: { picks: 0 },
      })
      .mockResolvedValueOnce({
        version: 0,
        status: 'in_progress',
        timerEndAt: new Date('2026-01-15T11:55:00.000Z'),
        _count: { picks: 0 },
      })

    const { processExpiredDraftPicks } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const summary = await processExpiredDraftPicks({ now, maxLeagues: 10 })

    expect(summary.scanned).toBe(1)
    expect(summary.processed).toBe(1)
    expect(hm.submitBestAvailableAutopickForExpiredTimer).toHaveBeenCalledWith('league-1', 'r1', 1)
    expect(hm.submitPick).not.toHaveBeenCalledWith(
      expect.objectContaining({ position: 'K' }),
    )
    expect(hm.invalidateLeagueDraftCaches).toHaveBeenCalledWith('league-1')
  })

  it('skips non-expired drafts (none returned from findMany)', async () => {
    hm.draftSessionFindMany.mockResolvedValue([])
    const { processExpiredDraftPicks } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const summary = await processExpiredDraftPicks({ now, maxLeagues: 10 })
    expect(summary.scanned).toBe(0)
    expect(summary.processed).toBe(0)
    expect(hm.tryQueueAutoPick).not.toHaveBeenCalled()
  })

  it('skips paused drafts (status not in_progress on load)', async () => {
    hm.draftSessionFindMany.mockResolvedValue([{ leagueId: 'league-1' }])
    hm.draftSessionFindUnique.mockResolvedValue(
      baseSession({ status: 'paused', timerEndAt: new Date('2026-01-15T11:55:00.000Z') }),
    )
    const { processExpiredDraftPicks } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const summary = await processExpiredDraftPicks({ now, maxLeagues: 10 })
    expect(summary.processed).toBe(0)
    expect(summary.skipped).toBe(1)
    expect(hm.tryQueueAutoPick).not.toHaveBeenCalled()
  })

  it('skips when commissioner disabled auto-pick in draft UI settings', async () => {
    hm.draftSessionFindMany.mockResolvedValue([{ leagueId: 'league-1' }])
    hm.getDraftUISettingsForLeague.mockResolvedValue({
      autoPickEnabled: false,
      timerMode: 'per_pick',
      slowDraftPauseWindow: null,
    })
    const { processExpiredDraftPicks } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const summary = await processExpiredDraftPicks({ now, maxLeagues: 10 })
    expect(summary.skipped).toBe(1)
    expect(hm.draftSessionFindUnique).not.toHaveBeenCalled()
  })

  it('skips when roster configuration is incomplete', async () => {
    hm.draftSessionFindMany.mockResolvedValue([{ leagueId: 'league-1' }])
    hm.isLeagueRosterDraftReady.mockResolvedValue(false)
    const { processExpiredDraftPicks } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const summary = await processExpiredDraftPicks({ now, maxLeagues: 10 })
    expect(summary.processed).toBe(0)
    expect(summary.skipped).toBe(1)
    expect(hm.draftSessionFindUnique).not.toHaveBeenCalled()
  })

  it('skips BPA when session version changes after queue miss (concurrency guard)', async () => {
    hm.draftSessionFindMany.mockResolvedValue([{ leagueId: 'league-1' }])
    hm.draftSessionFindUnique
      .mockResolvedValueOnce(baseSession({ version: 3 }))
      .mockResolvedValueOnce({
        version: 3,
        status: 'in_progress',
        timerEndAt: new Date('2026-01-15T11:55:00.000Z'),
        _count: { picks: 0 },
      })
      .mockResolvedValueOnce({
        version: 4,
        status: 'in_progress',
        timerEndAt: new Date('2026-01-15T11:55:00.000Z'),
        _count: { picks: 0 },
      })

    hm.tryQueueAutoPick.mockResolvedValue({ success: false })

    const { processExpiredDraftPicks } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const summary = await processExpiredDraftPicks({ now, maxLeagues: 10 })
    expect(summary.processed).toBe(0)
    expect(summary.skipped).toBe(1)
    expect(hm.submitBestAvailableAutopickForExpiredTimer).not.toHaveBeenCalled()
  })

  it('uses queue-first pick and does not call BPA when queue succeeds', async () => {
    hm.draftSessionFindMany.mockResolvedValue([{ leagueId: 'league-1' }])
    hm.draftSessionFindUnique
      .mockResolvedValueOnce(baseSession())
      .mockResolvedValueOnce({
        version: 0,
        status: 'in_progress',
        timerEndAt: new Date('2026-01-15T11:55:00.000Z'),
        _count: { picks: 0 },
      })
    hm.tryQueueAutoPick.mockResolvedValue({ success: true, playerName: 'Queue Guy' })

    const { processExpiredDraftPicks } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const summary = await processExpiredDraftPicks({ now, maxLeagues: 10 })
    expect(summary.processed).toBe(1)
    expect(hm.submitBestAvailableAutopickForExpiredTimer).not.toHaveBeenCalled()
    expect(hm.appendPickToRosterDraftSnapshot).toHaveBeenCalledWith(
      'league-1',
      'r1',
      expect.objectContaining({ playerName: 'Queue Guy', position: 'WR' }),
    )
  })

  it('submits skip placeholder when autopick_behavior is skip and queue is empty', async () => {
    hm.draftSessionFindMany.mockResolvedValue([{ leagueId: 'league-1' }])
    hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'skip' })
    hm.draftSessionFindUnique
      .mockResolvedValueOnce(baseSession())
      .mockResolvedValueOnce({
        version: 0,
        status: 'in_progress',
        timerEndAt: new Date('2026-01-15T11:55:00.000Z'),
        _count: { picks: 0 },
      })
      .mockResolvedValueOnce({
        version: 0,
        status: 'in_progress',
        timerEndAt: new Date('2026-01-15T11:55:00.000Z'),
        _count: { picks: 0 },
      })
    hm.tryQueueAutoPick.mockResolvedValue({ success: false })
    const { processExpiredDraftPicks } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const summary = await processExpiredDraftPicks({ now, maxLeagues: 10 })
    expect(summary.processed).toBe(1)
    expect(hm.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        rosterId: 'r1',
        position: 'SKIP',
        playerName: '(Skipped)',
        source: 'auto',
      }),
    )
    expect(hm.submitBestAvailableAutopickForExpiredTimer).not.toHaveBeenCalled()
  })

  it('skips when cpuAutoPick is disabled on the session', async () => {
    hm.draftSessionFindMany.mockResolvedValue([{ leagueId: 'league-1' }])
    hm.draftSessionFindUnique.mockResolvedValue(baseSession({ cpuAutoPick: false }))
    const { processExpiredDraftPicks } = await import('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
    const summary = await processExpiredDraftPicks({ now, maxLeagues: 10 })
    expect(summary.skipped).toBe(1)
    expect(hm.tryQueueAutoPick).not.toHaveBeenCalled()
  })
})
