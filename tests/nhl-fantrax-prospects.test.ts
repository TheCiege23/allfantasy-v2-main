import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  compactNhlFantraxUniverse,
  fantraxDisplayName,
  loadNhlFantraxProspects,
  NHL_FANTRAX_UNIVERSE_CACHE_KEY,
  selectNhlFantraxProspects,
  type NhlFantraxUniverseRow,
  type NhlProspectDb,
} from '@/lib/player-identity/nhlFantraxProspects'
import { bridgeRosterIdsToGameLogIds, identityNameKey } from '@/lib/redraft/rosterGameLogIdBridge'
import { isTeamlessExemptProspect, nhlProspectRawRows, shouldOfferNhlFantraxProspects } from '@/lib/draft-room/nhlProspectPoolRows'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'

/** The committed 20-row slice of the real `getPlayerIds?sport=NHL` response (F-01). */
const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/fantrax/nhl-player-ids-public.json'), 'utf8'),
) as { players: Record<string, FantraxPlayerRef> }
const universe = compactNhlFantraxUniverse(Object.values(fixture.players))
const none = { fantraxIds: new Set<string>(), names: new Set<string>() }

describe('Fantrax NHL prospect rule, on the committed capture', () => {
  it('compacts every captured row and reads "Last, First" as "First Last"', () => {
    expect(universe).toHaveLength(Object.keys(fixture.players).length)
    expect(fantraxDisplayName('Madden, Tyler')).toBe('Tyler Madden')
    expect(fantraxDisplayName('Prospect')).toBe('Prospect')
  })

  it('keeps the NHL org for an AHL player and marks a no-club row as unsigned, signed first', () => {
    const { prospects, counts } = selectNhlFantraxProspects(universe, none)
    const madden = prospects.find((p) => p.fantraxId === '04qyh')
    expect(madden).toEqual({ playerId: 'fantrax:04qyh', fantraxId: '04qyh', name: 'Tyler Madden', position: 'RW', orgTeam: 'MIN' })
    expect(prospects.find((p) => p.fantraxId === '04qyf')).toMatchObject({ name: 'Cameron Hillis', orgTeam: null })
    const firstUnsigned = prospects.findIndex((p) => p.orgTeam === null)
    expect(firstUnsigned).toBeGreaterThan(0)
    expect(prospects.slice(firstUnsigned).every((p) => p.orgTeam === null)).toBe(true)
    expect(counts.universe).toBe(universe.length)
    expect(counts.prospects).toBe(prospects.length)
  })

  it('drops a player linked to an NHL identity, or whose name an NHL identity or the pool already holds', () => {
    const { prospects, counts } = selectNhlFantraxProspects(universe, {
      fantraxIds: new Set(['04qyh']),
      names: new Set([identityNameKey('Jan Jeník')]),
      poolNames: new Set([identityNameKey('Ty Emberson')]),
    })
    const names = prospects.map((p) => p.name)
    expect(names).not.toContain('Tyler Madden')
    expect(names).not.toContain('Jan Jenik')
    expect(names).not.toContain('Ty Emberson')
    expect(counts).toMatchObject({ linked: 1, knownName: 1, inPool: 1 })
  })

  it('refuses an unrecognised team label and a non-hockey position, and keeps neither of two namesakes', () => {
    const rows: NhlFantraxUniverseRow[] = [
      ['a0001', 'Old, Coyote', 'ARI', 'C'],
      ['a0002', 'Odd, Spot', 'MIN', 'DH'],
      ['a0003', 'Same, Name', 'MIN', 'C'],
      ['a0004', 'Same, Name', 'BOS', 'D'],
      ['a0005', 'Good, Kid', 'Minnesota Wild', 'LW'],
    ]
    const { prospects, counts } = selectNhlFantraxProspects(rows, none)
    expect(prospects).toEqual([{ playerId: 'fantrax:a0005', fantraxId: 'a0005', name: 'Kid Good', position: 'LW', orgTeam: 'MIN' }])
    expect(counts).toMatchObject({ unrecognisedTeam: 1, badRow: 3 })
  })

  it('orders newest Fantrax id first within a group and honours the cap', () => {
    const rows: NhlFantraxUniverseRow[] = [
      ['04qya', 'One, A', 'EDM', 'C'],
      ['05aaa', 'Two, B', 'EDM', 'C'],
      ['0aaaaa', 'Three, C', 'EDM', 'C'],
      ['zzzzz', 'Four, D', '(N/A)', 'C'],
    ]
    const { prospects, counts } = selectNhlFantraxProspects(rows, none, 2)
    expect(prospects.map((p) => p.fantraxId)).toEqual(['0aaaaa', '05aaa'])
    expect(counts.overLimit).toBe(2)
  })
})

describe('loadNhlFantraxProspects (DB-first)', () => {
  const db = (row: { data: unknown; expiresAt: Date | null } | null, identities: Array<{ fantraxId: string | null; normalizedName: string | null; canonicalName: string | null }> = []) => {
    const findUnique = vi.fn(async (_args: unknown) => row)
    const findMany = vi.fn(async (_args: unknown) => identities)
    return { db: { sportsDataCache: { findUnique }, playerIdentityMap: { findMany } } as unknown as NhlProspectDb, findUnique, findMany }
  }
  const now = new Date('2026-10-31T00:00:00Z')
  const future = new Date('2026-11-30T00:00:00Z')

  it('reads only the stored universe and the NHL identity registry', async () => {
    const { db: d, findUnique, findMany } = db({ data: { at: '2026-10-30T00:00:00Z', rows: universe }, expiresAt: future }, [
      { fantraxId: '04qyh', normalizedName: 'tyler madden', canonicalName: 'Tyler Madden' },
      { fantraxId: null, normalizedName: null, canonicalName: 'Justus Annunen' },
    ])
    const out = await loadNhlFantraxProspects(d, { now })
    expect(findUnique.mock.calls[0]![0]).toMatchObject({ where: { cacheKey: NHL_FANTRAX_UNIVERSE_CACHE_KEY } })
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { sport: 'NHL' } })
    expect(out.snapshotAt).toBe('2026-10-30T00:00:00Z')
    expect(out.prospects.map((p) => p.name)).not.toContain('Tyler Madden')
    expect(out.prospects.map((p) => p.name)).not.toContain('Justus Annunen')
    expect(out.prospects.length).toBe(universe.length - 2)
  })

  it('is empty, not an error, when the universe was never stored or has expired', async () => {
    expect((await loadNhlFantraxProspects(db(null).db, { now })).prospects).toEqual([])
    const expired = db({ data: { at: 'x', rows: universe }, expiresAt: new Date('2026-10-01T00:00:00Z') })
    expect((await loadNhlFantraxProspects(expired.db, { now })).prospects).toEqual([])
    expect(expired.findMany).not.toHaveBeenCalled()
  })
})

describe('NHL rookie-draft pool rows', () => {
  it('only an NHL rookie draft gets prospects', () => {
    expect(shouldOfferNhlFantraxProspects({ sport: 'NHL', playerPool: 'rookies_only', draftModeLabel: null })).toBe(true)
    expect(shouldOfferNhlFantraxProspects({ sport: 'nhl', playerPool: 'all', draftModeLabel: 'rookie' })).toBe(true)
    expect(shouldOfferNhlFantraxProspects({ sport: 'NHL', playerPool: 'all', draftModeLabel: 'standard' })).toBe(false)
    expect(shouldOfferNhlFantraxProspects({ sport: 'NHL', playerPool: 'veterans_only', draftModeLabel: 'rookie' })).toBe(false)
    for (const sport of ['NFL', 'NBA', 'MLB']) {
      expect(shouldOfferNhlFantraxProspects({ sport, playerPool: 'rookies_only', draftModeLabel: 'rookie' })).toBe(false)
    }
  })

  it('a prospect normalizes as a rookie with his org, a stable fantrax id, and the prospect marker', () => {
    const [signed, unsigned] = nhlProspectRawRows([
      { playerId: 'fantrax:04qyh', fantraxId: '04qyh', name: 'Tyler Madden', position: 'RW', orgTeam: 'MIN' },
      { playerId: 'fantrax:04qyf', fantraxId: '04qyf', name: 'Cameron Hillis', position: 'C', orgTeam: null },
    ])
    const a = normalizeDraftPlayer(signed!, 'NHL')
    expect(a).toMatchObject({ playerId: 'fantrax:04qyh', name: 'Tyler Madden', position: 'RW', team: 'MIN', isRookie: true, yearsExp: 0, prospectSource: 'fantrax' })
    const b = normalizeDraftPlayer(unsigned!, 'NHL')
    expect(b.team).toBeNull()
    expect(isTeamlessExemptProspect(b)).toBe(true)
    expect(isTeamlessExemptProspect(normalizeDraftPlayer({ name: 'Free Agent', position: 'C', team: null }, 'NHL'))).toBe(false)
  })
})

describe('game-log bridge: fantrax:<id> roster ids', () => {
  type Row = { id: string; rollingInsightsId: string | null; sleeperId: string | null; fantraxId?: string | null; normalizedName?: string | null }
  const fakeDb = (rows: Row[]) => {
    const findMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
      const w = args.where as { rollingInsightsId?: { in: string[] }; sleeperId?: { in: string[] }; fantraxId?: { in: string[] }; normalizedName?: { in: string[] } }
      if (w.rollingInsightsId) return rows.filter((r) => r.rollingInsightsId && w.rollingInsightsId!.in.includes(r.rollingInsightsId))
      if (w.sleeperId) return rows.filter((r) => r.sleeperId && w.sleeperId!.in.includes(r.sleeperId))
      if (w.fantraxId) return rows.filter((r) => r.fantraxId && w.fantraxId!.in.includes(r.fantraxId))
      if (w.normalizedName) return rows.filter((r) => r.normalizedName && w.normalizedName!.in.includes(r.normalizedName))
      return []
    })
    return { db: { playerIdentityMap: { findMany } }, findMany }
  }

  it('maps a drafted prospect to the identity the weekly link gave his Fantrax id', async () => {
    const { db, findMany } = fakeDb([{ id: 'idm-madden', rollingInsightsId: '9001', sleeperId: null, fantraxId: '04qyh' }])
    const bridge = await bridgeRosterIdsToGameLogIds(db as never, ['NHL'], ['fantrax:04qyh'])
    expect(bridge.rosterIdFor('idm-madden')).toBe('fantrax:04qyh')
    expect(bridge.gameLogIds).toContain('idm-madden')
    expect(bridge).toMatchObject({ bridged: 1, bridgedByFantrax: 1, fantraxRefused: [] })
    const where = findMany.mock.calls.find((c) => (c[0].where as { fantraxId?: unknown }).fantraxId)![0].where
    expect(where).toEqual({ sport: { in: ['NHL'] }, fantraxId: { in: ['04qyh'] } })
  })

  it('an unlinked prospect maps to nothing (no NHL games), with no query for an id-less roster', async () => {
    const { db, findMany } = fakeDb([])
    const bridge = await bridgeRosterIdsToGameLogIds(db as never, ['NHL'], ['fantrax:zzzzz'])
    expect(bridge).toMatchObject({ bridged: 0, bridgedByFantrax: 0, fantraxRefused: [] })
    const none = await bridgeRosterIdsToGameLogIds(fakeDb([]).db as never, ['NHL'], ['16158'])
    expect(none.bridgedByFantrax).toBe(0)
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('refuses a Fantrax id two identities carry, and an identity another roster id already reaches', async () => {
    const twice = fakeDb([
      { id: 'a', rollingInsightsId: '1', sleeperId: null, fantraxId: 'dup' },
      { id: 'b', rollingInsightsId: '2', sleeperId: null, fantraxId: 'dup' },
    ])
    const one = await bridgeRosterIdsToGameLogIds(twice.db as never, ['NHL'], ['fantrax:dup'])
    expect(one).toMatchObject({ bridgedByFantrax: 0, fantraxRefused: ['fantrax:dup'] })
    const claimed = fakeDb([{ id: 'idm-x', rollingInsightsId: '777', sleeperId: null, fantraxId: 'fx1' }])
    const two = await bridgeRosterIdsToGameLogIds(claimed.db as never, ['NHL'], ['777', 'fantrax:fx1'])
    expect(two.rosterIdFor('idm-x')).toBe('777')
    expect(two).toMatchObject({ bridgedByFantrax: 0, fantraxRefused: ['fantrax:fx1'] })
  })
})

describe('prospect copy (EN + ES)', () => {
  it('every prospect key exists in both languages, and the Spanish never says "waiver"', async () => {
    const { translations } = await import('@/lib/i18n/translations')
    for (const key of ['draftRoom.pool.prospectBadge', 'draftRoom.pool.prospectUnsigned', 'draftRoom.pool.prospectTooltip']) {
      expect(translations.en[key], key).toBeTruthy()
      expect(translations.es[key], key).toBeTruthy()
      expect(translations.es[key]).not.toBe(translations.en[key])
      expect(translations.es[key]!.toLowerCase()).not.toContain('waiver')
    }
    expect(translations.en['draftRoom.pool.prospectUnsigned']).toBe('Unsigned')
  })
})

const ingestMocks = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), identities: vi.fn(), update: vi.fn(), provider: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findUnique: ingestMocks.findUnique, upsert: ingestMocks.upsert },
    playerIdentityMap: { findMany: ingestMocks.identities },
    $executeRaw: ingestMocks.update,
  },
}))
vi.mock('@/lib/league-import/fantrax/fantraxApi', () => ({ getFantraxPlayerIds: ingestMocks.provider }))

describe('scheduled NHL ingestion keeps the whole Fantrax universe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ingestMocks.identities.mockResolvedValue([])
    ingestMocks.provider.mockResolvedValue({ ok: true, data: fixture.players })
    ingestMocks.update.mockResolvedValue(0)
  })
  const load = async () => import('@/lib/player-identity/ingestProFantraxIdentities')
  const universeWrites = () => ingestMocks.upsert.mock.calls.filter((c) => c[0].where.cacheKey === NHL_FANTRAX_UNIVERSE_CACHE_KEY)

  it('stores every row it read, under its own key, from the same single provider read', async () => {
    ingestMocks.findUnique.mockResolvedValue(null)
    const { ingestNhlFantraxIdentities } = await load()
    const result = await ingestNhlFantraxIdentities()
    expect(ingestMocks.provider).toHaveBeenCalledTimes(1)
    expect(ingestMocks.provider).toHaveBeenCalledWith('NHL')
    expect(universeWrites()).toHaveLength(1)
    expect(universeWrites()[0]![0].create.data.rows).toEqual(universe)
    expect(result).toMatchObject({ universeStored: universe.length })
  })

  it('a fresh marker does not skip the run while the universe row is missing; with it present it does', async () => {
    const { ingestNhlFantraxIdentities } = await load()
    const fresh = { data: { at: new Date().toISOString() } }
    ingestMocks.findUnique.mockImplementation(async (args: { where: { cacheKey: string } }) => (args.where.cacheKey === NHL_FANTRAX_UNIVERSE_CACHE_KEY ? null : fresh))
    await ingestNhlFantraxIdentities()
    expect(ingestMocks.provider).toHaveBeenCalledTimes(1)
    vi.clearAllMocks()
    ingestMocks.findUnique.mockImplementation(async (args: { where: { cacheKey: string } }) => (args.where.cacheKey === NHL_FANTRAX_UNIVERSE_CACHE_KEY ? { cacheKey: args.where.cacheKey } : fresh))
    expect(await ingestNhlFantraxIdentities()).toMatchObject({ skipped: 'weekly cadence' })
    expect(ingestMocks.provider).not.toHaveBeenCalled()
  })

  it('NBA and MLB store no universe, and a dry run writes nothing', async () => {
    ingestMocks.findUnique.mockResolvedValue(null)
    const { ingestNbaFantraxIdentities, ingestNhlFantraxIdentities } = await load()
    await ingestNbaFantraxIdentities()
    expect(universeWrites()).toHaveLength(0)
    vi.clearAllMocks()
    ingestMocks.provider.mockResolvedValue({ ok: true, data: fixture.players })
    ingestMocks.identities.mockResolvedValue([])
    await ingestNhlFantraxIdentities(true)
    expect(ingestMocks.upsert).not.toHaveBeenCalled()
  })
})
