import { describe, expect, it } from 'vitest'

import { gatherCompletedTradeObservations } from '@/lib/trade-market/completedTradeObservations'

/**
 * Which row labels a traded player in the AllFantasy market.
 *
 * 🛑 Every `SportsPlayer` source stamps the same `sleeperId`, and TheSportsDB's rows got theirs by
 * NAME: its 11304 is G Elgton Jenkins (CLE), not TE E.J. Jenkins (PHI). "Most recently updated
 * wins" labelled the tight end "Elgton Jenkins G". The Sleeper row names the id.
 */

const sportsPlayers = [
  // In the order `updatedAt desc` returned them: the namesake was touched last.
  {
    sleeperId: '11304',
    source: 'thesportsdb',
    name: 'Elgton Jenkins',
    position: 'G',
    fetchedAt: new Date('2026-10-11T00:00:00Z'),
    updatedAt: new Date('2026-10-11T00:00:00Z'),
  },
  {
    sleeperId: '11304',
    source: 'sleeper',
    name: 'E.J. Jenkins',
    position: 'TE',
    fetchedAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  },
  {
    sleeperId: '6794',
    source: 'sleeper',
    name: 'Justin Jefferson',
    position: 'WR',
    fetchedAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  },
]

function fakePrisma() {
  return {
    leagueTrade: {
      findMany: async () => [
        {
          transactionId: 'tx1',
          season: 2026,
          tradeDate: null,
          playersGiven: ['11304'],
          playersReceived: ['6794'],
          picksGiven: [],
          picksReceived: [],
        },
      ],
    },
    playerValueSnapshot: {
      findMany: async () => [
        { sleeperId: '11304', value: 900 },
        { sleeperId: '6794', value: 9000 },
      ],
    },
    sportsPlayer: { findMany: async () => sportsPlayers },
  }
}

describe('gatherCompletedTradeObservations — player labels', () => {
  it('🛑 labels a Sleeper id from its Sleeper row, never a fresher TheSportsDB namesake', async () => {
    const gathered = await gatherCompletedTradeObservations({ prisma: fakePrisma() as never })
    expect(gathered.byPlayer.get('11304')).toMatchObject({ name: 'E.J. Jenkins', position: 'TE' })
    expect(gathered.byPlayer.get('6794')).toMatchObject({ name: 'Justin Jefferson', position: 'WR' })
  })
})
