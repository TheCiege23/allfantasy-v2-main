// @vitest-environment node
/**
 * Auction bid history, server half: an ACCEPTED bid is filed in `auction_bids`, a rejected one is
 * not, and a missing table (the migration ships separately) never fails or blocks the bid. The log
 * line on failure carries the league id and error code only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ session: vi.fn(), create: vi.fn(), findMany: vi.fn(), archive: vi.fn(), log: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { draftSession: { findFirst: m.session }, auctionBid: { create: m.create, findMany: m.findMany } },
}))
vi.mock('@/lib/logging/structured', () => ({ logStructured: m.log }))
vi.mock('@/lib/draft/draftLock', () => ({ withAuctionLock: async (_id: string, run: () => Promise<unknown>) => ({ acquired: true, value: await run() }) }))
vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({ loadSeasonDraftContext: async () => null, validateSeasonDraftPlayer: async () => null }))
vi.mock('@/lib/tournament/seasonDraftRefresh', () => ({ prepareSeasonDraftPool: async () => null }))
vi.mock('@/lib/tournament/seasonDraftCompletion', () => ({ completeSeasonDraft: vi.fn() }))
vi.mock('@/lib/league/league-roster-draft-gate', () => ({ isLeagueRosterDraftReady: async () => true }))
vi.mock('@/lib/draft-archive/events', () => ({ recordArchiveEvent: vi.fn(), updateSessionWithArchive: m.archive, json: (value: unknown) => value }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: async () => null }))

import { placeBid } from '@/lib/live-draft-engine/auction/AuctionEngine'
import { listAuctionBids } from '@/lib/live-draft-engine/auction/auctionBidLog'

function liveSession() {
  return {
    id: 'session-1',
    leagueId: 'league-1',
    version: 4,
    draftType: 'auction',
    status: 'in_progress',
    teamCount: 2,
    rounds: 3,
    timerSeconds: 30,
    timerEndAt: new Date(Date.now() + 60_000),
    playerPool: 'all',
    slotOrder: [{ slot: 1, rosterId: 'r-a', displayName: 'A' }, { slot: 2, rosterId: 'r-b', displayName: 'B' }],
    auctionBudgetPerTeam: 200,
    auctionBudgets: { 'r-a': 200, 'r-b': 200 },
    auctionState: {
      nominationOrderIndex: 0,
      currentNomination: { playerName: 'Bijan Robinson', position: 'RB', playerId: 'p-9', team: 'ATL' },
      currentBid: 10,
      currentBidderRosterId: 'r-a',
    },
    picks: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue(liveSession())
  m.archive.mockResolvedValue({})
  m.create.mockResolvedValue({ id: 'bid-1' })
})

describe('accepted bids are filed', () => {
  it('writes one row for an accepted bid, after the bid is saved', async () => {
    const result = await placeBid('league-1', 'r-b', 12)
    expect(result).toEqual({ success: true })
    expect(m.archive).toHaveBeenCalledTimes(1)
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.create).toHaveBeenCalledWith({
      data: {
        draftSessionId: 'session-1',
        leagueId: 'league-1',
        playerKey: 'id:p-9',
        playerId: 'p-9',
        playerName: 'Bijan Robinson',
        rosterId: 'r-b',
        amount: 12,
      },
    })
    expect(m.archive.mock.invocationCallOrder[0]).toBeLessThan(m.create.mock.invocationCallOrder[0])
  })

  it('writes nothing for a rejected bid (below the minimum)', async () => {
    const result = await placeBid('league-1', 'r-b', 5)
    expect(result.success).toBe(false)
    expect(m.create).not.toHaveBeenCalled()
  })

  it('writes nothing when the save loses a race (P2025)', async () => {
    m.archive.mockRejectedValueOnce(Object.assign(new Error('stale'), { code: 'P2025' }))
    const result = await placeBid('league-1', 'r-b', 12)
    expect(result.success).toBe(false)
    expect(m.create).not.toHaveBeenCalled()
  })
})

describe('the table not existing yet', () => {
  it('does not fail or block the bid, and logs only league id and code', async () => {
    m.create.mockRejectedValue(Object.assign(new Error('The table `public.auction_bids` does not exist in the current database.'), { code: 'P2021' }))
    const result = await placeBid('league-1', 'r-b', 12)
    expect(result).toEqual({ success: true })
    expect(m.create).toHaveBeenCalledTimes(1)
    const warns = m.log.mock.calls.filter((c) => c[1] === 'auction_bid_log')
    expect(warns.length).toBe(1)
    for (const call of warns) {
      expect(call[3]).toEqual({ leagueId: 'league-1', code: 'P2021' })
      expect(JSON.stringify(call)).not.toMatch(/r-b|Bijan|auction_bids|12/)
    }
  })

  it('reads an empty history rather than throwing', async () => {
    m.findMany.mockRejectedValue(Object.assign(new Error('missing'), { code: 'P2021' }))
    await expect(listAuctionBids('session-1', 'league-1')).resolves.toEqual([])
  })
})
