// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  snapshot: null as unknown,
  identity: [] as Array<{ fantraxId: string; canonicalName: string; position: string | null; currentTeam: string | null; sport: string }>,
  identityWhere: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantraxLeague: { findUnique: vi.fn(async () => h.snapshot) },
    playerIdentityMap: {
      findMany: vi.fn(async (q: { where: { fantraxId: { in: string[] }; sport?: string } }) => {
        h.identityWhere = q.where
        return h.identity.filter((r) => q.where.fantraxId.in.includes(r.fantraxId) && (!q.where.sport || r.sport === q.where.sport))
      }),
    },
  },
}))

import { fantraxLeagueMoves } from '@/lib/league/collegePro/fantraxActivity'

const NOW = Date.parse('2026-11-22T18:00:00Z')
const since = NOW - 30 * 86_400_000

// Shaped like Cream Bowl's stored snapshot, 2026-11-22.
beforeEach(() => {
  h.identityWhere = null
  h.identity = [{ fantraxId: '06rwv', canonicalName: 'Dropped Since', position: 'RB', currentTeam: 'Utah', sport: 'NCAAF' }]
  h.snapshot = {
    id: 'snap-cream',
    sport: 'CFB',
    roster: [
      { fantraxId: '06tue', name: 'Braden Pegan', position: 'WR', primaryPosition: 'WR', team: 'Utah', teamName: 'Jws452' },
      { fantraxId: '0736l', name: 'Second Add', position: 'QB', team: 'Iowa', teamName: 'Jws452' },
    ],
    transactions: {
      fantraxDerived: {
        moves: [
          { id: 'mv-new', period: 12, observedAt: '2026-11-18T08:08:02.701Z', teamId: 't1', teamName: 'Jws452', adds: ['06tue', '0736l'], drops: ['06rwv', 'zzz99'] },
          { id: 'mv-old', period: 2, observedAt: '2026-09-01T08:00:00.000Z', teamId: 't1', teamName: 'Jws452', adds: ['06tue'], drops: [] },
        ],
        suspectedTrades: [
          { id: 'tr-1', period: 12, observedAt: '2026-11-19T08:00:00.000Z', teamAId: 'a', teamAName: 'Ciege82', teamBId: 'b', teamBName: 'Grindingffb', aSent: ['06tue'], bSent: ['0736l'] },
        ],
      },
    },
  }
})

describe('a Fantrax league’s moves as Activity cards', () => {
  it('reads the stored roster diffs in the window, names players, and marks every card inferred', async () => {
    const cards = await fantraxLeagueMoves('snap-cream', { since })
    expect(cards.map((c) => c.id)).toEqual(['fantrax:snap-cream:mv-new', 'fantrax:snap-cream:tr-1']) // mv-old is outside the window
    expect(cards.every((c) => c.inferred)).toBe(true)

    const move = cards[0]!
    expect(move).toMatchObject({ kind: 'roster_move', teamName: 'Jws452', bid: null })
    expect(move.adds.map((p) => [p.name, p.position, p.team, p.to])).toEqual([
      ['Braden Pegan', 'WR', 'Utah', 'Jws452'],
      ['Second Add', 'QB', 'Iowa', 'Jws452'],
    ])
    // Dropped since the snapshot: the identity map's Fantrax id names him; an unknown id stays printable.
    expect(move.drops.map((p) => p.name)).toEqual(['Dropped Since', 'player zzz99'])
    expect(h.identityWhere).toMatchObject({ sport: 'NCAAF' })
  })

  it('reports a two-way exchange as a trade, each player received by the other team', async () => {
    const trade = (await fantraxLeagueMoves('snap-cream', { since })).find((c) => c.kind === 'trade')!
    expect(trade.involvedTeams).toEqual(['Ciege82', 'Grindingffb'])
    expect(trade.adds.map((p) => [p.name, p.to])).toEqual([
      ['Braden Pegan', 'Grindingffb'],
      ['Second Add', 'Ciege82'],
    ])
  })

  it('a snapshot with nothing stored, or none at all, has no cards', async () => {
    h.snapshot = { id: 'snap-x', sport: 'CBB', roster: [], transactions: {} }
    expect(await fantraxLeagueMoves('snap-x', { since })).toEqual([])
    h.snapshot = null
    expect(await fantraxLeagueMoves('missing', { since })).toEqual([])
  })
})
