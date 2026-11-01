import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const db = vi.hoisted(() => ({
  create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(),
  walletRead: vi.fn(), walletUpdate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  apiRateLimitRecord: db,
  userTokenBalance: { findUnique: db.walletRead, update: db.walletUpdate },
} }))

import {
  ChimmyAllowanceUnavailableError, readChimmyAnswerAllowance,
  takeChimmyPlanAllowance, releaseChimmyPlanAllowance, type PlanAllowanceDeps,
} from '@/lib/chimmy/planAllowance'
import { describeAllowanceNote, describeAnswerAllowance, readPlanAllowanceView } from '@/lib/chimmy/planAllowanceView'
import { describeOutOfAnswers } from '@/lib/chimmy/outOfAnswers'

const now = new Date('2026-10-25T18:00:00Z')
const freeState = { kind: 'free' as const, planName: 'Free Chimmy', used: 0, limit: 2,
  remaining: 2, resetsAt: '2026-10-26T00:00:00.000Z' }
const deps = (overrides: Partial<PlanAllowanceDeps> = {}): PlanAllowanceDeps => ({
  hasChimmyPlan: vi.fn(async () => ({ included: false, planName: 'AF Pro' })),
  readUsed: vi.fn(async () => 1), take: vi.fn(async () => 2),
  giveBack: vi.fn(async () => true), now: () => now, limit: () => 100, ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CHIMMY_REVIEW_ACCOUNT_USER_IDS
})

describe('daily free Chimmy answers', () => {
  it('tracks two daily answers without reading or changing the token wallet', async () => {
    const d = deps()
    expect(await readChimmyAnswerAllowance({ userId: 'u1' }, d)).toEqual({ ...freeState, used: 1, remaining: 1 })
    expect(d.readUsed).toHaveBeenCalledWith(expect.stringMatching(/^chimmy_free:/), {
      windowStart: new Date('2026-10-25T00:00:00Z'), windowEnd: new Date('2026-10-26T00:00:00Z'),
    })
    expect(db.walletRead).not.toHaveBeenCalled()
    expect(db.walletUpdate).not.toHaveBeenCalled()
  })

  it('retains the separate 100-answer subscription allowance', async () => {
    const d = deps({ hasChimmyPlan: vi.fn(async () => ({ included: true, planName: 'AF Pro' })) })
    expect(await readChimmyAnswerAllowance({ userId: 'u1' }, d)).toMatchObject({ limit: 100, remaining: 99, planName: 'AF Pro' })
    expect(d.readUsed).toHaveBeenCalledOnce()
    expect(d.readUsed).toHaveBeenCalledWith(expect.stringMatching(/^chimmy_plan:/), expect.anything())
  })

  it('preserves the existing App Review account allowance', async () => {
    process.env.CHIMMY_REVIEW_ACCOUNT_USER_IDS = 'review-user'
    expect(await readChimmyAnswerAllowance({ userId: 'review-user' }, deps())).toMatchObject({ kind: 'free', limit: 25 })
  })

  it('never substitutes a paid charge for an unreadable free counter', async () => {
    await expect(readChimmyAnswerAllowance({ userId: 'u1' }, deps({ readUsed: vi.fn().mockRejectedValue(new Error('offline')) })))
      .rejects.toBeInstanceOf(ChimmyAllowanceUnavailableError)
  })

  it('never treats an unknown subscription as a free account eligible for token charges', async () => {
    const d = deps({ hasChimmyPlan: vi.fn().mockRejectedValue(new Error('subscription read failed')) })
    await expect(readChimmyAnswerAllowance({ userId: 'u1' }, d)).rejects.toBeInstanceOf(ChimmyAllowanceUnavailableError)
    expect(d.readUsed).not.toHaveBeenCalled()
  })

  it('does not charge a subscriber when the included-answer counter is unreadable', async () => {
    const d = deps({ hasChimmyPlan: vi.fn(async () => ({ included: true, planName: 'AF Pro' })),
      readUsed: vi.fn().mockRejectedValue(new Error('counter offline')) })
    await expect(readChimmyAnswerAllowance({ userId: 'u1' }, d)).rejects.toBeInstanceOf(ChimmyAllowanceUnavailableError)
  })

  it('does not grant an uncounted free answer when reserving fails', async () => {
    await expect(takeChimmyPlanAllowance({ userId: 'u1', state: freeState }, deps({ take: vi.fn().mockRejectedValue(new Error('offline')) })))
      .rejects.toBeInstanceOf(ChimmyAllowanceUnavailableError)
  })

  it('limits simultaneous requests to two answers with the real conditional counter path', async () => {
    let calls = 0
    db.create.mockImplementation(async () => {
      if (calls > 0) throw new Prisma.PrismaClientKnownRequestError('Unique window', { code: 'P2002', clientVersion: 'test' })
      calls = 1
    })
    db.updateMany.mockImplementation(async ({ where }) => {
      expect(where.endpoint).toMatch(/^chimmy_free:/)
      expect(where.callsMade.lt).toBe(2)
      if (calls >= where.callsMade.lt) return { count: 0 }
      calls++
      return { count: 1 }
    })
    db.findFirst.mockImplementation(async () => ({ callsMade: calls }))
    const results = await Promise.all(Array.from({ length: 8 }, () => takeChimmyPlanAllowance({ userId: 'u1', state: freeState })))
    expect(results.filter(Boolean)).toHaveLength(2)
    expect(calls).toBe(2)
  })

  it('returns a failed answer to the free counter only once', async () => {
    const d = deps({ take: vi.fn(async () => 1) })
    const taken = await takeChimmyPlanAllowance({ userId: 'u1', state: freeState }, d)
    expect(taken).not.toBeNull()
    await Promise.all([releaseChimmyPlanAllowance({ userId: 'u1', state: taken! }, d),
      releaseChimmyPlanAllowance({ userId: 'u1', state: taken! }, d)])
    expect(d.giveBack).toHaveBeenCalledOnce()
    expect(d.giveBack).toHaveBeenCalledWith(expect.stringMatching(/^chimmy_free:/), expect.anything())
  })

  it('retains ownership of a successful reservation if its display-count read fails', async () => {
    db.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique window', { code: 'P2002', clientVersion: 'test' }))
    db.updateMany.mockResolvedValue({ count: 1 })
    db.findFirst.mockRejectedValue(new Error('display count unavailable'))
    const taken = await takeChimmyPlanAllowance({ userId: 'u1', state: freeState })
    expect(taken).toMatchObject({ kind: 'free', used: 2, remaining: 0 })
    const d = deps()
    await expect(releaseChimmyPlanAllowance({ userId: 'u1', state: taken! }, d)).resolves.toBe(true)
    expect(d.giveBack).toHaveBeenCalledOnce()
  })
})

describe('free answer display', () => {
  const view = { ...freeState, included: true }
  it('keeps the free identity through response validation', () => {
    expect(readPlanAllowanceView(view)?.kind).toBe('free')
    expect(describeAnswerAllowance(view)).toBe('Free daily answer · 0 of 2 today')
    expect(describeAllowanceNote(view, 10)).toContain('2 of 2 free Chimmy answers left today')
  })
  it('offers AF Pro to a free account after the daily answers are used', () => {
    expect(describeOutOfAnswers({ ...view, included: false, used: 2 }).actions.map(a => a.label)).toContain('Get AF Pro')
    expect(describeOutOfAnswers({ ...view, included: false, used: 2 }, { inIosApp: true }).actions).toEqual([])
  })
})
