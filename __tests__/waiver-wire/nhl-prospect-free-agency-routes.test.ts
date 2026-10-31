// @vitest-environment node
/**
 * The free-agent list route, and the add / claim routes' handling of a refused prospect id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prospectDb } from './nhl-prospect-fixture'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  league: vi.fn(),
  roster: vi.fn(),
  rosters: vi.fn(),
  pool: vi.fn(),
  db: null as null | ReturnType<typeof import('./nhl-prospect-fixture').prospectDb>,
}))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: async () => null }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: h.league, findUnique: h.league },
    roster: { findFirst: h.roster, findMany: h.rosters },
    sportsDataCache: { findUnique: (a: never) => h.db!.sportsDataCache.findUnique(a) },
    playerIdentityMap: { findMany: (a: never) => h.db!.playerIdentityMap.findMany(a) },
  },
}))
vi.mock('@/lib/waiver-wire/current-nba-player-pool', () => ({ loadLeagueWaiverPlayerPool: h.pool }))
vi.mock('@/lib/waiver-wire/waiverPoolEnrichment', () => ({ loadWaiverPoolEnrichment: async () => new Map() }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ normalizedWaiverType: 'rolling', waiverEngineConfig: {} }),
}))
vi.mock('@/lib/waiver-wire/dropped-player-waivers', () => ({
  droppedPlayerHoldPolicy: () => ({}),
  loadDroppedPlayerHolds: async () => new Map(),
}))
vi.mock('@/lib/projections/dailySportOutlook', () => ({
  loadDailySportOutlook: async () => ({}),
  applyDailySportOutlook: (players: unknown[]) => players,
}))

const POOL = [
  { player_id: 'sp-mcdavid', external_source_id: '7001', full_name: 'Connor McDavid', position: 'C', team_abbreviation: 'EDM', sport_type: 'NHL', team_id: null, status: null, injury_status: null },
  { player_id: 'sp-linked', external_source_id: '5001', full_name: 'Pro Linked', position: 'C', team_abbreviation: 'EDM', sport_type: 'NHL', team_id: null, status: null, injury_status: null },
]
const NHL_DYNASTY = { id: 'L1', sport: 'NHL', userId: 'u1', isDynasty: true, leagueType: 'dynasty', leagueVariant: null, waiverHours: 24, season: 2026, settings: {} }

async function getPlayers(query = '') {
  const { GET } = await import('@/app/api/waiver-wire/leagues/[leagueId]/players/route')
  const res = await GET({ nextUrl: new URL(`http://localhost/api/waiver-wire/leagues/L1/players?limit=200${query}`) } as never, {
    params: Promise.resolve({ leagueId: 'L1' }),
  })
  return { status: res.status, body: (await res.json()) as { players: Array<{ id: string; name: string; team: string | null; prospectSource?: string }>; nhlProspects?: { total: number; listed: number } } }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.db = prospectDb()
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.league.mockResolvedValue(NHL_DYNASTY)
  h.roster.mockResolvedValue({ id: 'r1' })
  h.rosters.mockResolvedValue([{ playerData: { players: ['fantrax:04abc'] } }])
  h.pool.mockResolvedValue(POOL)
})

describe('GET /api/waiver-wire/leagues/[id]/players', () => {
  it('NHL dynasty: lists free prospects after every pool player, badged, never a drafted one', async () => {
    const { status, body } = await getPlayers()
    expect(status).toBe(200)
    const ids = body.players.map((p) => p.id)
    expect(ids.slice(0, 2)).toEqual(['sp-mcdavid', 'sp-linked'])
    expect(ids.slice(2).sort()).toEqual(['fantrax:04qyf', 'fantrax:04qyh'])
    expect(ids).not.toContain('fantrax:04abc')
    expect(ids).not.toContain('fantrax:04lnk')
    const madden = body.players.find((p) => p.id === 'fantrax:04qyh')!
    expect(madden).toMatchObject({ name: 'Tyler Madden', team: 'MIN', prospectSource: 'fantrax' })
    expect(body.players.find((p) => p.id === 'fantrax:04qyf')).toMatchObject({ team: null, prospectSource: 'fantrax' })
    expect(body.players.filter((p) => p.prospectSource).length).toBe(2)
    expect(body.nhlProspects).toEqual({ total: 2, listed: 2 })
  })

  it('NHL dynasty: a rostered prospect since linked to an NHL identity hides that identity\'s pro row', async () => {
    h.rosters.mockResolvedValue([{ playerData: { players: ['fantrax:04lnk'] } }])
    const { body } = await getPlayers()
    expect(body.players.map((p) => p.id)).not.toContain('sp-linked')
    expect(body.players.map((p) => p.id)).toContain('sp-mcdavid')
  })

  it('NHL dynasty: the position filter applies to prospects', async () => {
    const { body } = await getPlayers('&position=RW')
    expect(body.players.filter((p) => p.prospectSource).map((p) => p.id)).toEqual(['fantrax:04qyh'])
  })

  it.each([
    ['NHL redraft', { ...NHL_DYNASTY, isDynasty: false, leagueType: 'redraft' }],
    ['NHL keeper', { ...NHL_DYNASTY, isDynasty: false, leagueType: 'keeper' }],
    ['MLB dynasty', { ...NHL_DYNASTY, sport: 'MLB' }],
    ['NFL dynasty', { ...NHL_DYNASTY, sport: 'NFL' }],
  ])('%s: unchanged — the pool only, and no prospect read', async (_label, league) => {
    h.league.mockResolvedValue(league)
    const { body } = await getPlayers()
    expect(body.players.map((p) => p.id)).toEqual(['sp-mcdavid', 'sp-linked'])
    expect(body.nhlProspects).toBeUndefined()
    expect(h.db!.sportsDataCache.findUnique).not.toHaveBeenCalled()
    expect(h.db!.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })

  it('NHL dynasty: a failed universe read leaves the list exactly the pool', async () => {
    h.db = prospectDb({ universe: 'throw' })
    const { status, body } = await getPlayers()
    expect(status).toBe(200)
    expect(body.players.map((p) => p.id)).toEqual(['sp-mcdavid', 'sp-linked'])
    expect(body.nhlProspects).toBeUndefined()
  })

  it('NHL dynasty: a never-stored universe lists no prospects', async () => {
    h.db = prospectDb({ universe: null })
    const { body } = await getPlayers()
    expect(body.players.map((p) => p.id)).toEqual(['sp-mcdavid', 'sp-linked'])
    expect(body.nhlProspects).toEqual({ total: 0, listed: 0 })
  })

  it('prospectsOnly search finds a prospect by name, and only in NHL dynasty', async () => {
    const { body } = await getPlayers('&prospectsOnly=1&q=hill')
    expect(body.players.map((p) => p.id)).toEqual(['fantrax:04qyf'])
    expect(h.pool).not.toHaveBeenCalled()
    h.league.mockResolvedValue({ ...NHL_DYNASTY, isDynasty: false, leagueType: 'redraft' })
    const redraft = await getPlayers('&prospectsOnly=1&q=hill')
    expect(redraft.body.players).toEqual([])
  })
})
