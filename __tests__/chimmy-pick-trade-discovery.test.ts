import { describe, expect, it } from 'vitest'
import { findWinNowPickTrades, type OwnedTradePick } from '@/lib/chimmy/pickTradeDiscovery'
import { requestsPickTradePackage } from '@/lib/chimmy/tradeFinderIntent'
import { priorConversationTurns } from '@/lib/chimmy-chat/conversation-context'
import type { DiscoveryPlayer, DiscoveryRoster } from '@/lib/trade-discovery/redraftTradeDiscovery'
import type { ImpactPlayer } from '@/lib/decision-os/trade/rosterImpact'

const player = (id: string, position: string, value: number): DiscoveryPlayer =>
  ({ playerId: id, playerName: id, position, value, isLocked: false })
const roster = (id: string, players: DiscoveryPlayer[]): DiscoveryRoster =>
  ({ rosterId: id, teamName: id, stance: 'rebuilder', weakPositions: [], strongPositions: [], players })
const me = roster('me', [player('QB', 'QB', 4000), player('RB', 'RB', 3000),
  player('WR', 'WR', 3000), player('TE', 'TE', 2000), player('FLEX', 'RB', 1800), player('lesser', 'WR', 1000)])
const projections = new Map<string, ImpactPlayer>([
  ['QB', { playerId: 'QB', position: 'QB', projectedPoints: 20 }],
  ['RB', { playerId: 'RB', position: 'RB', projectedPoints: 15 }],
  ['WR', { playerId: 'WR', position: 'WR', projectedPoints: 14 }],
  ['TE', { playerId: 'TE', position: 'TE', projectedPoints: 10 }],
  ['FLEX', { playerId: 'FLEX', position: 'RB', projectedPoints: 12 }],
  ['lesser', { playerId: 'lesser', position: 'WR', projectedPoints: 8 }],
  ...[18, 17, 16].map((points, i): [string, ImpactPlayer] =>
    [`target${i}`, { playerId: `target${i}`, position: 'WR', projectedPoints: points }]),
])
const picks: OwnedTradePick[] = [
  { season: 2027, round: 2, originalTeamName: null, value: 800 },
  { season: 2027, round: 3, originalTeamName: null, value: 700 },
]
const partners = [0, 1, 2].map(i => roster(`partner${i}`, [player(`target${i}`, 'WR', 2500)]))
const base = { me, partners, ownedPicks: picks, projections, slots: ['QB', 'RB', 'WR', 'TE', 'FLEX'] }

describe('Chimmy owned-pick win-now discovery', () => {
  it('returns three distinct partners with a lesser player, owned second and third, and a positive lineup gain', () => {
    const offers = findWinNowPickTrades(base)
    expect(offers).toHaveLength(3)
    expect(new Set(offers.map(x => x.partner.rosterId)).size).toBe(3)
    for (const offer of offers) {
      expect(offer.outgoing.playerId).toBe('lesser')
      expect(offer.picks.map(x => x.round)).toEqual([2, 3])
      expect(offer.lineupDelta).toBeGreaterThan(0)
      expect(offer.target.value).toBeGreaterThan(offer.outgoing.value!)
    }
  })

  it('refuses unpriced moved players and packages without enough owned picks', () => {
    expect(findWinNowPickTrades({ ...base, projections: new Map([...projections].filter(([id]) => id !== 'lesser')) })).toEqual([])
    expect(findWinNowPickTrades({ ...base, ownedPicks: picks.slice(0, 1) })).toEqual([])
  })

  it('keeps the current request out of history and recognizes the pick constraint', () => {
    expect(priorConversationTurns([{ role: 'user' as const, content: 'Explain PPR' },
      { role: 'assistant' as const, content: 'PPR means points per reception' },
      { role: 'user' as const, content: 'Find trades with my picks' }], 'Find trades with my picks'))
      .toHaveLength(2)
    expect(requestsPickTradePackage('find me 3 win now trades using my draft picks and a lesser player')).toBe(true)
    expect(requestsPickTradePackage('Find player-only trades')).toBe(false)
  })
})
