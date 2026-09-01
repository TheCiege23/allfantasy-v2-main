/**
 * The intra-run memo on `getLeagueTransactions`.
 *
 * ── ⚠ WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
 * `syncSleeperHistoricalBackfillAfterImport` walks the same 18 weeks of the same league twice in
 * one run: the transaction sibling writes `TransactionFact`, and `runDynastyBackfill` counts
 * trades for `SeasonResult`. Identical requests, different destinations, seconds apart.
 *
 * The memo collapses those without either caller knowing. Every assertion below is about the
 * NUMBER OF FETCHES, because that is the entire point — a test that only checked the returned
 * data would pass just as happily with the memo deleted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { getLeagueTransactions, __clearLeagueTransactionsMemo } from '@/lib/sleeper-client'

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

describe('getLeagueTransactions — intra-run memo', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    __clearLeagueTransactionsMemo()
  })
  afterEach(() => {
    __clearLeagueTransactionsMemo()
  })

  it('🛑 fetches a league-week ONCE across repeated callers', async () => {
    fetchMock.mockResolvedValue(ok([{ transaction_id: 't1', type: 'waiver' }]))

    const a = await getLeagueTransactions('lg-1', 3)
    const b = await getLeagueTransactions('lg-1', 3)

    expect(a).toEqual(b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keys on league AND week — neither alone', async () => {
    fetchMock.mockResolvedValue(ok([]))

    await getLeagueTransactions('lg-1', 3)
    await getLeagueTransactions('lg-1', 4) // same league, different week
    await getLeagueTransactions('lg-2', 3) // same week, different league

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('⚠ does NOT cache a failure — one blip must not become a minute of "no transactions"', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
    const first = await getLeagueTransactions('lg-1', 5)
    expect(first).toEqual([])

    // A cached empty here would report the league as having no transactions for a full minute,
    // which is the weather-geocode failure mode the root CLAUDE.md records.
    fetchMock.mockResolvedValueOnce(ok([{ transaction_id: 't9', type: 'trade' }]))
    const second = await getLeagueTransactions('lg-1', 5)
    expect(second).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches a genuinely empty week, which is a real answer', async () => {
    fetchMock.mockResolvedValue(ok([]))
    await getLeagueTransactions('lg-1', 6)
    await getLeagueTransactions('lg-1', 6)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still throws for a strict caller rather than serving a memo of nothing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as unknown as Response)
    await expect(getLeagueTransactions('lg-1', 7, { strict: true })).rejects.toThrow()
  })

  it('🛑 a strict caller is NEVER served from the memo, even when one is warm', async () => {
    /*
     * The regression this exists for, and it shipped in the first version of the memo.
     *
     * `strict` is how an importer tells a timed-out league from a genuinely empty one. Reading
     * the memo first meant a strict call whose fetch was failing returned cached data and never
     * threw — a dead feed counted as a clean import. Caught by the pre-existing
     * sleeper-client-fetch-timeout suite, not by this file: my own tests exercised the memo and
     * the strict path separately and never in that order.
     */
    fetchMock.mockResolvedValueOnce(ok([{ transaction_id: 'warm', type: 'trade' }]))
    await getLeagueTransactions('lg-9', 2) // warms the memo for lg-9:2
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await expect(getLeagueTransactions('lg-9', 2, { strict: true })).rejects.toThrow()
    // It went to the network rather than answering from the warm entry.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('the control: clearing the memo restores the fetch', async () => {
    // Without this, "called once" would also pass against a function that never fetches at all.
    fetchMock.mockResolvedValue(ok([]))
    await getLeagueTransactions('lg-1', 8)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    __clearLeagueTransactionsMemo()
    await getLeagueTransactions('lg-1', 8)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
