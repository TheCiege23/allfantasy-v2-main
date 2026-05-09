/**
 * buildSessionSnapshot — viewerUserId hydration of viewerAutopick.
 *
 * Asserts:
 * - No viewerUserId  → viewerAutopick is null (server-internal callers unaffected).
 * - With viewerUserId → viewerAutopick is populated from getViewerAutopickPreference.
 * - Two viewers on same session get different viewerAutopick (per-viewer correctness).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getViewerAutopickPreferenceMock = vi.hoisted(() =>
  vi.fn(async (_draftSessionId: string, viewerUserId: string) => ({
    enabled: false,
    mode: 'standard' as const,
    isProEligible: false,
    updatedAt: null as string | null,
    __viewer: viewerUserId, // sentinel for per-viewer correctness assertions
  })),
)

vi.mock('@/lib/live-draft-engine/LiveDraftAutopickPreferenceService', () => ({
  getViewerAutopickPreference: (...args: [string, string]) => getViewerAutopickPreferenceMock(...args),
}))

const ctx = vi.hoisted(() => {
  const session = {
    id: 'session-1',
    leagueId: 'league-1',
    status: 'in_progress' as string,
    draftType: 'snake' as const,
    rounds: 4,
    teamCount: 2,
    thirdRoundReversal: false,
    timerSeconds: 90,
    timerEndAt: null as Date | null,
    pausedRemainingSeconds: null as number | null,
    overnightFrozenPickSeconds: null as number | null,
    slotOrder: [
      { slot: 1, rosterId: 'roster-a', displayName: 'Team A' },
      { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
    ],
    tradedPicks: [] as unknown[],
    version: 3,
    sessionKind: 'live',
    sportType: 'NFL',
    playerPool: 'all',
    draftModeLabel: null as string | null,
    cpuAutoPick: false,
    aiAutoPick: false,
    alphabeticalSort: false,
    onClockTradeTimerBehavior: 'inherit_remaining',
    inDraftPlayerTradesEnabled: true,
    customRankingsEnabled: true,
    auctionBudgetPerTeam: null as number | null,
    auctionBudgets: null,
    auctionState: null,
    keeperConfig: null,
    keeperSelections: null,
    devyConfig: null,
    c2cConfig: null,
    dispersalPoolConfig: null,
    commissionerAiManagers: null,
    pausedByUserId: null as string | null,
    nextOverallPick: 1,
    currentRoundNum: 1,
    startedAt: null as Date | null,
    completedAt: null as Date | null,
    sleeperDraftId: null as string | null,
    createdAt: new Date('2026-05-09T00:00:00.000Z'),
    updatedAt: new Date('2026-05-09T00:00:00.000Z'),
    picks: [] as unknown[],
  }

  const prisma = {
    draftSession: {
      findUnique: vi.fn(async () => session),
      update: vi.fn(async () => session),
    },
    league: {
      findUnique: vi.fn(async () => ({ id: 'league-1', settings: {} })),
    },
    leagueSettings: {
      findUnique: vi.fn(async () => ({ settings: {} })),
    },
  }

  return { session, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: ctx.prisma }))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({
    timerMode: 'per_pick' as const,
    autoPickEnabled: false,
    allowPicksDuringOvernightPause: false,
    slowDraftPauseWindow: null,
    tradedPickOwnerNameRedEnabled: false,
    tradedPickColorModeEnabled: false,
  })),
  isSoftTimerEnabled: vi.fn(() => false),
}))

vi.mock('@/lib/league/league-roster-template', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ hasPersistedRosterSchema: true })),
}))

vi.mock('@/lib/live-draft-engine/repairDraftSessionSlotOrderIfNeeded', () => ({
  repairDraftSessionSlotOrderIfNeeded: vi.fn(async () => {}),
}))

vi.mock('@/lib/live-draft-engine/overnightDraftTimerReconcile', () => ({
  reconcileOvernightDraftTimerForLeague: vi.fn(async () => {}),
}))

const { buildSessionSnapshot } = await import('@/lib/live-draft-engine/DraftSessionService')

describe('buildSessionSnapshot — viewerAutopick hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getViewerAutopickPreferenceMock.mockImplementation(async (_draftSessionId, viewerUserId) => ({
      enabled: false,
      mode: 'standard',
      isProEligible: false,
      updatedAt: null,
      __viewer: viewerUserId,
    }))
  })

  it('returns viewerAutopick: null when no viewerUserId is passed (default)', async () => {
    const snap = await buildSessionSnapshot('league-1')
    expect(snap?.viewerAutopick).toBeNull()
    expect(getViewerAutopickPreferenceMock).not.toHaveBeenCalled()
  })

  it('returns viewerAutopick: null when viewerUserId is null', async () => {
    const snap = await buildSessionSnapshot('league-1', new Date(), null)
    expect(snap?.viewerAutopick).toBeNull()
    expect(getViewerAutopickPreferenceMock).not.toHaveBeenCalled()
  })

  it('populates viewerAutopick from helper when viewerUserId is provided', async () => {
    getViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: true,
      mode: 'ai_queue',
      isProEligible: true,
      updatedAt: '2026-05-09T01:00:00.000Z',
    } as any)

    const snap = await buildSessionSnapshot('league-1', new Date(), 'user-pro')
    expect(snap?.viewerAutopick).toEqual({
      enabled: true,
      mode: 'ai_queue',
      isProEligible: true,
      updatedAt: '2026-05-09T01:00:00.000Z',
    })
    expect(getViewerAutopickPreferenceMock).toHaveBeenCalledWith('session-1', 'user-pro')
  })

  it('two viewers on same session get viewer-specific results (privacy / per-viewer correctness)', async () => {
    const snapA = await buildSessionSnapshot('league-1', new Date(), 'user-A')
    const snapB = await buildSessionSnapshot('league-1', new Date(), 'user-B')

    // Helper called once per viewer with the right userId
    expect(getViewerAutopickPreferenceMock).toHaveBeenNthCalledWith(1, 'session-1', 'user-A')
    expect(getViewerAutopickPreferenceMock).toHaveBeenNthCalledWith(2, 'session-1', 'user-B')

    // Sentinel proves the snapshot embedded the correct viewer's result, not the other's
    expect((snapA?.viewerAutopick as any)?.__viewer).toBe('user-A')
    expect((snapB?.viewerAutopick as any)?.__viewer).toBe('user-B')
  })
})
