/**
 * Expired timer / autopick behavior (service-level, mocked Prisma).
 *
 * Complements **`__tests__/processExpiredDraftPicks.test.ts`** (mocked `processExpiredDraftPicks` scan + BPA/queue delegation).
 *
 * Flow map (`lib/live-draft-engine/expired-picks/processExpiredDraftPicks.ts`):
 * - `processExpiredDraftPicks` scans sessions with `timerEndAt <= now` (in_progress, snake/linear).
 * - `processExpiredDraftPickForLeague`: roster gate → UI auto-pick enabled → **not** soft timer →
 *   overnight reconcile → load session → auction/cpu/timer expiry checks → version/timer freshness →
 *   **queue-first** `tryQueueAutoPick` → else skip/BPA via `submitBestAvailableAutopickForExpiredTimer`.
 * - `tryQueueAutoPick` (`SlowDraftRuntimeService`): ordered queue → `submitPick` (`source: 'auto'`, `expectedOverall`).
 * - Timer authority: `PickSubmissionService` sets `timerEndAt` via `computeTimerEndAt(timerSeconds)`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { computeTimerEndAt } from '@/lib/live-draft-engine/DraftTimerService'
import { DRAFT_PICK_STALE_OVERALL } from '@/lib/live-draft-engine/pickAuthorityCodes'

const completeDraftSessionMock = vi.fn(async () => true)
const postDraftPickChatEventMock = vi.fn(async () => {})
const recordTrendSignalMock = vi.fn(async () => {})
const leagueLifecycleTransitionMock = vi.fn(async () => {})

const aiAutopickTryMock = vi.fn(async (): Promise<{ ok: false }> => ({ ok: false }))

const getDraftUISettingsForLeagueMock = vi.hoisted(() =>
  vi.fn(async () => ({
    autoPickEnabled: true,
    timerMode: 'per_pick' as const,
    slowDraftPauseWindow: null as null,
    tradedPickOwnerNameRedEnabled: false,
    tradedPickColorModeEnabled: false,
  })),
)

const isLeagueRosterDraftReadyMock = vi.hoisted(() => vi.fn(async () => true))

const reconcileOvernightDraftTimerForLeagueMock = vi.hoisted(() => vi.fn(async () => {}))

const getDraftConfigForLeagueMock = vi.hoisted(() =>
  vi.fn(async () => ({ autopick_behavior: 'queue-first' as string | undefined })),
)

const ctx = vi.hoisted(() => {
  type PickRow = {
    id: string
    sessionId: string
    overall: number
    round: number
    slot: number
    rosterId: string
    playerName: string
    position: string
    playerId?: string | null
    team?: string | null
    originalRosterId?: string | null
    tradedPickMeta?: unknown
    source?: string | null
    pickMetadata?: unknown
    sportType?: string | null
  }

  type QueueRow = { id: string; sessionId: string; userId: string; order: unknown }

  const store = {
    picks: [] as PickRow[],
    transactionLockedPicksOverride: null as PickRow[] | null,
    draftQueueRows: [] as QueueRow[],
    rostersById: {} as Record<string, { platformUserId: string | null }>,
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
      slotOrder: [
        { slot: 1, rosterId: 'roster-a', displayName: 'Team A' },
        { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
      ],
      tradedPicks: [] as Array<{
        round: number
        originalRosterId: string
        previousOwnerName: string
        newRosterId: string
        newOwnerName: string
      }>,
      sportType: 'NFL',
      playerPool: 'all',
      draftModeLabel: null as string | null,
      dispersalPoolConfig: null,
      keeperConfig: null,
      keeperSelections: null,
      devyConfig: null,
      c2cConfig: null,
      version: 5,
      sessionKind: 'live',
      cpuAutoPick: true,
      pausedRemainingSeconds: null,
      overnightFrozenPickSeconds: null,
    },
    pickIdSeq: 0,
  }

  function nextPickId() {
    store.pickIdSeq += 1
    return `pick-id-${store.pickIdSeq}`
  }

  function buildTx() {
    return {
      draftSession: {
        findUnique: vi.fn(async () => ({
          ...store.session,
          sessionKind: store.session.sessionKind,
          picks: (store.transactionLockedPicksOverride ?? store.picks).map((p) => ({ ...p })),
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.timerEndAt !== undefined) store.session.timerEndAt = data.timerEndAt as Date | null
          if (data.status !== undefined) store.session.status = data.status as string
          if (
            data.version &&
            typeof data.version === 'object' &&
            data.version !== null &&
            'increment' in data.version
          ) {
            store.session.version += Number((data.version as { increment: number }).increment)
          }
          return { ...store.session }
        }),
      },
      draftPick: {
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          store.picks = store.picks.filter((p) => p.id !== where.id)
        }),
        create: vi.fn(async ({ data }: { data: Omit<PickRow, 'id'> & { sessionId: string } }) => {
          const row: PickRow = {
            id: nextPickId(),
            ...(data as PickRow),
          }
          store.picks.push(row)
          return row
        }),
      },
    }
  }

  function draftSessionPayload(includeRelations: boolean) {
    const base = {
      ...store.session,
      sessionKind: store.session.sessionKind,
    }
    if (!includeRelations) {
      return base
    }
    return {
      ...base,
      picks: store.picks.map((p) => ({ ...p })),
      queues: store.draftQueueRows.map((q) => ({ ...q })),
    }
  }

  const prisma = {
    draftSession: {
      findUnique: vi.fn(async (args?: { select?: Record<string, boolean> }) => {
        if (args?.select) {
          return {
            version: store.session.version,
            timerEndAt: store.session.timerEndAt,
            status: store.session.status,
          }
        }
        return draftSessionPayload(true)
      }),
      findMany: vi.fn(),
    },
    roster: {
      findUnique: vi.fn(),
    },
    draftPick: {
      findMany: vi.fn(async () => store.picks.map((p) => ({ ...p }))),
      findFirst: vi.fn(async () => {
        const sorted = [...store.picks].sort((a, b) => b.overall - a.overall)
        return sorted[0] ?? null
      }),
    },
    league: {
      findUnique: vi.fn(async () => ({
        lifecycleState: 'drafting',
        sport: 'NFL',
        userId: 'commissioner-1',
      })),
    },
    player: {
      findFirst: vi.fn(async () => null),
    },
    $transaction: vi.fn(async (fn: (tx: ReturnType<typeof buildTx>) => Promise<unknown>) => {
      return fn(buildTx())
    }),
  }

  function resetStore() {
    store.picks = []
    store.transactionLockedPicksOverride = null
    store.draftQueueRows = []
    store.rostersById = {}
    store.pickIdSeq = 0
    store.session.status = 'in_progress'
    store.session.timerSeconds = 90
    store.session.timerEndAt = null
    store.session.version = 5
    store.session.rounds = 4
    store.session.teamCount = 2
    store.session.tradedPicks = []
    store.session.slotOrder = [
      { slot: 1, rosterId: 'roster-a', displayName: 'Team A' },
      { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
    ]
  }

  function wireDefaultDraftSessionFindUnique() {
    prisma.draftSession.findUnique.mockImplementation(async (args?: { select?: Record<string, boolean> }) => {
      if (args?.select) {
        return {
          version: store.session.version,
          timerEndAt: store.session.timerEndAt,
          status: store.session.status,
        }
      }
      return draftSessionPayload(true)
    })
  }

  return { store, prisma, resetStore, wireDefaultDraftSessionFindUnique }
})

vi.mock('@/lib/prisma', () => ({
  prisma: ctx.prisma,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/draft-defaults/DraftUISettingsResolver')>()
  return {
    ...mod,
    getDraftUISettingsForLeague: (...args: Parameters<typeof mod.getDraftUISettingsForLeague>) =>
      getDraftUISettingsForLeagueMock(...args),
  }
})

vi.mock('@/lib/league/league-roster-draft-gate', () => ({
  isLeagueRosterDraftReady: (...args: [string]) => isLeagueRosterDraftReadyMock(...args),
}))

vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getLeagueDraftTemplatePayload: vi.fn(async () => null),
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/live-draft-engine/DraftSessionService')>()
  return {
    ...mod,
    completeDraftSession: (...args: unknown[]) => completeDraftSessionMock(...args),
    reconcileOvernightDraftTimerForLeague: (...args: unknown[]) =>
      reconcileOvernightDraftTimerForLeagueMock(...args),
  }
})

vi.mock('@/lib/player-trend/signal-integration', () => ({
  recordTrendSignalByPlayerId: (...args: unknown[]) => recordTrendSignalMock(...args),
}))

vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({
  getSalaryCapConfig: vi.fn(async () => null),
}))

vi.mock('@/lib/salary-cap/RookieContractService', () => ({
  assignRookieContract: vi.fn(async () => {}),
}))

vi.mock('@/lib/draft-room/postDraftPickChatEvent', () => ({
  postDraftPickChatEvent: (...args: unknown[]) => postDraftPickChatEventMock(...args),
}))

vi.mock('@/server/services/leagueLifecycleService', () => ({
  transitionLeagueState: (...args: unknown[]) => leagueLifecycleTransitionMock(...args),
  getLeagueLifecycleState: () => 'drafting',
}))

vi.mock('@/lib/ai/opponents/liveDraftAiAutopick', () => ({
  tryAiOpponentAutopickForExpiredTimer: (...args: unknown[]) => aiAutopickTryMock(...args),
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/live-draft-engine/RosterFitValidation')>()
  return {
    ...mod,
    getAllowedPositionsAndRosterSize: vi.fn(async () => ({ draftEligiblePositions: null as Set<string> | null })),
  }
})

vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({
  invalidateLeagueDraftCaches: vi.fn(),
}))

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: (...args: unknown[]) => getDraftConfigForLeagueMock(...args),
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

vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  appendPickToRosterDraftSnapshot: vi.fn(async () => {}),
}))

const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
const { processExpiredDraftPickForLeague } = await import(
  '@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks'
)

describe('expired autopick — tryQueueAutoPick + submitPick', () => {
  beforeEach(() => {
    ctx.resetStore()
    ctx.wireDefaultDraftSessionFindUnique()
    ctx.prisma.roster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const r = ctx.store.rostersById[where.id]
      return r ? { platformUserId: r.platformUserId } : null
    })
    vi.clearAllMocks()
    completeDraftSessionMock.mockResolvedValue(true)
    getDraftUISettingsForLeagueMock.mockImplementation(async () => ({
      autoPickEnabled: true,
      timerMode: 'per_pick',
      slowDraftPauseWindow: null,
      tradedPickOwnerNameRedEnabled: false,
      tradedPickColorModeEnabled: false,
    }))
    isLeagueRosterDraftReadyMock.mockResolvedValue(true)
    reconcileOvernightDraftTimerForLeagueMock.mockResolvedValue(undefined)
    getDraftConfigForLeagueMock.mockResolvedValue({ autopick_behavior: 'queue-first' })
    aiAutopickTryMock.mockResolvedValue({ ok: false })
  })

  it('queue-first: skips drafted queue head and submits next available player with source auto', async () => {
    ctx.store.picks.push({
      id: 'seed-1',
      sessionId: 'session-1',
      overall: 1,
      round: 1,
      slot: 1,
      rosterId: 'roster-a',
      playerName: 'Josh Allen',
      position: 'QB',
      playerId: 'ja',
    })
    ctx.store.draftQueueRows = [
      {
        id: 'dq-1',
        sessionId: 'session-1',
        userId: 'user-b',
        order: [
          { playerName: 'Josh Allen', position: 'QB' },
          { playerName: 'Mike Evans', position: 'WR' },
        ],
      },
    ]
    ctx.store.rostersById['roster-b'] = { platformUserId: 'user-b' }

    const r = await tryQueueAutoPick('league-1', 'roster-b')
    expect(r.success).toBe(true)
    expect(r.playerName).toBe('Mike Evans')
    expect(ctx.store.picks).toHaveLength(2)
    expect(ctx.store.picks.find((p) => p.overall === 2)).toMatchObject({
      rosterId: 'roster-b',
      playerName: 'Mike Evans',
      position: 'WR',
      source: 'auto',
    })
    expect(ctx.store.session.timerEndAt).toBeInstanceOf(Date)
  })

  it('queue loop stops on stale overall (concurrent writer) without creating a pick', async () => {
    ctx.store.draftQueueRows = [
      {
        id: 'dq-1',
        sessionId: 'session-1',
        userId: 'user-b',
        order: [{ playerName: 'Only Guy', position: 'TE' }],
      },
    ]
    ctx.store.rostersById['roster-b'] = { platformUserId: 'user-b' }

    const ps = await import('@/lib/live-draft-engine/PickSubmissionService')
    const submitSpy = vi.spyOn(ps, 'submitPick')
    submitSpy.mockResolvedValueOnce({
      success: false,
      error: 'stale',
      code: DRAFT_PICK_STALE_OVERALL,
    })

    const r = await tryQueueAutoPick('league-1', 'roster-b')
    expect(r.success).toBe(false)
    submitSpy.mockRestore()
  })
})

describe('expired autopick — submitPick with source auto (same path as queue/BPA autopick)', () => {
  beforeEach(() => {
    ctx.resetStore()
    ctx.wireDefaultDraftSessionFindUnique()
    ctx.prisma.roster.findUnique.mockResolvedValue(null)
    vi.clearAllMocks()
    completeDraftSessionMock.mockResolvedValue(true)
    getDraftUISettingsForLeagueMock.mockImplementation(async () => ({
      autoPickEnabled: true,
      timerMode: 'per_pick',
      slowDraftPauseWindow: null,
      tradedPickOwnerNameRedEnabled: false,
      tradedPickColorModeEnabled: false,
    }))
  })

  it('timerEndAt after autopick matches computeTimerEndAt(timerSeconds)', async () => {
    const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
    ctx.store.session.timerSeconds = 90
    const t0 = new Date('2026-06-01T10:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    await submitPick({
      leagueId: 'league-1',
      playerName: 'Auto Guy',
      position: 'RB',
      rosterId: 'roster-a',
      playerId: 'ag',
      source: 'auto',
      expectedOverall: 1,
    })
    expect(ctx.store.session.timerEndAt!.getTime()).toBe(t0.getTime() + 90_000)
    vi.useRealTimers()
  })

  it('consecutive auto picks advance roster A then B', async () => {
    const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
    await submitPick({
      leagueId: 'league-1',
      playerName: 'P1',
      position: 'QB',
      rosterId: 'roster-a',
      playerId: 'p1',
      source: 'auto',
      expectedOverall: 1,
    })
    await submitPick({
      leagueId: 'league-1',
      playerName: 'P2',
      position: 'WR',
      rosterId: 'roster-b',
      playerId: 'p2',
      source: 'auto',
      expectedOverall: 2,
    })
    expect(ctx.store.picks.map((p) => p.rosterId)).toEqual(['roster-a', 'roster-b'])
    expect(ctx.store.picks.every((p) => p.source === 'auto')).toBe(true)
  })

  it('final auto pick invokes completeDraftSession', async () => {
    const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
    ctx.store.session.rounds = 1
    ctx.store.session.teamCount = 1
    ctx.store.session.slotOrder = [{ slot: 1, rosterId: 'solo', displayName: 'Solo' }]
    ctx.wireDefaultDraftSessionFindUnique()
    await submitPick({
      leagueId: 'league-1',
      playerName: 'Last',
      position: 'QB',
      rosterId: 'solo',
      playerId: 'last',
      source: 'auto',
      expectedOverall: 1,
    })
    expect(completeDraftSessionMock).toHaveBeenCalledWith('league-1')
  })
})

describe('expired autopick — DraftTimerService.computeTimerEndAt', () => {
  it('deadline is server-authoritative from timerSeconds', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(computeTimerEndAt(120, now).getTime()).toBe(now.getTime() + 120_000)
  })
})

describe('processExpiredDraftPickForLeague', () => {
  const expiredAt = new Date('2026-03-10T12:00:00.000Z')
  const now = new Date('2026-03-10T12:05:00.000Z')

  beforeEach(() => {
    ctx.resetStore()
    ctx.store.session.timerEndAt = expiredAt
    ctx.wireDefaultDraftSessionFindUnique()
    ctx.prisma.roster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const r = ctx.store.rostersById[where.id]
      return r ? { platformUserId: r.platformUserId } : null
    })
    vi.clearAllMocks()
    completeDraftSessionMock.mockResolvedValue(true)
    getDraftUISettingsForLeagueMock.mockImplementation(async () => ({
      autoPickEnabled: true,
      timerMode: 'per_pick',
      slowDraftPauseWindow: null,
      tradedPickOwnerNameRedEnabled: false,
      tradedPickColorModeEnabled: false,
    }))
    isLeagueRosterDraftReadyMock.mockResolvedValue(true)
    reconcileOvernightDraftTimerForLeagueMock.mockResolvedValue(undefined)
    getDraftConfigForLeagueMock.mockResolvedValue({ autopick_behavior: 'queue-first' })
    aiAutopickTryMock.mockResolvedValue({ ok: false })
  })

  it('queue-first expired path: processes_queue when tryQueueAutoPick succeeds', async () => {
    ctx.store.picks.push({
      id: 'seed-1',
      sessionId: 'session-1',
      overall: 1,
      round: 1,
      slot: 1,
      rosterId: 'roster-a',
      playerName: 'Taken',
      position: 'QB',
      playerId: 'x',
    })
    ctx.store.draftQueueRows = [
      {
        id: 'dq-1',
        sessionId: 'session-1',
        userId: 'user-b',
        order: [{ playerName: 'Mike Evans', position: 'WR' }],
      },
    ]
    ctx.store.rostersById['roster-b'] = { platformUserId: 'user-b' }

    const detail = await processExpiredDraftPickForLeague('league-1', now)
    expect(detail.outcome).toBe('processed_queue')
    if (detail.outcome !== 'processed_queue') throw new Error('expected queue')
    expect(detail.rosterId).toBe('roster-b')
    expect(detail.playerName).toBe('Mike Evans')
  })

  it('skips when draft UI soft timer is enabled (no session mutation)', async () => {
    getDraftUISettingsForLeagueMock.mockImplementation(async () => ({
      autoPickEnabled: true,
      timerMode: 'soft_pause',
      slowDraftPauseWindow: null,
      tradedPickOwnerNameRedEnabled: false,
      tradedPickColorModeEnabled: false,
    }))
    const detail = await processExpiredDraftPickForLeague('league-1', now)
    expect(detail).toMatchObject({ outcome: 'skipped', reason: 'soft_timer_enabled' })
    expect(ctx.store.picks).toHaveLength(0)
  })

  it('skips when session is paused even if timerEndAt is in the past', async () => {
    ctx.store.session.status = 'paused'
    ctx.store.session.timerEndAt = expiredAt
    const detail = await processExpiredDraftPickForLeague('league-1', now)
    expect(detail).toMatchObject({ outcome: 'skipped', reason: 'status_paused' })
  })

  it('skips when freshness check sees version drift (concurrent processor)', async () => {
    ctx.prisma.draftSession.findUnique.mockImplementation(async (args?: { select?: Record<string, boolean> }) => {
      if (args?.select) {
        return {
          version: 99,
          timerEndAt: expiredAt,
          status: 'in_progress',
        }
      }
      return {
        ...ctx.store.session,
        sessionKind: ctx.store.session.sessionKind,
        timerEndAt: expiredAt,
        picks: ctx.store.picks.map((p) => ({ ...p })),
        queues: ctx.store.draftQueueRows.map((q) => ({ ...q })),
      }
    })

    const detail = await processExpiredDraftPickForLeague('league-1', now)
    expect(detail).toMatchObject({ outcome: 'skipped', reason: 'stale_session' })
  })

  it('traded pick: autopick targets new owner roster (queue on traded-to team)', async () => {
    ctx.store.session.tradedPicks = [
      {
        round: 1,
        originalRosterId: 'roster-a',
        previousOwnerName: 'A',
        newRosterId: 'roster-b',
        newOwnerName: 'B',
      },
    ]
    ctx.store.draftQueueRows = [
      {
        id: 'dq-1',
        sessionId: 'session-1',
        userId: 'user-b',
        order: [{ playerName: 'Traded Pick Guy', position: 'TE' }],
      },
    ]
    ctx.store.rostersById['roster-b'] = { platformUserId: 'user-b' }

    const detail = await processExpiredDraftPickForLeague('league-1', now)
    expect(detail.outcome).toBe('processed_queue')
    if (detail.outcome !== 'processed_queue') throw new Error('expected queue')
    expect(detail.rosterId).toBe('roster-b')
    const last = ctx.store.picks[ctx.store.picks.length - 1]
    expect(last?.rosterId).toBe('roster-b')
    expect(last?.originalRosterId).toBe('roster-a')
  })
})
