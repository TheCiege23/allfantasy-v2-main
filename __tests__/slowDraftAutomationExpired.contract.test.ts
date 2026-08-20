import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  leagueFindUnique,
  draftFindUnique,
  leagueUpdate,
  rosterFindUnique,
  getDraftUi,
  getDraftConfig,
  submitPickMock,
  bpaMock,
  pauseMock,
  resumeMock,
} = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  draftFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  rosterFindUnique: vi.fn(),
  getDraftUi: vi.fn(),
  getDraftConfig: vi.fn(),
  submitPickMock: vi.fn(),
  bpaMock: vi.fn(),
  pauseMock: vi.fn(),
  resumeMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: (...a: unknown[]) => leagueFindUnique(...a),
      update: (...a: unknown[]) => leagueUpdate(...a),
    },
    draftSession: { findUnique: (...a: unknown[]) => draftFindUnique(...a) },
    roster: { findUnique: (...a: unknown[]) => rosterFindUnique(...a) },
  },
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/draft-defaults/DraftUISettingsResolver')>()
  return {
    ...mod,
    getDraftUISettingsForLeague: (...a: unknown[]) => getDraftUi(...a),
  }
})

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: (...a: unknown[]) => getDraftConfig(...a),
}))

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: (...a: unknown[]) => submitPickMock(...a),
}))

vi.mock('@/lib/live-draft-engine/autopickBestAvailableSubmit', () => ({
  submitBestAvailableAutopickForExpiredTimer: (...a: unknown[]) => bpaMock(...a),
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  pauseDraftSession: (...a: unknown[]) => pauseMock(...a),
  resumeDraftSession: (...a: unknown[]) => resumeMock(...a),
}))

vi.mock('@/lib/draft-notifications', () => ({
  createDraftNotification: vi.fn().mockResolvedValue(undefined),
  getAppUserIdForRoster: vi.fn().mockResolvedValue(null),
  notifyDraftIntelOnClockUrgent: vi.fn(),
  notifyDraftIntelPickConfirmation: vi.fn().mockResolvedValue(undefined),
  notifyDraftIntelQueueReady: vi.fn(),
  notifyApproachingTimeout: vi.fn(),
  notifyAutoPickFired: vi.fn(),
  notifyOnTheClockAfterPick: vi.fn(),
  notifyQueuePlayerUnavailable: vi.fn(),
}))

vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: vi.fn().mockResolvedValue([]),
  sendDraftIntelDm: vi.fn().mockResolvedValue(null),
}))

import { runSlowDraftAutomationTick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'

const expired = new Date('2020-01-01T00:00:00.000Z')
const now = new Date('2026-06-10T12:00:00.000Z')

function sessionBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-x',
    leagueId: 'L-exp',
    status: 'in_progress',
    draftType: 'snake',
    timerSeconds: 90,
    timerEndAt: expired,
    pausedRemainingSeconds: null,
    overnightFrozenPickSeconds: null,
    rounds: 4,
    teamCount: 2,
    thirdRoundReversal: false,
    slotOrder: [
      { slot: 1, rosterId: 'r1', displayName: 'A' },
      { slot: 2, rosterId: 'r2', displayName: 'B' },
    ],
    tradedPicks: [],
    picks: [],
    queues: [],
    ...overrides,
  }
}

describe('runSlowDraftAutomationTick — expired timer autopick contracts', () => {
  beforeEach(() => {
    leagueFindUnique.mockReset()
    draftFindUnique.mockReset()
    leagueUpdate.mockReset()
    rosterFindUnique.mockReset()
    getDraftUi.mockReset()
    getDraftConfig.mockReset()
    submitPickMock.mockReset()
    bpaMock.mockReset()
    pauseMock.mockReset()
    resumeMock.mockReset()

    leagueFindUnique.mockResolvedValue({ settings: {} })
    leagueUpdate.mockResolvedValue({})
    pauseMock.mockResolvedValue(false)
    resumeMock.mockResolvedValue(false)

    getDraftUi.mockResolvedValue({
      autoPickEnabled: true,
      timerMode: 'per_pick',
      slowDraftPauseWindow: undefined,
      allowPicksDuringOvernightPause: false,
    })
    getDraftConfig.mockResolvedValue({ autopick_behavior: 'queue-first' })
  })

  it('queue-first: successful queue submit surfaces auto_pick', async () => {
    draftFindUnique.mockResolvedValue(
      sessionBase({
        queues: [
          {
            userId: 'u1',
            order: [{ playerName: 'Queue Star', position: 'TE', team: 'KC', playerId: 'q1' }],
          },
        ],
      }),
    )
    rosterFindUnique.mockResolvedValue({ platformUserId: 'u1' })
    submitPickMock.mockResolvedValue({ success: true })

    const out = await runSlowDraftAutomationTick('L-exp', now)
    expect(out.actions.find((a) => a.type === 'auto_pick')).toMatchObject({
      type: 'auto_pick',
      playerName: 'Queue Star',
    })
    expect(out.changed).toBe(true)
    expect(submitPickMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOverall: 1,
        source: 'auto',
        rosterId: 'r1',
      }),
    )
  })

  it('BPA fallback when queue path yields no pick', async () => {
    draftFindUnique.mockResolvedValue(sessionBase({ queues: [] }))
    rosterFindUnique.mockResolvedValue({ platformUserId: 'u1' })
    bpaMock.mockResolvedValue({
      ok: true,
      pick: { playerName: 'BPA Hero', position: 'QB', team: 'BUF', playerId: 'b1' },
    })

    const out = await runSlowDraftAutomationTick('L-exp', now)
    expect(bpaMock).toHaveBeenCalledWith('L-exp', 'r1', 1)
    expect(out.actions.some((a) => a.type === 'auto_pick' && 'playerName' in a && a.playerName === 'BPA Hero')).toBe(
      true,
    )
    expect(out.changed).toBe(true)
  })

  it('skip behavior: auto_skip when autopick_behavior is skip', async () => {
    draftFindUnique.mockResolvedValue(sessionBase({ queues: [] }))
    getDraftConfig.mockResolvedValue({ autopick_behavior: 'skip' })
    rosterFindUnique.mockResolvedValue({ platformUserId: 'u1' })
    submitPickMock.mockResolvedValueOnce({ success: true })

    const out = await runSlowDraftAutomationTick('L-exp', now)
    expect(out.actions.some((a) => a.type === 'auto_skip')).toBe(true)
    expect(submitPickMock).toHaveBeenCalledWith(
      expect.objectContaining({
        playerName: '(Skipped)',
        position: 'SKIP',
        source: 'auto',
        expectedOverall: 1,
      }),
    )
  })

  it('no autopick when session is commissioner-paused', async () => {
    draftFindUnique.mockResolvedValue(
      sessionBase({
        status: 'paused',
        pausedRemainingSeconds: 30,
        timerEndAt: expired,
      }),
    )

    const out = await runSlowDraftAutomationTick('L-exp', now)
    expect(out.actions.filter((a) => a.type === 'auto_pick')).toHaveLength(0)
    expect(submitPickMock).not.toHaveBeenCalled()
    expect(bpaMock).not.toHaveBeenCalled()
  })

  it('no autopick when soft_pause timer mode', async () => {
    getDraftUi.mockResolvedValue({
      autoPickEnabled: true,
      timerMode: 'soft_pause',
      slowDraftPauseWindow: undefined,
      allowPicksDuringOvernightPause: false,
    })
    draftFindUnique.mockResolvedValue(sessionBase())

    const out = await runSlowDraftAutomationTick('L-exp', now)
    expect(out.actions.filter((a) => a.type === 'auto_pick')).toHaveLength(0)
    expect(submitPickMock).not.toHaveBeenCalled()
  })

  it('overnight window + frozen seconds: timer paused, no expired autopick', async () => {
    getDraftUi.mockResolvedValue({
      autoPickEnabled: true,
      timerMode: 'overnight_pause',
      slowDraftPauseWindow: { start: '10:00', end: '14:00', timezone: 'UTC' },
      allowPicksDuringOvernightPause: true,
    })
    draftFindUnique.mockResolvedValue(
      sessionBase({
        overnightFrozenPickSeconds: 30,
        timerEndAt: null,
      }),
    )

    const out = await runSlowDraftAutomationTick('L-exp', now)
    expect(out.actions.filter((a) => a.type === 'auto_pick')).toHaveLength(0)
    expect(submitPickMock).not.toHaveBeenCalled()
    expect(bpaMock).not.toHaveBeenCalled()
  })
})
