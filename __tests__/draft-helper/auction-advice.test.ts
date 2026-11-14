import { describe, expect, it } from 'vitest'
import { buildAuctionAdvice, marketPrices } from '@/lib/draft-helper/auctionAdvice'
import { computeDraftPlayerRankings, type RecommendationPlayer } from '@/lib/draft-helper/RecommendationEngine'

/*
 * Auction advice on the one draft engine (2026-11-14): market prices from the room's remaining
 * money, your price moved by need and the scoring window, and a verdict on the player up for bid.
 */

const TWELVE_TEAMS_FRESH = { teams: Array.from({ length: 12 }, () => ({ budget: 200, openSlots: 15 })), minBid: 1 }

function pool(n: number): RecommendationPlayer[] {
  const positions = ['RB', 'WR', 'WR', 'RB', 'QB', 'TE']
  return Array.from({ length: n }, (_, i) => ({
    name: `Player ${i + 1}`,
    position: positions[i % positions.length]!,
    team: 'AAA',
    adp: i + 1,
  }))
}

describe('marketPrices', () => {
  it('has the shape of a real $200 auction and spends the room’s money', () => {
    const order = pool(180).map((p) => ({ name: p.name }))
    const prices = marketPrices(order, TWELVE_TEAMS_FRESH)
    expect(prices.get('Player 1')!).toBeGreaterThan(45)
    expect(prices.get('Player 1')!).toBeLessThan(70)
    expect(prices.get('Player 90')!).toBeLessThan(12)
    expect(prices.get('Player 180')!).toBeCloseTo(1, 0)
    const total = [...prices.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(12 * 200, -1)
  })
})

describe('buildAuctionAdvice', () => {
  const ranked = computeDraftPlayerRankings({
    available: pool(80),
    teamRoster: [{ position: 'RB' }, { position: 'RB' }],
    rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'],
    round: 1,
    pick: 1,
    totalTeams: 12,
    sport: 'NFL',
  })!.scored

  it('says bid when the current bid is below your price, and let go above it', () => {
    const me = { budget: 200, openSlots: 13 }
    const cheap = buildAuctionAdvice({ ranked, room: TWELVE_TEAMS_FRESH, me, nomination: { playerName: 'Player 2', currentBid: 5 } })
    expect(cheap.nominated?.verdict).toBe('bid')
    expect(cheap.summary).toMatch(/^Bid on Player 2 up to \$\d+/)
    const steep = buildAuctionAdvice({ ranked, room: TWELVE_TEAMS_FRESH, me, nomination: { playerName: 'Player 2', currentBid: 150 } })
    expect(steep.nominated?.verdict).toBe('let_go')
  })

  it('never advises a bid above your legal maximum', () => {
    const me = { budget: 20, openSlots: 10 }
    const advice = buildAuctionAdvice({ ranked, room: TWELVE_TEAMS_FRESH, me, nomination: { playerName: 'Player 1', currentBid: 15 } })
    expect(advice.maxLegalBid).toBe(11)
    expect(advice.nominated?.verdict).toBe('cannot_afford')
    for (const t of advice.targets) expect(t.marketPrice).toBeLessThanOrEqual(11)
  })

  it('values an open starting slot above a filled one', () => {
    const advice = buildAuctionAdvice({ ranked, room: TWELVE_TEAMS_FRESH, me: { budget: 200, openSlots: 13 } })
    const all = [...advice.targets]
    // RBs are filled (2 of 2); the targets should lean to positions still open.
    expect(all.every((t) => t.position !== 'RB' || t.surplus <= 0)).toBe(true)
  })

  it('suggests nominating a player the room wants more than you do', () => {
    const advice = buildAuctionAdvice({ ranked, room: TWELVE_TEAMS_FRESH, me: { budget: 200, openSlots: 13 } })
    expect(advice.nominate?.position).toBe('RB')
  })

  it('a bye inside the scoring window lowers your price for that player', () => {
    const avail = [
      { name: 'In Window', position: 'WR', team: 'AAA', adp: 5, byeWeek: 11 },
      { name: 'Played', position: 'WR', team: 'BBB', adp: 6, byeWeek: 7 },
      ...pool(40).slice(10),
    ]
    const r = computeDraftPlayerRankings({
      available: avail,
      teamRoster: [],
      rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'],
      round: 1,
      pick: 1,
      totalTeams: 12,
      sport: 'NFL',
      scoringWindow: { startWeek: 11, endWeek: 12 },
    })!.scored
    const advice = buildAuctionAdvice({ ranked: r, room: TWELVE_TEAMS_FRESH, me: { budget: 200, openSlots: 15 } })
    const all = [...advice.targets, ...(advice.nominate ? [advice.nominate] : [])]
    const inWindow = buildAuctionAdvice({ ranked: r, room: TWELVE_TEAMS_FRESH, me: { budget: 200, openSlots: 15 }, nomination: { playerName: 'In Window', currentBid: 1 } }).nominated!
    const played = buildAuctionAdvice({ ranked: r, room: TWELVE_TEAMS_FRESH, me: { budget: 200, openSlots: 15 }, nomination: { playerName: 'Played', currentBid: 1 } }).nominated!
    expect(inWindow.yourPrice / inWindow.marketPrice).toBeLessThan(played.yourPrice / played.marketPrice)
    expect(inWindow.reason).toContain('inside the scoring window')
    expect(all.length).toBeGreaterThan(0)
  })
})
