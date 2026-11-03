import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  baseballPosition,
  compactMlbFantraxUniverse,
  knownMlbIdentitySets,
  loadMlbFantraxProspects,
  MLB_FANTRAX_PROSPECT_LIMIT,
  MLB_FANTRAX_UNIVERSE_CACHE_KEY,
  selectMlbFantraxProspects,
  type MlbFantraxUniverseRow,
  type MlbProspectDb,
} from '@/lib/player-identity/mlbFantraxProspects'
import { compactNhlFantraxUniverse, NHL_FANTRAX_UNIVERSE_CACHE_KEY } from '@/lib/player-identity/nhlFantraxProspects'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { mlbProspectRawRows, shouldOfferMlbFantraxProspects } from '@/lib/draft-room/mlbProspectPoolRows'
import { isTeamlessExemptProspect, shouldOfferNhlFantraxProspects } from '@/lib/draft-room/nhlProspectPoolRows'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import { sportSupportsProspectStash } from '@/lib/league-creation/prospectStashPolicy'
import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'

/** The only committed MLB `getPlayerIds` capture: three major leaguers (an array, not the id map). */
const mlbFixture = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/fantrax/mlb-player-map-public.json'), 'utf8'),
) as { players: FantraxPlayerRef[] }
const mlbMap: Record<string, FantraxPlayerRef> = Object.fromEntries(mlbFixture.players.map((p) => [p.fantraxId, p]))
const nhlFixture = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/fantrax/nhl-player-ids-public.json'), 'utf8'),
) as { players: Record<string, FantraxPlayerRef> }

const captured = compactMlbFantraxUniverse(mlbFixture.players)
/** Fixture-shaped rows: the three captured major leaguers plus invented minor-league / unsigned rows. */
const universe: MlbFantraxUniverseRow[] = [
  ...captured,
  ['06abc', 'Prospect, Signed', 'NYY', 'SS'],
  ['06abd', 'Arm, Young', 'Seattle Mariners', 'SP'],
  ['06abe', 'Free, Agent', '(N/A)', 'OF'],
  ['06abf', 'Both, Ways', 'LAD', 'SP,DH'],
]
type Identity = { fantraxId: string | null; normalizedName: string | null; canonicalName: string | null; currentTeam: string | null; position: string | null }
const noIdentities = knownMlbIdentitySets([])

describe('Fantrax MLB prospect rule, on fixture-shaped rows', () => {
  it('compacts the capture and reads "Last, First"', () => {
    expect(captured).toEqual([
      ['042sz', 'Smith, Will', 'LAD', 'C'],
      ['02z0s', 'Judge, Aaron', 'NYY', 'RF'],
      ['02yc4', 'Ohtani, Shohei', 'LAD', 'DH'],
    ])
    const { prospects } = selectMlbFantraxProspects(universe, noIdentities)
    expect(prospects.find((p) => p.fantraxId === '02z0s')).toEqual({ playerId: 'fantrax:02z0s', fantraxId: '02z0s', name: 'Aaron Judge', position: 'RF', orgTeam: 'NYY' })
  })

  it('an already-tracked player with NO fantraxId is excluded by name — the main guard', () => {
    // 2026-10-25: ~4,500 MLB identities carry no fantraxId. Judge here is one of them.
    const known = knownMlbIdentitySets([
      { fantraxId: null, normalizedName: 'aaron judge', canonicalName: 'Aaron Judge', currentTeam: 'NYY', position: 'RF' },
      { fantraxId: '042sz', normalizedName: 'will smith', canonicalName: 'Will Smith', currentTeam: 'LAD', position: 'C' },
      { fantraxId: null, normalizedName: null, canonicalName: 'Shohei Ohtani', currentTeam: 'Los Angeles Dodgers', position: 'DH' },
    ])
    const { prospects, counts } = selectMlbFantraxProspects(universe, known)
    const names = prospects.map((p) => p.name)
    for (const pro of ['Aaron Judge', 'Will Smith', 'Shohei Ohtani']) expect(names).not.toContain(pro)
    expect(counts).toMatchObject({ linked: 1, knownName: 2 })
    expect(names).toContain('Signed Prospect')
  })

  it('the name guard alone holds when our stored club is stale (traded player, no fantraxId)', () => {
    const known = knownMlbIdentitySets([{ fantraxId: null, normalizedName: 'aaron judge', canonicalName: 'Aaron Judge', currentTeam: 'BOS', position: 'RF' }])
    const { prospects, counts } = selectMlbFantraxProspects(universe, known)
    expect(prospects.map((p) => p.name)).not.toContain('Aaron Judge')
    expect(counts).toMatchObject({ knownName: 1, knownClubSurname: 0 })
  })

  it('a tracked player spelt differently is caught by club + surname + initial + role, and only then', () => {
    const rows: MlbFantraxUniverseRow[] = [
      ['07aaa', 'Yastrzemski, Michael', 'SF', 'OF'],
      ['07aab', 'Yastrzemski, Michael', 'BOS', 'OF'],
      ['07aac', 'Yastrzemski, Mark', 'SF', 'SP'],
    ]
    const known = knownMlbIdentitySets([{ fantraxId: null, normalizedName: 'mike yastrzemski', canonicalName: 'Mike Yastrzemski', currentTeam: 'San Francisco Giants', position: 'RF' }])
    const { prospects, counts } = selectMlbFantraxProspects(rows.slice(0, 1).concat(rows.slice(2)), known)
    expect(prospects.map((p) => p.fantraxId)).toEqual(['07aac'])
    expect(counts.knownClubSurname).toBe(1)
    // Another club: not the tracked man.
    expect(selectMlbFantraxProspects([rows[1]!], known).prospects.map((p) => p.fantraxId)).toEqual(['07aab'])
  })

  it('names on the league pool are excluded; a non-MLB team and a non-baseball position are refused; namesakes both dropped', () => {
    const rows: MlbFantraxUniverseRow[] = [
      ['08aaa', 'Pool, Already', 'NYY', 'C'],
      ['08aab', 'Expos, Old', 'MON', 'SS'],
      ['08aac', 'Hockey, Guy', 'NYY', 'LW'],
      ['08aad', 'Same, Name', 'NYY', 'C'],
      ['08aae', 'Same, Name', 'BOS', 'SP'],
      ['08aaf', 'Good, Kid', 'Athletics', '2B'],
    ]
    const { prospects, counts } = selectMlbFantraxProspects(rows, { ...noIdentities, poolNames: new Set(['already pool']) })
    expect(prospects).toEqual([{ playerId: 'fantrax:08aaf', fantraxId: '08aaf', name: 'Kid Good', position: '2B', orgTeam: 'ATH' }])
    expect(counts).toMatchObject({ inPool: 1, unrecognisedTeam: 1, badRow: 3 })
  })

  it('two-way rows are kept as TWP; every baseball position parses', () => {
    expect(baseballPosition('SP,DH')).toBe('TWP')
    expect(baseballPosition('TWP')).toBe('TWP')
    expect(baseballPosition('RP')).toBe('RP')
    expect(baseballPosition('UTIL')).toBe('UT')
    expect(baseballPosition('G')).toBeNull()
    const { prospects } = selectMlbFantraxProspects(universe, noIdentities)
    expect(prospects.find((p) => p.fantraxId === '06abf')?.position).toBe('TWP')
    expect(prospects.find((p) => p.fantraxId === '06abd')).toMatchObject({ position: 'SP', orgTeam: 'SEA' })
  })

  it('signed first, newest Fantrax id first, unsigned last, capped at 900 by default', () => {
    const { prospects } = selectMlbFantraxProspects(universe, noIdentities)
    expect(prospects.at(-1)).toMatchObject({ fantraxId: '06abe', orgTeam: null })
    expect(prospects.slice(0, 4).map((p) => p.fantraxId)).toEqual(['06abf', '06abd', '06abc', '042sz'])
    expect(MLB_FANTRAX_PROSPECT_LIMIT).toBe(900)
    const many: MlbFantraxUniverseRow[] = Array.from({ length: 950 }, (_, i) => [`x${String(i).padStart(4, '0')}`, `Kid${i}, Player`, 'NYY', 'SS'])
    const capped = selectMlbFantraxProspects(many, noIdentities)
    expect(capped.prospects).toHaveLength(900)
    expect(capped.counts.overLimit).toBe(50)
  })
})

describe('loadMlbFantraxProspects (DB-first)', () => {
  const db = (row: { data: unknown; expiresAt: Date | null } | null, identities: Identity[] = []) => {
    const findUnique = vi.fn(async (_args: unknown) => row)
    const findMany = vi.fn(async (_args: unknown) => identities)
    return { db: { sportsDataCache: { findUnique }, playerIdentityMap: { findMany } } as unknown as MlbProspectDb, findUnique, findMany }
  }
  const now = new Date('2026-10-31T00:00:00Z')
  const future = new Date('2026-11-30T00:00:00Z')

  it('reads only the stored MLB universe and every MLB identity (linked or not)', async () => {
    const { db: d, findUnique, findMany } = db({ data: { at: '2026-10-30T00:00:00Z', rows: universe }, expiresAt: future }, [
      { fantraxId: null, normalizedName: 'aaron judge', canonicalName: 'Aaron Judge', currentTeam: 'NYY', position: 'RF' },
    ])
    const out = await loadMlbFantraxProspects(d, { now })
    expect(findUnique.mock.calls[0]![0]).toMatchObject({ where: { cacheKey: MLB_FANTRAX_UNIVERSE_CACHE_KEY } })
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { sport: 'MLB' } })
    expect(out.prospects.map((p) => p.name)).not.toContain('Aaron Judge')
    expect(out.prospects).toHaveLength(universe.length - 1)
    expect(out.snapshotAt).toBe('2026-10-30T00:00:00Z')
  })

  it('is empty, not an error, when never stored or expired', async () => {
    expect((await loadMlbFantraxProspects(db(null).db, { now })).prospects).toEqual([])
    const expired = db({ data: { at: 'x', rows: universe }, expiresAt: new Date('2026-10-01T00:00:00Z') })
    expect((await loadMlbFantraxProspects(expired.db, { now })).prospects).toEqual([])
    expect(expired.findMany).not.toHaveBeenCalled()
  })
})

describe('MLB rookie-draft pool rows', () => {
  it('only an MLB rookie draft gets MLB prospects, and the NHL gate is unchanged', () => {
    expect(shouldOfferMlbFantraxProspects({ sport: 'MLB', playerPool: 'rookies_only', draftModeLabel: null })).toBe(true)
    expect(shouldOfferMlbFantraxProspects({ sport: 'mlb', playerPool: 'all', draftModeLabel: 'rookie' })).toBe(true)
    expect(shouldOfferMlbFantraxProspects({ sport: 'MLB', playerPool: 'all', draftModeLabel: 'standard' })).toBe(false)
    expect(shouldOfferMlbFantraxProspects({ sport: 'MLB', playerPool: 'all', draftModeLabel: null })).toBe(false)
    expect(shouldOfferMlbFantraxProspects({ sport: 'MLB', playerPool: 'veterans_only', draftModeLabel: 'rookie' })).toBe(false)
    for (const sport of ['NFL', 'NBA', 'NHL']) expect(shouldOfferMlbFantraxProspects({ sport, playerPool: 'rookies_only', draftModeLabel: 'rookie' })).toBe(false)
    expect(shouldOfferNhlFantraxProspects({ sport: 'MLB', playerPool: 'rookies_only', draftModeLabel: 'rookie' })).toBe(false)
  })

  it('a prospect normalizes as an MLB rookie with his club or none, a fantrax id and the shared marker', () => {
    const [signed, unsigned] = mlbProspectRawRows([
      { playerId: 'fantrax:06abc', fantraxId: '06abc', name: 'Signed Prospect', position: 'SS', orgTeam: 'NYY' },
      { playerId: 'fantrax:06abe', fantraxId: '06abe', name: 'Agent Free', position: 'OF', orgTeam: null },
    ])
    expect(normalizeDraftPlayer(signed!, 'MLB')).toMatchObject({ playerId: 'fantrax:06abc', team: 'NYY', isRookie: true, yearsExp: 0, prospectSource: 'fantrax' })
    const b = normalizeDraftPlayer(unsigned!, 'MLB')
    expect(b.team).toBeNull()
    expect(isTeamlessExemptProspect(b)).toBe(true)
  })

  it('taxi / prospect stash stays closed for MLB (and NHL)', () => {
    expect(sportSupportsProspectStash('MLB')).toBe(false)
    expect(sportSupportsProspectStash('NHL')).toBe(false)
  })
})

describe('game-log bridge: MLB fantrax:<id> roster ids', () => {
  type Row = { id: string; sport: string; rollingInsightsId: string | null; sleeperId: string | null; fantraxId: string | null }
  const fakeDb = (rows: Row[]) => {
    const findMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
      const w = args.where as { sport: { in: string[] }; fantraxId?: { in: string[] }; rollingInsightsId?: { in: string[] } }
      const inSport = rows.filter((r) => w.sport.in.includes(r.sport))
      if (w.fantraxId) return inSport.filter((r) => r.fantraxId && w.fantraxId!.in.includes(r.fantraxId))
      if (w.rollingInsightsId) return inSport.filter((r) => r.rollingInsightsId && w.rollingInsightsId!.in.includes(r.rollingInsightsId))
      return []
    })
    return { db: { playerIdentityMap: { findMany } }, findMany }
  }

  it('maps a drafted MLB prospect within the MLB sport keys, and never to another sport\'s identity', async () => {
    const { db, findMany } = fakeDb([
      { id: 'idm-mlb', sport: 'MLB', rollingInsightsId: '55001', sleeperId: null, fantraxId: '06abc' },
      { id: 'idm-nhl', sport: 'NHL', rollingInsightsId: '9001', sleeperId: null, fantraxId: '06abd' },
    ])
    const bridge = await bridgeRosterIdsToGameLogIds(db as never, ['MLB', 'mlb'], ['fantrax:06abc', 'fantrax:06abd'])
    expect(bridge.rosterIdFor('idm-mlb')).toBe('fantrax:06abc')
    expect(bridge.rosterIdFor('idm-nhl')).toBeUndefined()
    expect(bridge).toMatchObject({ bridged: 1, bridgedByFantrax: 1, fantraxRefused: [] })
    const where = findMany.mock.calls.find((c) => (c[0].where as { fantraxId?: unknown }).fantraxId)![0].where
    expect(where).toEqual({ sport: { in: ['MLB', 'mlb'] }, fantraxId: { in: ['06abc', '06abd'] } })
  })

  it('refuses an MLB Fantrax id two MLB identities carry', async () => {
    const { db } = fakeDb([
      { id: 'a', sport: 'MLB', rollingInsightsId: '1', sleeperId: null, fantraxId: 'dup' },
      { id: 'b', sport: 'mlb', rollingInsightsId: '2', sleeperId: null, fantraxId: 'dup' },
    ])
    const bridge = await bridgeRosterIdsToGameLogIds(db as never, ['MLB', 'mlb'], ['fantrax:dup'])
    expect(bridge).toMatchObject({ bridgedByFantrax: 0, fantraxRefused: ['fantrax:dup'] })
  })
})

describe('MLB prospect copy (EN + ES)', () => {
  it('the MLB tooltip exists in both languages, plain, and the Spanish never says "waiver"', async () => {
    const { translations } = await import('@/lib/i18n/translations')
    const key = 'draftRoom.pool.prospectTooltipMlb'
    expect(translations.en[key]).toMatch(/^MLB prospect/)
    expect(translations.es[key]).toMatch(/^Prospecto de la MLB/)
    expect(translations.es[key]!.toLowerCase()).not.toContain('waiver')
    for (const shared of ['draftRoom.pool.prospectBadge', 'draftRoom.pool.prospectUnsigned']) expect(translations.es[shared]).toBeTruthy()
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

describe('scheduled ingestion keeps the MLB universe; NHL is unchanged', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ingestMocks.identities.mockResolvedValue([])
    ingestMocks.update.mockResolvedValue(0)
  })
  const load = async () => import('@/lib/player-identity/ingestProFantraxIdentities')
  const writes = (key: string) => ingestMocks.upsert.mock.calls.filter((c) => c[0].where.cacheKey === key)

  it('MLB stores every row it read under its own key, from the same single provider read', async () => {
    ingestMocks.findUnique.mockResolvedValue(null)
    ingestMocks.provider.mockResolvedValue({ ok: true, data: mlbMap })
    const { ingestMlbFantraxIdentities } = await import('@/lib/player-identity/ingestMlbFantraxIdentities')
    const result = await ingestMlbFantraxIdentities()
    expect(ingestMocks.provider).toHaveBeenCalledTimes(1)
    expect(ingestMocks.provider).toHaveBeenCalledWith('MLB')
    expect(writes(MLB_FANTRAX_UNIVERSE_CACHE_KEY)).toHaveLength(1)
    expect(writes(MLB_FANTRAX_UNIVERSE_CACHE_KEY)[0]![0].create.data.rows).toEqual(captured)
    expect(writes(NHL_FANTRAX_UNIVERSE_CACHE_KEY)).toHaveLength(0)
    expect(result).toMatchObject({ universeStored: captured.length, provided: 3 })
  })

  it('a fresh MLB marker does not skip while the MLB universe is missing; with it present it does', async () => {
    ingestMocks.provider.mockResolvedValue({ ok: true, data: mlbMap })
    const { ingestMlbFantraxIdentities } = await import('@/lib/player-identity/ingestMlbFantraxIdentities')
    const fresh = { data: { at: new Date().toISOString() } }
    ingestMocks.findUnique.mockImplementation(async (args: { where: { cacheKey: string } }) => (args.where.cacheKey === MLB_FANTRAX_UNIVERSE_CACHE_KEY ? null : fresh))
    await ingestMlbFantraxIdentities()
    expect(ingestMocks.provider).toHaveBeenCalledTimes(1)
    vi.clearAllMocks()
    ingestMocks.findUnique.mockImplementation(async (args: { where: { cacheKey: string } }) => (args.where.cacheKey === MLB_FANTRAX_UNIVERSE_CACHE_KEY ? { cacheKey: args.where.cacheKey } : fresh))
    expect(await ingestMlbFantraxIdentities()).toMatchObject({ skipped: 'weekly cadence' })
    expect(ingestMocks.provider).not.toHaveBeenCalled()
  })

  it('NHL still writes only its own universe, with the same rows and result keys; NBA none; dry run nothing', async () => {
    ingestMocks.findUnique.mockResolvedValue(null)
    ingestMocks.provider.mockResolvedValue({ ok: true, data: nhlFixture.players })
    const { ingestNhlFantraxIdentities, ingestNbaFantraxIdentities } = await load()
    const nhl = await ingestNhlFantraxIdentities()
    expect(writes(NHL_FANTRAX_UNIVERSE_CACHE_KEY)[0]![0].create.data.rows).toEqual(compactNhlFantraxUniverse(Object.values(nhlFixture.players)))
    expect(writes(MLB_FANTRAX_UNIVERSE_CACHE_KEY)).toHaveLength(0)
    expect(Object.keys(nhl).sort()).toEqual(['ambiguous', 'conflicts', 'dryRun', 'proposed', 'provided', 'unchanged', 'universeStored', 'unmatched', 'updated'])
    vi.clearAllMocks()
    ingestMocks.identities.mockResolvedValue([])
    ingestMocks.provider.mockResolvedValue({ ok: true, data: nhlFixture.players })
    const nba = await ingestNbaFantraxIdentities()
    expect(writes(MLB_FANTRAX_UNIVERSE_CACHE_KEY)).toHaveLength(0)
    expect(writes(NHL_FANTRAX_UNIVERSE_CACHE_KEY)).toHaveLength(0)
    expect(nba).not.toHaveProperty('universeStored')
    vi.clearAllMocks()
    ingestMocks.identities.mockResolvedValue([])
    ingestMocks.provider.mockResolvedValue({ ok: true, data: mlbMap })
    const { ingestMlbFantraxIdentities } = await import('@/lib/player-identity/ingestMlbFantraxIdentities')
    await ingestMlbFantraxIdentities(true)
    expect(ingestMocks.upsert).not.toHaveBeenCalled()
  })
})
