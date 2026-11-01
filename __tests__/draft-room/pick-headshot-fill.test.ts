import { describe, expect, it, vi, beforeEach } from 'vitest'

const findMany = vi.fn()
const leagueFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: { findMany: (...a: unknown[]) => findMany(...a) },
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a) },
  },
}))

import { chooseStoredPickHeadshot, resolveStoredPickHeadshot } from '@/lib/draft-room/storedPickHeadshot'
import { fillPickHeadshotsFromPool } from '@/lib/draft-room/fillPickHeadshotsFromPool'

const JOKIC = 'https://r2.thesportsdb.com/images/media/player/cutout/hqzhc61766921696.png'
const TATUM = 'https://r2.thesportsdb.com/images/media/player/cutout/afoj6v1759590736.png'

describe('chooseStoredPickHeadshot', () => {
  const base = { sport: 'NBA', playerId: '114', playerName: 'Nikola Jokic', team: 'DENVER NUGGETS' }

  it('takes the Rolling Insights row whose id is the pick id', () => {
    const rows = [
      { externalId: '114', source: 'rolling_insights', name: 'Nikola Jokic', team: 'Denver Nuggets', imageUrl: JOKIC },
    ]
    expect(chooseStoredPickHeadshot(base, rows)).toBe(JOKIC)
  })

  it('refuses an id row that names somebody else', () => {
    const rows = [
      { externalId: '114', source: 'rolling_insights', name: 'Someone Else', team: 'Denver Nuggets', imageUrl: TATUM },
    ]
    expect(chooseStoredPickHeadshot(base, rows)).toBeNull()
  })

  it('falls back to a name with one distinct photo (no id on the pick)', () => {
    const rows = [
      { externalId: '651', source: 'rolling_insights', name: 'Jayson Tatum', team: 'Boston Celtics', imageUrl: TATUM },
      { externalId: 'tsdb_1', source: 'thesportsdb', name: 'Jayson Tatum', team: 'Boston Celtics', imageUrl: TATUM },
    ]
    expect(chooseStoredPickHeadshot({ ...base, playerId: null, playerName: 'Jayson Tatum', team: 'BOSTON CELTICS' }, rows)).toBe(TATUM)
  })

  it('narrows a shared name by team, and gives up when it still cannot tell', () => {
    const rows = [
      { externalId: '1', source: 'thesportsdb', name: 'Sebastian Aho', team: 'Carolina Hurricanes', imageUrl: 'https://x/a.png' },
      { externalId: '2', source: 'thesportsdb', name: 'Sebastian Aho', team: 'New York Islanders', imageUrl: 'https://x/b.png' },
    ]
    const pick = { sport: 'NHL', playerId: null, playerName: 'Sebastian Aho', team: 'CAROLINA HURRICANES' }
    expect(chooseStoredPickHeadshot(pick, rows)).toBe('https://x/a.png')
    expect(chooseStoredPickHeadshot({ ...pick, team: null }, rows)).toBeNull()
  })

  it('ignores placeholders and team logos', () => {
    const rows = [
      { externalId: '114', source: 'rolling_insights', name: 'Nikola Jokic', team: null, imageUrl: 'data:image/svg+xml;utf8,AF' },
      { externalId: 'x', source: 'espn', name: 'Nikola Jokic', team: null, imageUrl: 'https://a/teamLogos/den.png' },
    ]
    expect(chooseStoredPickHeadshot(base, rows)).toBeNull()
  })
})

describe('resolveStoredPickHeadshot', () => {
  beforeEach(() => {
    findMany.mockReset()
    leagueFindUnique.mockReset()
  })

  it('never looks anything up for NFL', async () => {
    expect(await resolveStoredPickHeadshot({ sport: 'NFL', playerId: '4046', playerName: 'Patrick Mahomes', team: 'KC' })).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('reads the league sport when the session has none', async () => {
    leagueFindUnique.mockResolvedValue({ sport: 'NBA' })
    findMany.mockResolvedValue([
      { externalId: '114', source: 'rolling_insights', name: 'Nikola Jokic', team: 'Denver Nuggets', imageUrl: JOKIC },
    ])
    const url = await resolveStoredPickHeadshot({
      sport: null,
      leagueId: 'L1',
      playerId: '114',
      playerName: 'Nikola Jokic',
      team: 'DENVER NUGGETS',
    })
    expect(url).toBe(JOKIC)
    expect(findMany.mock.calls[0]![0].where.sport).toBe('NBA')
  })

  it('returns null instead of throwing when the lookup fails', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    expect(await resolveStoredPickHeadshot({ sport: 'NBA', playerId: '114', playerName: 'Nikola Jokic', team: null })).toBeNull()
  })
})

describe('fillPickHeadshotsFromPool', () => {
  const players = [
    { id: '114', name: 'Nikola Jokic', position: 'C', team: 'DENVER NUGGETS', display: { playerId: '114', assets: { headshotUrl: JOKIC } } },
    { id: '651', name: 'Jayson Tatum', position: 'SF', team: 'BOSTON CELTICS', display: { playerId: '651', assets: { headshotUrl: TATUM } } },
    { id: '9', name: 'No Photo', position: 'PG', team: 'X', display: { playerId: '9', assets: { headshotUrl: 'data:image/svg+xml;utf8,AF' } } },
  ]

  it('fills by id, then by name + position + team, and keeps saved photos', () => {
    const picks = [
      { playerId: '114', playerName: 'Nikola Jokic', position: 'C', team: 'DENVER NUGGETS', playerImageUrl: null },
      { playerId: null, playerName: 'Jayson Tatum', position: 'SF', team: 'BOSTON CELTICS', playerImageUrl: null },
      { playerId: '651', playerName: 'Jayson Tatum', position: 'SF', team: 'BOSTON CELTICS', playerImageUrl: 'https://saved.png' },
      { playerId: '9', playerName: 'No Photo', position: 'PG', team: 'X', playerImageUrl: null },
    ]
    const out = fillPickHeadshotsFromPool(picks, players)
    expect(out.map((p) => p.playerImageUrl)).toEqual([JOKIC, TATUM, 'https://saved.png', null])
  })

  it('returns the same array when nothing needs filling', () => {
    const picks = [{ playerId: '114', playerName: 'Nikola Jokic', position: 'C', team: 'X', playerImageUrl: 'https://saved.png' }]
    expect(fillPickHeadshotsFromPool(picks, players)).toBe(picks)
  })
})
