/**
 * Manager history beyond Sleeper (2026-11-16, re-score item 11 step E — "all platforms"): native leagues
 * from our own tables, ESPN / MFL waiver claims from their import, and a named reason for everything
 * that cannot be counted per manager yet.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  roster: vi.fn(),
  team: vi.fn(),
  trades: vi.fn(),
  waivers: vi.fn(),
  picks: vi.fn(),
  facts: vi.fn(),
  resolve: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: db.roster },
    leagueTeam: { findMany: db.team },
    afLeagueTrade: { findMany: db.trades },
    waiverTransaction: { findMany: db.waivers },
    draftPick: { findMany: db.picks },
    transactionFact: { findMany: db.facts },
  },
}))
vi.mock('@/lib/decision-os/trade/tradePlayers', () => ({
  playerIdSpaceFor: () => 'sleeper',
  resolveTradePlayers: db.resolve,
}))

import { nativeTradesToEdge, readNativeHistory } from '@/lib/competitive-edge/nativeManagerHistory'
import { providerDraftsReason, providerTradesReason, providerWaiversReason, providerWaiverSupport, readProviderWaivers } from '@/lib/competitive-edge/providerManagerHistory'
import { buildTradeRecord } from '@/lib/competitive-edge/tradeEdge'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

const POS: Record<string, string> = { p1: 'RB', p2: 'WR', p3: 'QB', p4: 'TE' }
beforeEach(() => {
  vi.clearAllMocks()
  db.resolve.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, POS[id] ? { ok: true, name: id, position: POS[id] } : { ok: false, why: 'unresolved' }])))
  db.roster.mockResolvedValue([
    { id: 'r1', platformUserId: 'user-a', faabRemaining: 70 },
    { id: 'r2', platformUserId: 'user-b', faabRemaining: 35 },
  ])
  db.team.mockResolvedValue([
    { externalId: 'r1', claimedByUserId: 'user-a', platformUserId: 'user-a' },
    { externalId: 'r2', claimedByUserId: 'user-b', platformUserId: 'user-b' },
  ])
})

describe('native leagues', () => {
  it('nativeTradesToEdge: one side per roster, keyed by the PERSON, with what each took and gave', () => {
    const [t] = nativeTradesToEdge(
      [{
        id: 'T1', proposerRosterId: 'r1', receiverRosterId: 'r2', processedAt: new Date('2026-10-05T00:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z'),
        items: [
          { itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2' },
          { itemType: 'player', itemReference: 'p2', fromRosterId: 'r2', toRosterId: 'r1' },
          { itemType: 'rookie_pick', itemReference: '2027-1', fromRosterId: 'r2', toRosterId: 'r1' },
          { itemType: 'faab', itemReference: null, fromRosterId: 'r1', toRosterId: 'r2' },
        ],
      }],
      2026,
      (r) => ({ r1: 'user-a', r2: 'user-b' })[r] ?? null,
      (id) => POS[id] ?? null,
    )
    expect(t!.createdIso).toBe('2026-10-05T00:00:00.000Z') // processed, not proposed
    const a = t!.sides.find((s) => s.ownerId === 'user-a')!
    expect(a.playersIn).toEqual([{ position: 'WR' }])
    expect(a.playersOut).toEqual([{ position: 'RB' }])
    expect(a.picksIn).toHaveLength(1)
    expect(a.picksOut).toHaveLength(0)
  })

  it('reads processed trades only, claims (not free-agent adds), and picks credited by roster owner', async () => {
    db.trades.mockResolvedValue(
      [1, 2, 3].map((n) => ({
        id: `T${n}`, proposerRosterId: 'r1', receiverRosterId: 'r2', processedAt: new Date(`2026-10-0${n}T00:00:00Z`), createdAt: new Date(`2026-09-2${n}T00:00:00Z`),
        items: [
          { itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2' },
          { itemType: 'player', itemReference: 'p2', fromRosterId: 'r2', toRosterId: 'r1' },
        ],
      })),
    )
    db.waivers.mockResolvedValue([
      { rosterId: 'r2', addPlayerId: 'p4', faabSpent: 12, processedAt: new Date('2026-10-08T00:00:00Z') },
    ])
    db.picks.mockResolvedValue([
      { round: 1, position: 'RB', rosterId: 'r1', assetType: 'player', playerId: 'p1', playerName: 'x' },
      { round: 2, position: 'WR', rosterId: 'r-gone', assetType: 'player', playerId: 'p2', playerName: 'y' },
    ])
    const h = await readNativeHistory({ id: 'L', sport: 'NFL', season: 2026, platform: 'allfantasy' })
    expect(db.trades).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L', status: 'processed' } }))
    expect(db.waivers).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L', claimId: { not: null } } }))

    if (!h.trades.available) throw new Error(h.trades.reason)
    const rec = buildTradeRecord({
      trades: h.trades.data.trades, managerOwnerId: 'user-a', managerName: 'Avery', teamExternalId: 'r1', viewerOwnerId: 'user-b',
      seasonsScanned: h.trades.data.seasonsScanned, historyGaps: [], asOf: h.trades.data.asOf, stale: false,
    })
    expect(rec.facts.map((f) => f.text)).toContain('Avery took on a WR in 3 of their 3 trades and sent one away in none.')
    expect(rec.facts.map((f) => f.text)).toContain('3 of them were with you.')

    if (!h.waivers.available) throw new Error(h.waivers.reason)
    expect(h.waivers.data.claims).toEqual([{ teamExternalId: 'r2', position: 'TE', bid: 12, atIso: '2026-10-08T00:00:00.000Z' }])
    expect(h.waivers.data.faabByTeam.get('r1')).toBe(70)

    if (!h.drafts.available) throw new Error(h.drafts.reason)
    expect(h.drafts.data.picks).toEqual([{ season: 2026, round: 1, position: 'RB', ownerSleeperId: 'user-a' }])
    // A pick by a roster with no owner is left out AND named — never credited to someone else.
    expect(h.drafts.data.unattributedSeasons).toEqual([2026])
  })
})

describe('imported leagues (ESPN, MFL, Yahoo, Fantrax, Fleaflicker)', () => {
  it('which platforms are counted, and which record bids', () => {
    expect(providerWaiverSupport('espn')).toEqual({ counted: true, bids: true })
    expect(providerWaiverSupport('mfl')).toEqual({ counted: true, bids: false })
    for (const p of ['yahoo', 'fantrax', 'fleaflicker']) expect(providerWaiverSupport(p).counted).toBe(false)
  })

  it('🛑 ESPN: reads ONLY waiver_add rows with a team — the commit’s duplicate "waiver" row is never counted', async () => {
    db.team.mockResolvedValue([{ externalId: '4', claimedByUserId: null, platformUserId: 'swid-4' }])
    db.roster.mockResolvedValue([{ platformUserId: 'swid-4', faabRemaining: 41 }])
    db.facts.mockResolvedValue([
      { transactionId: 'a', playerId: 'p1', managerId: '4', payload: { bidAmount: '23' }, createdAt: new Date('2026-10-01T00:00:00Z') },
      { transactionId: 'b', playerId: 'p9', managerId: 'not-a-team', payload: { bidAmount: 5 }, createdAt: new Date('2026-10-02T00:00:00Z') },
    ])
    const r = await readProviderWaivers({ id: 'E', sport: 'NFL', season: 2026, platform: 'espn' })
    expect(db.facts).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'E', type: 'waiver_add', season: 2026, managerId: { not: null } } }))
    if (!r.available) throw new Error(r.reason)
    expect(r.data.claims).toEqual([{ teamExternalId: '4', position: 'RB', bid: 23, atIso: '2026-10-01T00:00:00.000Z' }])
    expect(r.data.faabByTeam.get('4')).toBe(41)
    expect(r.data.bidsKnown).toBe(true)
  })

  it('MFL: claims without bids, even when a payload carries a number', async () => {
    db.team.mockResolvedValue([{ externalId: '0007', claimedByUserId: null, platformUserId: '0007' }])
    db.roster.mockResolvedValue([])
    db.facts.mockResolvedValue([{ transactionId: 'a', playerId: 'p2', managerId: '0007', payload: { bidAmount: 9 }, createdAt: new Date('2026-10-01T00:00:00Z') }])
    const r = await readProviderWaivers({ id: 'M', sport: 'NFL', season: 2026, platform: 'mfl' })
    if (!r.available) throw new Error(r.reason)
    expect(r.data.claims[0]!.bid).toBeNull()
    expect(r.data.bidsKnown).toBe(false)
  })

  it('a platform that cannot be counted says so in words and reads nothing', async () => {
    const r = await readProviderWaivers({ id: 'F', sport: 'NFL', season: 2026, platform: 'fantrax' })
    expect(r).toEqual({ available: false, reason: "Fantrax doesn't give each team a person id, so there is no per-manager history to read." })
    expect(db.facts).not.toHaveBeenCalled()
    expect(providerTradesReason('yahoo')).toBe("Yahoo trades aren't imported in a form that can be counted per manager yet.")
    expect(providerDraftsReason('espn')).toBe("ESPN draft picks aren't matched to the manager who made them yet.")
    expect(providerWaiversReason('fleaflicker')).toBe("Fleaflicker waiver claims aren't imported in a form that can be counted per manager yet.")
  })

  it('every reason reads in Spanish', () => {
    expect(coreUiCopy(providerTradesReason('espn'), 'es')).toBe('Los intercambios de ESPN todavía no se importan de forma que se puedan contar por mánager.')
    expect(coreUiCopy(providerWaiversReason('yahoo'), 'es')).toBe('Los reclamos de Yahoo todavía no se importan de forma que se puedan contar por mánager.')
    expect(coreUiCopy(providerDraftsReason('mfl'), 'es')).toMatch(/^Las selecciones del draft de /)
    expect(coreUiCopy(providerDraftsReason('fantrax'), 'es')).toMatch(/^Fantrax no da un identificador de persona/)
    expect(coreUiCopy('Trade history could not be read right now.', 'es')).toBe('No se pudo leer ahora el historial de intercambios.')
  })
})
