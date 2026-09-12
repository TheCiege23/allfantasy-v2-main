import { describe, expect, it, vi, beforeEach } from 'vitest'

const upsert = vi.fn((args: unknown) => args)
const leagueFindFirst = vi.fn(async () => ({ sport: 'NFL' }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...a: unknown[]) => leagueFindFirst(...(a as [])) },
    rankingsSnapshot: { upsert: (...a: unknown[]) => upsert(a[0]) },
    $transaction: async (ops: unknown[]) => ops,
  },
}))

import { saveRankingsSnapshot } from '@/lib/rankings-engine/snapshots'

type UpsertArgs = { update: Record<string, unknown>; create: Record<string, unknown> }

beforeEach(() => { upsert.mockClear(); leagueFindFirst.mockClear() })

async function writeOnce() {
  await saveRankingsSnapshot({
    leagueId: 'L1',
    season: '2026',
    week: 1,
    teams: [
      { rosterId: '1', rank: 1, composite: 90 },
      { rosterId: '2', rank: 2, composite: 80 },
    ],
  })
  return upsert.mock.calls.map((c) => c[0] as unknown as UpsertArgs)
}

describe('the snapshot writer stamps when it wrote, not when it first wrote', () => {
  /*
   * 🛑 THE REGRESSION THIS PINS, AND IT WAS LIVE IN PRODUCTION.
   *
   * `RankingsSnapshot` has `createdAt @default(now())` and NO `@updatedAt`. This writer UPSERTS,
   * and the `update` branch did not touch `createdAt` — so once a league had been snapshotted for
   * a (season, week), its newest `createdAt` never advanced again.
   *
   * Every consumer of that column reads it as "when did we last write one":
   *   - `rankingsSweep` due-ness  — `orderBy: { createdAt: 'desc' }` against an 18h TTL
   *   - `api-health-monitor`      — `orderBy: [{ createdAt: 'desc' }]`, a freshness probe
   * Not one reads it as "when was this row first created". So a frozen `createdAt` made the sweep's
   * TTL stop suppressing re-work after 18h (every snapshotted league permanently due) and made the
   * health probe report a stale age for data that was refreshed minutes ago.
   */
  it('sets createdAt on the UPDATE branch, not only on create', async () => {
    const calls = await writeOnce()
    expect(calls).toHaveLength(2)
    for (const c of calls) {
      expect(c.update).toHaveProperty('createdAt')
      expect(c.update.createdAt).toBeInstanceOf(Date)
    }
  })

  /*
   * One snapshot is one instant. Per-row `new Date()` would scatter the rows of a single write
   * across milliseconds, which makes `max(createdAt)` answer a slightly different question per
   * roster and makes an equality assertion in any consumer flaky.
   */
  it('stamps every roster in one write with the SAME instant', async () => {
    const calls = await writeOnce()
    const updated = calls.map((c) => (c.update.createdAt as Date).getTime())
    const created = calls.map((c) => (c.create.createdAt as Date).getTime())
    expect(new Set(updated).size).toBe(1)
    expect(new Set(created).size).toBe(1)
    expect(updated[0]).toBe(created[0])
  })

  it('still writes the ranking payload it always did', async () => {
    const calls = await writeOnce()
    expect(calls[0].update).toMatchObject({ rank: 1, composite: 90, sportType: 'NFL' })
    expect(calls[0].create).toMatchObject({ leagueId: 'L1', season: '2026', week: 1, rosterId: '1' })
  })
})
