/**
 * Phase 1 — player image write-through cache.
 *
 * The headline guarantee under test: once a headshot has been resolved through the live
 * provider chain, the *next* lookup for that player is served from `PlayerImage` and makes
 * zero provider calls.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  playerImage: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  sportsPlayer: { findMany: vi.fn(async () => []) },
  $transaction: vi.fn(),
}))

const nflProviderMock = vi.hoisted(() => ({
  resolveNflRedraftCanonicalHeadshot: vi.fn(),
}))

const sportsDbMock = vi.hoisted(() => ({ theSportsDbProvider: { fetch: vi.fn() } }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/nfl-provider/nflRedraftProviderCertification', () => nflProviderMock)
vi.mock('@/lib/workers/providers/thesportsdb', () => sportsDbMock)

import {
  PLAYER_IMAGE_TTL_MS,
  readPrimaryPlayerImage,
  writePrimaryPlayerImage,
} from '@/lib/player-assets/playerImageStore'
import { resolvePlayerHeadshot } from '@/lib/player-assets/resolvePlayerHeadshot'

const HEADSHOT = 'https://a.espncdn.com/i/headshots/nfl/players/full/3139477.png'
const OLD_HEADSHOT = 'https://a.espncdn.com/i/headshots/nfl/players/full/0000001.png'

/** Run `$transaction(cb)` against the same mock object the real client would pass. */
function wireTransaction() {
  prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prismaMock))
}

beforeEach(() => {
  vi.clearAllMocks()
  wireTransaction()
  prismaMock.playerImage.findFirst.mockResolvedValue(null)
  prismaMock.playerImage.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.playerImage.create.mockResolvedValue({ id: 'img-1' })
  prismaMock.playerImage.update.mockResolvedValue({ id: 'img-1' })
  sportsDbMock.theSportsDbProvider.fetch.mockResolvedValue(null)
})

describe('resolvePlayerHeadshot — NFL falls through past the canonical provider', () => {
  /**
   * Regression: the NFL branch used to `return` whatever the canonical orchestrator gave
   * back, including its `default_avatar` fallback of `headshotUrl: null`. That made every
   * later tier unreachable for NFL, so players whose headshot TheSportsDB serves on request
   * were reported as having none. Verified live against Ja'Marr Chase before the fix.
   */
  it('reaches TheSportsDB when the canonical NFL provider returns its default avatar', async () => {
    nflProviderMock.resolveNflRedraftCanonicalHeadshot.mockResolvedValue({
      imageUrl: null,
      source: 'none',
      confidence: 'none',
    })
    sportsDbMock.theSportsDbProvider.fetch.mockResolvedValue({ headshotUrl: HEADSHOT })

    const result = await resolvePlayerHeadshot({ name: 'Ja’Marr Chase', sport: 'NFL', team: 'CIN' })

    expect(nflProviderMock.resolveNflRedraftCanonicalHeadshot).toHaveBeenCalledTimes(1)
    expect(sportsDbMock.theSportsDbProvider.fetch).toHaveBeenCalled()
    expect(result.imageUrl).toBe(HEADSHOT)
    expect(result.source).toBe('sportsdb')
  })

  it('still prefers the canonical provider when it does return an image', async () => {
    nflProviderMock.resolveNflRedraftCanonicalHeadshot.mockResolvedValue({
      imageUrl: HEADSHOT,
      source: 'clearsports',
      confidence: 'exact',
    })

    const result = await resolvePlayerHeadshot({ name: 'Ja’Marr Chase', sport: 'NFL', team: 'CIN' })

    expect(result.source).toBe('clearsports')
    // Dedicated-provider-first ordering: no lower tier is consulted on a canonical hit.
    expect(sportsDbMock.theSportsDbProvider.fetch).not.toHaveBeenCalled()
  })

  it('falls through rather than dying when the canonical provider throws', async () => {
    nflProviderMock.resolveNflRedraftCanonicalHeadshot.mockRejectedValue(new Error('orchestrator down'))
    sportsDbMock.theSportsDbProvider.fetch.mockResolvedValue({ headshotUrl: HEADSHOT })

    const result = await resolvePlayerHeadshot({ name: 'Ja’Marr Chase', sport: 'NFL', team: 'CIN' })

    expect(result.imageUrl).toBe(HEADSHOT)
  })
})

describe('playerImageStore — write contract', () => {
  it('persists a resolved headshot with the required sportKey/imageType the old script omitted', async () => {
    const result = await writePrimaryPlayerImage({
      playerId: 'player-1',
      sportKey: 'nfl',
      url: HEADSHOT,
      provider: 'sportsdb',
      confidence: 0.8,
    })

    expect(result).toMatchObject({ written: true, skippedReason: null })
    expect(prismaMock.playerImage.create).toHaveBeenCalledTimes(1)

    const data = prismaMock.playerImage.create.mock.calls[0][0].data
    // sportKey + imageType are non-null columns; omitting them is what made the
    // pre-Phase-1 write in scripts/sync-player-images.ts throw on every call.
    expect(data.sportKey).toBe('NFL')
    expect(data.imageType).toBe('headshot')
    expect(data.isPrimary).toBe(true)
    expect(data.url).toBe(HEADSHOT)
    expect(data.expiresAt.getTime() - data.fetchedAt.getTime()).toBe(PLAYER_IMAGE_TTL_MS)
  })

  it('demotes the previous primary when a player gets a new headshot URL', async () => {
    prismaMock.playerImage.updateMany.mockResolvedValue({ count: 1 })

    const result = await writePrimaryPlayerImage({
      playerId: 'player-1',
      sportKey: 'NFL',
      url: HEADSHOT,
    })

    expect(result.demoted).toBe(1)
    expect(prismaMock.playerImage.updateMany).toHaveBeenCalledWith({
      where: { playerId: 'player-1', imageType: 'headshot', isPrimary: true, NOT: { url: HEADSHOT } },
      data: { isPrimary: false },
    })
  })

  it('updates in place instead of inserting a duplicate when the same URL re-resolves', async () => {
    prismaMock.playerImage.findFirst.mockResolvedValue({ id: 'img-existing' })

    await writePrimaryPlayerImage({ playerId: 'player-1', sportKey: 'NFL', url: HEADSHOT })

    expect(prismaMock.playerImage.create).not.toHaveBeenCalled()
    expect(prismaMock.playerImage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'img-existing' } }),
    )
  })

  it('refuses to write a NULL-keyed row (Postgres would never dedupe it)', async () => {
    const result = await writePrimaryPlayerImage({ playerId: null, sportKey: 'NFL', url: HEADSHOT })

    expect(result).toEqual({ written: false, demoted: 0, skippedReason: 'missing_player_id' })
    expect(prismaMock.playerImage.create).not.toHaveBeenCalled()
  })

  it('never throws when the database is unavailable', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('connection refused'))

    const result = await writePrimaryPlayerImage({ playerId: 'p', sportKey: 'NFL', url: HEADSHOT })

    expect(result.written).toBe(false)
    expect(result.skippedReason).toContain('connection refused')
  })

  it('treats a concurrent writer (P2002) as success', async () => {
    prismaMock.$transaction.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

    const result = await writePrimaryPlayerImage({ playerId: 'p', sportKey: 'NFL', url: HEADSHOT })

    expect(result.written).toBe(true)
  })
})

describe('playerImageStore — read contract', () => {
  it('flags a row past its expiry as stale but still returns the URL', async () => {
    prismaMock.playerImage.findFirst.mockResolvedValue({
      url: HEADSHOT,
      provider: 'sportsdb',
      confidence: 0.8,
      fetchedAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-01-15'),
    })

    const row = await readPrimaryPlayerImage({ playerId: 'p', now: new Date('2026-02-01') })

    expect(row?.stale).toBe(true)
    expect(row?.url).toBe(HEADSHOT)
  })

  it('prefers the live primary over a row demoted mid-write', async () => {
    prismaMock.playerImage.findFirst.mockResolvedValue({
      url: HEADSHOT,
      provider: null,
      confidence: null,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + PLAYER_IMAGE_TTL_MS),
    })

    await readPrimaryPlayerImage({ playerId: 'p' })

    expect(prismaMock.playerImage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ isPrimary: 'desc' }, { fetchedAt: 'desc' }] }),
    )
  })
})

describe('resolvePlayerHeadshot — write-through behaviour', () => {
  it('calls the provider on a cache miss, then persists the result', async () => {
    nflProviderMock.resolveNflRedraftCanonicalHeadshot.mockResolvedValue({
      imageUrl: HEADSHOT,
      source: 'sportsdb',
      confidence: 'name_team_position',
    })

    const result = await resolvePlayerHeadshot({
      name: 'Ja’Marr Chase',
      sport: 'NFL',
      team: 'CIN',
      playerId: 'player-1',
    })

    expect(nflProviderMock.resolveNflRedraftCanonicalHeadshot).toHaveBeenCalledTimes(1)
    expect(result.imageUrl).toBe(HEADSHOT)
    expect(result.cacheHit).toBe(false)
    expect(result.persisted).toBe(true)
    expect(prismaMock.playerImage.create).toHaveBeenCalledTimes(1)
  })

  it('serves a fresh cached row WITHOUT calling any provider', async () => {
    prismaMock.playerImage.findFirst.mockResolvedValue({
      url: HEADSHOT,
      provider: 'sportsdb',
      confidence: 0.8,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + PLAYER_IMAGE_TTL_MS),
    })

    const result = await resolvePlayerHeadshot({
      name: 'Ja’Marr Chase',
      sport: 'NFL',
      team: 'CIN',
      playerId: 'player-1',
    })

    expect(result.imageUrl).toBe(HEADSHOT)
    expect(result.cacheHit).toBe(true)
    // The whole point of Phase 1: no network call on the second lookup.
    expect(nflProviderMock.resolveNflRedraftCanonicalHeadshot).not.toHaveBeenCalled()
  })

  it('falls back to a stale image when every provider comes back empty', async () => {
    prismaMock.playerImage.findFirst.mockResolvedValue({
      url: OLD_HEADSHOT,
      provider: 'sleeper',
      confidence: 0.5,
      fetchedAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-01-15'),
    })
    nflProviderMock.resolveNflRedraftCanonicalHeadshot.mockResolvedValue({
      imageUrl: null,
      source: 'none',
      confidence: 'none',
    })

    const result = await resolvePlayerHeadshot({ name: 'Ghost Player', sport: 'NFL', playerId: 'p' })

    expect(nflProviderMock.resolveNflRedraftCanonicalHeadshot).toHaveBeenCalledTimes(1)
    expect(result.imageUrl).toBe(OLD_HEADSHOT)
    expect(result.servedStale).toBe(true)
  })

  it('is unchanged for callers that pass no playerId (back-compat)', async () => {
    nflProviderMock.resolveNflRedraftCanonicalHeadshot.mockResolvedValue({
      imageUrl: HEADSHOT,
      source: 'sportsdb',
      confidence: 'name_only',
    })

    const result = await resolvePlayerHeadshot({ name: 'Ja’Marr Chase', sport: 'NFL' })

    expect(result.imageUrl).toBe(HEADSHOT)
    expect(prismaMock.playerImage.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.playerImage.create).not.toHaveBeenCalled()
  })

  it('skipCache forces a live resolution even when a fresh row exists', async () => {
    prismaMock.playerImage.findFirst.mockResolvedValue({
      url: OLD_HEADSHOT,
      provider: 'sleeper',
      confidence: 0.5,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + PLAYER_IMAGE_TTL_MS),
    })
    nflProviderMock.resolveNflRedraftCanonicalHeadshot.mockResolvedValue({
      imageUrl: HEADSHOT,
      source: 'sportsdb',
      confidence: 'exact',
    })

    const result = await resolvePlayerHeadshot({
      name: 'Ja’Marr Chase',
      sport: 'NFL',
      playerId: 'player-1',
      skipCache: true,
    })

    expect(nflProviderMock.resolveNflRedraftCanonicalHeadshot).toHaveBeenCalledTimes(1)
    expect(result.imageUrl).toBe(HEADSHOT)
  })
})
