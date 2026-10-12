import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sportsPlayerFindMany: vi.fn(),
  rosterPlayerFindMany: vi.fn(),
  playerFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: { findMany: mocks.sportsPlayerFindMany },
    redraftRosterPlayer: { findMany: mocks.rosterPlayerFindMany },
    player: { findMany: mocks.playerFindMany },
  },
}))

import { playerImageKey, resolveImagesByPlayerName, resolveSleeperPlayerIdentities } from '@/lib/players/sleeperPlayerCrosswalk'

describe('resolveSleeperPlayerIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sportsPlayerFindMany.mockResolvedValue([])
    mocks.rosterPlayerFindMany.mockResolvedValue([])
    mocks.playerFindMany.mockResolvedValue([])
  })

  it('resolves through SportsPlayer and on to the canonical row', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'sleeper:5859', sleeperId: '5859', name: 'Brian Thomas Jr.', position: 'WR', team: 'JAX', imageUrl: null },
    ])
    mocks.playerFindMany.mockResolvedValue([
      { id: 'nfl-brian-thomas-abc', name: 'Brian Thomas Jr.', imageUrl: 'https://img/bt.png', position: 'WR', team: 'JAX' },
    ])

    const { byId, resolved, unresolved } = await resolveSleeperPlayerIdentities(['5859'], 'nfl')

    expect(resolved).toBe(1)
    expect(unresolved).toBe(0)
    expect(byId.get('5859')).toMatchObject({
      name: 'Brian Thomas Jr.',
      canonicalPlayerId: 'nfl-brian-thomas-abc',
      imageUrl: 'https://img/bt.png',
      source: 'sports_player',
    })
  })

  /* The second hop is what lifts coverage from 15% to 42%. */
  it('falls back to observed roster pairs when SportsPlayer misses', async () => {
    mocks.rosterPlayerFindMany.mockResolvedValue([
      { playerId: '2216', playerName: 'Old Reliable', position: 'RB', team: 'KC' },
    ])

    const { byId } = await resolveSleeperPlayerIdentities(['2216'], 'nfl')

    expect(byId.get('2216')).toMatchObject({ name: 'Old Reliable', source: 'roster' })
  })

  it('only asks the roster table about ids SportsPlayer could not name', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'sleeper:5859', sleeperId: '5859', name: 'Brian Thomas Jr.', position: 'WR', team: 'JAX', imageUrl: null },
    ])

    await resolveSleeperPlayerIdentities(['5859', '2216'], 'nfl')

    expect(mocks.rosterPlayerFindMany.mock.calls[0][0].where.playerId.in).toEqual(['2216'])
  })

  /*
   * ⚠ THE COLLISION THIS HOP EXISTS TO SURVIVE. A Rolling Insights row carries a BARE numeric
   * `externalId`, and 42,032 of those are also valid Sleeper ids belonging to someone else.
   * Measured on 201 real roster ids, the old query resolved 121 and 79 were strangers — Mike
   * Evans came back as Harlan Miller, Justin Jefferson as DaRon Bland. A row that matches only
   * by bare `externalId` must never be accepted as a Sleeper id.
   */
  it('refuses a provider row whose bare externalId happens to equal the Sleeper id', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: '6794', sleeperId: null, name: 'DaRon Bland', position: 'CB', team: 'DAL', imageUrl: null },
    ])

    const { byId, resolved } = await resolveSleeperPlayerIdentities(['6794'], 'nfl')

    expect(resolved).toBe(0)
    expect(byId.get('6794')?.name).toBeNull()
    expect(byId.get('6794')?.source).toBe('unresolved')
  })

  /*
   * 🛑 One row per source shares the Sleeper id, and TheSportsDB's got it by NAME: its 11304 is
   * G Elgton Jenkins (CLE), not TE E.J. Jenkins (PHI). The last row used to win.
   */
  it('names the id from its Sleeper row, not a later TheSportsDB namesake', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'sleeper:11304', sleeperId: '11304', source: 'sleeper', name: 'E.J. Jenkins', position: 'TE', team: 'Philadelphia Eagles', imageUrl: null, fetchedAt: new Date('2026-10-01') },
      { externalId: '34163931', sleeperId: '11304', source: 'thesportsdb', name: 'Elgton Jenkins', position: 'G', team: 'Cleveland Browns', imageUrl: 'https://www.thesportsdb.com/images/media/player/cutout/elgton.png', fetchedAt: new Date('2026-10-11') },
    ])

    const { byId } = await resolveSleeperPlayerIdentities(['11304'], 'nfl')

    expect(byId.get('11304')).toMatchObject({ name: 'E.J. Jenkins', position: 'TE', team: 'Philadelphia Eagles', source: 'sports_player' })
    expect(byId.get('11304')?.imageUrl).not.toContain('elgton')
  })

  /*
   * `externalId` is unique only within a sport — `340` is five different athletes
   * across five sports. An unfiltered query returns an arbitrary one.
   */
  it('filters every lookup by sport', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'sleeper:340', sleeperId: '340', name: 'Someone', position: 'WR', team: 'NE', imageUrl: null },
    ])

    await resolveSleeperPlayerIdentities(['340'], 'nfl')

    expect(mocks.sportsPlayerFindMany.mock.calls[0][0].where.sport).toBe('NFL')
    expect(mocks.playerFindMany.mock.calls[0][0].where.sport).toMatchObject({ equals: 'nfl' })
  })

  it('leaves an unmatched id unresolved rather than guessing a name', async () => {
    const { byId, resolved, unresolved } = await resolveSleeperPlayerIdentities(['999999'], 'nfl')

    expect(resolved).toBe(0)
    expect(unresolved).toBe(1)
    expect(byId.get('999999')).toMatchObject({ name: null, source: 'unresolved' })
  })

  /* An unnamed player still gets the right face from the numeric id. */
  it('still derives a headshot for an unresolved numeric id', async () => {
    const { byId } = await resolveSleeperPlayerIdentities(['999999'], 'nfl')
    expect(byId.get('999999')?.imageUrl).toContain('999999')
  })

  it('yields no image for a synthetic id that is not a Sleeper id', async () => {
    const { byId } = await resolveSleeperPlayerIdentities(['name:Someone:WR:JAX'], 'nfl')
    expect(byId.get('name:Someone:WR:JAX')?.imageUrl).toBeNull()
  })

  it('matches canonical rows case-insensitively, since two pipelines populate them', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'sleeper:1', sleeperId: '1', name: 'de’Von Achane', position: 'RB', team: 'MIA', imageUrl: null },
    ])
    mocks.playerFindMany.mockResolvedValue([
      { id: 'nfl-devon-achane', name: 'De’Von Achane', imageUrl: 'https://img/a.png', position: 'RB', team: 'MIA' },
    ])

    const { byId } = await resolveSleeperPlayerIdentities(['1'], 'nfl')

    expect(byId.get('1')?.canonicalPlayerId).toBe('nfl-devon-achane')
  })

  it('survives a failing lookup by reporting unresolved, not throwing', async () => {
    mocks.sportsPlayerFindMany.mockRejectedValue(new Error('connection lost'))

    const { resolved, unresolved } = await resolveSleeperPlayerIdentities(['5859'], 'nfl')

    expect(resolved).toBe(0)
    expect(unresolved).toBe(1)
  })
})

/*
 * 🛑 PRODUCTION `Player` ROWS, 2026-10-11: two Justin Jeffersons. The name hops used to build a
 * lower-cased-name Map — LAST row wins — so with the linebacker listed second the receiver got
 * the linebacker's canonical id and face.
 */
const JEFFERSONS = [
  { id: 'nfl-justin-jefferson-28fd81ce', name: 'Justin Jefferson', imageUrl: 'https://img/wr.png', position: 'WR', team: 'MIN' },
  { id: 'nfl-justin-jefferson-a6b68cb2', name: 'Justin Jefferson', imageUrl: 'https://img/lb.png', position: 'LB', team: 'CLE' },
]

describe('🛑 resolveSleeperPlayerIdentities hop 2 binds a shared name by position/team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rosterPlayerFindMany.mockResolvedValue([])
    mocks.playerFindMany.mockResolvedValue(JEFFERSONS)
  })

  it('the receiver gets the receiver’s canonical row, though the LB row comes last', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([
      // Sleeper rows spell the team out; the canonical table abbreviates it.
      { externalId: 'sleeper:6794', sleeperId: '6794', name: 'Justin Jefferson', position: 'WR', team: 'Minnesota Vikings', imageUrl: null },
    ])
    const { byId } = await resolveSleeperPlayerIdentities(['6794'], 'nfl')
    expect(byId.get('6794')).toMatchObject({
      canonicalPlayerId: 'nfl-justin-jefferson-28fd81ce',
      imageUrl: 'https://img/wr.png',
    })
  })

  it('same-position namesakes are told apart by team, with Sleeper’s spelled-out team abbreviated', async () => {
    mocks.playerFindMany.mockResolvedValue([
      { id: 'nfl-mike-williams-pit', name: 'Mike Williams', imageUrl: 'https://img/pit.png', position: 'WR', team: 'PIT' },
      { id: 'nfl-mike-williams-nyj', name: 'Mike Williams', imageUrl: 'https://img/nyj.png', position: 'WR', team: 'NYJ' },
    ])
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'sleeper:4068', sleeperId: '4068', name: 'Mike Williams', position: 'WR', team: 'Pittsburgh Steelers', imageUrl: null },
    ])
    const { byId } = await resolveSleeperPlayerIdentities(['4068'], 'nfl')
    expect(byId.get('4068')?.canonicalPlayerId).toBe('nfl-mike-williams-pit')
  })

  it('a shared name with nothing to verify by keeps its name but takes NO canonical row', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([])
    mocks.rosterPlayerFindMany.mockResolvedValue([
      { playerId: '6794', playerName: 'Justin Jefferson', position: null, team: null },
    ])
    const { byId } = await resolveSleeperPlayerIdentities(['6794'], 'nfl')
    expect(byId.get('6794')?.name).toBe('Justin Jefferson')
    expect(byId.get('6794')?.canonicalPlayerId).toBeNull()
    // The numeric id's own CDN face, never the linebacker's.
    expect(byId.get('6794')?.imageUrl).not.toBe('https://img/lb.png')
  })
})

describe('🛑 resolveImagesByPlayerName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.playerFindMany.mockResolvedValue(JEFFERSONS)
  })

  it('gives each namesake his own face when position/team are supplied', async () => {
    const wr = { name: 'Justin Jefferson', position: 'WR', team: 'MIN' }
    const lb = { name: 'Justin Jefferson', position: 'LB', team: 'CLE' }
    const out = await resolveImagesByPlayerName([wr, lb], 'nfl')
    expect(out.get(playerImageKey(wr))).toBe('https://img/wr.png')
    expect(out.get(playerImageKey(lb))).toBe('https://img/lb.png')
  })

  it('a bare shared name gets no image — initials, not another man’s face', async () => {
    const out = await resolveImagesByPlayerName(['Justin Jefferson'], 'nfl')
    expect(out.get(playerImageKey('Justin Jefferson'))).toBeUndefined()
    expect(out.size).toBe(0)
  })

  it('a lone row on the other side of the ball is refused', async () => {
    mocks.playerFindMany.mockResolvedValue([JEFFERSONS[1]])
    const wr = { name: 'Justin Jefferson', position: 'WR', team: 'MIN' }
    const out = await resolveImagesByPlayerName([wr], 'nfl')
    expect(out.size).toBe(0)
  })

  it('[control] a unique name still resolves from the name alone', async () => {
    mocks.playerFindMany.mockResolvedValue([
      { name: 'Brian Thomas Jr.', imageUrl: 'https://img/bt.png', position: 'WR', team: 'JAX' },
    ])
    const out = await resolveImagesByPlayerName(['Brian Thomas Jr.'], 'nfl')
    expect(out.get(playerImageKey('Brian Thomas Jr.'))).toBe('https://img/bt.png')
  })
})
