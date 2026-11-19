/**
 * GET /api/advice-record — the platform-wide record the advice surfaces show beside their call. Counts only:
 * no user's own calls ever leave it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/chimmy-outcomes/learningStore', () => ({ readAdviceLearningSnapshot: m.read }))

import { GET } from '@/app/api/advice-record/route'

beforeEach(() => m.read.mockReset())

describe('GET /api/advice-record', () => {
  it('returns the everyone view with no per-user lines', async () => {
    m.read.mockResolvedValue({
      ledger: {
        season: 2026,
        throughWeek: 10,
        bench: { right: 21, wrong: 9, same: 0, gain: 30, pending: 0, unscored: 0, withdrawn: 0 },
        pickups: { graded: 40, startable: 18, vsDrop: 0, beatDrop: 0, lostDrop: 0, pending: 0, noStats: 0 },
        trades: { byLetter: { A: { n: 20, netPerWeek: 2, ahead: 14, behind: 6 } }, pending: 0, unscored: 0, read: 20, gradable: 20 },
        users: { someone: { b: [9, 1, 0], p: [6, 5] } },
      },
    })
    const res = await GET()
    const body = await res.json()
    expect(body.record.bench.you).toBeNull()
    expect(body.record.pickups.you).toBeNull()
    expect(body.record.bench.everyone.ratePct).toBe(70)
    expect(body.record.trades).toEqual([{ letter: 'A', n: 20, netPerWeek: 2, aheadPct: 70 }])
    expect(JSON.stringify(body)).not.toContain('someone')
    expect(res.headers.get('cache-control')).toContain('s-maxage')
  })

  it('no snapshot, or none with a ledger, is a null record — not an error', async () => {
    m.read.mockResolvedValue(null)
    expect(await (await GET()).json()).toEqual({ record: null })
    m.read.mockResolvedValue({ computedAt: 'x' })
    expect(await (await GET()).json()).toEqual({ record: null })
  })
})
