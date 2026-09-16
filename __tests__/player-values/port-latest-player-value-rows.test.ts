/**
 * The trade evaluator's value read now goes through the newest-row helper. What must NOT change is
 * the row shape the enrichment sees — exactly the fields the old `select` returned.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadLatest = vi.fn()
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({
  loadLatestPlayerValueSnapshots: (...args: unknown[]) => loadLatest(...args),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { loadPlayerValueRows } from '@/lib/decision-os/world/port'

const ROW = {
  sleeperId: '4046',
  name: 'Patrick Mahomes',
  position: 'QB',
  source: 'FANTASYCALC',
  format: 'DYNASTY',
  qbFormat: 'SUPERFLEX',
  value: 7400,
  overallRank: 12,
  positionRank: 3,
  trend30d: -40,
  tradeFrequency: 0.8,
  marketStdDev: 310,
  capturedAt: new Date('2026-09-15T10:00:00Z'),
}

describe('loadPlayerValueRows', () => {
  /*
   * ⚠ BRACES, NOT AN EXPRESSION BODY. `mockReset()` returns the mock, and a FUNCTION returned from
   * `beforeEach` is run by vitest as that test's cleanup — so `() => loadLatest.mockReset()` called
   * the mock after every test, and after the throwing test that failed it with "connection reset".
   */
  beforeEach(() => {
    loadLatest.mockReset()
  })

  it('asks for the FantasyCalc book only, with a cleaned, capped id list', async () => {
    loadLatest.mockResolvedValue([])
    const ids = ['', 'a', 'a', ...Array.from({ length: 250 }, (_, i) => `p${i}`)]
    await loadPlayerValueRows(ids, 'DYNASTY', 'SUPERFLEX')

    const args = loadLatest.mock.calls[0]![0] as { sleeperIds: string[]; source: string; format: string; qbFormat: string }
    expect(args.source).toBe('FANTASYCALC')
    expect(args.format).toBe('DYNASTY')
    expect(args.qbFormat).toBe('SUPERFLEX')
    expect(args.sleeperIds).toHaveLength(200)
    expect(args.sleeperIds[0]).toBe('a')
    expect(args.sleeperIds).not.toContain('')
  })

  it('returns exactly the fields the old select did — no name, position or marketStdDev', async () => {
    loadLatest.mockResolvedValue([ROW])
    const out = await loadPlayerValueRows(['4046'], 'DYNASTY', 'SUPERFLEX')
    expect(out).toEqual([
      {
        sleeperId: '4046',
        source: 'FANTASYCALC',
        format: 'DYNASTY',
        qbFormat: 'SUPERFLEX',
        value: 7400,
        overallRank: 12,
        positionRank: 3,
        tradeFrequency: 0.8,
        trend30d: -40,
        capturedAt: ROW.capturedAt,
      },
    ])
  })

  it('degrades to no rows when the read fails, as the old `.catch(() => [])` did', async () => {
    loadLatest.mockRejectedValue(new Error('connection reset'))
    await expect(loadPlayerValueRows(['4046'], 'DYNASTY', 'SUPERFLEX')).resolves.toEqual([])
  })

  it('skips the read entirely for no ids', async () => {
    await expect(loadPlayerValueRows(['', ''], 'DYNASTY', 'SUPERFLEX')).resolves.toEqual([])
    expect(loadLatest).not.toHaveBeenCalled()
  })
})
