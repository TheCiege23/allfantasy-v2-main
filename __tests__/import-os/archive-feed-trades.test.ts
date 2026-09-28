/**
 * 🛑 A just-accepted Sleeper trade reached the live screens in minutes and the ARCHIVE — /core Trades'
 * grade list, the cross-league board, Chimmy's history — hours to a day later (2026-09-25). The
 * reconcile read that notices the trade now writes it to the archive from the same feed row.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/dynasty-import/normalize-historical', () => ({ persistTradesForSeason: vi.fn() }))
vi.mock('@/lib/trade-intel/sleeperTradeSync', () => ({ fetchLeagueRosters: vi.fn() }))

import { archiveCompletedFeedTrades, feedTradeToFact } from '@/lib/import-os/collector/archiveFeedTrades'
import type { FeedTrade } from '@/lib/trade-intel/sleeperTradeSync'

const completed: FeedTrade = {
  id: 'tx-1',
  status: 'complete',
  week: 3,
  rosterIds: [1, 2],
  creator: 'user-a',
  createdMs: 1_758_800_000_000,
  tx: {
    adds: { '4984': 1, '10218': 2 } as unknown as Record<string, number>,
    drops: { '4984': 2, '10218': 1 } as unknown as Record<string, number>,
    draft_picks: [{ season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 }] as never,
  },
}
const pending: FeedTrade = { ...completed, id: 'tx-2', status: 'pending' }

describe('feedTradeToFact', () => {
  it('maps a completed feed row into the archive’s shape — roster ids as strings, week kept', () => {
    expect(feedTradeToFact(completed, 2026)).toEqual({
      transactionId: 'tx-1',
      season: 2026,
      week: 3,
      rosterIds: ['1', '2'],
      adds: { '4984': '1', '10218': '2' },
      drops: { '4984': '2', '10218': '1' },
      draftPicks: [{ season: '2027', round: 1, rosterId: '2', previousOwnerId: '2', ownerId: '1' }],
      created: 1_758_800_000_000,
      creator: 'user-a',
    })
  })

  it('🛑 never maps a trade that did not happen', () => {
    expect(feedTradeToFact(pending, 2026)).toBeNull()
  })

  it('an unknown week is the archive’s 0 sentinel', () => {
    expect(feedTradeToFact({ ...completed, week: undefined }, 2026)?.week).toBe(0)
  })
})

describe('archiveCompletedFeedTrades', () => {
  const deps = () => ({
    seasonOf: vi.fn(async () => 2026),
    rostersOf: vi.fn(async () => [
      { roster_id: 1, owner_id: 'owner-a' },
      { roster_id: 2, owner_id: 'owner-b' },
      { roster_id: 3, owner_id: null },
    ]),
    persist: vi.fn(async () => 2),
  })

  it('writes only the completed trades, under the league row’s season, joined to owners', async () => {
    const d = deps()
    const out = await archiveCompletedFeedTrades({ sleeperLeagueId: 'SL1', feed: [completed, pending] }, d)
    expect(out).toEqual({ written: 2, trades: 1 })
    expect(d.persist).toHaveBeenCalledTimes(1)
    const [leagueId, season, facts, owners] = d.persist.mock.calls[0] as unknown as [string, number, Array<{ transactionId: string }>, Map<string, string>]
    expect([leagueId, season]).toEqual(['SL1', 2026])
    expect(facts.map((f) => f.transactionId)).toEqual(['tx-1'])
    expect([...owners.entries()]).toEqual([
      ['1', 'owner-a'],
      ['2', 'owner-b'],
    ])
  })

  it('does nothing — no read, no write — when nothing in the feed completed', async () => {
    const d = deps()
    expect(await archiveCompletedFeedTrades({ sleeperLeagueId: 'SL1', feed: [pending] }, d)).toEqual({
      written: 0,
      skipped: 'no-completed-trades',
    })
    expect(d.seasonOf).not.toHaveBeenCalled()
    expect(d.persist).not.toHaveBeenCalled()
  })

  it('skips a league with no imported row, and one whose rosters could not be read', async () => {
    const d1 = { ...deps(), seasonOf: vi.fn(async () => null) }
    expect(await archiveCompletedFeedTrades({ sleeperLeagueId: 'SL1', feed: [completed] }, d1)).toMatchObject({ skipped: 'no-league-row' })
    const d2 = { ...deps(), rostersOf: vi.fn(async () => null) }
    expect(await archiveCompletedFeedTrades({ sleeperLeagueId: 'SL1', feed: [completed] }, d2)).toMatchObject({ skipped: 'no-rosters' })
    expect(d1.persist).not.toHaveBeenCalled()
    expect(d2.persist).not.toHaveBeenCalled()
  })

  it('never throws — a failed write is reported, not raised into the read that triggered it', async () => {
    const d = { ...deps(), persist: vi.fn(async () => { throw new Error('db down') }) }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await archiveCompletedFeedTrades({ sleeperLeagueId: 'SL1', feed: [completed] }, d)).toEqual({ written: 0, skipped: 'failed' })
    warn.mockRestore()
  })
})
