/**
 * The legacy `api_sports` expiry inside the Rolling Insights ingest.
 *
 * 🛑 WHY THIS EXISTS. That clause retires rows left behind by the dead Free-plan API-Sports feed,
 * and it originally matched on `source: 'api_sports'` alone. That is correct for exactly as long
 * as nothing else writes that source — and the moment a paid API-Sports subscription is wired
 * back in, it becomes a deleter: RI writes NFL on every 30-minute run, so every fresh API-Sports
 * row would be expired within half an hour of being written.
 *
 * The failure is SILENT in every direction. The rows are still in the table, the API-Sports write
 * still reports success, the route still returns 200, and the read port simply drops them for
 * being expired. No error, no failing test, no red monitor — the exact shape this repo keeps
 * getting caught by. Nothing covered this block before; that is how it survived.
 *
 * So the assertion is on the WHERE CLAUSE, not on a row count: the query must carry a `fetchedAt`
 * upper bound, and that bound must sit in the past so live rows cannot match it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` factories are hoisted above ordinary consts, so the spies have to be too.
const { upsert, updateMany, riFetch } = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
  riFetch: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { sportsInjury: { upsert, updateMany } } }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetch }))

import { syncRollingInsightsInjuriesToDb } from '@/lib/injuries/rollingInsightsInjuries'

/** One team block with one parseable injury — enough for `written > 0`, which gates the expiry. */
const PAYLOAD = {
  data: {
    NFL: [
      {
        team: 'Buffalo Bills',
        team_id: 1,
        injuries: [
          {
            injury: 'Knee',
            player: 'Ty Johnson',
            returns: 'Questionable For Week 1 At Houston',
            player_id: '4434',
            date_injured: '2026-8-8',
          },
        ],
      },
    ],
  },
}

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({})
  updateMany.mockReset().mockResolvedValue({ count: 0 })
  riFetch.mockReset().mockResolvedValue({ ok: true, payload: PAYLOAD })
})

describe('legacy api_sports expiry', () => {
  it('runs only once RI actually landed rows', async () => {
    // A feed that returns nothing must not retire the only injury data AF has left.
    riFetch.mockResolvedValue({ ok: true, payload: { data: { NFL: [] } } })
    const res = await syncRollingInsightsInjuriesToDb({ sport: 'NFL' })

    expect(res.written).toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('scopes the expiry to rows fetched BEFORE the cutover', async () => {
    const res = await syncRollingInsightsInjuriesToDb({ sport: 'NFL' })
    expect(res.written).toBeGreaterThan(0)
    expect(updateMany).toHaveBeenCalledTimes(1)

    const where = updateMany.mock.calls[0]![0].where as {
      source: string
      fetchedAt?: { lt: Date }
    }

    expect(where.source).toBe('api_sports')

    /*
     * 🛑 THE ASSERTION THAT MATTERS. Without this bound the clause matches every `api_sports` row
     * regardless of age, which is the deleter described in the header.
     */
    expect(where.fetchedAt, 'expiry must be date-scoped or it deletes live rows').toBeDefined()
    expect(where.fetchedAt!.lt).toBeInstanceOf(Date)
  })

  it('cannot match a row a live subscription just wrote', async () => {
    await syncRollingInsightsInjuriesToDb({ sport: 'NFL' })

    const where = updateMany.mock.calls[0]![0].where as { fetchedAt: { lt: Date } }
    const cutover = where.fetchedAt.lt

    /*
     * The bound is a FIXED cutover, not a rolling window. A relative bound (`now - N days`) would
     * start expiring live rows again the moment the new feed paused for longer than N — silently,
     * which is the whole failure being prevented. So: strictly in the past, and a row written now
     * must fall outside it.
     */
    const aRowWrittenNow = new Date()
    expect(cutover.getTime()).toBeLessThan(aRowWrittenNow.getTime())
    expect(aRowWrittenNow < cutover).toBe(false)

    // And the frozen production rows (2026-07-24) must still be caught by it.
    expect(new Date('2026-07-24T10:30:00.000Z') < cutover).toBe(true)
  })
})
