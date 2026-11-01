/** Orphan team auction — the pure rules (lib/orphan-auction/orphanAuction.ts). */
import { describe, expect, it } from 'vitest'
import {
  checkBids,
  isAuctionDue,
  isAuctionOpen,
  openNotice,
  readOrphanAuction,
  readOrphanAuctionBids,
  resolveOrphanAuction,
  resultNotice,
  type BidderAtClose,
  type OrphanAuction,
} from '@/lib/orphan-auction/orphanAuction'

const NOW = new Date('2026-10-27T12:00:00Z')

const auction = (over: Partial<OrphanAuction> = {}): OrphanAuction => ({
  id: 'A1',
  status: 'open',
  sourceRosterIds: ['orph'],
  sourceTeamNames: ['Ghost FC'],
  assets: [
    { id: 'p:orph:1', kind: 'player', sourceRosterId: 'orph', label: 'Star', playerId: '1' },
    { id: 'p:orph:2', kind: 'player', sourceRosterId: 'orph', label: 'Depth', playerId: '2' },
    { id: 'k:fdp:2027:1:orph', kind: 'pick', sourceRosterId: 'orph', label: '2027 1st round', pickId: 'fdp:2027:1:orph' },
  ],
  minBid: 1,
  openedAt: '2026-10-25T12:00:00Z',
  openedBy: 'comm',
  closesAt: '2026-10-28T12:00:00Z',
  ...over,
})

const bidder = (rosterId: string, bids: Record<string, number>, over: Partial<BidderAtClose> = {}): BidderAtClose => ({
  rosterId,
  bids,
  updatedAt: '2026-10-26T00:00:00Z',
  budget: 100,
  waiverPriority: 5,
  ...over,
})

describe('readers', () => {
  it('reads an auction only in a shape it knows', () => {
    expect(readOrphanAuction({ orphan_auction: auction() })?.id).toBe('A1')
    expect(readOrphanAuction({ orphan_auction: { ...auction(), status: 'paused' } })).toBeNull()
    expect(readOrphanAuction({ orphan_auction: { id: 'A1' } })).toBeNull()
    expect(readOrphanAuction(null)).toBeNull()
  })

  it("reads a team's bids for this auction only, keeping numbers", () => {
    const settings = { orphan_auction_bids: { auctionId: 'A1', bids: { a: 5, b: 'x', c: Number.NaN }, updatedAt: '2026-10-26T00:00:00Z' } }
    expect(readOrphanAuctionBids(settings, 'A1')).toEqual({ auctionId: 'A1', bids: { a: 5 }, updatedAt: '2026-10-26T00:00:00Z' })
    expect(readOrphanAuctionBids(settings, 'A2')).toBeNull()
  })

  it('is open before its closing time and due after it', () => {
    expect(isAuctionOpen(auction(), NOW)).toBe(true)
    expect(isAuctionDue(auction(), NOW)).toBe(false)
    const ended = auction({ closesAt: '2026-10-27T11:00:00Z' })
    expect(isAuctionOpen(ended, NOW)).toBe(false)
    expect(isAuctionDue(ended, NOW)).toBe(true)
    expect(isAuctionDue(auction({ status: 'closed', closesAt: '2026-10-27T11:00:00Z' }), NOW)).toBe(false)
  })
})

describe('checkBids', () => {
  const check = (raw: unknown, budget = 50, a = auction()) => checkBids({ auction: a, raw, budget, now: NOW })

  it('keeps whole-dollar bids on known assets and drops empty ones', () => {
    expect(check({ 'p:orph:1': 30, 'p:orph:2': '', 'k:fdp:2027:1:orph': '12' })).toEqual({ ok: true, bids: { 'p:orph:1': 30, 'k:fdp:2027:1:orph': 12 }, total: 42 })
  })

  it('reads 0 as no bid when there is a minimum, and as a bid when the minimum is $0', () => {
    expect(check({ 'p:orph:1': 0 })).toEqual({ ok: true, bids: {}, total: 0 })
    expect(check({ 'p:orph:1': 0 }, 50, auction({ minBid: 0 }))).toEqual({ ok: true, bids: { 'p:orph:1': 0 }, total: 0 })
  })

  it('refuses what the close could not honour', () => {
    expect(check({ nope: 5 })).toEqual({ ok: false, issue: 'UNKNOWN_ASSET', assetId: 'nope' })
    expect(check({ 'p:orph:1': 2.5 })).toMatchObject({ ok: false, issue: 'NOT_WHOLE_DOLLARS' })
    expect(check({ 'p:orph:1': -3 })).toMatchObject({ ok: false, issue: 'NOT_WHOLE_DOLLARS' })
    expect(check({ 'p:orph:1': 2 }, 50, auction({ minBid: 5 }))).toMatchObject({ ok: false, issue: 'BELOW_MIN_BID' })
    expect(check({ 'p:orph:1': 30, 'p:orph:2': 21 })).toEqual({ ok: false, issue: 'OVER_BUDGET' })
    expect(check({ 'p:orph:1': 50 })).toMatchObject({ ok: true, total: 50 })
  })

  it('refuses every bid once the closing time has passed', () => {
    expect(check({ 'p:orph:1': 1 }, 50, auction({ closesAt: '2026-10-27T11:59:59Z' }))).toEqual({ ok: false, issue: 'AUCTION_CLOSED' })
  })
})

describe('resolveOrphanAuction', () => {
  it('gives each asset to the highest bid', () => {
    const r = resolveOrphanAuction({
      auction: auction(),
      bidders: [bidder('a', { 'p:orph:1': 40, 'p:orph:2': 3 }), bidder('b', { 'p:orph:1': 41, 'k:fdp:2027:1:orph': 9 })],
    })
    expect(r.awards).toEqual([
      { assetId: 'p:orph:1', rosterId: 'b', amount: 41 },
      { assetId: 'p:orph:2', rosterId: 'a', amount: 3 },
      { assetId: 'k:fdp:2027:1:orph', rosterId: 'b', amount: 9 },
    ])
    expect(r.unsold).toEqual([])
  })

  it('breaks a tie on waiver priority (lower first), then on the earlier bid', () => {
    const tie = (a: Partial<BidderAtClose>, b: Partial<BidderAtClose>) =>
      resolveOrphanAuction({ auction: auction(), bidders: [bidder('a', { 'p:orph:1': 20 }, a), bidder('b', { 'p:orph:1': 20 }, b)] }).awards[0]!.rosterId
    expect(tie({ waiverPriority: 4 }, { waiverPriority: 2 })).toBe('b')
    expect(tie({ waiverPriority: 2 }, { waiverPriority: 4 })).toBe('a')
    expect(tie({ updatedAt: '2026-10-26T05:00:00Z' }, { updatedAt: '2026-10-26T01:00:00Z' })).toBe('b')
    expect(tie({ waiverPriority: null }, { waiverPriority: 9 })).toBe('b')
  })

  it('skips a win a team can no longer afford, so the asset goes to the next bid', () => {
    // a bid 60 + 50 when it had 110; it has 70 at close, so it keeps the 60 and loses the second.
    const r = resolveOrphanAuction({
      auction: auction(),
      bidders: [bidder('a', { 'p:orph:1': 60, 'p:orph:2': 50 }, { budget: 70 }), bidder('b', { 'p:orph:2': 10 })],
    })
    expect(r.awards).toEqual([
      { assetId: 'p:orph:1', rosterId: 'a', amount: 60 },
      { assetId: 'p:orph:2', rosterId: 'b', amount: 10 },
    ])
  })

  it('leaves an asset nobody bid on unsold, and ignores bids below the minimum, on unknown assets or from an orphan team', () => {
    const r = resolveOrphanAuction({
      auction: auction({ minBid: 5 }),
      bidders: [bidder('a', { 'p:orph:1': 4, ghost: 90 }), bidder('orph', { 'p:orph:2': 80 })],
    })
    expect(r.awards).toEqual([])
    expect(r.unsold).toEqual(['p:orph:1', 'p:orph:2', 'k:fdp:2027:1:orph'])
  })

  it('does not depend on the order the bidders were read in', () => {
    const bidders = [bidder('a', { 'p:orph:1': 20 }), bidder('b', { 'p:orph:1': 20 }), bidder('c', { 'p:orph:1': 20 })]
    const once = resolveOrphanAuction({ auction: auction(), bidders })
    expect(resolveOrphanAuction({ auction: auction(), bidders: [...bidders].reverse() })).toEqual(once)
    expect(once.awards[0]!.rosterId).toBe('a')
  })
})

describe('notices', () => {
  it('tells every team the auction opened, in both languages', () => {
    const n = openNotice({ teams: ['Ghost FC', 'Left Town'], assets: 30, closesAt: '2026-10-29T16:00:00Z', leagueName: 'Dynasty One' })
    expect(n.title.en).toBe('Orphan auction open in Dynasty One')
    expect(n.body.en).toContain('30 players and picks from Ghost FC and Left Town')
    expect(n.body.es).toContain('de Ghost FC y Left Town')
  })

  it('tells each bidder what they won and paid, or that nothing was spent', () => {
    const won = resultNotice({ won: [{ label: 'Star', amount: 41 }, { label: '2027 1st round', amount: 9 }], leagueName: 'Dynasty One' })
    expect(won.title.en).toBe('You won 2 in the orphan auction')
    expect(won.body.en).toContain('Star ($41) and 2027 1st round ($9): $50 of FAAB in all')
    expect(won.body.es).toContain('$50 de FAAB en total')
    const none = resultNotice({ won: [], leagueName: 'Dynasty One' })
    expect(none.body.en).toContain('no FAAB was spent')
    for (const text of [won.body.en, none.body.en, won.body.es]) expect(text).not.toMatch(/\b(he|she|his|her)\b/i)
  })
})
