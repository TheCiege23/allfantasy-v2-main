/**
 * A Sleeper thumbnail names its owner, so the Sleeper headshot tier must never bind a namesake's.
 *
 * Measured in production 2026-10-13: S Mike Brown (TEN) held a v2-stamped — i.e. TRUSTED — primary
 * headshot of `thumb/1321`, Sleeper's free-agent WR Mike Brown. The tier matched names by substring
 * and let a team-less free agent through the team filter; the cron then copied the cache hit into
 * `Player.imageUrl` and the Rolling Insights Mike Brown's `SportsPlayer.imageUrl`. Sleeper lists
 * three Mike Browns: 1321 WR (FA), 7906 OL (FA), 8532 DB (NE).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => [] as unknown[]),
  player: { findMany: vi.fn(async (_args?: unknown) => [] as unknown[]), update: vi.fn(async () => ({})) },
  sportsPlayer: {
    findMany: vi.fn(async (_args?: unknown) => [] as unknown[]),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  playerImage: { findMany: vi.fn(async () => [] as unknown[]), findFirst: vi.fn(async () => null as unknown) },
}))
const resolverResult = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
const resolverInputs = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const sleeperBlob = vi.hoisted(() => ({ value: {} as Record<string, Record<string, unknown>> }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/sleeper-client', () => ({ getPlayersBySport: vi.fn(async () => sleeperBlob.value) }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ recordSyncJobRun: vi.fn(async () => undefined) }))
vi.mock('@/lib/sport-teams/teamImageStore', () => ({ TEAM_IMAGE_TYPE_LOGO: 'logo', writePrimaryTeamImage: vi.fn() }))
vi.mock('@/lib/player-assets/resolvePlayerHeadshot', () => ({
  createBatchPlayerHeadshotResolver: vi.fn(async () => ({
    resolve: vi.fn(async (input: Record<string, unknown>) => {
      resolverInputs.push(input)
      return resolverResult.value
    }),
    stats: () => ({ clearSportsCacheSize: 0, sport: 'NFL' }),
  })),
}))

import { pickSleeperHeadshotPlayer } from '@/lib/player-assets/headshotCandidateMatch'
import { sleeperChainProvider } from '@/lib/workers/providers/sleeper-chain'
import { GET as syncPlayerImages } from '@/app/api/cron/sync-player-images/route'

const thumb = (id: string) => `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`
const MIKE_BROWNS = [
  { id: '1321', name: 'Mike Brown', position: 'WR', team: null },
  { id: '7906', name: 'Mike Brown', position: 'OL', team: null },
  { id: '8532', name: 'Mike Brown', position: 'DB', team: 'NE' },
]

describe('pickSleeperHeadshotPlayer', () => {
  it('refuses S Mike Brown (TEN): three namesakes, none on his team or at his exact position', () => {
    expect(pickSleeperHeadshotPlayer(MIKE_BROWNS, { name: 'Mike Brown', position: 'S', team: 'TEN' })).toBeNull()
  })

  it('binds DB Mike Brown (NE) to 8532, not the first or the team-less namesake', () => {
    expect(pickSleeperHeadshotPlayer(MIKE_BROWNS, { name: 'Mike Brown', position: 'DB', team: 'New England Patriots' })?.id).toBe('8532')
  })

  it('takes the player\'s own Sleeper id when known, and only that id', () => {
    expect(pickSleeperHeadshotPlayer(MIKE_BROWNS, { sleeperId: '8532', name: 'Michael Brown', position: null, team: null })?.id).toBe('8532')
    expect(pickSleeperHeadshotPlayer(MIKE_BROWNS, { sleeperId: '99999', name: 'Mike Brown', position: 'DB', team: 'NE' })).toBeNull()
  })

  it('a unique name still needs an agreeing position group and the same stated club', () => {
    const one = [{ id: '6039', name: 'Ty Johnson', position: 'RB', team: 'BUF' }]
    expect(pickSleeperHeadshotPlayer(one, { name: 'Ty Johnson', position: 'RB', team: 'BUF' })?.id).toBe('6039')
    expect(pickSleeperHeadshotPlayer(one, { name: 'Ty Johnson', position: 'WR', team: 'BUF' })).toBeNull()
    expect(pickSleeperHeadshotPlayer(one, { name: 'Ty Johnson', position: 'RB', team: 'DAL' })).toBeNull()
    expect(pickSleeperHeadshotPlayer(one, { name: 'Ty Johnson', position: 'RB', team: null })).toBeNull()
    expect(pickSleeperHeadshotPlayer(one, { name: 'Tyler Johnson', position: 'RB', team: 'BUF' })).toBeNull()
  })
})

describe('sleeperChainProvider player_headshots', () => {
  beforeEach(() => {
    sleeperBlob.value = {
      '1321': { full_name: 'Mike Brown', position: 'WR', team: null },
      '7906': { full_name: 'Mike Brown', position: 'OL', team: null },
      '8532': { full_name: 'Mike Brown', position: 'DB', team: 'NE' },
    }
  })
  const fetchHeadshot = (query: Record<string, unknown>) =>
    sleeperChainProvider.fetch({ sport: 'NFL', dataType: 'player_headshots', query }) as Promise<{ headshotUrl?: string } | null>

  it('no longer hands S Mike Brown (TEN) the free-agent WR\'s thumbnail', async () => {
    expect(await fetchHeadshot({ search: 'Mike Brown', teamCode: 'TEN', position: 'S' })).toBeNull()
  })

  it('binds the verified namesake, and the own id when passed', async () => {
    expect((await fetchHeadshot({ search: 'Mike Brown', teamCode: 'NE', position: 'DB' }))?.headshotUrl).toBe(thumb('8532'))
    expect((await fetchHeadshot({ search: 'Mike Brown', teamCode: 'TEN', position: 'S', sleeperId: '7906' }))?.headshotUrl).toBe(thumb('7906'))
  })
})

describe('image cron — a trusted cached Sleeper thumbnail is re-verified before it is mirrored', () => {
  const tenSafety = { id: 'nfl-mike-brown-ten', name: 'Mike Brown', team: 'TEN', sport: 'NFL', position: 'S', providerIds: { rolling_insights: '6888' } }
  const neBack = { id: 'nfl-mike-brown-ne', name: 'Mike Brown', team: 'NE', sport: 'NFL', position: 'DB', providerIds: { thesportsdb: 'tsdb_1' } }

  beforeEach(() => {
    resolverInputs.length = 0
    prismaMock.player.update.mockClear()
    prismaMock.sportsPlayer.updateMany.mockClear()
    prismaMock.sportsPlayer.findMany.mockResolvedValue(
      MIKE_BROWNS.map((m) => ({ externalId: `sleeper:${m.id}`, name: m.name, position: m.position, team: m.team })),
    )
    prismaMock.playerImage.findFirst.mockResolvedValue({ provider: 'sleeper', rawPayload: { headshotResolver: 'v2' } })
  })

  async function runFor(player: Record<string, unknown>, url: string) {
    resolverResult.value = { imageUrl: url, source: 'sleeper', confidence: 'exact', cacheHit: true }
    prismaMock.player.findMany.mockImplementation(async (args: unknown) =>
      (args as { where: Record<string, unknown> }).where.imageUrl === null ? [player] : [],
    )
    await syncPlayerImages(new Request('https://worker.invalid/api/cron/sync-player-images?sport=NFL&scope=players&limit=10') as never)
  }

  it('does not copy S Mike Brown\'s stamped thumb/1321 into Player.imageUrl or the Rolling Insights row', async () => {
    await runFor(tenSafety, thumb('1321'))
    expect(prismaMock.player.update).not.toHaveBeenCalled()
    expect(prismaMock.sportsPlayer.updateMany).not.toHaveBeenCalled()
  })

  it('still copies a stamped Sleeper thumbnail the rule verifies', async () => {
    await runFor(neBack, thumb('8532'))
    expect(prismaMock.player.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ imageUrl: thumb('8532') }) }))
    expect(prismaMock.sportsPlayer.updateMany).toHaveBeenCalled()
  })

  it('finds a thumbnail owner stored under the `sleeper_<id>` externalId spelling', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      { sleeperId: '11789', externalId: 'sleeper_11789', name: 'Joshua Karty', position: 'K', team: 'Arizona Cardinals' },
    ])
    const karty = { id: 'nfl-joshua-karty', name: 'Joshua Karty', team: 'ARI', sport: 'NFL', position: 'PK', providerIds: {} }
    await runFor(karty, thumb('11789'))
    expect(prismaMock.player.update).toHaveBeenCalled()
  })

  it('passes the player\'s own Sleeper id to the resolver and holds the thumbnail to it', async () => {
    const owned = { ...tenSafety, providerIds: { sleeper: 'sleeper_7906' } }
    await runFor(owned, thumb('1321'))
    expect(resolverInputs[0]?.externalIds).toEqual({ sleeperId: '7906' })
    expect(prismaMock.player.update).not.toHaveBeenCalled()
    await runFor(owned, thumb('7906'))
    expect(prismaMock.player.update).toHaveBeenCalled()
  })
})
