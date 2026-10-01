/**
 * Wrong-person headshots — regression coverage.
 *
 * Measured in production 2026-10-01: 163 NBA/MLB/NHL/NCAAB/soccer players carried an
 * `api-sports.io/american-football` photo. Two defects combined:
 *   1. the resolver called `apiSportsProvider.fetch` without asking `supports()`, and that client
 *      falls back to the NFL player list for any sport it does not know;
 *   2. both name-search providers ended their match with `?? rows[0]`, so a search that found
 *      nobody by that name returned the first stranger's photo anyway.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiSportsLib = vi.hoisted(() => ({
  fetchAPISportsPlayerBySearch: vi.fn(),
}))
const prismaMock = vi.hoisted(() => ({
  sportsPlayer: { findMany: vi.fn(async () => []) },
}))
const imageStoreMock = vi.hoisted(() => ({
  PLAYER_IMAGE_TYPE_HEADSHOT: 'headshot',
  readPrimaryPlayerImage: vi.fn(async () => null),
  writePrimaryPlayerImage: vi.fn(async () => ({ written: true, skippedReason: null })),
}))

vi.mock('@/lib/api-sports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-sports')>()),
  fetchAPISportsPlayerBySearch: apiSportsLib.fetchAPISportsPlayerBySearch,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/player-assets/playerImageStore', () => imageStoreMock)
vi.mock('@/lib/nfl-provider/nflRedraftProviderCertification', () => ({
  resolveNflRedraftCanonicalHeadshot: vi.fn(async () => ({ imageUrl: null, source: 'none', confidence: 'none' })),
}))

import { compactPlayerName, pickHeadshotCandidate } from '@/lib/player-assets/headshotCandidateMatch'
import { resolvePlayerHeadshot } from '@/lib/player-assets/resolvePlayerHeadshot'
import { apiSportsProvider } from '@/lib/workers/providers/api-sports'
import { theSportsDbProvider, theSportsDbSportName } from '@/lib/workers/providers/thesportsdb'

const FOOTBALL_PHOTO = 'https://media.api-sports.io/american-football/players/54016.png'
const NBA_PHOTO = 'https://r2.thesportsdb.com/images/media/player/cutout/avax2e1728335811.png'

type Row = { name: string; team: string | null }
const pick = (rows: Row[], search: string, teamCode?: string) =>
  pickHeadshotCandidate(rows, { search, nameOf: (r) => r.name, teamCodeOf: (r) => r.team, teamCode })

describe('pickHeadshotCandidate', () => {
  it('returns null when no candidate has the searched name — never the first row', () => {
    expect(pick([{ name: 'Someone Else', team: 'KC' }], 'Alex Cook')).toBeNull()
  })

  it('accepts every spelling the resolver searches for one name', () => {
    const rows = [{ name: "Ja'Marr Chase", team: 'CIN' }]
    for (const variant of ["Ja'Marr Chase", 'JaMarr Chase', 'Ja Marr Chase', 'jamarr chase']) {
      expect(pick(rows, variant)).toBe(rows[0])
    }
    expect(compactPlayerName('Brian Thomas Jr.')).toBe(compactPlayerName('Brian Thomas'))
  })

  it('accepts a lone name match even when its team differs (provider rosters lag trades)', () => {
    const rows = [{ name: 'Alex Cook', team: 'SEA' }]
    expect(pick(rows, 'Alex Cook', 'TB')).toBe(rows[0])
  })

  it('uses team to break a tie between same-named players', () => {
    const rows = [
      { name: 'Josh Allen', team: 'BUF' },
      { name: 'Josh Allen', team: 'JAX' },
    ]
    expect(pick(rows, 'Josh Allen', 'JAX')).toBe(rows[1])
  })

  it('refuses to guess between same-named players that team cannot separate', () => {
    const rows = [
      { name: 'Josh Allen', team: 'BUF' },
      { name: 'Josh Allen', team: 'JAX' },
    ]
    expect(pick(rows, 'Josh Allen')).toBeNull()
    expect(pick(rows, 'Josh Allen', 'NYJ')).toBeNull()
  })
})

describe('theSportsDbSportName', () => {
  it('maps our sport codes onto the vendor strSport enum', () => {
    expect(theSportsDbSportName('NFL')).toBe('American Football')
    expect(theSportsDbSportName('NCAAF')).toBe('American Football')
    expect(theSportsDbSportName('NBA')).toBe('Basketball')
    expect(theSportsDbSportName('NCAAB')).toBe('Basketball')
    expect(theSportsDbSportName('MLB')).toBe('Baseball')
    expect(theSportsDbSportName('NHL')).toBe('Ice Hockey')
    expect(theSportsDbSportName('SOCCER')).toBe('Soccer')
  })
})

describe('apiSportsProvider — player_headshots', () => {
  beforeEach(() => {
    apiSportsLib.fetchAPISportsPlayerBySearch.mockReset()
  })

  it('refuses a non-football sport without searching the football list', async () => {
    apiSportsLib.fetchAPISportsPlayerBySearch.mockResolvedValue([
      { id: 54016, name: 'Alex Cook', image: FOOTBALL_PHOTO, team: { name: 'Seattle Seahawks' } },
    ])
    for (const sport of ['NBA', 'MLB', 'NHL', 'NCAAB', 'SOCCER']) {
      expect(apiSportsProvider.supports({ sport, dataType: 'player_headshots' })).toBe(false)
      const result = await apiSportsProvider.fetch({
        sport,
        dataType: 'player_headshots',
        query: { search: 'Alex Cook' },
      })
      expect(result).toBeNull()
    }
    expect(apiSportsLib.fetchAPISportsPlayerBySearch).not.toHaveBeenCalled()
  })

  it('returns null rather than the first result when nobody has that name', async () => {
    apiSportsLib.fetchAPISportsPlayerBySearch.mockResolvedValue([
      { id: 1, name: 'Somebody Different', image: FOOTBALL_PHOTO, team: { name: 'Kansas City Chiefs' } },
    ])
    const result = await apiSportsProvider.fetch({
      sport: 'NFL',
      dataType: 'player_headshots',
      query: { search: 'Alex Cook' },
    })
    expect(apiSportsLib.fetchAPISportsPlayerBySearch).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('still returns the photo for a real name match in football', async () => {
    apiSportsLib.fetchAPISportsPlayerBySearch.mockResolvedValue([
      { id: 1, name: 'Somebody Different', image: 'https://x.test/wrong.png', team: null },
      { id: 54016, name: 'Alex Cook', image: FOOTBALL_PHOTO, team: { name: 'Seattle Seahawks' } },
    ])
    const result = (await apiSportsProvider.fetch({
      sport: 'NFL',
      dataType: 'player_headshots',
      query: { search: 'Alex Cook' },
    })) as { headshotUrl: string } | null
    expect(result?.headshotUrl).toBe(FOOTBALL_PHOTO)
  })
})

describe('theSportsDbProvider — player_headshots', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  const respond = (player: unknown[]) =>
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ player }) })

  it('ignores a same-named player from another sport', async () => {
    respond([{ idPlayer: '1', strPlayer: 'Alex Cook', strSport: 'American Football', strCutout: FOOTBALL_PHOTO }])
    const result = await theSportsDbProvider.fetch({
      sport: 'MLB',
      dataType: 'player_headshots',
      query: { search: 'Alex Cook' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('returns null rather than the first result when nobody has that name', async () => {
    respond([{ idPlayer: '2', strPlayer: 'Different Person', strSport: 'Basketball', strCutout: NBA_PHOTO }])
    const result = await theSportsDbProvider.fetch({
      sport: 'NBA',
      dataType: 'player_headshots',
      query: { search: 'Alex Cook' },
    })
    expect(result).toBeNull()
  })

  it('returns the photo of the same-sport, same-name player', async () => {
    respond([
      { idPlayer: '1', strPlayer: 'Jalen Williams', strSport: 'American Football', strCutout: FOOTBALL_PHOTO },
      { idPlayer: '3', strPlayer: 'Jalen Williams', strSport: 'Basketball', strCutout: NBA_PHOTO },
    ])
    const result = (await theSportsDbProvider.fetch({
      sport: 'NBA',
      dataType: 'player_headshots',
      query: { search: 'Jalen Williams' },
    })) as { headshotUrl: string } | null
    expect(result?.headshotUrl).toBe(NBA_PHOTO)
  })
})

describe('resolvePlayerHeadshot — sport guard', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    apiSportsLib.fetchAPISportsPlayerBySearch.mockReset()
    apiSportsLib.fetchAPISportsPlayerBySearch.mockResolvedValue([
      { id: 54016, name: 'Alex Cook', image: FOOTBALL_PHOTO, team: { name: 'Seattle Seahawks' } },
    ])
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ player: null }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('never gives an MLB player the NFL namesake’s photo', async () => {
    const result = await resolvePlayerHeadshot({ name: 'Alex Cook', sport: 'MLB', team: 'TB' })
    expect(apiSportsLib.fetchAPISportsPlayerBySearch).not.toHaveBeenCalled()
    expect(result.imageUrl).toBeNull()
    expect(imageStoreMock.writePrimaryPlayerImage).not.toHaveBeenCalled()
  })

  it('still consults api-sports for football', async () => {
    const result = await resolvePlayerHeadshot({ name: 'Alex Cook', sport: 'NCAAF' })
    expect(apiSportsLib.fetchAPISportsPlayerBySearch).toHaveBeenCalled()
    expect(result.imageUrl).toBe(FOOTBALL_PHOTO)
    expect(result.source).toBe('apisports')
  })
})
