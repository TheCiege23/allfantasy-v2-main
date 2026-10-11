/**
 * Wrong-person headshots, round two — measured in production 2026-10-11.
 *
 *   a. The NFL canonical TheSportsDB adapter returned `players[0]` of a name search spanning every
 *      sport: 72 TheSportsDB URLs were the primary headshot of 2+ different players (NFL Ben Jones
 *      wearing NHL Ben Jones's photo).
 *   b. The resolver's `SportsPlayer` tier accepted team OR position, then `?? dbRows[0]`: DL Chris
 *      Jones (KC) was stored with CB Chris Jones's photo (Sleeper 5815).
 *   c. `findMatchingRow` ended `?? rows[0]`, so a request matching nothing got the first row.
 *   d. The wrong images were persisted to `PlayerImage`; readers must stop serving pre-fix rows.
 *
 * Every row below is copied from production `SportsPlayer` (sport = 'NFL') as read that day.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  sportsPlayer: { findMany: vi.fn(async () => [] as unknown[]) },
  playerImage: { findFirst: vi.fn(async () => null as unknown), findMany: vi.fn(async () => [] as unknown[]) },
  playerProviderIdentity: { findMany: vi.fn(async () => [] as unknown[]) },
  player: { findMany: vi.fn(async () => [] as unknown[]) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/nfl-provider/nflRedraftProviderCertification', () => ({
  resolveNflRedraftCanonicalHeadshot: vi.fn(async () => ({ imageUrl: null, source: 'none', confidence: 'none' })),
}))
vi.mock('@/lib/workers/providers/thesportsdb', () => ({
  theSportsDbProvider: { supports: () => true, fetch: vi.fn(async () => null) },
}))
vi.mock('@/lib/workers/providers/api-sports', () => ({
  apiSportsProvider: { supports: () => true, fetch: vi.fn(async () => null) },
}))
vi.mock('@/lib/workers/providers/sleeper-chain', () => ({
  sleeperChainProvider: { supports: () => true, fetch: vi.fn(async () => null) },
}))

import {
  buildNflRedraftProductionProviderAdapters,
  findMatchingRow,
} from '@/lib/nfl-provider/nflRedraftProductionProviderWiring'
import { resolvePlayerHeadshot } from '@/lib/player-assets/resolvePlayerHeadshot'
import {
  readPrimaryPlayerImage,
  servedPlayerImageUrl,
} from '@/lib/player-assets/playerImageStore'
import { getCanonicalPlayersBySleeperIds } from '@/lib/canonical/getCanonicalPlayer'

const NHL_BEN_JONES = 'https://r2.thesportsdb.com/images/media/player/cutout/nhl-ben-jones.png'
const NFL_BEN_JONES = 'https://r2.thesportsdb.com/images/media/player/cutout/nfl-ben-jones.png'
const NCAAB_CAMERON_JACKSON = 'https://r2.thesportsdb.com/images/media/player/cutout/cm9h7v1648234807.png'
const CB_CHRIS_JONES = 'https://sleepercdn.com/content/nfl/players/thumb/5815.jpg'
const DL_CHRIS_JONES = 'https://sleepercdn.com/content/nfl/players/thumb/3558.jpg'

// The search's top-level key is not pinned by a fixture (contracts/thesportsdb/GAPS.md G-14):
// the worker reads `player`, the old adapter read `players`. Both are exercised.
function stubSearch(rows: Array<Record<string, unknown>>, key: 'player' | 'players' = 'players') {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ [key]: rows }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function nflTheSportsDbHeadshot(request: { playerName: string; teamAbbr?: string; position?: string }) {
  const adapter = buildNflRedraftProductionProviderAdapters().thesportsdb!.headshots!
  const result = await adapter({ capability: 'headshots', ...request })
  return (result?.canonicalData?.headshotUrl as string | undefined) ?? null
}

beforeEach(() => {
  vi.unstubAllGlobals()
  prismaMock.sportsPlayer.findMany.mockReset().mockResolvedValue([])
  prismaMock.playerImage.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.playerImage.findMany.mockReset().mockResolvedValue([])
  prismaMock.playerProviderIdentity.findMany.mockReset().mockResolvedValue([])
  prismaMock.player.findMany.mockReset().mockResolvedValue([])
})

describe('a. NFL canonical TheSportsDB headshot adapter', () => {
  it('skips another sport\'s namesake listed first and binds the NFL player', async () => {
    stubSearch([
      { strPlayer: 'Ben Jones', strSport: 'Ice Hockey', strTeam: 'Vegas Golden Knights', strPosition: 'Centre', strCutout: NHL_BEN_JONES },
      { strPlayer: 'Ben Jones', strSport: 'American Football', strTeam: 'Tennessee Titans', strPosition: 'Center', strCutout: NFL_BEN_JONES },
    ])
    expect(await nflTheSportsDbHeadshot({ playerName: 'Ben Jones', teamAbbr: 'TEN', position: 'C' })).toBe(NFL_BEN_JONES)
  })

  it('refuses when the only hit is a differently-named player from another sport', async () => {
    stubSearch([
      { strPlayer: 'Cameron Jackson', strSport: 'Basketball', strTeam: 'Wake Forest Demon Deacons', strCutout: NCAAB_CAMERON_JACKSON },
    ])
    expect(await nflTheSportsDbHeadshot({ playerName: 'Cam Jackson', teamAbbr: 'CAR', position: 'DL' })).toBeNull()
  })

  it('reads the `player` key the worker adapter uses as well', async () => {
    stubSearch([
      { strPlayer: 'Ben Jones', strSport: 'Ice Hockey', strTeam: 'Vegas Golden Knights', strCutout: NHL_BEN_JONES },
      { strPlayer: 'Ben Jones', strSport: 'American Football', strTeam: 'Tennessee Titans', strPosition: 'Center', strCutout: NFL_BEN_JONES },
    ], 'player')
    expect(await nflTheSportsDbHeadshot({ playerName: 'Ben Jones', teamAbbr: 'TEN', position: 'C' })).toBe(NFL_BEN_JONES)
  })

  it('refuses an American-football namesake whose position contradicts the request', async () => {
    stubSearch([
      { strPlayer: 'Chris Jones', strSport: 'American Football', strTeam: 'Kansas City Chiefs', strPosition: 'Cornerback', strCutout: CB_CHRIS_JONES },
    ])
    expect(await nflTheSportsDbHeadshot({ playerName: 'Chris Jones', teamAbbr: 'KC', position: 'DL' })).toBeNull()
  })
})

describe('b. SportsPlayer cache tier', () => {
  it('serves DL Chris Jones his own photo, not CB Chris Jones\'s (Sleeper 5815)', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      { team: null, position: 'CB', imageUrl: CB_CHRIS_JONES },
      // The DL's own row, already poisoned by a resolver write-back with the CB's photo.
      { team: 'Kansas City Chiefs', position: 'DL', imageUrl: CB_CHRIS_JONES },
      { team: 'Las Vegas Raiders', position: 'DB', imageUrl: null },
      { team: null, position: 'P', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/903.jpg' },
      { team: 'Kansas City Chiefs', position: 'DT', imageUrl: DL_CHRIS_JONES },
    ])
    const result = await resolvePlayerHeadshot({ name: 'Chris Jones', sport: 'NFL', team: 'KC', position: 'DL' })
    expect(result.imageUrl).toBe(DL_CHRIS_JONES)
    expect(result.source).toBe('sportsplayer')
  })

  it('refuses rather than fall back to the first row when no row is this player', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      { team: null, position: 'QB', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/6954.jpg' },
    ])
    const result = await resolvePlayerHeadshot({ name: 'Cole McDonald', sport: 'NFL', team: 'KC', position: 'LB' })
    expect(result.imageUrl).toBeNull()
  })

  it('refuses a namesake that matches on team but not position (team OR position is not enough)', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      { team: 'Indianapolis Colts', position: 'LB', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/6526.jpg' },
    ])
    const result = await resolvePlayerHeadshot({ name: 'Tre Thomas', sport: 'NFL', team: 'IND', position: 'S' })
    expect(result.imageUrl).toBeNull()
  })
})

describe('c. findMatchingRow', () => {
  it('returns null when no row matches — never rows[0]', () => {
    const rows = [
      { name: 'Somebody Else', team: 'BUF' },
      { name: 'Another Person', team: 'MIA' },
    ]
    expect(findMatchingRow(rows, { capability: 'player_identity', playerName: 'Bijan Robinson', teamAbbr: 'ATL' })).toBeNull()
  })

  it('still finds the matching row', () => {
    const rows = [
      { name: 'Somebody Else', team: 'BUF' },
      { name: 'Bijan Robinson', team: 'Atlanta Falcons' },
    ]
    expect(findMatchingRow(rows, { capability: 'player_identity', playerName: 'Bijan Robinson', teamAbbr: 'ATL' })).toBe(rows[1])
  })
})

describe('d. PlayerImage rows written by the pre-fix resolver are not served', () => {
  it('readPrimaryPlayerImage only asks for trusted rows', async () => {
    await readPrimaryPlayerImage({ playerId: 'nfl-chris-jones-kc' })
    const where = (prismaMock.playerImage.findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({
      playerId: 'nfl-chris-jones-kc',
      OR: expect.arrayContaining([
        { provider: { notIn: expect.arrayContaining(['sportsdb', 'sportsplayer']) } },
        { rawPayload: { path: ['headshotResolver'], equals: 'v2' } },
      ]),
    })
  })

  it('an unstamped resolver row hides itself and the identical Player.imageUrl copy', () => {
    const legacy = { url: CB_CHRIS_JONES, provider: 'sportsplayer', rawPayload: null }
    expect(servedPlayerImageUrl(legacy, CB_CHRIS_JONES)).toBeNull()
    expect(servedPlayerImageUrl({ ...legacy, rawPayload: { headshotResolver: 'v2' } }, CB_CHRIS_JONES)).toBe(CB_CHRIS_JONES)
    expect(servedPlayerImageUrl({ url: DL_CHRIS_JONES, provider: 'espn', rawPayload: null }, null)).toBe(DL_CHRIS_JONES)
  })

  it('getCanonicalPlayersBySleeperIds does not serve a pre-fix cached image', async () => {
    prismaMock.playerProviderIdentity.findMany.mockResolvedValue([{ playerId: 'p1', providerPlayerId: '3558' }])
    prismaMock.player.findMany.mockResolvedValue([
      { id: 'p1', name: 'Chris Jones', sport: 'NFL', position: 'DL', team: 'KC', active: true, imageUrl: CB_CHRIS_JONES, injuryStatus: null, fetchedAt: null, expiresAt: null },
    ])
    prismaMock.playerImage.findMany.mockResolvedValue([
      { playerId: 'p1', url: CB_CHRIS_JONES, provider: 'sportsplayer', rawPayload: null },
    ])
    const map = await getCanonicalPlayersBySleeperIds(['3558'])
    expect(map.get('3558')?.imageUrl).toBeNull()
  })

  it('the fixed resolver stamps what it writes, so its rows are served again', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      { team: 'Kansas City Chiefs', position: 'DT', imageUrl: DL_CHRIS_JONES },
    ])
    const tx = {
      player: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
      playerImage: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
    }
    ;(prismaMock as unknown as { $transaction: unknown }).$transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
    const result = await resolvePlayerHeadshot({ name: 'Chris Jones', sport: 'NFL', team: 'KC', position: 'DL', playerId: 'p1' })
    expect(result.imageUrl).toBe(DL_CHRIS_JONES)
    const created = (tx.playerImage.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
    expect(created.rawPayload).toEqual({ headshotResolver: 'v2' })
  })
})
