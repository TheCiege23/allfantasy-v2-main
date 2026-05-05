import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    draftSession: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    roster: {
      findUnique: vi.fn(),
    },
    draftPick: {
      findFirst: vi.fn(),
    },
    league: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  submitPick: vi.fn(),
  getAllowedPositionsAndRosterSize: vi.fn(),
  getDraftUISettingsForLeague: vi.fn(),
  isLeagueRosterDraftReady: vi.fn(),
  getDraftConfigForLeague: vi.fn(),
  submitBestAvailableAutopickForExpiredTimer: vi.fn(),
  assertLeagueActionGate: vi.fn(),
  getServerSession: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mocks.getServerSession(...args),
}))

vi.mock('@/server/services/leagueActionGate', () => ({
  assertLeagueActionGate: (...args: unknown[]) => mocks.assertLeagueActionGate(...args),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: (...args: unknown[]) => mocks.submitPick(...args),
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({
  getAllowedPositionsAndRosterSize: (...args: unknown[]) =>
    mocks.getAllowedPositionsAndRosterSize(...args),
}))

vi.mock('@/lib/draft-room/draft-pool-eligible-positions', () => ({
  filterEntriesByDraftEligiblePositions: (
    entries: Array<{ position?: string | null }>,
    eligible: Set<string> | null | undefined,
  ) => {
    if (!eligible || eligible.size === 0) return entries
    return entries.filter((entry) => eligible.has(String(entry.position ?? '').trim().toUpperCase()))
  },
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: (...args: unknown[]) => mocks.getDraftUISettingsForLeague(...args),
  // Slice 3 — single source of truth for soft-timer interpretation. Test mocks must
  // surface this so processExpiredDraftPickForLeague can short-circuit when timerMode === 'soft_pause'.
  isSoftTimerEnabled: (uiSettings: { timerMode?: string } | null | undefined) =>
    uiSettings?.timerMode === 'soft_pause',
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', async () => {
  const actual = await vi.importActual('@/lib/live-draft-engine/DraftSessionService')
  return {
    ...actual,
    reconcileOvernightDraftTimerForLeague: vi.fn().mockResolvedValue(null),
  }
})

vi.mock('@/lib/league/league-roster-draft-gate', () => ({
  isLeagueRosterDraftReady: (...args: unknown[]) => mocks.isLeagueRosterDraftReady(...args),
}))

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: (...args: unknown[]) => mocks.getDraftConfigForLeague(...args),
}))

vi.mock('@/lib/live-draft-engine/autopickBestAvailableSubmit', () => ({
  submitBestAvailableAutopickForExpiredTimer: (...args: unknown[]) =>
    mocks.submitBestAvailableAutopickForExpiredTimer(...args),
}))

vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({
  invalidateLeagueDraftCaches: vi.fn(),
}))

vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  appendPickToRosterDraftSnapshot: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/draft-notifications', () => ({
  notifyAutoPickFired: vi.fn().mockResolvedValue(null),
  notifyDraftIntelPickConfirmation: vi.fn().mockResolvedValue(null),
  notifyDraftIntelOnClockUrgent: vi.fn().mockResolvedValue(null),
  notifyDraftIntelQueueReady: vi.fn().mockResolvedValue(null),
  notifyOnTheClockAfterPick: vi.fn().mockResolvedValue(null),
  notifyQueuePlayerUnavailable: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: vi.fn().mockResolvedValue([]),
  sendDraftIntelDm: vi.fn().mockResolvedValue(null),
}))

import { computeTimerEndAt, computeTimerState } from '@/lib/live-draft-engine/DraftTimerService'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { reorderQueueByNeed, removeDraftedPlayersFromQueue } from '@/lib/draft-queue-engine'
import { tryQueueAutoPick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
import { processExpiredDraftPickForLeague } from '@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks'
import { POST as postDraftControls } from '@/app/api/leagues/[leagueId]/draft/controls/route'

function makeSlotOrder(teamCount: number) {
  return Array.from({ length: teamCount }, (_, i) => ({
    slot: i + 1,
    rosterId: `roster-${i + 1}`,
    displayName: `Team ${i + 1}`,
  }))
}

describe('Phase 4 Slice 2 - timer mechanics', () => {
  it('pre-draft session does not expose a running timer', () => {
    const state = computeTimerState(
      {
        status: 'pre_draft',
        timerSeconds: 90,
        timerEndAt: null,
        pausedRemainingSeconds: null,
      },
      new Date('2026-05-01T12:00:00.000Z'),
    )
    expect(state.status).toBe('none')
    expect(state.remainingSeconds).toBeNull()
    expect(state.timerEndAt).toBeNull()
  })

  it('started timer uses configured duration from now', () => {
    const now = new Date('2026-05-01T12:00:00.000Z')
    const endAt = computeTimerEndAt(90, now)
    expect(endAt.toISOString()).toBe('2026-05-01T12:01:30.000Z')
  })

  it('pause preserves remaining seconds and resume uses a fresh end time without pointer mutation', () => {
    const slotOrder = makeSlotOrder(12)
    const picks = [{ overall: 1, playerName: 'Player One', position: 'RB' }]
    const beforePause = resolveCurrentOnTheClock({
      totalPicks: 24,
      picks,
      teamCount: 12,
      draftType: 'snake',
      thirdRoundReversal: false,
      slotOrder,
    })

    const pausedState = computeTimerState(
      {
        status: 'paused',
        timerSeconds: 90,
        timerEndAt: null,
        pausedRemainingSeconds: 44,
      },
      new Date('2026-05-01T12:00:46.000Z'),
    )
    expect(pausedState.status).toBe('paused')
    expect(pausedState.remainingSeconds).toBe(44)

    const resumedEndAt = computeTimerEndAt(pausedState.remainingSeconds ?? 0, new Date('2026-05-01T12:10:00.000Z'))
    expect(resumedEndAt.toISOString()).toBe('2026-05-01T12:10:44.000Z')

    const afterResume = resolveCurrentOnTheClock({
      totalPicks: 24,
      picks,
      teamCount: 12,
      draftType: 'snake',
      thirdRoundReversal: false,
      slotOrder,
    })
    expect(afterResume?.overall).toBe(beforePause?.overall)
    expect(afterResume?.pickLabel).toBe(beforePause?.pickLabel)
  })

  it('reset timer refreshes clock but keeps on-clock pointer stable', () => {
    const slotOrder = makeSlotOrder(10)
    const picks = [
      { overall: 1, playerName: 'A', position: 'WR' },
      { overall: 2, playerName: 'B', position: 'RB' },
    ]

    const pointerBefore = resolveCurrentOnTheClock({
      totalPicks: 20,
      picks,
      teamCount: 10,
      draftType: 'snake',
      thirdRoundReversal: false,
      slotOrder,
    })

    const resetAt = computeTimerEndAt(120, new Date('2026-05-01T13:00:00.000Z'))
    expect(resetAt.toISOString()).toBe('2026-05-01T13:02:00.000Z')

    const pointerAfter = resolveCurrentOnTheClock({
      totalPicks: 20,
      picks,
      teamCount: 10,
      draftType: 'snake',
      thirdRoundReversal: false,
      slotOrder,
    })
    expect(pointerAfter?.overall).toBe(pointerBefore?.overall)
    expect(pointerAfter?.slot).toBe(pointerBefore?.slot)
  })

  it('completed draft exposes no active timer', () => {
    const state = computeTimerState(
      {
        status: 'completed',
        timerSeconds: 90,
        timerEndAt: new Date('2026-05-01T12:01:00.000Z'),
        pausedRemainingSeconds: null,
      },
      new Date('2026-05-01T12:05:00.000Z'),
    )
    expect(state.status).toBe('none')
    expect(state.remainingSeconds).toBeNull()
  })
})

describe('Phase 4 Slice 2 - queue mechanics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.draftSession.findUnique.mockReset()
    mocks.prisma.roster.findUnique.mockReset()
    mocks.submitPick.mockReset()
    mocks.getAllowedPositionsAndRosterSize.mockResolvedValue({
      draftEligiblePositions: new Set(['RB', 'WR']),
    })
  })

  it('reorder keeps player identity while changing order by need', () => {
    const queue = [
      { playerName: 'Alpha RB', position: 'RB', team: 'A', playerId: 'p1' },
      { playerName: 'Bravo QB', position: 'QB', team: 'B', playerId: 'p2' },
      { playerName: 'Charlie WR', position: 'WR', team: 'C', playerId: 'p3' },
    ]
    const result = reorderQueueByNeed({
      queue,
      rosterPositions: ['QB', 'QB'],
      sport: 'NFL',
    })
    const originalIds = queue.map((entry) => entry.playerId).sort()
    const reorderedIds = result.reordered.map((entry) => entry.playerId).sort()
    expect(reorderedIds).toEqual(originalIds)
    expect(result.reordered[0]?.position).not.toBe('QB')
  })

  it('removes drafted players from queue before selection', () => {
    const queue = [
      { playerName: 'Taken Player', position: 'WR', team: 'A', playerId: 'x1' },
      { playerName: 'Available Player', position: 'RB', team: 'B', playerId: 'x2' },
    ]
    const cleaned = removeDraftedPlayersFromQueue(queue, new Set(['taken player']))
    expect(cleaned.removedCount).toBe(1)
    expect(cleaned.queue).toHaveLength(1)
    expect(cleaned.queue[0]?.playerName).toBe('Available Player')
  })

  it('queue-first autopick chooses top legal undrafted queued entry', async () => {
    mocks.prisma.draftSession.findUnique.mockResolvedValue({
      status: 'in_progress',
      picks: [{ playerName: 'Taken Player' }],
      queues: [
        {
          userId: 'user-1',
          order: [
            { playerName: 'Taken Player', position: 'WR', team: 'A', playerId: 'x1' },
            { playerName: 'Available Player', position: 'RB', team: 'B', playerId: 'x2' },
          ],
        },
      ],
    })
    mocks.prisma.roster.findUnique.mockResolvedValue({ platformUserId: 'user-1' })
    mocks.submitPick.mockResolvedValue({ success: true })

    const result = await tryQueueAutoPick('league-1', 'roster-1')

    expect(result).toEqual({
      success: true,
      playerName: 'Available Player',
      queuePlayerUnavailable: true,
    })
    expect(mocks.submitPick).toHaveBeenCalledTimes(1)
    expect(mocks.submitPick.mock.calls[0]?.[0]).toMatchObject({
      leagueId: 'league-1',
      rosterId: 'roster-1',
      playerName: 'Available Player',
      position: 'RB',
      source: 'auto',
    })
  })
})

describe('Phase 4 Slice 2 - autopick mechanics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.draftSession.findUnique.mockReset()
    mocks.prisma.draftPick.findFirst.mockReset()
    mocks.prisma.roster.findUnique.mockReset()
    mocks.submitPick.mockReset()
    mocks.assertLeagueActionGate.mockReset()
    mocks.getServerSession.mockReset()
    mocks.isLeagueRosterDraftReady.mockResolvedValue(true)
    mocks.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'queue-first' })
    mocks.submitBestAvailableAutopickForExpiredTimer.mockResolvedValue({ ok: false, error: 'no_pool' })
    mocks.prisma.draftPick.findFirst.mockResolvedValue(null)
    mocks.getServerSession.mockResolvedValue({ user: { id: 'commissioner-1' } })
    mocks.assertLeagueActionGate.mockResolvedValue({ ok: true })
  })

  it('expired timer does nothing when auto-pick is disabled', async () => {
    mocks.getDraftUISettingsForLeague.mockResolvedValue({
      autoPickEnabled: false,
      timerMode: 'per_pick',
      slowDraftPauseWindow: null,
    })

    const detail = await processExpiredDraftPickForLeague('league-disabled', new Date('2026-05-01T12:00:00.000Z'))

    expect(detail).toEqual({
      leagueId: 'league-disabled',
      outcome: 'skipped',
      reason: 'auto_pick_disabled',
    })
  })

  it('expired timer processes queue autopick when enabled and legal', async () => {
    const now = new Date('2026-05-01T12:05:00.000Z')
    const expired = new Date('2026-05-01T12:00:00.000Z')

    mocks.getDraftUISettingsForLeague.mockResolvedValue({
      autoPickEnabled: true,
      timerMode: 'per_pick',
      slowDraftPauseWindow: null,
    })
    mocks.getAllowedPositionsAndRosterSize.mockResolvedValue({
      draftEligiblePositions: new Set(['RB', 'WR']),
    })
    mocks.submitPick.mockResolvedValue({ success: true })
    mocks.prisma.roster.findUnique.mockResolvedValue({ platformUserId: 'user-1' })

    const inProgressSession = {
      id: 'session-1',
      leagueId: 'league-enabled',
      status: 'in_progress',
      draftType: 'snake',
      cpuAutoPick: true,
      timerSeconds: 90,
      timerEndAt: expired,
      pausedRemainingSeconds: null,
      overnightFrozenPickSeconds: null,
      version: 7,
      rounds: 2,
      teamCount: 2,
      thirdRoundReversal: false,
      slotOrder: makeSlotOrder(2),
      tradedPicks: [],
      picks: [],
      queues: [
        {
          userId: 'user-1',
          order: [{ playerName: 'Queue RB', position: 'RB', team: 'A', playerId: 'p-queue' }],
        },
      ],
    }

    mocks.prisma.draftSession.findUnique
      .mockResolvedValueOnce(inProgressSession)
      .mockResolvedValueOnce({ version: 7, status: 'in_progress', timerEndAt: expired })
      .mockResolvedValueOnce(inProgressSession)

    const detail = await processExpiredDraftPickForLeague('league-enabled', now)

    expect(detail).toEqual({
      leagueId: 'league-enabled',
      outcome: 'processed_queue',
      rosterId: 'roster-1',
      playerName: 'Queue RB',
    })
    expect(mocks.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-enabled',
        rosterId: 'roster-1',
        playerName: 'Queue RB',
        source: 'auto',
      }),
    )
  })

  it('force_autopick is rejected when commissioner control is disabled', async () => {
    mocks.getDraftUISettingsForLeague.mockResolvedValue({
      commissionerForceAutoPickEnabled: false,
    })

    const req = new Request('http://localhost/api/leagues/league-1/draft/controls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'force_autopick' }),
    }) as any

    const res = await postDraftControls(req, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(String(body?.error ?? '')).toContain('disabled')
  })
})