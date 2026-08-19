import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The capture stamp is what makes a re-run safe.
 *
 * `capturedAt` used to be `new Date()`, so the unique key
 * (sleeperId, source, format, qbFormat, capturedAt) could never collide between runs and
 * `skipDuplicates` never fired. A cron retry, or a human running the CLI on a day the
 * cron already covered, appended a whole second series for that day — which then
 * double-counts in anything averaging across dates.
 *
 * These assert the stamp through the public return value. Every combo is made to fail so
 * no write is attempted, which keeps the test honest about what it covers: the filing
 * date and the failure reporting, not the persistence.
 */
const createMany = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: { playerValueSnapshot: { createMany: (...a: unknown[]) => createMany(...a) } },
}))

import { ingestPlayerValues } from '@/lib/player-values/ingestPlayerValues'

const originalFetch = globalThis.fetch

beforeEach(() => {
  createMany.mockReset()
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as never
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('player value capture: filed by UTC day, not by clock time', () => {
  it('files a late-evening run under that same UTC day', async () => {
    const r = await ingestPlayerValues(new Date('2026-08-19T23:59:59.000Z'))
    expect(r.capturedAt).toBe('2026-08-19')
  })

  it('files a just-after-midnight run under the new day', async () => {
    const r = await ingestPlayerValues(new Date('2026-08-20T00:00:01.000Z'))
    expect(r.capturedAt).toBe('2026-08-20')
  })

  it('two runs on the same UTC day agree on the stamp, so skipDuplicates can fire', async () => {
    const morning = await ingestPlayerValues(new Date('2026-08-19T06:00:00.000Z'))
    const evening = await ingestPlayerValues(new Date('2026-08-19T21:30:00.000Z'))
    expect(morning.capturedAt).toBe(evening.capturedAt)
  })
})

describe('player value capture: a failure is reported, never swallowed', () => {
  it('marks the run partial and names why each combo was skipped', async () => {
    const r = await ingestPlayerValues(new Date('2026-08-19T10:00:00.000Z'))
    expect(r.partial).toBe(true)
    expect(r.stored).toBe(0)
    expect(r.combos).toHaveLength(4)
    for (const c of r.combos) expect(c.skipped).toContain('network down')
  })

  it('attempts no write when every combo fails', async () => {
    await ingestPlayerValues(new Date('2026-08-19T10:00:00.000Z'))
    expect(createMany).not.toHaveBeenCalled()
  })

  it('a non-ok response is skipped with its status, not thrown', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as never
    const r = await ingestPlayerValues(new Date('2026-08-19T10:00:00.000Z'))
    expect(r.partial).toBe(true)
    for (const c of r.combos) expect(c.skipped).toBe('HTTP 429')
    expect(createMany).not.toHaveBeenCalled()
  })

  it('covers all four format/qbFormat combos', async () => {
    const r = await ingestPlayerValues(new Date('2026-08-19T10:00:00.000Z'))
    const seen = r.combos.map((c) => `${c.format}/${c.qbFormat}`).sort()
    expect(seen).toEqual([
      'DYNASTY/ONE_QB',
      'DYNASTY/SUPERFLEX',
      'REDRAFT/ONE_QB',
      'REDRAFT/SUPERFLEX',
    ])
  })
})
