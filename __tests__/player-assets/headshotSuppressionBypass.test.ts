/**
 * The two copies of a pre-fix headshot that the PlayerImage suppression could not reach,
 * measured in production 2026-10-12:
 *
 *   1. `Player.imageUrl`, read raw by the Sleeper crosswalk (Chimmy's player cards): 152 rows share
 *      a URL with a differently named player — OT Trent Brown (HOU) wore CB Tre' Brown III's photo.
 *   2. `SportsPlayer.imageUrl`, which the image cron mirrored every resolution into: NFL DL Cam
 *      Jackson (Rolling Insights 8966) carried NCAAB forward Cameron Jackson's cutout on the card.
 *
 * And the case that must NOT be suppressed: a URL shared by one man under two spellings
 * ("Kevin Winston" / "Kevin Winston Jr.", accents), which is most cross-name shares.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => [] as unknown[]),
  player: { findMany: vi.fn(async (_args?: unknown) => [] as unknown[]), update: vi.fn(async () => ({})) },
  sportsPlayer: {
    findMany: vi.fn(async (_args?: unknown) => [] as unknown[]),
    findFirst: vi.fn(async () => null as unknown),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  redraftRosterPlayer: { findMany: vi.fn(async () => [] as unknown[]) },
  playerImage: { findMany: vi.fn(async () => [] as unknown[]), findFirst: vi.fn(async () => null as unknown) },
  playerProviderIdentity: { findMany: vi.fn(async () => [] as unknown[]) },
  playerIdentityMap: { findMany: vi.fn(async () => [] as unknown[]) },
  sportsPlayerRecord: { findMany: vi.fn(async () => [] as unknown[]) },
  teamAsset: { findMany: vi.fn(async () => [] as unknown[]) },
}))
const resolverResult = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ recordSyncJobRun: vi.fn(async () => undefined) }))
vi.mock('@/lib/sport-teams/teamImageStore', () => ({ TEAM_IMAGE_TYPE_LOGO: 'logo', writePrimaryTeamImage: vi.fn() }))
vi.mock('@/lib/player-assets/resolvePlayerHeadshot', () => ({
  createBatchPlayerHeadshotResolver: vi.fn(async () => ({
    resolve: vi.fn(async () => resolverResult.value),
    stats: () => ({ clearSportsCacheSize: 0, sport: 'NFL' }),
  })),
}))

import { resetPlayerImageSuspicionCache, withoutDetectablyWrongHeadshots } from '@/lib/player-assets/playerImageStore'
import { resolveImagesByPlayerName, resolveSleeperPlayerIdentities, playerImageKey } from '@/lib/players/sleeperPlayerCrosswalk'
import { searchPlayers } from '@/lib/core-app/playerFinder'
import { attachPlayerMediaBatch, clearMediaCache } from '@/lib/player-media'
import { GET as syncPlayerImages } from '@/app/api/cron/sync-player-images/route'
import { getCanonicalPlayerMapForSport, getCanonicalPlayersBySleeperIds } from '@/lib/canonical/getCanonicalPlayer'

const TRE_BROWN_PHOTO = 'https://r2.thesportsdb.com/images/media/player/cutout/tre-brown-iii.png'
const CAMERON_JACKSON_PHOTO = 'https://r2.thesportsdb.com/images/media/player/cutout/cm9h7v1648234807.png'
const WINSTON_PHOTO = 'https://r2.thesportsdb.com/images/media/player/cutout/kevin-winston.png'
const VUCEVIC_PHOTO = 'https://r2.thesportsdb.com/images/media/player/cutout/vucevic.png'

const holder = (url: string, player_id: string, name: string, sport: string, position: string | null, team: string | null, trusted = false) =>
  ({ url, player_id, trusted, name, sport, team, position })

/** The shared-URL snapshot, copied from the production holders of each URL. */
const SNAPSHOT = [
  holder(TRE_BROWN_PHOTO, 'nfl-trent-brown', 'Trent Brown', 'NFL', 'OT', 'HOU'),
  holder(TRE_BROWN_PHOTO, 'nfl-tre-brown-iii', "Tre' Brown III", 'NFL', 'CB', 'SEA'),
  holder(CAMERON_JACKSON_PHOTO, 'nfl-cam-jackson', 'Cam Jackson', 'NFL', 'DL', 'CAR'),
  holder(CAMERON_JACKSON_PHOTO, 'ncaab-cameron-jackson', 'Cameron Jackson', 'NCAAB', 'F', 'University of Texas at Arlington'),
  holder(WINSTON_PHOTO, 'nfl-kevin-winston', 'Kevin Winston', 'NFL', 'DB', 'TEN'),
  holder(WINSTON_PHOTO, 'nfl-kevin-winston-jr', 'Kevin Winston Jr.', 'NFL', 'S', 'TEN'),
  holder(VUCEVIC_PHOTO, 'nba-nikola-vucevic-a', 'Nikola Vucevic', 'NBA', 'C', 'BOS'),
  holder(VUCEVIC_PHOTO, 'nba-nikola-vucevic-b', 'Nikola Vucevic', 'NBA', 'PF', null),
]

beforeEach(() => {
  for (const group of Object.values(prismaMock)) {
    if (typeof group === 'function') continue
    for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([])
  }
  prismaMock.$queryRaw.mockReset().mockResolvedValue(SNAPSHOT)
  prismaMock.sportsPlayer.findFirst.mockResolvedValue(null)
  prismaMock.playerImage.findFirst.mockResolvedValue(null)
  prismaMock.sportsPlayer.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.player.update.mockResolvedValue({})
  resetPlayerImageSuspicionCache()
  clearMediaCache()
})

describe('Player.imageUrl — the Sleeper crosswalk', () => {
  it('resolveImagesByPlayerName drops Trent Brown\'s copy of Tre\' Brown III\'s photo and keeps a Jr. spelling variant', async () => {
    prismaMock.player.findMany.mockResolvedValue([
      { id: 'nfl-trent-brown', name: 'Trent Brown', imageUrl: TRE_BROWN_PHOTO, position: 'OT', team: 'HOU' },
      { id: 'nfl-kevin-winston', name: 'Kevin Winston', imageUrl: WINSTON_PHOTO, position: 'DB', team: 'TEN' },
    ])
    const trent = { name: 'Trent Brown', position: 'OT', team: 'HOU' }
    const winston = { name: 'Kevin Winston', position: 'DB', team: 'TEN' }
    const out = await resolveImagesByPlayerName([trent, winston], 'NFL')
    expect(out.has(playerImageKey(trent))).toBe(false)
    expect(out.get(playerImageKey(winston))).toBe(WINSTON_PHOTO)
  })

  it('resolveSleeperPlayerIdentities does not serve the canonical row\'s wrong photo, falling back to the id\'s own thumbnail', async () => {
    prismaMock.sportsPlayer.findMany.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: { source?: string } }).where ?? {}
      if (where.source === 'sleeper') return [] // the owner lookup for Sleeper thumbnails
      return [
        { externalId: 'sleeper:6011', sleeperId: '6011', name: 'Trent Brown', position: 'OT', team: 'HOU', imageUrl: null },
        { externalId: 'sleeper:7012', sleeperId: '7012', name: 'Kevin Winston', position: 'DB', team: 'TEN', imageUrl: null },
      ]
    })
    prismaMock.player.findMany.mockResolvedValue([
      { id: 'nfl-trent-brown', name: 'Trent Brown', imageUrl: TRE_BROWN_PHOTO, position: 'OT', team: 'HOU' },
      { id: 'nfl-kevin-winston', name: 'Kevin Winston', imageUrl: WINSTON_PHOTO, position: 'DB', team: 'TEN' },
    ])
    const { byId } = await resolveSleeperPlayerIdentities(['6011', '7012'], 'nfl')
    expect(byId.get('6011')?.canonicalPlayerId).toBe('nfl-trent-brown')
    expect(byId.get('6011')?.imageUrl).not.toBe(TRE_BROWN_PHOTO)
    expect(byId.get('6011')?.imageUrl).toMatch(/sleepercdn\.com\/content\/nfl\/players\/thumb\/6011\.jpg/)
    expect(byId.get('7012')?.imageUrl).toBe(WINSTON_PHOTO)
  })

  it('resolveSleeperPlayerIdentities does not serve a SportsPlayer row\'s mirrored wrong photo either', async () => {
    prismaMock.sportsPlayer.findMany.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: { source?: string } }).where ?? {}
      if (where.source === 'sleeper') return []
      return [{ externalId: '8966', sleeperId: '8966', name: 'Cam Jackson', position: 'DL', team: 'CAR', imageUrl: CAMERON_JACKSON_PHOTO }]
    })
    const { byId } = await resolveSleeperPlayerIdentities(['8966'], 'nfl')
    expect(byId.get('8966')?.name).toBe('Cam Jackson')
    expect(byId.get('8966')?.imageUrl).not.toBe(CAMERON_JACKSON_PHOTO)
  })
})

describe('SportsPlayer.imageUrl — every reader that serves the legacy column', () => {
  const sp = (over: Record<string, unknown>) => ({ number: null, sport: 'NFL', ...over })

  it('withoutDetectablyWrongHeadshots nulls Cam Jackson\'s NCAAB photo and keeps Jr. and accent variants', async () => {
    const rows = await withoutDetectablyWrongHeadshots([
      sp({ name: 'Cam Jackson', position: 'DL', team: 'Carolina Panthers', imageUrl: CAMERON_JACKSON_PHOTO }),
      sp({ name: 'Kevin Winston Jr.', position: 'S', team: 'Tennessee Titans', imageUrl: WINSTON_PHOTO }),
      sp({ name: 'Nikola Vučević', sport: 'NBA', position: 'C', team: 'Boston Celtics', imageUrl: VUCEVIC_PHOTO }),
    ])
    expect(rows.map((r) => r.imageUrl)).toEqual([null, WINSTON_PHOTO, VUCEVIC_PHOTO])
  })

  it('a URL vouched for by the same man\'s verified row is served even though a namesake shares it', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      holder(TRE_BROWN_PHOTO, 'nfl-tre-brown-iii', "Tre' Brown III", 'NFL', 'CB', 'SEA', true),
      holder(TRE_BROWN_PHOTO, 'nfl-trent-brown', 'Trent Brown', 'NFL', 'OT', 'HOU'),
    ])
    const rows = await withoutDetectablyWrongHeadshots([
      sp({ name: "Tre' Brown", position: 'CB', team: 'SEA', imageUrl: TRE_BROWN_PHOTO }),
      sp({ name: 'Trent Brown', position: 'OT', team: 'HOU', imageUrl: TRE_BROWN_PHOTO }),
    ])
    expect(rows.map((r) => r.imageUrl)).toEqual([TRE_BROWN_PHOTO, null])
  })

  it('player search (the collapse) serves no face for the wrong photo, and the Jr. variant\'s face', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      sp({ externalId: '8966', sleeperId: null, name: 'Cam Jackson', position: 'DL', team: 'CAR', imageUrl: CAMERON_JACKSON_PHOTO }),
      sp({ externalId: '9001', sleeperId: null, name: 'Kevin Winston Jr.', position: 'S', team: 'TEN', imageUrl: WINSTON_PHOTO }),
    ])
    const matches = await searchPlayers('ja', 12)
    expect(matches.find((m) => m.name === 'Cam Jackson')?.imageUrl).toBeNull()
    expect(matches.find((m) => m.name === 'Kevin Winston Jr.')?.imageUrl).toBe(WINSTON_PHOTO)
  })

  it('player-media serves the Sleeper template, not the mirrored wrong photo', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      { sleeperId: '11650', name: 'Cam Jackson', sport: 'NFL', position: 'DL', team: 'CAR', imageUrl: CAMERON_JACKSON_PHOTO },
      { sleeperId: '12001', name: 'Kevin Winston Jr.', sport: 'NFL', position: 'S', team: 'TEN', imageUrl: WINSTON_PHOTO },
    ])
    const media = await attachPlayerMediaBatch([
      { playerId: '11650', sport: 'nfl' },
      { playerId: '12001', sport: 'nfl' },
    ])
    expect(media.get('11650')?.media.headshotUrl).not.toBe(CAMERON_JACKSON_PHOTO)
    expect(media.get('12001')?.media.headshotUrl).toBe(WINSTON_PHOTO)
  })
})

describe('image cron — mirrorToLegacy', () => {
  const camJackson = { id: 'nfl-cam-jackson', name: 'Cam Jackson', team: 'CAR', sport: 'NFL', position: 'DL', providerIds: { rolling_insights: '8966' } }

  async function runOnce() {
    prismaMock.player.findMany.mockImplementation(async (args: unknown) =>
      (args as { where: Record<string, unknown> }).where.imageUrl === null ? [camJackson] : [],
    )
    const req = new Request('https://worker.invalid/api/cron/sync-player-images?sport=NFL&scope=players&limit=10')
    await syncPlayerImages(req as never)
  }

  it('does not copy a cache hit from an unstamped pre-fix row into Player.imageUrl or SportsPlayer.imageUrl', async () => {
    resolverResult.value = { imageUrl: CAMERON_JACKSON_PHOTO, source: 'sportsdb', confidence: 'exact', cacheHit: true }
    prismaMock.playerImage.findFirst.mockResolvedValue({ provider: 'sportsdb', rawPayload: null })
    await runOnce()
    expect(prismaMock.player.update).not.toHaveBeenCalled()
    expect(prismaMock.sportsPlayer.updateMany).not.toHaveBeenCalled()
  })

  it('does copy a cache hit whose row the fixed resolver stamped (a live request wrote it)', async () => {
    const own = 'https://r2.thesportsdb.com/images/media/player/cutout/nfl-cam-jackson.png'
    resolverResult.value = { imageUrl: own, source: 'sportsdb', confidence: 'exact', cacheHit: true }
    prismaMock.playerImage.findFirst.mockResolvedValue({ provider: 'sportsdb', rawPayload: { headshotResolver: 'v2' } })
    await runOnce()
    expect(prismaMock.player.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ imageUrl: own }) }))
    expect(prismaMock.sportsPlayer.updateMany).toHaveBeenCalled()
  })

  it('does copy a fresh resolution the fixed resolver persisted', async () => {
    const own = 'https://r2.thesportsdb.com/images/media/player/cutout/nfl-cam-jackson.png'
    resolverResult.value = { imageUrl: own, source: 'sportsdb', confidence: 'name_team_position', cacheHit: false, persisted: true }
    await runOnce()
    expect(prismaMock.player.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ imageUrl: own }) }))
    expect(prismaMock.sportsPlayer.updateMany).toHaveBeenCalledWith({
      where: { sport: 'NFL', source: 'rolling_insights', externalId: '8966' },
      data: { imageUrl: own },
    })
  })
})

describe('Player.imageUrl with no primary PlayerImage row — the canonical batch readers', () => {
  const players = [
    { id: 'nfl-trent-brown', name: 'Trent Brown', sport: 'NFL', position: 'OT', team: 'HOU', active: true, imageUrl: TRE_BROWN_PHOTO, injuryStatus: null, fetchedAt: null, expiresAt: null },
    { id: 'nfl-kevin-winston', name: 'Kevin Winston', sport: 'NFL', position: 'DB', team: 'TEN', active: true, imageUrl: WINSTON_PHOTO, injuryStatus: null, fetchedAt: null, expiresAt: null },
  ]
  beforeEach(() => {
    prismaMock.playerProviderIdentity.findMany.mockResolvedValue([
      { playerId: 'nfl-trent-brown', providerPlayerId: '6011' },
      { playerId: 'nfl-kevin-winston', providerPlayerId: '7012' },
    ])
    prismaMock.player.findMany.mockResolvedValue(players)
    prismaMock.playerImage.findMany.mockResolvedValue([]) // neither has a primary row
  })

  it('getCanonicalPlayersBySleeperIds drops Trent Brown\'s copy and keeps the Jr. spelling variant', async () => {
    const map = await getCanonicalPlayersBySleeperIds(['6011', '7012'])
    expect(map.get('6011')?.imageUrl).toBeNull()
    expect(map.get('7012')?.imageUrl).toBe(WINSTON_PHOTO)
  })

  it('getCanonicalPlayerMapForSport judges Player.imageUrl with and without includeImages', async () => {
    for (const includeImages of [true, false]) {
      resetPlayerImageSuspicionCache()
      const map = await getCanonicalPlayerMapForSport('NFL', { includeImages })
      expect(map.get('6011')?.imageUrl).toBeNull()
      expect(map.get('7012')?.imageUrl).toBe(WINSTON_PHOTO)
    }
  })
})
