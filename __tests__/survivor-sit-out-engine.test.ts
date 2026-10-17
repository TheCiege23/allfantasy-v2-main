// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  survivorCommissionerActionFindMany: vi.fn(),
  survivorCommissionerActionCreate: vi.fn(),
  survivorCommissionerActionFindFirst: vi.fn(),
  survivorCommissionerActionUpdate: vi.fn(),
  survivorCommissionerActionCount: vi.fn(),
  survivorCommissionerActionFindUnique: vi.fn(),
  survivorTribeMemberFindMany: vi.fn(),
  survivorTribeFindMany: vi.fn(),
  readWeekGames: vi.fn(),
  rosterFindMany: vi.fn(),
  rosterFindFirst: vi.fn(),
  survivorPlayerFindMany: vi.fn(),
  survivorPlayerFindFirst: vi.fn(),
  survivorWeeklyScoreFindMany: vi.fn(),
  survivorWeeklyScoreUpdateMany: vi.fn(),
  survivorChatChannelFindFirst: vi.fn(),
  survivorChatMessageCreate: vi.fn(),
  getSurvivorConfig: vi.fn(),
  getTribesWithMembers: vi.fn(),
  logSurvivorAuditEntry: vi.fn(),
  enqueueNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: hm.leagueFindUnique,
    },
    survivorCommissionerAction: {
      findMany: hm.survivorCommissionerActionFindMany,
      create: hm.survivorCommissionerActionCreate,
      findFirst: hm.survivorCommissionerActionFindFirst,
      update: hm.survivorCommissionerActionUpdate,
      count: hm.survivorCommissionerActionCount,
      findUnique: hm.survivorCommissionerActionFindUnique,
    },
    survivorTribeMember: {
      findMany: hm.survivorTribeMemberFindMany,
    },
    roster: {
      findMany: hm.rosterFindMany,
      findFirst: hm.rosterFindFirst,
    },
    survivorPlayer: {
      findMany: hm.survivorPlayerFindMany,
      findFirst: hm.survivorPlayerFindFirst,
    },
    survivorWeeklyScore: {
      findMany: hm.survivorWeeklyScoreFindMany,
      updateMany: hm.survivorWeeklyScoreUpdateMany,
    },
    survivorChatChannel: {
      findFirst: hm.survivorChatChannelFindFirst,
    },
    survivorChatMessage: {
      create: hm.survivorChatMessageCreate,
    },
  },
}))

vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({
  withSurvivorSetupTransaction: (_leagueId: string, work: (tx: unknown) => unknown) => work({
    survivorCommissionerAction: {
      findUnique: hm.survivorCommissionerActionFindUnique,
      findFirst: hm.survivorCommissionerActionFindFirst,
      findMany: hm.survivorCommissionerActionFindMany,
      count: hm.survivorCommissionerActionCount,
      create: hm.survivorCommissionerActionCreate,
      update: hm.survivorCommissionerActionUpdate,
    },
    survivorTribe: { findMany: hm.survivorTribeFindMany },
    survivorPlayer: { findFirst: hm.survivorPlayerFindFirst, findMany: hm.survivorPlayerFindMany },
    survivorTribe: { findMany: hm.survivorTribeFindMany },
  }),
}))

vi.mock('@/lib/redraft/weekGames', () => ({ readWeekGames: hm.readWeekGames }))

vi.mock('@/lib/survivor/notificationEngine', () => ({
  enqueueNotification: hm.enqueueNotification,
}))

vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({
  getSurvivorConfig: hm.getSurvivorConfig,
}))

vi.mock('@/lib/survivor/SurvivorTribeService', () => ({
  getTribesWithMembers: hm.getTribesWithMembers,
}))

vi.mock('@/lib/survivor/auditEntry', () => ({
  logSurvivorAuditEntry: hm.logSurvivorAuditEntry,
}))

import {
  applySurvivorSitOutToMiniGames,
  applySurvivorSitOutToScoring,
  getSurvivorTribeBalanceState,
  maybeTriggerSurvivorTribeShuffleRecommendation,
  nominateSurvivorSitOut,
  respondToSurvivorSitOut,
  requiredTribeSitOuts,
  settleNbaTribeSitOutDeadline,
} from '@/lib/survivor/SurvivorSitOutEngine'

describe('SurvivorSitOutEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.enqueueNotification.mockResolvedValue(undefined)
    hm.logSurvivorAuditEntry.mockResolvedValue(undefined)
    hm.survivorChatMessageCreate.mockResolvedValue(undefined)
    hm.survivorChatChannelFindFirst.mockResolvedValue({ id: 'tribe-chat-1' })
    hm.survivorCommissionerActionCount.mockResolvedValue(0)
    hm.survivorCommissionerActionFindUnique.mockResolvedValue(null)
    hm.survivorCommissionerActionFindFirst.mockResolvedValue(null)
    hm.survivorCommissionerActionFindMany.mockResolvedValue([])
  })

  it('balances uneven tribes to the smallest active tribe', () => {
    expect(requiredTribeSitOuts({ a: 5, b: 5, c: 4, d: 3 })).toEqual({ a: 2, b: 2, c: 1, d: 0 })
    expect(requiredTribeSitOuts({ a: 4, b: 4 })).toEqual({ a: 0, b: 0 })
  })

  it('auto-selects only eligible managers at the first NBA tipoff', async () => {
    const firstTipoff = new Date('2026-10-27T23:00:00Z')
    hm.leagueFindUnique.mockResolvedValue({ survivorMode: true, sport: 'NBA', season: 2026, survivorPhase: 'pre_merge' })
    hm.readWeekGames.mockResolvedValue([{ startTime: firstTipoff }])
    hm.survivorTribeFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    hm.survivorPlayerFindMany.mockResolvedValue([
      { userId: 'a1', tribeId: 'a', displayName: 'A1' },
      { userId: 'a2', tribeId: 'a', displayName: 'A2' },
      { userId: 'a3', tribeId: 'a', displayName: 'A3' },
      { userId: 'b1', tribeId: 'b', displayName: 'B1' },
      { userId: 'b2', tribeId: 'b', displayName: 'B2' },
    ])
    hm.survivorCommissionerActionFindMany.mockImplementation(async ({ where }) => where.week === 1 ? [{ targetUserId: 'a1' }] : [])
    hm.survivorCommissionerActionCreate.mockResolvedValue({ id: 'created' })

    expect(await settleNbaTribeSitOutDeadline('league-1', 2, firstTipoff)).toBe('locked')
    const autoCalls = hm.survivorCommissionerActionCreate.mock.calls.filter(([arg]) => arg.data.actionType === 'sit_out_accepted')
    expect(autoCalls).toHaveLength(1)
    expect(['a2', 'a3']).toContain(autoCalls[0][0].data.targetUserId)
    expect(hm.survivorCommissionerActionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'sit_out_week_locked' }) }))
  })

  it('blocks a tribe result when no fair rotation exists', async () => {
    const tipoff = new Date('2026-10-27T23:00:00Z')
    hm.leagueFindUnique.mockResolvedValue({ survivorMode: true, sport: 'NBA', season: 2026, survivorPhase: 'pre_merge' })
    hm.readWeekGames.mockResolvedValue([{ startTime: tipoff }])
    hm.survivorTribeFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    hm.survivorPlayerFindMany.mockResolvedValue([
      { userId: 'a1', tribeId: 'a', displayName: 'A1' }, { userId: 'a2', tribeId: 'a', displayName: 'A2' },
      { userId: 'a3', tribeId: 'a', displayName: 'A3' }, { userId: 'b1', tribeId: 'b', displayName: 'B1' },
    ])
    hm.survivorCommissionerActionFindMany.mockImplementation(async ({ where }) => where.week === 1 ? [{ targetUserId: 'a1' }, { targetUserId: 'a2' }] : [])
    hm.survivorCommissionerActionCreate.mockResolvedValue({ id: 'blocked' })
    expect(await settleNbaTribeSitOutDeadline('league-1', 2, tipoff)).toBe('blocked')
    expect(hm.survivorCommissionerActionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'sit_out_week_blocked' }) }))
    expect(hm.survivorCommissionerActionCreate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'sit_out_accepted' }) }))
  })

  it('persists a pending sit-out nomination for an eligible active tribe member', async () => {
    hm.leagueFindUnique.mockResolvedValue({ survivorPhase: 'tribe' })
    hm.rosterFindFirst.mockResolvedValue({ id: 'r-target', platformUserId: 'u-target' })
    hm.survivorPlayerFindFirst.mockResolvedValue({ userId: 'u-target' })
    hm.survivorPlayerFindFirst
      .mockResolvedValueOnce({ userId: 'u-target', displayName: 'Target User', playerState: 'active' })
      .mockResolvedValueOnce({ userId: 'u-nominator', tribeId: 'tribe-a', playerState: 'active' })
    hm.survivorCommissionerActionFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    hm.survivorTribeMemberFindMany.mockResolvedValue([{ rosterId: 'r-target' }])
    hm.rosterFindMany.mockResolvedValue([{ id: 'r-target', platformUserId: 'u-target' }])
    hm.survivorPlayerFindMany.mockResolvedValueOnce([
      {
        redraftRosterId: 'r-target',
        userId: 'u-target',
        displayName: 'Target User',
        hasImmunityThisWeek: false,
      },
    ]).mockResolvedValueOnce([{ redraftRosterId: 'r-target' }, { redraftRosterId: 'r-nominator' }, { redraftRosterId: 'r-other' }])
    hm.getTribesWithMembers.mockResolvedValue([
      { id: 'tribe-a', name: 'A', members: [{ rosterId: 'r-target' }, { rosterId: 'r-nominator' }] },
      { id: 'tribe-b', name: 'B', members: [{ rosterId: 'r-other' }] },
    ])
    hm.survivorCommissionerActionCreate.mockResolvedValue({ id: 'sit-1' })

    const result = await nominateSurvivorSitOut({
      leagueId: 'league-1',
      week: 4,
      nominatorUserId: 'u-nominator',
      nominatorRosterId: 'r-nominator',
      tribeId: 'tribe-a',
      nominatedRosterId: 'r-target',
      command: '@chimmy nominate Target User to sit out',
    })

    expect(result).toEqual({
      ok: true,
      sitOutId: 'sit-1',
      nominatedUserId: 'u-target',
      nominatedDisplayName: 'Target User',
    })
    expect(hm.survivorCommissionerActionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'sit_out_nominated',
          targetUserId: 'u-target',
          targetTribeId: 'tribe-a',
        }),
      }),
    )
    expect(hm.enqueueNotification).toHaveBeenCalled()
  })

  it('rejects sit-out responses from anyone other than the nominated manager', async () => {
    hm.survivorCommissionerActionFindFirst.mockResolvedValue({
      id: 'sit-1',
      leagueId: 'league-1',
      week: 5,
      actionType: 'sit_out_nominated',
      targetUserId: 'u-target',
      targetTribeId: 'tribe-a',
      newState: { status: 'pending' },
    })

    const result = await respondToSurvivorSitOut({
      leagueId: 'league-1',
      sitOutId: 'sit-1',
      responderUserId: 'u-other',
      accept: true,
    })

    expect(result).toEqual({
      ok: false,
      error: 'Only the nominated manager can respond to this sit-out.',
    })
    expect(hm.survivorCommissionerActionUpdate).not.toHaveBeenCalled()
  })

  it('removes accepted sit-out managers from tribe scoring totals', async () => {
    hm.survivorCommissionerActionFindMany.mockResolvedValueOnce([
      {
        id: 'sit-1',
        targetUserId: 'u-sat-out',
        actionType: 'sit_out_accepted',
      },
    ])
    hm.survivorWeeklyScoreFindMany
      .mockResolvedValueOnce([
        {
          id: 'score-1',
          userId: 'u-sat-out',
          tribeId: 'tribe-a',
          finalScore: 14,
          countedTowardTribeTotal: true,
        },
        {
          id: 'score-2',
          userId: 'u-active',
          tribeId: 'tribe-a',
          finalScore: 20,
          countedTowardTribeTotal: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          tribeId: 'tribe-a',
          finalScore: 14,
          countedTowardTribeTotal: false,
        },
        {
          tribeId: 'tribe-a',
          finalScore: 20,
          countedTowardTribeTotal: true,
        },
      ])
    hm.survivorWeeklyScoreUpdateMany.mockResolvedValue({ count: 1 })

    const result = await applySurvivorSitOutToScoring('league-1', 7)

    expect(result).toEqual({
      sitOutExcludedUserIds: ['u-sat-out'],
      tribeScoreBeforeSitOut: { 'tribe-a': 34 },
      tribeScoreAfterSitOut: { 'tribe-a': 20 },
    })
    expect(hm.survivorWeeklyScoreUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['score-1'] } },
        data: { countedTowardTribeTotal: false },
      }),
    )
  })

  it('keeps individual challenges available to accepted sit-out managers', async () => {
    hm.rosterFindFirst.mockResolvedValue({ platformUserId: 'u-target' })
    hm.survivorCommissionerActionFindMany.mockResolvedValueOnce([
      {
        id: 'sit-1',
        targetUserId: 'u-target',
        actionType: 'sit_out_accepted',
      },
    ])

    const result = await applySurvivorSitOutToMiniGames({
      leagueId: 'league-1',
      week: 8,
      rosterId: 'r-target',
    })

    expect(result).toEqual({
      blocked: false,
      sitOutExcludedUserIds: [],
    })
  })

  it('does not issue a duplicate shuffle recommendation in the same week', async () => {
    hm.getTribesWithMembers.mockResolvedValue([
      { id: 'tribe-a', name: 'Alpha', members: [{ rosterId: 'r1' }] },
      { id: 'tribe-b', name: 'Beta', members: [{ rosterId: 'r2' }] },
    ])
    hm.leagueFindUnique.mockResolvedValue({ survivorPhase: 'tribe' })
    hm.survivorPlayerFindMany.mockResolvedValue([
      { redraftRosterId: 'r1' },
      { redraftRosterId: 'r2' },
    ])
    hm.getSurvivorConfig.mockResolvedValue({ tribeSize: 4, tribeShuffleEnabled: false })
    hm.survivorCommissionerActionFindFirst.mockResolvedValue({ id: 'shuffle-1', week: 9 })

    const result = await maybeTriggerSurvivorTribeShuffleRecommendation('league-1', 9)

    expect(result).toEqual({
      triggered: false,
      reason: 'This week’s shuffle recommendation already exists.',
    })
    expect(hm.survivorCommissionerActionCreate).not.toHaveBeenCalled()
  })

  it.each([
    [4, 2, false],
    [4, 1, true],
    [5, 2, true],
    [6, 2, true],
  ])('recommends a redraw at 40%% of original tribe size (%i original, %i active)', async (originalSize, survivingSize, expected) => {
    const firstMembers = Array.from({ length: survivingSize }, (_, i) => ({ rosterId: `a-${i}` }))
    const secondMembers = Array.from({ length: originalSize }, (_, i) => ({ rosterId: `b-${i}` }))
    hm.getTribesWithMembers.mockResolvedValue([
      { id: 'tribe-a', name: 'Alpha', members: firstMembers },
      { id: 'tribe-b', name: 'Beta', members: secondMembers },
    ])
    hm.leagueFindUnique.mockResolvedValue({ survivorPhase: 'tribe' })
    hm.getSurvivorConfig.mockResolvedValue({ tribeSize: originalSize })
    hm.survivorPlayerFindMany.mockResolvedValue([...firstMembers, ...secondMembers].map(member => ({ redraftRosterId: member.rosterId })))

    const result = await getSurvivorTribeBalanceState('league-1', 9)

    expect(result.shouldSuggestShuffle).toBe(expected)
  })
})
