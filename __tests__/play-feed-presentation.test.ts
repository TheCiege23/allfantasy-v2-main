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

import { getPlayFeed, headlineFor, playActionFor, playYards } from '@/lib/live/playFeedPresentation'

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

/** A Rolling Insights play-by-play event: `stat` is the play's `event`, `delta` its yardsGained. */
const pbp = (over: Record<string, unknown> = {}) =>
  event({ stat: 'run', role: 'rusher', delta: 34, value: 34, passerId: null, passerName: null, ...over })

beforeEach(() => {
  h.readPlayByPlayFeed.mockReset()
  h.identityFindMany.mockReset()
  h.playerFindMany.mockReset()
  h.identityFindMany.mockResolvedValue([])
  h.playerFindMany.mockResolvedValue([])
})

describe('getPlayFeed', () => {
  it('joins a headshot and a Sleeper id through the Rolling Insights id, never through a name', async () => {
    h.readPlayByPlayFeed.mockResolvedValue([event()])
    h.identityFindMany.mockResolvedValue([
      { rollingInsightsId: '5474', canonicalName: 'Jerry Jeudy', position: 'WR', sport: 'NFL', sleeperId: '7564' },
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
    expect(h.identityFindMany.mock.calls[0][0].select.sleeperId).toBe(true)
    expect(feed[0].imageUrl).toBe('https://img/jeudy.png')
    // The Sleeper id is the headshot fallback and the player card's key.
    expect(feed[0].sleeperId).toBe('7564')
    expect(feed[0].headline).toBe('Jerry Jeudy (WR) 17-yard catch')
    expect(feed[0].action).toBe('17-yard catch')
    expect(feed[0].yards).toBe(17)
  })

  it('returns the play WITHOUT an image or Sleeper id when the id does not resolve', async () => {
    h.readPlayByPlayFeed.mockResolvedValue([event()])
    h.identityFindMany.mockResolvedValue([]) // unknown to the crosswalk

    const feed = await getPlayFeed()

    // A missing headshot is cosmetic. The wrong headshot on a touchdown is not.
    expect(feed).toHaveLength(1)
    expect(feed[0].imageUrl).toBeNull()
    expect(feed[0].sleeperId).toBeNull()
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

describe('headlineFor — play-by-play events (the feed on a Sunday)', () => {
  it('REGRESSION: a catch is a catch, not "ran for 33 yards"', () => {
    // Play-by-play `stat` is 'pass'; the old headline looked for 'receiving…',
    // matched nothing, and called every catch a run.
    const line = headlineFor(
      pbp({ playerName: 'Marvin Harrison Jr.', stat: 'pass', role: 'receiver', delta: 33, passerName: 'Kyler Murray' }) as never,
      null,
    )
    expect(line).toBe('Marvin Harrison Jr. 33-yard catch from Kyler Murray')
    expect(line).not.toContain('ran for')
  })

  it('REGRESSION: a touchdown says how it was scored and how far', () => {
    expect(headlineFor(pbp({ playerName: 'Ashton Jeanty', type: 'TOUCHDOWN' }) as never, 'RB'))
      .toBe('Ashton Jeanty (RB) 34-yard rushing TD')
    expect(
      headlineFor(
        pbp({ playerName: 'Drake London', type: 'TOUCHDOWN', stat: 'pass', role: 'receiver', passerName: 'Kirk Cousins' }) as never,
        'WR',
      ),
    ).toBe('Drake London (WR) 34-yard receiving TD from Kirk Cousins')
  })

  it('the subject ROLE decides the kind of play, whatever the event says', () => {
    // `not_available` is a real value of the contract's `event` enum. The role is
    // the only thing that still says this was a catch.
    expect(playActionFor(pbp({ stat: 'not_available', role: 'receiver', delta: 25 }) as never)).toBe('25-yard catch')
  })

  it('an event cached before roles existed still reads a pass as a catch', () => {
    // The feed cache lives 6 hours; events written before this change carry no
    // `role`. The play's `event` is all that is left to go on.
    expect(
      playActionFor(pbp({ stat: 'pass', role: undefined, delta: 33, passerName: 'Kyler Murray' }) as never),
    ).toBe('33-yard catch from Kyler Murray')
  })

  it("tells a passing touchdown from the passer's side", () => {
    const passer = pbp({ playerName: 'Kirk Cousins', type: 'TOUCHDOWN', stat: 'pass', role: 'passer', receiverName: 'Drake London' })
    expect(headlineFor(passer as never, 'QB')).toBe('Kirk Cousins (QB) 34-yard TD pass to Drake London')
  })

  it('a 20+ yard run reads as a run', () => {
    expect(playActionFor(pbp({ delta: 25 }) as never)).toBe('25-yard run')
  })

  it('names the kind of score for the other scoring plays', () => {
    expect(playActionFor(pbp({ type: 'FIELD_GOAL', stat: 'field_goal', role: 'kicker' }) as never)).toBe('made a field goal')
    expect(playActionFor(pbp({ type: 'DEFENSIVE_SCORE', stat: 'interception', role: 'interceptor' }) as never)).toBe('pick-six')
    expect(playActionFor(pbp({ type: 'SPECIAL_TEAMS_SCORE', stat: 'punt', role: 'returner' }) as never)).toBe('punt return TD')
    expect(playActionFor(pbp({ type: 'TURNOVER', stat: 'interception', role: 'interceptor' }) as never)).toBe('intercepted a pass')
  })
})

describe('headlineFor — box-score events', () => {
  it('distinguishes how a touchdown was scored, with no invented yardage', () => {
    // A touchdown COUNTER moves by 1; that 1 is not yards.
    expect(headlineFor(event({ type: 'TOUCHDOWN', stat: 'passing_touchdowns', delta: 1 }) as never, 'QB'))
      .toBe('Jerry Jeudy (QB) TD pass')
    expect(headlineFor(event({ type: 'TOUCHDOWN', stat: 'receiving_touchdowns', delta: 1 }) as never, 'WR'))
      .toBe('Jerry Jeudy (WR) receiving TD')
    expect(headlineFor(event({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1 }) as never, 'RB'))
      .toBe('Jerry Jeudy (RB) rushing TD')
  })

  it('reads a new long from its value, not from how far the long moved', () => {
    // rushing_long went 30 -> 41: the play was 41 yards, the delta is 11.
    expect(playYards(event({ stat: 'rushing_long', delta: 11, value: 41 }) as never)).toBe(41)
    expect(playActionFor(event({ stat: 'rushing_long', delta: 11, value: 41 }) as never)).toBe('41-yard run')
    expect(playYards(event({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 2 }) as never)).toBeNull()
  })

  it('reads correctly with no position on file', () => {
    expect(headlineFor(event() as never, null)).toBe('Jerry Jeudy 17-yard catch')
  })
})
