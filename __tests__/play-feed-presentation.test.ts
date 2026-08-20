import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  readPlayByPlayFeed: vi.fn(),
  identityFindMany: vi.fn(),
  playerFindMany: vi.fn(),
}))

vi.mock('@/lib/live/playByPlayFeed', () => ({ readPlayByPlayFeed: h.readPlayByPlayFeed }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: h.identityFindMany },
    player: { findMany: h.playerFindMany },
  },
}))

import { getPlayFeed, headlineFor } from '@/lib/live/playFeedPresentation'

const event = (over: Record<string, unknown> = {}) => ({
  gameId: '20260820-1-26',
  playerId: '5474',
  playerName: 'Jerry Jeudy',
  team: 'CLE',
  type: 'BIG_PLAY',
  stat: 'receiving_yards',
  delta: 17,
  value: 62,
  detectedAt: new Date('2026-08-20T20:00:00Z'),
  idempotencyKey: '20260820-1-26:42:BIG_PLAY',
  ...over,
})

beforeEach(() => {
  h.readPlayByPlayFeed.mockReset()
  h.identityFindMany.mockReset()
  h.playerFindMany.mockReset()
  h.identityFindMany.mockResolvedValue([])
  h.playerFindMany.mockResolvedValue([])
})

describe('getPlayFeed', () => {
  it('joins a headshot through the Rolling Insights id, never through a name', async () => {
    h.readPlayByPlayFeed.mockResolvedValue([event()])
    h.identityFindMany.mockResolvedValue([
      { rollingInsightsId: '5474', canonicalName: 'Jerry Jeudy', position: 'WR', sport: 'NFL' },
    ])
    h.playerFindMany.mockResolvedValue([
      { name: 'Jerry Jeudy', imageUrl: 'https://img/jeudy.png', position: 'WR' },
    ])

    const feed = await getPlayFeed()

    // The lookup must be keyed on the RI id. A name-keyed query would attach the
    // wrong face, since most same-name groups here are different people.
    expect(h.identityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { rollingInsightsId: { in: ['5474'] } } }),
    )
    expect(feed[0].imageUrl).toBe('https://img/jeudy.png')
    expect(feed[0].headline).toBe('Jerry Jeudy (WR) caught a pass for 17 yards')
    expect(feed[0].yards).toBe(17)
  })

  it('returns the play WITHOUT an image when the id does not resolve', async () => {
    h.readPlayByPlayFeed.mockResolvedValue([event()])
    h.identityFindMany.mockResolvedValue([]) // unknown to the crosswalk

    const feed = await getPlayFeed()

    // A missing headshot is cosmetic. The wrong headshot on a touchdown is not.
    expect(feed).toHaveLength(1)
    expect(feed[0].imageUrl).toBeNull()
    expect(feed[0].playerName).toBe('Jerry Jeudy')
  })

  it('never queries the crosswalk for the parser\'s name: fallback ids', async () => {
    h.readPlayByPlayFeed.mockResolvedValue([event({ playerId: 'name:Unknown Guy' })])
    await getPlayFeed()
    // Only real ids are worth a round trip; `name:` means the play had no id.
    expect(h.identityFindMany).not.toHaveBeenCalled()
  })

  it('degrades to an empty feed instead of throwing when the store is down', async () => {
    h.readPlayByPlayFeed.mockRejectedValue(new Error('cache unavailable'))
    await expect(getPlayFeed()).resolves.toEqual([])
  })

  it('survives a headshot lookup failure and still returns the plays', async () => {
    h.readPlayByPlayFeed.mockResolvedValue([event()])
    h.identityFindMany.mockRejectedValue(new Error('db down'))

    const feed = await getPlayFeed()
    expect(feed).toHaveLength(1)
    expect(feed[0].imageUrl).toBeNull()
  })

  it('is empty on a quiet day rather than an error state', async () => {
    h.readPlayByPlayFeed.mockResolvedValue([])
    await expect(getPlayFeed()).resolves.toEqual([])
  })
})

describe('headlineFor', () => {
  it('distinguishes how a touchdown was scored', () => {
    expect(headlineFor(event({ type: 'TOUCHDOWN', stat: 'passing_touchdowns' }) as never, 'QB'))
      .toBe('Jerry Jeudy (QB) threw a touchdown')
    expect(headlineFor(event({ type: 'TOUCHDOWN', stat: 'receiving_touchdowns' }) as never, 'WR'))
      .toContain('caught a touchdown')
    expect(headlineFor(event({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns' }) as never, 'RB'))
      .toContain('scored a touchdown')
  })

  it('reads correctly with no position on file', () => {
    expect(headlineFor(event() as never, null)).toBe('Jerry Jeudy caught a pass for 17 yards')
  })
})
