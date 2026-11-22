/**
 * The roster value grade reaches Chimmy without ever being the packet's critical path (2026-11-16, re-score
 * item 8): a cached grade is served at once; a miss starts ONE background compute and says so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  clearRosterValueGradeCache,
  loadRosterValueGradeSliceCached,
  settleRosterValueGradeComputes,
} from '@/lib/decision-os/grounding/rosterValueGradeSlice'

const graded = { present: true, value: { letter: 'B' }, asOf: '2026-11-16', servedFrom: 'live', confidence: null, conclusive: { ok: true }, gap: null } as never
const failed = { present: false, value: null, gap: { reason: 'not_computed', detail: 'x', remedy: 'y' } } as never

let t = 0
const now = () => t
beforeEach(() => {
  clearRosterValueGradeCache()
  t = 1_000_000
})

describe('loadRosterValueGradeSliceCached', () => {
  it('a miss returns at once with a "being computed" gap, and computes in the background', async () => {
    let release!: () => void
    const compute = vi.fn(() => new Promise<never>((resolve) => { release = () => resolve(graded as never) }))
    const first = await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    expect(first.present).toBe(false)
    expect(first.gap?.detail).toContain('being computed now; it is included from the next question')
    expect(compute).toHaveBeenCalledTimes(1)

    // A second ask while it computes does not start another.
    await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    expect(compute).toHaveBeenCalledTimes(1)

    release()
    await settleRosterValueGradeComputes()
    const next = await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    expect(next).toBe(graded)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('caches per league AND user — another manager is not handed this grade', async () => {
    const compute = vi.fn(async () => graded)
    await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    await settleRosterValueGradeComputes()
    const other = await loadRosterValueGradeSliceCached({ userId: 'someone-else', leagueId: 'L' }, { compute, now })
    expect(other.present).toBe(false)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('never caches a failed or withheld grade', async () => {
    const compute = vi.fn(async () => failed)
    await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    await settleRosterValueGradeComputes()
    await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('after 15 minutes serves the stale grade once while a fresh one computes', async () => {
    const compute = vi.fn(async () => graded)
    await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    await settleRosterValueGradeComputes()
    t += 16 * 60 * 1000
    const stale = await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    expect(stale).toBe(graded)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('a compute that throws leaves no stuck in-flight entry', async () => {
    const compute = vi.fn(async () => { throw new Error('db down') })
    await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    await settleRosterValueGradeComputes()
    await loadRosterValueGradeSliceCached({ userId: 'u', leagueId: 'L' }, { compute, now })
    expect(compute).toHaveBeenCalledTimes(2)
  })
})
