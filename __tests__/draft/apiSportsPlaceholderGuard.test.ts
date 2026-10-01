/**
 * api-sports answers "no photo" with HTTP 200 and a stock image. Measured
 * 2026-10-01: 58 of 60 sampled NCAAF api-sports headshots were that picture, and
 * the resolver cached and mirrored every one as a real headshot.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiSportsLib = vi.hoisted(() => ({ fetchAPISportsPlayerBySearch: vi.fn() }))
const placeholder = vi.hoisted(() => ({ isPlaceholderHeadshot: vi.fn() }))
const prismaMock = vi.hoisted(() => ({ sportsPlayer: { findMany: vi.fn(async () => []) } }))
const imageStoreMock = vi.hoisted(() => ({
  PLAYER_IMAGE_TYPE_HEADSHOT: 'headshot',
  readPrimaryPlayerImage: vi.fn(async () => null),
  writePrimaryPlayerImage: vi.fn(async () => ({ written: true, skippedReason: null })),
}))

vi.mock('@/lib/api-sports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-sports')>()),
  fetchAPISportsPlayerBySearch: apiSportsLib.fetchAPISportsPlayerBySearch,
}))
vi.mock('@/lib/player-assets/apiSportsPlaceholder', () => placeholder)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/player-assets/playerImageStore', () => imageStoreMock)
vi.mock('@/lib/nfl-provider/nflRedraftProviderCertification', () => ({
  resolveNflRedraftCanonicalHeadshot: vi.fn(async () => ({ imageUrl: null, source: 'none', confidence: 'none' })),
}))

import { resolvePlayerHeadshot } from '@/lib/player-assets/resolvePlayerHeadshot'

const PHOTO = 'https://media.api-sports.io/american-football/players/60595.png'

describe('resolvePlayerHeadshot — api-sports placeholder', () => {
  beforeEach(() => {
    apiSportsLib.fetchAPISportsPlayerBySearch.mockReset().mockResolvedValue([
      { id: 60595, name: 'Alex Cook', image: PHOTO, team: { name: 'Temple' } },
    ])
    placeholder.isPlaceholderHeadshot.mockReset()
    imageStoreMock.writePrimaryPlayerImage.mockClear()
    // TheSportsDB finds nobody, so api-sports is the deciding tier.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ player: null }) })))
  })

  it('refuses a confirmed placeholder and caches nothing', async () => {
    placeholder.isPlaceholderHeadshot.mockResolvedValue(true)
    const result = await resolvePlayerHeadshot({ name: 'Alex Cook', sport: 'NCAAF' })
    expect(placeholder.isPlaceholderHeadshot).toHaveBeenCalledWith(PHOTO)
    expect(result.imageUrl).toBeNull()
    expect(imageStoreMock.writePrimaryPlayerImage).not.toHaveBeenCalled()
    // One placeholder answers for the player — later name variants are not re-asked.
    expect(placeholder.isPlaceholderHeadshot).toHaveBeenCalledTimes(1)
  })

  it('keeps a real photo, and one it could not check', async () => {
    for (const verdict of [false, null]) {
      placeholder.isPlaceholderHeadshot.mockResolvedValue(verdict)
      const result = await resolvePlayerHeadshot({ name: 'Alex Cook', sport: 'NCAAF' })
      expect(result.imageUrl, `verdict ${verdict}`).toBe(PHOTO)
      expect(result.source).toBe('apisports')
    }
  })
})
