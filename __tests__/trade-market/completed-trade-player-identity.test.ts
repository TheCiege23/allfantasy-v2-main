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

describe('gatherCompletedTradeObservations — NFL rows only', () => {
  it('🛑 never labels an NFL Sleeper id from another sport’s row with the same number', async () => {
    const rows = [
      { sport: 'NFL', sleeperId: '1466', source: 'sleeper', name: 'Travis Kelce', position: 'TE', fetchedAt: new Date('2026-11-25T08:40:53Z') },
      { sport: 'NBA', sleeperId: '1466', source: 'sleeper', name: 'JaVale McGee', position: 'C', fetchedAt: new Date('2026-11-25T18:04:05Z') },
      { sport: 'NFL', sleeperId: '6794', source: 'sleeper', name: 'Justin Jefferson', position: 'WR', fetchedAt: new Date('2026-10-01T00:00:00Z') },
    ]
    const base = fakePrisma()
    const prisma = {
      ...base,
      leagueTrade: { findMany: async () => [{ transactionId: 'tx2', season: 2026, tradeDate: null, playersGiven: ['1466'], playersReceived: ['6794'], picksGiven: [], picksReceived: [] }] },
      playerValueSnapshot: { findMany: async () => [{ sleeperId: '1466', value: 1700 }, { sleeperId: '6794', value: 9000 }] },
      sportsPlayer: {
        findMany: async (a: { where: { sport?: string } }) => rows.filter((r) => !a.where.sport || r.sport === a.where.sport),
      },
    }
    const gathered = await gatherCompletedTradeObservations({ prisma: prisma as never })
    expect(gathered.byPlayer.get('1466')).toMatchObject({ name: 'Travis Kelce', position: 'TE' })
  })
})
