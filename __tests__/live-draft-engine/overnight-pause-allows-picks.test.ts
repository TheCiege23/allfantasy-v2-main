/**
 * allowPicksDuringOvernightPause — server enforcement (mocked Prisma).
 *
 * Bug fixed: before Commit 4, SlowDraftRuntimeService always called pauseDraftSession
 * when the overnight window started, regardless of the allowPicksDuringOvernightPause flag.
 * Managers with the flag enabled had their sessions paused, blocking manual picks.
 *
 * Fixed behavior:
 * - flag=false + window starts    → pauseDraftSession called, session paused (original behavior)
 * - flag=true  + window starts    → pauseDraftSession NOT called, session stays in_progress
 * - flag=true  + window ends      → resumeDraftSession NOT called (session was never paused),
 *                                   autoPausedByWindow flag cleared, action logged
 * - flag=false + window ends      → resumeDraftSession called (original behavior)
 * - manual pause is never touched → untouched if autoPausedByWindow=false
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const pauseDraftSessionMock = vi.hoisted(() => vi.fn(async () => true))
const resumeDraftSessionMock = vi.hoisted(() => vi.fn(async () => true))

const getDraftUISettingsForLeagueMock = vi.hoisted(() =>
  vi.fn(async () => ({
    timerMode: 'overnight_pause' as const,
    autoPickEnabled: false,
    allowPicksDuringOvernightPause: false,
    slowDraftPauseWindow: { startHour: 22, endHour: 8, timezone: 'America/New_York' } as {
      startHour: number
      endHour: number
      timezone: string
    } | null,
    tradedPickOwnerNameRedEnabled: false,
    tradedPickColorModeEnabled: false,
  })),
)

const isInsidePauseWindowMock = vi.hoisted(() => vi.fn(() => false))

const ctx = vi.hoisted(() => {
  const store = {
    leagueSettings: {} as Record<string, unknown>,
    session: {
      id: 'session-1',
      leagueId: 'league-1',
      status: 'in_progress' as string,
      draftType: 'linear' as const,
      rounds: 4,
      teamCount: 2,
      thirdRoundReversal: false,
      timerSeconds: 90,
      timerEndAt: null as Date | null,
      pausedRemainingSeconds: null as number | null,
      overnightFrozenPickSeconds: null as number | null,
      version: 3,
      slotOrder: [
        { slot: 1, rosterId: 'roster-a', displayName: 'Team A' },
        { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
      ],
      tradedPicks: [] as unknown[],
      cpuAutoPick: false,
      sessionKind: 'live',
      sportType: 'NFL',
      playerPool: 'all',
      draftModeLabel: null as string | null,
      dispersalPoolConfig: null,
      keeperConfig: null,
      keeperSelections: null,
      devyConfig: null,
      c2cConfig: null,
    },
    picks: [] as Array<{ id: string; overall: number; round: number; slot: number; rosterId: string }>,
    queues: [] as unknown[],
  }

  const prisma = {
    draftSession: {
      findUnique: vi.fn(async () => ({
        ...store.session,
        picks: [...store.picks],
        queues: [...store.queues],
      })),
    },
    league: {
      findUnique: vi.fn(async () => ({
        settings: store.leagueSettings,
      })),
      update: vi.fn(async ({ data }: { data: { settings?: unknown } }) => {
        if (data.settings) store.leagueSettings = data.settings as Record<string, unknown>
      }),
    },
    leagueSettings: {
      findUnique: vi.fn(async () => ({
        settings: store.leagueSettings,
      })),
      update: vi.fn(async ({ data }: { data: { settings?: unknown } }) => {
        if (data.settings) store.leagueSettings = data.settings as Record<string, unknown>
      }),
    },
    roster: {
      findUnique: vi.fn(async () => null),
    },
  }

  function reset() {
    store.session.status = 'in_progress'
    store.session.version = 3
    store.session.timerEndAt = null
    store.session.pausedRemainingSeconds = null
    store.leagueSettings = {}
    store.picks = []
    store.queues = []
    pauseDraftSessionMock.mockResolvedValue(true)
    resumeDraftSessionMock.mockResolvedValue(true)
  }

  function setRuntimeMeta(meta: { autoPausedByWindow?: boolean }) {
    store.leagueSettings = {
      ...store.leagueSettings,
      draft_slow_runtime_meta: meta,
    }
  }

  return { store, prisma, reset, setRuntimeMeta }
})

vi.mock('@/lib/prisma', () => ({ prisma: ctx.prisma }))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/draft-defaults/DraftUISettingsResolver')>()
  return {
    ...mod,
    getDraftUISettingsForLeague: (...args: Parameters<typeof mod.getDraftUISettingsForLeague>) =>
      getDraftUISettingsForLeagueMock(...args),
  }
})

vi.mock('@/lib/live-draft-engine/DraftSessionService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/live-draft-engine/DraftSessionService')>()
  return {
    ...mod,
    pauseDraftSession: (...args: [string]) => pauseDraftSessionMock(...args),
    resumeDraftSession: (...args: [string]) => resumeDraftSessionMock(...args),
  }
})

vi.mock('@/lib/live-draft-engine/DraftTimerService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/live-draft-engine/DraftTimerService')>()
  return {
    ...mod,
    isInsidePauseWindow: (...args: Parameters<typeof mod.isInsidePauseWindow>) => isInsidePauseWindowMock(...args),
  }
})

vi.mock('@/lib/draft-notifications', () => ({
  createDraftNotification: vi.fn(async () => {}),
  getAppUserIdForRoster: vi.fn(async () => null),
  notifyDraftIntelOnClockUrgent: vi.fn(async () => {}),
  notifyDraftIntelPickConfirmation: vi.fn(async () => {}),
  notifyDraftIntelQueueReady: vi.fn(async () => {}),
  notifyApproachingTimeout: vi.fn(async () => {}),
  notifyAutoPickFired: vi.fn(async () => {}),
  notifyOnTheClockAfterPick: vi.fn(async () => {}),
  notifyQueuePlayerUnavailable: vi.fn(async () => {}),
}))

vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: vi.fn(async () => {}),
  sendDraftIntelDm: vi.fn(async () => {}),
}))

vi.mock('@/lib/live-draft-engine/autopickBestAvailableSubmit', () => ({
  submitBestAvailableAutopickForExpiredTimer: vi.fn(async () => ({ ok: false, reason: 'noop' })),
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({
  getAllowedPositionsAndRosterSize: vi.fn(async () => ({ allowedPositions: [], maxRosterSize: 15 })),
}))

vi.mock('@/lib/draft-room/draft-pool-eligible-positions', () => ({
  filterEntriesByDraftEligiblePositions: vi.fn((entries: unknown[]) => entries),
}))

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn(async () => ({ autopick_behavior: 'queue-first' })),
}))

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: vi.fn(async () => ({ ok: false })),
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------

const { runSlowDraftAutomationTick } = await import(
  '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runSlowDraftAutomationTick — allowPicksDuringOvernightPause enforcement', () => {
  beforeEach(() => {
    ctx.reset()
    vi.clearAllMocks()
    // Re-wire the mock implementations that clearAllMocks resets
    pauseDraftSessionMock.mockResolvedValue(true)
    resumeDraftSessionMock.mockResolvedValue(true)
    getDraftUISettingsForLeagueMock.mockResolvedValue({
      timerMode: 'overnight_pause' as const,
      autoPickEnabled: false,
      allowPicksDuringOvernightPause: false,
      slowDraftPauseWindow: { startHour: 22, endHour: 8, timezone: 'America/New_York' },
      tradedPickOwnerNameRedEnabled: false,
      tradedPickColorModeEnabled: false,
    })
    ctx.prisma.draftSession.findUnique.mockImplementation(async () => ({
      ...ctx.store.session,
      picks: [...ctx.store.picks],
      queues: [...ctx.store.queues],
    }))
  })

  describe('window starts — flag=false (default: pause session)', () => {
    beforeEach(() => {
      isInsidePauseWindowMock.mockReturnValue(true)
    })

    it('calls pauseDraftSession when inside window and flag is false', async () => {
      await runSlowDraftAutomationTick('league-1')
      expect(pauseDraftSessionMock).toHaveBeenCalledWith('league-1')
    })

    it('emits pause_window_started action', async () => {
      const result = await runSlowDraftAutomationTick('league-1')
      expect(result.actions.some((a) => a.type === 'pause_window_started')).toBe(true)
    })

    it('reports changed=true', async () => {
      const result = await runSlowDraftAutomationTick('league-1')
      expect(result.changed).toBe(true)
    })
  })

  describe('window starts — flag=true (picks allowed, session stays in_progress)', () => {
    beforeEach(() => {
      isInsidePauseWindowMock.mockReturnValue(true)
      getDraftUISettingsForLeagueMock.mockResolvedValue({
        timerMode: 'overnight_pause' as const,
        autoPickEnabled: false,
        allowPicksDuringOvernightPause: true,
        slowDraftPauseWindow: { startHour: 22, endHour: 8, timezone: 'America/New_York' },
        tradedPickOwnerNameRedEnabled: false,
        tradedPickColorModeEnabled: false,
      })
    })

    it('does NOT call pauseDraftSession', async () => {
      await runSlowDraftAutomationTick('league-1')
      expect(pauseDraftSessionMock).not.toHaveBeenCalled()
    })

    it('still emits pause_window_started action', async () => {
      const result = await runSlowDraftAutomationTick('league-1')
      expect(result.actions.some((a) => a.type === 'pause_window_started')).toBe(true)
    })

    it('reports changed=true', async () => {
      const result = await runSlowDraftAutomationTick('league-1')
      expect(result.changed).toBe(true)
    })

    it('does not call pauseDraftSession on subsequent ticks (autoPausedByWindow already set)', async () => {
      ctx.setRuntimeMeta({ autoPausedByWindow: true })
      const result = await runSlowDraftAutomationTick('league-1')
      expect(pauseDraftSessionMock).not.toHaveBeenCalled()
      // No new pause_window_started on repeated ticks
      expect(result.actions.some((a) => a.type === 'pause_window_started')).toBe(false)
    })
  })

  describe('window ends — flag=true (session was in_progress, just clear meta)', () => {
    beforeEach(() => {
      isInsidePauseWindowMock.mockReturnValue(false)
      ctx.setRuntimeMeta({ autoPausedByWindow: true })
      // Session stayed in_progress (was never actually paused)
      ctx.store.session.status = 'in_progress'
      getDraftUISettingsForLeagueMock.mockResolvedValue({
        timerMode: 'overnight_pause' as const,
        autoPickEnabled: false,
        allowPicksDuringOvernightPause: true,
        slowDraftPauseWindow: { startHour: 22, endHour: 8, timezone: 'America/New_York' },
        tradedPickOwnerNameRedEnabled: false,
        tradedPickColorModeEnabled: false,
      })
    })

    it('does NOT call resumeDraftSession (session was never paused)', async () => {
      await runSlowDraftAutomationTick('league-1')
      expect(resumeDraftSessionMock).not.toHaveBeenCalled()
    })

    it('emits pause_window_ended action', async () => {
      const result = await runSlowDraftAutomationTick('league-1')
      expect(result.actions.some((a) => a.type === 'pause_window_ended')).toBe(true)
    })

    it('reports changed=true', async () => {
      const result = await runSlowDraftAutomationTick('league-1')
      expect(result.changed).toBe(true)
    })
  })

  describe('window ends — flag=false (session was paused, resume it)', () => {
    beforeEach(() => {
      isInsidePauseWindowMock.mockReturnValue(false)
      ctx.setRuntimeMeta({ autoPausedByWindow: true })
      ctx.store.session.status = 'paused'
    })

    it('calls resumeDraftSession', async () => {
      await runSlowDraftAutomationTick('league-1')
      expect(resumeDraftSessionMock).toHaveBeenCalledWith('league-1')
    })

    it('emits pause_window_ended action', async () => {
      const result = await runSlowDraftAutomationTick('league-1')
      expect(result.actions.some((a) => a.type === 'pause_window_ended')).toBe(true)
    })
  })

  describe('manual pause is unaffected (autoPausedByWindow=false)', () => {
    beforeEach(() => {
      isInsidePauseWindowMock.mockReturnValue(false)
      ctx.setRuntimeMeta({ autoPausedByWindow: false })
      ctx.store.session.status = 'paused'
    })

    it('does NOT call resumeDraftSession for a manual pause', async () => {
      await runSlowDraftAutomationTick('league-1')
      expect(resumeDraftSessionMock).not.toHaveBeenCalled()
    })

    it('does not emit pause_window_ended', async () => {
      const result = await runSlowDraftAutomationTick('league-1')
      expect(result.actions.some((a) => a.type === 'pause_window_ended')).toBe(false)
    })
  })
})
