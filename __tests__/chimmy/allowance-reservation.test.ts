import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { readChimmyPlanAllowance, takeChimmyPlanAllowance, releaseChimmyPlanAllowance, planAllowanceMeta,
  type PlanAllowanceDeps } from '@/lib/chimmy/planAllowance'

function harness() {
  let now = new Date('2026-09-26T23:59:59Z')
  const counts = new Map<string, number>([['2026-09-26T00:00:00.000Z', 3]])
  const d: PlanAllowanceDeps = {
    now: () => now, limit: () => 100,
    hasChimmyPlan: async () => ({ included: true, planName: 'AF Pro' }),
    readUsed: async (_, w) => counts.get(w.windowStart.toISOString()) ?? 0,
    take: async (_, w, limit) => {
      const key = w.windowStart.toISOString(), used = counts.get(key) ?? 0
      if (used >= limit) return null
      counts.set(key, used + 1)
      return used + 1
    },
    giveBack: vi.fn(async (_: string, w: { windowStart: Date; windowEnd: Date }) => {
      const key = w.windowStart.toISOString(), used = counts.get(key) ?? 0
      if (!used) return false
      counts.set(key, used - 1)
      return true
    }),
  }
  const reserve = async () => takeChimmyPlanAllowance({ userId: 'u1',
    state: (await readChimmyPlanAllowance({ userId: 'u1' }, d))! }, d)
  return { d, counts, reserve, tomorrow: () => { now = new Date('2026-09-27T00:00:01Z') } }
}

describe('allowance reservation cleanup', () => {
  it('refunds yesterday after midnight without touching a new-day answer', async () => {
    const h = harness(), yesterday = (await h.reserve())!
    h.tomorrow()
    await h.reserve()
    expect(await releaseChimmyPlanAllowance({ userId: 'u1', state: yesterday }, h.d)).toBe(true)
    expect([...h.counts.values()]).toEqual([3, 1])
  })

  it('takes the new day when a previously read view crosses midnight', async () => {
    const h = harness(), view = (await readChimmyPlanAllowance({ userId: 'u1' }, h.d))!
    h.tomorrow()
    const taken = (await takeChimmyPlanAllowance({ userId: 'u1', state: view }, h.d))!
    expect(taken).toMatchObject({ used: 1, remaining: 99, resetsAt: '2026-09-28T00:00:00.000Z' })
    expect(planAllowanceMeta(taken, true)).toEqual({ included: true, planName: 'AF Pro', used: 1, limit: 100,
      resetsAt: '2026-09-28T00:00:00.000Z' })
  })

  it('does not subtract another answer after a failed take', async () => {
    const h = harness()
    h.d.take = async () => { throw new Error('database unavailable') }
    const taken = (await h.reserve())!
    expect(await releaseChimmyPlanAllowance({ userId: 'u1', state: taken }, h.d)).toBe(false)
    expect(h.d.giveBack).not.toHaveBeenCalled()
    expect([...h.counts.values()]).toEqual([3])
  })

  it('shares concurrent and repeated cleanup of one reservation', async () => {
    const h = harness(), taken = (await h.reserve())!
    const release = () => releaseChimmyPlanAllowance({ userId: 'u1', state: taken }, h.d)
    expect(await Promise.all([release(), release(), release()])).toEqual([true, true, true])
    expect(await release()).toBe(true)
    expect(h.d.giveBack).toHaveBeenCalledTimes(1)
    expect([...h.counts.values()]).toEqual([3])
  })

  it('rejects a read-only, copied or differently owned receipt', async () => {
    const h = harness(), view = (await readChimmyPlanAllowance({ userId: 'u1' }, h.d))!
    const taken = (await h.reserve())!
    for (const args of [{ userId: 'u1', state: view }, { userId: 'u1', state: { ...taken } },
      { userId: 'other-user', state: taken }]) {
      expect(await releaseChimmyPlanAllowance(args, h.d)).toBe(false)
    }
    expect(h.d.giveBack).not.toHaveBeenCalled()
  })

  it('does not retry an ambiguous failed decrement and refund twice', async () => {
    const h = harness(), taken = (await h.reserve())!
    vi.mocked(h.d.giveBack).mockImplementationOnce(async (_, w) => {
      const key = w.windowStart.toISOString()
      h.counts.set(key, h.counts.get(key)! - 1)
      throw new Error('connection lost after commit')
    })
    const args = { userId: 'u1', state: taken }
    expect(await releaseChimmyPlanAllowance(args, h.d)).toBe(false)
    expect(await releaseChimmyPlanAllowance(args, h.d)).toBe(false)
    expect(h.d.giveBack).toHaveBeenCalledTimes(1)
    expect([...h.counts.values()]).toEqual([3])
  })
})
