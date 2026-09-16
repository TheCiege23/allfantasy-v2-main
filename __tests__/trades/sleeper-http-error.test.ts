import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE TYPED STATUS HAS TO COME FROM `sleeperGet`, AND NOTHING WAS CHECKING THAT.
 *
 * `scanPendingSleeperTrades` decides `unscannedKind: 'identity' | 'provider'` from
 * `err instanceof SleeperHttpError && err.status`, and a permanent 404 classified as transient
 * pins /core's "since your last visit" trade boundary at the 7-day floor forever.
 *
 * ⚠ ITS OWN TESTS CANNOT SEE A REGRESSION HERE, measured: they construct the error themselves
 * (`mockRejectedValue(new SleeperHttpError(404, …))`), so reverting `sleeperGet` to a plain
 * `new Error(...)` left every one of them GREEN. This pins the other half — that the cache layer
 * actually produces the typed error a real 404 would carry.
 */

const prismaFindUnique = vi.hoisted(() => vi.fn(async () => null))
const prismaUpsert = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findUnique: prismaFindUnique, upsert: prismaUpsert } },
}))

import { SleeperHttpError, getLeagueRosters } from '@/lib/api-cache/SleeperCacheLayer'

const realFetch = globalThis.fetch

beforeEach(() => {
  prismaFindUnique.mockClear()
  prismaUpsert.mockClear()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('sleeperGet surfaces the HTTP status as a typed error', () => {
  it.each([
    [404, 'a league that no longer exists'],
    [429, 'a rate limit'],
    [503, 'a provider fault'],
  ])('throws SleeperHttpError carrying %i (%s)', async (status) => {
    globalThis.fetch = vi.fn(async () => new Response('', { status })) as unknown as typeof fetch

    /*
     * A unique league id per case: `cachedFetch` keeps a process-wide memory cache and an
     * in-flight map keyed by `rosters:<id>`, so reusing one id would let a later case be served
     * by an earlier one and assert nothing.
     */
    const err = await getLeagueRosters(`no-such-league-${status}`).then(
      () => null,
      (e: unknown) => e,
    )

    expect(err, 'the failure reached the caller rather than being swallowed').toBeInstanceOf(SleeperHttpError)
    expect((err as SleeperHttpError).status).toBe(status)
    // The message keeps it too, for logs — but nothing should have to parse it back out.
    expect((err as Error).message).toContain(String(status))
  })

  it('[control] a 200 resolves, so the cases above are not passing because every call throws', async () => {
    globalThis.fetch = vi.fn(async () => Response.json([{ roster_id: 1 }])) as unknown as typeof fetch
    await expect(getLeagueRosters('a-real-league')).resolves.toEqual([{ roster_id: 1 }])
  })
})
