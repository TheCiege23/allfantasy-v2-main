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

import { resolveSleeperPlayerIdentities } from '@/lib/players/sleeperPlayerCrosswalk'

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
