/**
 * Yahoo trades in a manager's record (2026-11-23), from the historical backfill's rows: one Yahoo transaction is one
 * trade, each leg a row with the team and add / drop, each team matched to its person for that season.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({ facts: vi.fn(), snapshots: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { transactionFact: { findMany: db.facts }, rosterSnapshot: { findMany: db.snapshots } },
}))
vi.mock('@/lib/decision-os/trade/tradePlayers', () => ({
  playerIdSpaceFor: () => ({ provider: 'yahoo' }),
  resolveTradePlayers: db.resolve,
}))

import { readYahooTrades, seasonTeamOwners, yahooTradeRowsToEdge } from '@/lib/competitive-edge/providerManagerHistory'
import { buildTradeRecord } from '@/lib/competitive-edge/tradeEdge'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

const POS: Record<string, string> = { 'p.1': 'RB', 'p.2': 'WR', 'p.3': 'QB' }
const T2 = '423.l.9.t.2'
const T5 = '423.l.9.t.5'
const snap = (teamId: string, season: number, ownerId: string, createdAt = new Date('2026-09-01T00:00:00Z')) => ({
  teamId, season, createdAt, rosterPlayers: [{ id: 'x', ownerId, rosterId: teamId }],
})
const leg = (tx: string, playerId: string | null, rosterId: string | null, direction: string | undefined, season = 2025, extra: Record<string, unknown> = {}) => ({
  playerId, rosterId, season, createdAt: new Date(`${season}-10-0${tx.length % 9 || 1}T00:00:00Z`),
  payload: { yahooTransactionId: tx, status: 'successful', teamKeys: [T2, T5], ...(direction ? { direction } : {}), ...extra },
})
/** A two-team swap: T2 sends p.1 and gets p.2. */
const swap = (tx: string, season = 2025) => [
  leg(tx, 'p.1', T2, 'drop', season), leg(tx, 'p.1', T5, 'add', season),
  leg(tx, 'p.2', T5, 'drop', season), leg(tx, 'p.2', T2, 'add', season),
]

beforeEach(() => {
  vi.clearAllMocks()
  db.resolve.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, POS[id] ? { ok: true, name: id, position: POS[id] } : { ok: false, why: 'unresolved' }])))
})

describe('yahooTradeRowsToEdge', () => {
  const owners = seasonTeamOwners('yahoo', [snap(T2, 2025, 'GUID-A'), snap(T5, 2025, 'GUID-B')])

  it('🛑 four leg rows are ONE trade with two sides, each keyed by the season’s person', () => {
    const r = yahooTradeRowsToEdge(swap('423.l.9.tr.1'), owners, (id) => POS[id] ?? null)
    expect(r.trades).toHaveLength(1)
    const a = r.trades[0]!.sides.find((s) => s.ownerId === 'GUID-A')!
    expect(a.playersOut).toEqual([{ position: 'RB' }])
    expect(a.playersIn).toEqual([{ position: 'WR' }])
    expect(r.trades[0]!.sides.find((s) => s.ownerId === 'GUID-B')!.playersIn).toEqual([{ position: 'RB' }])
    expect(r.unreadableSeasons).toEqual([])
    expect(r.unmatchedSeasons).toEqual([])
  })

  it('the import commit’s copy (providerTransactionId, receiving side only, "obtained") is never counted', () => {
    // Two guards: no `yahooTransactionId`, and "obtained" is not a leg direction. Both teams appear, so the
    // one-team rule cannot be what keeps it out.
    const copy = (playerId: string, rosterId: string) => ({ playerId, rosterId, season: 2025, createdAt: new Date('2025-10-01T00:00:00Z'), payload: { providerTransactionId: '423.l.9.tr.9', direction: 'obtained', status: 'successful' } })
    expect(yahooTradeRowsToEdge([copy('p.1', T5), copy('p.2', T2)], owners, () => null)).toEqual({ trades: [], unreadableSeasons: [], unmatchedSeasons: [] })
    // Alongside the backfill's rows for the same trade it adds nothing either.
    const both = yahooTradeRowsToEdge([...swap('423.l.9.tr.9'), copy('p.1', T5), copy('p.2', T2)], owners, () => null)
    expect(both.trades).toHaveLength(1)
    expect(both.trades[0]!.sides.find((x) => x.ownerId === 'GUID-B')!.playersIn).toHaveLength(1)
  })

  it('a leg written twice (re-read under another status) counts once', () => {
    const rows = [...swap('423.l.9.tr.1'), leg('423.l.9.tr.1', 'p.2', T2, 'add')]
    const a = yahooTradeRowsToEdge(rows, owners, () => null).trades[0]!.sides.find((s) => s.ownerId === 'GUID-A')!
    expect(a.playersIn).toHaveLength(1)
  })

  it('a trade with no player legs (read before the leg fix) is left out and its season named', () => {
    const old = [leg('423.l.9.tr.7', null, null, undefined, 2023)]
    const r = yahooTradeRowsToEdge(old, owners, () => null)
    expect(r.trades).toEqual([])
    expect(r.unreadableSeasons).toEqual([2023])
  })

  it('a vetoed trade is not a trade', () => {
    const rows = swap('423.l.9.tr.8').map((r) => ({ ...r, payload: { ...r.payload, status: 'vetoed' } }))
    expect(yahooTradeRowsToEdge(rows, owners, () => null).trades).toEqual([])
  })

  it('a team with no person on file that season is credited to nobody, and the season is named', () => {
    const noOwner = seasonTeamOwners('yahoo', [snap(T2, 2025, 'GUID-A'), snap(T5, 2025, '5')])
    const r = yahooTradeRowsToEdge(swap('423.l.9.tr.1'), noOwner, () => null)
    expect(r.trades[0]!.sides.map((s) => s.ownerId).sort()).toEqual(['GUID-A', null].sort())
    expect(r.unmatchedSeasons).toEqual([2025])
  })
})

describe('readYahooTrades', () => {
  it('reads the trade rows and snapshots, and the record counts the person’s trades', async () => {
    db.facts.mockResolvedValue([...swap('423.l.9.tr.1'), ...swap('423.l.9.tr.22'), ...swap('423.l.9.tr.333'), leg('423.l.9.tr.4444', null, null, undefined, 2024)])
    db.snapshots.mockResolvedValue([snap(T2, 2025, 'GUID-A'), snap(T5, 2025, 'GUID-B'), snap(T2, 2024, 'GUID-A')])
    const r = await readYahooTrades({ id: 'Y', sport: 'NFL', platform: 'yahoo' }, new Date('2026-09-05T00:00:00Z'))
    expect(db.facts).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'Y', type: 'trade' } }))
    if (!r.available) throw new Error(r.reason)
    expect(r.data.trades).toHaveLength(3)
    expect(r.data.seasonsScanned).toEqual(['2024', '2025'])
    expect(r.data.stale).toBe(false)
    expect(r.data.historyGaps).toEqual([
      "Draft picks moved in Yahoo trades aren't stored in the imported transactions, so these counts are players only.",
      "Some Yahoo trades from 2024 were imported without the players each team got, so they aren't counted until the league's transactions are imported again.",
    ])
    const rec = buildTradeRecord({
      trades: r.data.trades, managerOwnerId: 'GUID-A', managerName: 'Avery', teamExternalId: T2, viewerOwnerId: 'GUID-B',
      seasonsScanned: r.data.seasonsScanned, historyGaps: r.data.historyGaps, asOf: r.data.asOf, stale: r.data.stale,
    })
    expect(rec.coverage.trades).toBe(3)
    expect(rec.coverage.gaps).toHaveLength(2) // both gaps survive the record's own gap filter
    expect(rec.facts.map((f) => f.text)).toContain('Avery took on a WR in 3 of their 3 trades and sent one away in none.')
    expect(rec.facts.map((f) => f.text)).toContain('3 of them were with you.')
  })

  it('no snapshots means the backfill never ran: a reason, never "0 trades"', async () => {
    db.facts.mockResolvedValue([])
    db.snapshots.mockResolvedValue([])
    expect(await readYahooTrades({ id: 'Y', sport: 'NFL', platform: 'yahoo' })).toEqual({
      available: false,
      reason: "Yahoo's season-by-season history hasn't been imported for this league yet, so its trades can't be counted per manager.",
    })
  })

  it('an import older than two weeks reads as stale', async () => {
    db.facts.mockResolvedValue(swap('423.l.9.tr.1'))
    db.snapshots.mockResolvedValue([snap(T2, 2025, 'GUID-A', new Date('2026-08-01T00:00:00Z'))])
    const r = await readYahooTrades({ id: 'Y', sport: 'NFL', platform: 'yahoo' }, new Date('2026-09-05T00:00:00Z'))
    expect(r.available && r.data.stale).toBe(true)
  })

  it('every new line reads in Spanish', () => {
    expect(coreUiCopy("Yahoo's season-by-season history hasn't been imported for this league yet, so its trades can't be counted per manager.", 'es')).toMatch(/^El historial por temporada de Yahoo/)
    expect(coreUiCopy("Draft picks moved in Yahoo trades aren't stored in the imported transactions, so these counts are players only.", 'es')).toMatch(/^Las selecciones del draft intercambiadas en Yahoo/)
    expect(coreUiCopy("Some Yahoo trades from 2024 were imported without the players each team got, so they aren't counted until the league's transactions are imported again.", 'es')).toMatch(/^Algunos intercambios de Yahoo de 2024 /)
    expect(coreUiCopy("In 2025, some teams' managers weren't recorded, so their side of a trade isn't credited to anyone.", 'es')).toMatch(/^En 2025, no quedaron registrados/)
  })
})
