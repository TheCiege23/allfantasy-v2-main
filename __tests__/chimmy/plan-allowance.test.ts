import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  create: vi.fn(),
  updateMany: vi.fn(),
  findFirst: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { apiRateLimitRecord: db } }))

import { Prisma } from '@prisma/client'
import {
  readChimmyPlanAllowance,
  releaseChimmyPlanAllowance,
  takeChimmyPlanAllowance,
  type PlanAllowanceDeps,
} from '@/lib/chimmy/planAllowance'
import { CHIMMY_PLAN_DAILY_INCLUDED } from '@/lib/chimmy/planAllowanceView'

/**
 * AF Pro includes Chimmy, 100 answers a day, tokens after (owner's decision 2026-09-24). These pin
 * who is included, that the count cannot overshoot, and which way each failure falls.
 */

const NOW = new Date('2026-09-24T18:30:00.000Z')

const deps = (over: Partial<PlanAllowanceDeps> = {}): PlanAllowanceDeps => ({
  hasChimmyPlan: vi.fn(async () => ({ included: true, planName: 'AF Pro' })),
  readUsed: vi.fn(async () => 37),
  take: vi.fn(async () => 38),
  giveBack: vi.fn(async () => {}),
  now: () => NOW,
  limit: () => 100,
  ...over,
})

describe('readChimmyPlanAllowance', () => {
  it('reports the plan, what is used and what is left, resetting at the next UTC midnight', async () => {
    expect(await readChimmyPlanAllowance({ userId: 'u1' }, deps())).toEqual({
      planName: 'AF Pro',
      limit: 100,
      used: 37,
      remaining: 63,
      resetsAt: '2026-09-25T00:00:00.000Z',
    })
  })

  it('is null for a plan without Chimmy — and never reads the counter', async () => {
    const d = deps({ hasChimmyPlan: vi.fn(async () => ({ included: false, planName: 'AF Pro' })) })
    expect(await readChimmyPlanAllowance({ userId: 'u1' }, d)).toBeNull()
    expect(d.readUsed).not.toHaveBeenCalled()
  })

  /* Never "included" on a guess: an unprovable plan keeps the token path. */
  it('is null when the plan cannot be established', async () => {
    const d = deps({ hasChimmyPlan: vi.fn(async () => { throw new Error('db down') }) })
    expect(await readChimmyPlanAllowance({ userId: 'u1' }, d)).toBeNull()
  })

  /* A proven subscriber is not billed because our own counter hiccuped. */
  it('reads a failed counter as nothing used, for a proven plan', async () => {
    const d = deps({ readUsed: vi.fn(async () => { throw new Error('db down') }) })
    expect(await readChimmyPlanAllowance({ userId: 'u1' }, d)).toMatchObject({ used: 0, remaining: 100 })
  })

  it('reports none left at the limit', async () => {
    const d = deps({ readUsed: vi.fn(async () => 100) })
    expect(await readChimmyPlanAllowance({ userId: 'u1' }, d)).toMatchObject({ used: 100, remaining: 0 })
  })

  it('never keys the counter on the raw user id', async () => {
    const d = deps()
    await readChimmyPlanAllowance({ userId: 'user-cuid-123' }, d)
    const endpoint = (d.readUsed as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(endpoint).toMatch(/^chimmy_plan:[0-9a-f]{20}$/)
    expect(endpoint).not.toContain('user-cuid-123')
  })
})

describe('takeChimmyPlanAllowance', () => {
  const state = { planName: 'AF Pro', limit: 100, used: 37, remaining: 63, resetsAt: '2026-09-25T00:00:00.000Z' }

  it('returns the updated count', async () => {
    expect(await takeChimmyPlanAllowance({ userId: 'u1', state }, deps())).toMatchObject({ used: 38, remaining: 62 })
  })

  it('returns null when another request took the last one — the caller falls back to tokens', async () => {
    expect(await takeChimmyPlanAllowance({ userId: 'u1', state }, deps({ take: vi.fn(async () => null) }))).toBeNull()
  })

  it('fails OPEN for a proven subscriber when the counter cannot be written', async () => {
    const out = await takeChimmyPlanAllowance({ userId: 'u1', state }, deps({ take: vi.fn(async () => { throw new Error('x') }) }))
    expect(out).toMatchObject({ used: 37 })
  })
})

describe('releaseChimmyPlanAllowance', () => {
  it('gives one back and never throws', async () => {
    const d = deps({ giveBack: vi.fn(async () => { throw new Error('x') }) })
    await expect(releaseChimmyPlanAllowance({ userId: 'u1' }, d)).resolves.toBeUndefined()
    expect(d.giveBack).toHaveBeenCalledTimes(1)
  })
})

/*
 * 🛑 THE REAL COUNTER, AGAINST A DOUBLED PRISMA. The injected `take` above proves the callers; this
 * proves the default one is create-then-CONDITIONAL-increment, which is what stops two tabs at 99
 * from both being included.
 */
describe('the default counter', () => {
  const realDeps = async () => {
    const mod = await import('@/lib/chimmy/planAllowance')
    return mod
  }
  const state = { planName: 'AF Pro', limit: CHIMMY_PLAN_DAILY_INCLUDED, used: 99, remaining: 1, resetsAt: '' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates the day\'s row on the first answer', async () => {
    db.create.mockResolvedValue({})
    const { takeChimmyPlanAllowance: take } = await realDeps()
    expect(await take({ userId: 'u1', state: { ...state, used: 0, remaining: 100 } })).toMatchObject({ used: 1 })
    expect(db.create.mock.calls[0][0].data).toMatchObject({ provider: 'ai_daily', callsMade: 1, callsLimit: 100 })
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('increments only while under the limit, and reports the new count', async () => {
    db.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }))
    db.updateMany.mockResolvedValue({ count: 1 })
    db.findFirst.mockResolvedValue({ callsMade: 100 })
    const { takeChimmyPlanAllowance: take } = await realDeps()
    expect(await take({ userId: 'u1', state })).toMatchObject({ used: 100, remaining: 0 })
    expect(db.updateMany.mock.calls[0][0].where).toMatchObject({ callsMade: { lt: 100 } })
  })

  it('takes nothing once the limit is reached', async () => {
    db.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }))
    db.updateMany.mockResolvedValue({ count: 0 })
    const { takeChimmyPlanAllowance: take } = await realDeps()
    expect(await take({ userId: 'u1', state: { ...state, used: 100, remaining: 0 } })).toBeNull()
  })

  it('gives back only down to zero', async () => {
    db.updateMany.mockResolvedValue({ count: 1 })
    const { releaseChimmyPlanAllowance: release } = await realDeps()
    await release({ userId: 'u1' })
    expect(db.updateMany.mock.calls[0][0]).toMatchObject({
      where: { callsMade: { gt: 0 } },
      data: { callsMade: { decrement: 1 } },
    })
  })

  it('uses the one shared limit', () => {
    expect(CHIMMY_PLAN_DAILY_INCLUDED).toBe(100)
  })
})
