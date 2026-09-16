import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The outcome loop's rebuild: when it runs, what it writes, and that it never writes a claim it
 * could not check. Everything below it is mocked — the Receipts rules have their own suites.
 */

const h = vi.hoisted(() => ({
  cacheFindUnique: vi.fn(),
  cacheUpsert: vi.fn(),
  leagueFindMany: vi.fn(),
  listAdviceUsers: vi.fn(),
  resolveCurrentWeek: vi.fn(),
  resolveOutcomes: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findUnique: h.cacheFindUnique, upsert: h.cacheUpsert },
    league: { findMany: h.leagueFindMany },
  },
}))
vi.mock('@/lib/chimmy-advice/adviceStore', () => ({ listAdviceUsers: h.listAdviceUsers }))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: h.resolveCurrentWeek }))
vi.mock('@/lib/core-app/decisionReceipts', () => ({ resolveChimmyAdviceOutcomes: h.resolveOutcomes }))

import {
  ADVICE_LEARNING_CACHE_KEY,
  MAX_LEARNING_USERS,
  RECOMPUTE_AFTER_MS,
  recomputeAdviceLearning,
  toOutcomes,
} from '@/lib/chimmy-outcomes/adviceLearning'
import { resetAdviceLearningMemo } from '@/lib/chimmy-outcomes/learningStore'
import { buildAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningSnapshot'

const NOW = new Date('2026-10-20T12:00:00Z')
const GIVEN = new Date('2026-10-01T12:00:00Z')

const startAdvice = {
  leagueId: 'L1',
  sport: 'NFL',
  season: 2026,
  week: 4,
  adviceType: 'start_sit' as const,
  surface: 'start_vs_comparison' as const,
  rec: { key: '100', name: 'A' },
  alt: { key: '200', name: 'B' },
  slot: 'FLEX',
  confidencePct: 88,
  givenAt: GIVEN,
}
const addAdvice = {
  ...startAdvice,
  adviceType: 'add' as const,
  surface: 'chimmy_chat_waiver' as const,
  rec: { key: '300', name: 'C' },
  alt: null,
  slot: null,
  confidencePct: 64,
}
const resolved = {
  advice: [startAdvice, addAdvice],
  startSits: [{ id: 'L1:2026:4:100:200', call: 'right', followed: 'yes' }],
  adds: [{ id: 'L1:2026:4:add:300', added: null }],
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAdviceLearningMemo()
  h.cacheFindUnique.mockResolvedValue(null)
  h.cacheUpsert.mockResolvedValue({})
  h.leagueFindMany.mockResolvedValue([{ id: 'L1', name: 'One', platform: 'sleeper', platformLeagueId: 'S1', season: 2026 }])
  h.listAdviceUsers.mockResolvedValue([{ userId: 'u1', leagueIds: ['L1'] }])
  h.resolveCurrentWeek.mockResolvedValue({ seasonYear: 2026, week: 7 })
  h.resolveOutcomes.mockResolvedValue(resolved)
})

describe('recomputeAdviceLearning', () => {
  it('skips the rebuild while the stored snapshot is fresh', async () => {
    const fresh = buildAdviceLearningSnapshot([], { now: new Date(NOW.getTime() - RECOMPUTE_AFTER_MS + 60_000), complete: true, users: 0 })
    h.cacheFindUnique.mockResolvedValue({ data: fresh })
    expect(await recomputeAdviceLearning({ now: NOW })).toEqual({ status: 'fresh', computedAt: fresh.computedAt })
    expect(h.listAdviceUsers).not.toHaveBeenCalled()
    expect(h.cacheUpsert).not.toHaveBeenCalled()
  })

  it('rebuilds a stale snapshot, and always when forced', async () => {
    const stale = buildAdviceLearningSnapshot([], { now: new Date(NOW.getTime() - RECOMPUTE_AFTER_MS - 1), complete: true, users: 0 })
    h.cacheFindUnique.mockResolvedValue({ data: stale })
    expect((await recomputeAdviceLearning({ now: NOW })).status).toBe('computed')

    const fresh = buildAdviceLearningSnapshot([], { now: NOW, complete: true, users: 0 })
    h.cacheFindUnique.mockResolvedValue({ data: fresh })
    expect((await recomputeAdviceLearning({ now: NOW, force: true })).status).toBe('computed')
  })

  it('writes nothing when the advice table is unavailable', async () => {
    h.listAdviceUsers.mockResolvedValue(null)
    expect(await recomputeAdviceLearning({ now: NOW })).toEqual({ status: 'unavailable' })
    expect(h.cacheUpsert).not.toHaveBeenCalled()
  })

  it('resolves each user with their own leagues and week, and stores one snapshot', async () => {
    const run = await recomputeAdviceLearning({ now: NOW })
    expect(run).toMatchObject({ status: 'computed', users: 1, resolvedUsers: 1, outcomes: 2, calls: 1, complete: true })
    expect(h.resolveCurrentWeek).toHaveBeenCalledWith(['S1'])
    expect(h.resolveOutcomes).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', currentWeek: 7, leagues: [expect.objectContaining({ id: 'L1' })] }),
    )

    expect(h.cacheUpsert).toHaveBeenCalledTimes(1)
    const write = h.cacheUpsert.mock.calls[0][0]
    expect(write.where).toEqual({ cacheKey: ADVICE_LEARNING_CACHE_KEY })
    expect(write.update.expiresAt.getTime()).toBeGreaterThan(NOW.getTime() + RECOMPUTE_AFTER_MS)
    const snap = write.update.data
    expect(snap.calibration.start_sit.high).toMatchObject({ n: 1, right: 1 })
    expect(snap.followThrough.u1.map((v: unknown[]) => v.slice(0, 2))).toEqual(
      expect.arrayContaining([
        ['L1:2026:4:100:200', 1],
        ['L1:2026:4:add:300', 0],
      ]),
    )
  })

  it('marks the snapshot incomplete when there are more users than one run takes', async () => {
    h.listAdviceUsers.mockResolvedValue(
      Array.from({ length: MAX_LEARNING_USERS + 1 }, (_, i) => ({ userId: `u${i}`, leagueIds: ['L1'] })),
    )
    const run = await recomputeAdviceLearning({ now: NOW })
    expect(run).toMatchObject({ status: 'computed', users: MAX_LEARNING_USERS, complete: false })
    expect(h.resolveOutcomes).toHaveBeenCalledTimes(MAX_LEARNING_USERS)
  })

  it('stops at its time budget and says so', async () => {
    h.listAdviceUsers.mockResolvedValue([
      { userId: 'u1', leagueIds: ['L1'] },
      { userId: 'u2', leagueIds: ['L1'] },
    ])
    const run = await recomputeAdviceLearning({ now: NOW, budgetMs: -1 })
    expect(run).toMatchObject({ status: 'computed', resolvedUsers: 0, complete: false })
    expect(h.resolveOutcomes).not.toHaveBeenCalled()
  })

  it('one user’s failure does not stop the others', async () => {
    h.listAdviceUsers.mockResolvedValue([
      { userId: 'bad', leagueIds: ['L1'] },
      { userId: 'u1', leagueIds: ['L1'] },
    ])
    h.resolveOutcomes.mockImplementation(async (a: { userId: string }) => {
      if (a.userId === 'bad') throw new Error('boom')
      return resolved
    })
    const run = await recomputeAdviceLearning({ now: NOW })
    expect(run).toMatchObject({ status: 'computed', resolvedUsers: 1, complete: false })
  })
})

describe('toOutcomes', () => {
  it('joins each receipt to the advice it came from, and drops one it cannot join', () => {
    const out = toOutcomes('u1', {
      ...resolved,
      startSits: [...resolved.startSits, { id: 'L1:2026:4:999:998', call: 'wrong', followed: 'no' }],
    } as never)
    expect(out).toEqual([
      {
        userId: 'u1',
        key: 'L1:2026:4:100:200',
        adviceType: 'start_sit',
        confidencePct: 88,
        givenAt: GIVEN,
        call: 'right',
        followed: 'yes',
      },
      { userId: 'u1', key: 'L1:2026:4:add:300', adviceType: 'add', confidencePct: 64, givenAt: GIVEN, followed: 'no' },
    ])
  })
})
