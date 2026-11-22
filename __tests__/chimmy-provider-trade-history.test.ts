/**
 * Chimmy reads ESPN / Yahoo / MFL / Fleaflicker completed trades (Trade OS, 2026-11-16). The live collector writes
 * them to `LeagueTrade` like Sleeper's, in the PROVIDER's id space; the history block refused them all as "not
 * Sleeper". Now they are named through the provider identity map, carry their frozen original, and a provider
 * league's real history comes before its AllFantasy shadow trades.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => ({
  league: { platform: 'mfl', platformLeagueId: '55555', sport: 'NFL', season: 2026 } as Record<string, unknown>,
  histories: [{ id: 'h1' }] as Array<{ id: string }>,
  frozen: [] as unknown[],
  sleeperLookup: vi.fn(async () => []),
  resolve: vi.fn(),
  af: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => m.league, findMany: async () => [] },
    leagueTeam: { findMany: async () => [] },
    leagueTradeHistory: { findMany: async () => m.histories },
    leagueTrade: {
      findMany: async () => [
        {
          transactionId: 'mfl-tx-7',
          week: 4,
          season: 2026,
          tradeDate: new Date('2026-10-01T00:00:00.000Z'),
          playersGiven: ['13604'],
          playersReceived: ['9999'],
          picksGiven: [],
          picksReceived: [],
          partnerName: 'Blitz',
          partnerRosterId: null,
          history: { sleeperUsername: 'Gridiron Gang' },
        },
      ],
    },
    tradeAnalysisSnapshot: { findMany: async () => m.frozen },
    sportsPlayer: { findMany: m.sleeperLookup },
  },
}))
vi.mock('@/lib/decision-os/trade/tradePlayers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/decision-os/trade/tradePlayers')>()),
  resolveTradePlayers: m.resolve,
}))
vi.mock('@/lib/players/sleeperPlayerCrosswalk', () => ({
  resolveSleeperPlayerIdentities: vi.fn(async (ids: string[]) => ({ byId: new Map(ids.map((id) => [id, { name: `Sleeper ${id}` }])) })),
}))
vi.mock('@/lib/chimmy-trade/afTradeHistoryGrounding', () => ({ buildAfTradeHistoryOutcome: m.af }))

import { buildLeagueTradeHistoryOutcome } from '@/lib/chimmy-trade/leagueTradeHistoryGrounding'

const frozenRow = (give: string[], get: string[]) => ({
  contextKey: 'mfl-tx-7',
  payloadJson: {
    v: 2, tradeId: 'mfl-tx-7', give, get,
    grade: { graded: true, letter: 'B', partnerLetter: 'D' },
    frozenAt: '2026-10-02T00:00:00.000Z', basis: 'trade_date', pricedAsOf: '2026-10-01', tradeAt: '2026-10-01T00:00:00.000Z',
  },
})

beforeEach(() => {
  m.league = { platform: 'mfl', platformLeagueId: '55555', sport: 'NFL', season: 2026 }
  m.histories = [{ id: 'h1' }]
  m.frozen = []
  m.af.mockReset()
  m.af.mockResolvedValue({ kind: 'none' })
  m.resolve.mockReset()
  m.resolve.mockImplementation(async (ids: string[]) =>
    new Map(ids.map((id) => [id, id === '13604' ? { ok: true, name: 'Alpha Back', position: 'RB', sleeperId: 'p1' } : id === '9999' ? { ok: true, name: 'Beta Wide', position: 'WR' } : { ok: false, why: 'unresolved' }])),
  )
})

describe('an MFL league’s synced trades', () => {
  it('are read and named in MFL’s id space, never as Sleeper ids', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u')
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(m.resolve).toHaveBeenCalledWith(expect.arrayContaining(['13604', '9999']), { space: { provider: 'mfl' }, sport: 'NFL' })
    expect(out.text).toContain('(MFL league 55555)')
    expect(out.text).toContain('got [Beta Wide] from Blitz for [Alpha Back]')
    expect(out.text).not.toContain('Sleeper 13604')
  })

  it('carry the frozen original, matched on the keys /core froze it under (linked Sleeper id, else name)', async () => {
    m.frozen = [frozenRow(['sleeper:p1'], ['name:beta wide'])]
    const onGrade = vi.fn()
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u', { frozenGrades: true, onGrade })
    if (out.kind !== 'ok') throw new Error(out.kind)
    expect(out.text).toContain('AllFantasy grade (the frozen original')
    expect(out.text).toContain(': B for Gridiron Gang, D for Blitz.')
    expect(onGrade).toHaveBeenCalledWith(expect.objectContaining({ letters: ['B', 'D'] }))
  })

  it('a frozen row keyed as if the MFL ids were Sleeper ids lends no letter', async () => {
    m.frozen = [frozenRow(['sleeper:13604'], ['sleeper:9999'])]
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u', { frozenGrades: true })
    if (out.kind !== 'ok') throw new Error(out.kind)
    expect(out.text).not.toContain('AllFantasy grade (the frozen original')
  })
})

describe('a provider league’s real history comes before its shadow trades', () => {
  it('shows the synced trades even when AllFantasy shadow trades exist', async () => {
    m.af.mockResolvedValue({ kind: 'ok', text: 'SHADOW BLOCK', uniqueTrades: 1, shown: 1, unresolvedPlayers: 0 })
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u')
    expect(out.kind === 'ok' && out.text).toContain('(MFL league 55555)')
  })

  it('falls back to the shadow trades when nothing is synced', async () => {
    m.histories = []
    m.af.mockResolvedValue({ kind: 'ok', text: 'SHADOW BLOCK', uniqueTrades: 1, shown: 1, unresolvedPlayers: 0 })
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u')
    expect(out.kind === 'ok' && out.text).toBe('SHADOW BLOCK')
  })

  it('a native league still answers from its AllFantasy trades alone', async () => {
    m.league = { platform: 'manual', platformLeagueId: null, sport: 'NFL', season: 2026 }
    m.af.mockResolvedValue({ kind: 'ok', text: 'NATIVE BLOCK', uniqueTrades: 1, shown: 1, unresolvedPlayers: 0 })
    const out = await buildLeagueTradeHistoryOutcome('lg', 'u')
    expect(out.kind === 'ok' && out.text).toBe('NATIVE BLOCK')
    expect(m.resolve).not.toHaveBeenCalled()
  })
})
