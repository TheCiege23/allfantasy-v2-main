/**
 * Service-level coverage for PickSubmissionService.submitPick with mocked Prisma $transaction.
 * Verifies timer reset, consecutive picks, stale overall, duplicate slot/player, completion, traded ownership.
 *
 * Chat notifications fire via dynamic import postDraftPickChatEvent (mocked).
 * League lifecycle / salary cap / trend hooks are mocked or no-op.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DRAFT_PICK_DUPLICATE_PLAYER,
  DRAFT_PICK_NOT_ON_CLOCK,
  DRAFT_PICK_RACE_RETRY,
  DRAFT_PICK_STALE_OVERALL,
} from '@/lib/live-draft-engine/pickAuthorityCodes'

const completeDraftSessionMock = vi.fn(async () => true)
const postDraftPickChatEventMock = vi.fn(async () => {})
const recordTrendSignalMock = vi.fn(async () => {})
const leagueLifecycleTransitionMock = vi.fn(async () => {})

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
  }

  const store = {
    picks: [] as PickRow[],
    /** When set, `tx.draftSession.findUnique` returns these picks (simulates race / inner lock view). */
    transactionLockedPicksOverride: null as PickRow[] | null,
    session: {
      id: 'session-1',
      leagueId: 'league-1',
      status: 'in_progress',
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
          if (data.pausedRemainingSeconds !== undefined) {
            /* ignored for these tests */
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

  const prisma = {
    draftSession: {
      findUnique: vi.fn(async () => ({
        ...store.session,
        picks: store.picks.map((p) => ({ ...p })),
      })),
    },
    draftPick: {
      findMany: vi.fn(async () => store.picks.map((p) => ({ ...p }))),
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
    store.pickIdSeq = 0
    store.session.status = 'in_progress'
    store.session.timerSeconds = 90
    store.session.timerEndAt = null
    store.session.version = 5
    store.session.tradedPicks = []
    store.session.slotOrder = [
      { slot: 1, rosterId: 'roster-a', displayName: 'Team A' },
      { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
    ]
  }

  return { store, prisma, resetStore }
})

vi.mock('@/lib/prisma', () => ({
  prisma: ctx.prisma,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({
    tradedPickOwnerNameRedEnabled: false,
    tradedPickColorModeEnabled: false,
  })),
}))

vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getLeagueDraftTemplatePayload: vi.fn(async () => null),
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/live-draft-engine/DraftSessionService')>()
  return {
    ...mod,
    completeDraftSession: (...args: unknown[]) => completeDraftSessionMock(...args),
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

const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')

describe('PickSubmissionService.submitPick (mocked Prisma transaction)', () => {
  beforeEach(() => {
    ctx.resetStore()
    vi.clearAllMocks()
    completeDraftSessionMock.mockResolvedValue(true)
  })

  it('successful pick creates DraftPick and resets timerEndAt + increments version', async () => {
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Josh Allen',
      position: 'QB',
      team: 'BUF',
      playerId: 'player-1',
      rosterId: 'roster-a',
      madeByUserId: 'user-a',
      source: 'user',
      expectedOverall: 1,
    })
    expect(r.success).toBe(true)
    expect(ctx.store.picks).toHaveLength(1)
    expect(ctx.store.picks[0]).toMatchObject({
      overall: 1,
      rosterId: 'roster-a',
      playerName: 'Josh Allen',
      position: 'QB',
      playerId: 'player-1',
      sessionId: 'session-1',
      source: 'user',
    })
    expect(ctx.store.session.timerEndAt).toBeInstanceOf(Date)
    expect(ctx.store.session.timerEndAt!.getTime()).toBeGreaterThan(Date.now())
    expect(ctx.store.session.version).toBe(6)
    expect(completeDraftSessionMock).not.toHaveBeenCalled()
  })

  it('consecutive picks: roster A then roster B; timer resets each time; different players', async () => {
    const t0 = new Date('2026-03-01T18:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(t0)

    const first = await submitPick({
      leagueId: 'league-1',
      playerName: 'Player One',
      position: 'QB',
      playerId: 'p1',
      rosterId: 'roster-a',
      expectedOverall: 1,
    })
    expect(first.success).toBe(true)
    const afterFirst = ctx.store.session.timerEndAt!.getTime()

    vi.setSystemTime(new Date(t0.getTime() + 5_000))
    const second = await submitPick({
      leagueId: 'league-1',
      playerName: 'Player Two',
      position: 'RB',
      playerId: 'p2',
      rosterId: 'roster-b',
      expectedOverall: 2,
    })
    expect(second.success).toBe(true)
    expect(ctx.store.picks).toHaveLength(2)
    expect(ctx.store.picks[0]!.rosterId).toBe('roster-a')
    expect(ctx.store.picks[1]!.rosterId).toBe('roster-b')
    expect(ctx.store.picks[0]!.playerId).toBe('p1')
    expect(ctx.store.picks[1]!.playerId).toBe('p2')
    expect(ctx.store.session.timerEndAt!.getTime()).toBeGreaterThanOrEqual(afterFirst)
    vi.useRealTimers()
  })

  it('rejects stale expectedOverall before transaction', async () => {
    ctx.store.picks.push({
      id: 'seed-1',
      sessionId: 'session-1',
      overall: 1,
      round: 1,
      slot: 1,
      rosterId: 'roster-a',
      playerName: 'Already Gone',
      position: 'QB',
      playerId: 'seed',
    })
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Late',
      position: 'WR',
      rosterId: 'roster-b',
      expectedOverall: 1,
    })
    expect(r.success).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_STALE_OVERALL)
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled()
    expect(ctx.store.picks).toHaveLength(1)
  })

  it('rejects duplicate fill of same overall (race) with RACE_RETRY', async () => {
    // Outer read: board still open at overall 1. Inner tx: another writer filled slot 1 first
    // (picksCountAtSubmit mismatch → "Draft state changed").
    ctx.store.transactionLockedPicksOverride = [
      {
        id: 'existing',
        sessionId: 'session-1',
        overall: 1,
        round: 1,
        slot: 1,
        rosterId: 'roster-a',
        playerName: 'Taken',
        position: 'QB',
        playerId: 'x',
      },
    ]
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Someone Else',
      position: 'RB',
      rosterId: 'roster-a',
      expectedOverall: 1,
    })
    expect(r.success).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_RACE_RETRY)
    expect(ctx.store.picks).toHaveLength(0)
  })

  it('rejects duplicate player via PickValidation', async () => {
    ctx.store.picks.push({
      id: 'pfill',
      sessionId: 'session-1',
      overall: 1,
      round: 1,
      slot: 1,
      rosterId: 'roster-a',
      playerName: 'Josh Allen',
      position: 'QB',
      playerId: 'same',
    })
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Josh Allen',
      position: 'QB',
      rosterId: 'roster-b',
      expectedOverall: 2,
    })
    expect(r.success).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_DUPLICATE_PLAYER)
    expect(ctx.store.picks).toHaveLength(1)
  })

  it('final pick invokes completeDraftSession', async () => {
    ctx.store.session.rounds = 1
    ctx.store.session.teamCount = 1
    ctx.store.session.slotOrder = [{ slot: 1, rosterId: 'solo', displayName: 'Solo' }]
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Only Pick',
      position: 'QB',
      rosterId: 'solo',
      playerId: 'solo-p',
      expectedOverall: 1,
    })
    expect(r.success).toBe(true)
    expect(completeDraftSessionMock).toHaveBeenCalledWith('league-1')
  })

  it('timer deadline is server-authoritative: timerEndAt ≈ now + timerSeconds', async () => {
    ctx.store.session.timerSeconds = 120
    const frozen = new Date('2026-07-04T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(frozen)
    await submitPick({
      leagueId: 'league-1',
      playerName: 'Frozen',
      position: 'TE',
      rosterId: 'roster-a',
      playerId: 'fz',
      expectedOverall: 1,
    })
    expect(ctx.store.session.timerEndAt!.getTime()).toBe(frozen.getTime() + 120_000)
    vi.useRealTimers()
  })

  it('traded pick: on-clock owner is new roster; wrong roster rejected', async () => {
    ctx.store.session.tradedPicks = [
      {
        round: 1,
        originalRosterId: 'roster-a',
        previousOwnerName: 'Team A',
        newRosterId: 'roster-b',
        newOwnerName: 'Team B',
      },
    ]
    const wrong = await submitPick({
      leagueId: 'league-1',
      playerName: 'No',
      position: 'WR',
      rosterId: 'roster-a',
      playerId: 'n1',
      expectedOverall: 1,
    })
    expect(wrong.success).toBe(false)
    expect(wrong.code).toBe(DRAFT_PICK_NOT_ON_CLOCK)

    const ok = await submitPick({
      leagueId: 'league-1',
      playerName: 'Yes',
      position: 'WR',
      rosterId: 'roster-b',
      playerId: 'y1',
      expectedOverall: 1,
    })
    expect(ok.success).toBe(true)
    expect(ctx.store.picks[0]!.rosterId).toBe('roster-b')
    expect(ctx.store.picks[0]!.originalRosterId).toBe('roster-a')
    expect(ctx.store.picks[0]!.tradedPickMeta).toMatchObject({
      originalRosterId: 'roster-a',
      newOwnerName: 'Team B',
    })
  })
})
