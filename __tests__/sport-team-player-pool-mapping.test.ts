import { beforeEach, describe, expect, it, vi } from 'vitest'

const sportsTeamFindManyMock = vi.fn()
const sportsTeamFindFirstMock = vi.fn()
const sportsPlayerFindManyMock = vi.fn()
const sportsPlayerFindFirstMock = vi.fn()
const playerIdentityFindManyMock = vi.fn()
const playerIdentityFindFirstMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsTeam: {
      findMany: sportsTeamFindManyMock,
      findFirst: sportsTeamFindFirstMock,
    },
    sportsPlayer: {
      findMany: sportsPlayerFindManyMock,
      findFirst: sportsPlayerFindFirstMock,
    },
    playerIdentityMap: {
      findMany: playerIdentityFindManyMock,
      findFirst: playerIdentityFindFirstMock,
    },
  },
}))

describe('Sport teams, logos, and player pool mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sportsTeamFindManyMock.mockResolvedValue([])
    sportsTeamFindFirstMock.mockResolvedValue(null)
    sportsPlayerFindManyMock.mockResolvedValue([])
    sportsPlayerFindFirstMock.mockResolvedValue(null)
    playerIdentityFindManyMock.mockResolvedValue([])
    playerIdentityFindFirstMock.mockResolvedValue(null)
  })

  it('prefers DB-enriched team metadata with logos and sport scoping', async () => {
    const { getTeamMetadataForSportDbAware } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')

    sportsTeamFindManyMock.mockResolvedValue([
      {
        sport: 'NBA',
        externalId: 'LAL',
        name: 'Los Angeles Lakers',
        shortName: 'LAL',
        city: 'Los Angeles',
        conference: 'West',
        division: 'Pacific',
        logo: 'https://cdn.example/lal.png',
        primaryColor: '#552583',
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])

    const teams = await getTeamMetadataForSportDbAware('NBA')
    expect(teams.length).toBe(1)
    expect(teams[0]).toEqual(
      expect.objectContaining({
        team_id: 'LAL',
        sport_type: 'NBA',
        team_name: 'Los Angeles Lakers',
        city: 'Los Angeles',
        abbreviation: 'LAL',
        conference: 'West',
        division: 'Pacific',
        primary_logo_url: 'https://cdn.example/lal.png',
        primary_color: '#552583',
      })
    )
  })

  it('maps player pool by sport and backfills team_id from abbreviation when missing', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')

    sportsPlayerFindManyMock.mockResolvedValue([
      {
        id: 'p1',
        sport: 'NBA',
        teamId: null,
        team: 'LAL',
        name: 'LeBron James',
        position: 'SF',
        status: 'ACTIVE',
        sleeperId: 's1',
        externalId: 'ext1',
        age: 40,
      },
    ])

    const players = await getPlayerPoolForSport('NBA', { limit: 10 })
    expect(players.length).toBe(1)
    expect(players[0]).toEqual(
      expect.objectContaining({
        sport_type: 'NBA',
        team_abbreviation: 'LAL',
        team_id: 'LAL',
        full_name: 'LeBron James',
        position: 'SF',
      })
    )
  })

  it('supports soccer GK alias and NFL IDP grouped position filters in player pool queries', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')

    sportsPlayerFindManyMock.mockResolvedValueOnce([
      {
        id: 's-gk-1',
        sport: 'SOCCER',
        teamId: 'MIA',
        team: 'MIA',
        name: 'Soccer Keeper',
        position: 'GKP',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'soc-gk-1',
        age: 27,
      },
    ])

    const soccerGk = await getPlayerPoolForSport('SOCCER', { position: 'GK', limit: 10 })
    expect(soccerGk.length).toBe(1)
    expect(soccerGk[0]?.position).toBe('GKP')

    sportsPlayerFindManyMock.mockResolvedValueOnce([
      {
        id: 'nfl-de-1',
        sport: 'NFL',
        teamId: 'KC',
        team: 'KC',
        name: 'Edge Rusher',
        position: 'DE',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-de-1',
        age: 25,
      },
      {
        id: 'nfl-dt-1',
        sport: 'NFL',
        teamId: 'KC',
        team: 'KC',
        name: 'Interior Lineman',
        position: 'DT',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-dt-1',
        age: 28,
      },
    ])

    const nflDl = await getPlayerPoolForSport('NFL', { position: 'DL', limit: 10 })
    expect(nflDl.map((p) => p.position)).toEqual(expect.arrayContaining(['DE', 'DT']))
  })

  it('supports NFL Offense and IDP FLEX labels for server-side pool filters', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')

    sportsPlayerFindManyMock.mockResolvedValueOnce([
      {
        id: 'nfl-qb-1',
        sport: 'NFL',
        teamId: 'BUF',
        team: 'BUF',
        name: 'Pocket Passer',
        position: 'QB',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-qb-1',
        age: 26,
      },
      {
        id: 'nfl-rb-1',
        sport: 'NFL',
        teamId: 'BUF',
        team: 'BUF',
        name: 'Power Runner',
        position: 'RB',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-rb-1',
        age: 24,
      },
    ])

    const nflOffense = await getPlayerPoolForSport('NFL', { position: 'Offense', limit: 10 })
    expect(nflOffense.map((p) => p.position)).toEqual(expect.arrayContaining(['QB', 'RB']))

    sportsPlayerFindManyMock.mockResolvedValueOnce([
      {
        id: 'nfl-lb-1',
        sport: 'NFL',
        teamId: 'SEA',
        team: 'SEA',
        name: 'Run Stuffer',
        position: 'LB',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-lb-1',
        age: 28,
      },
      {
        id: 'nfl-s-1',
        sport: 'NFL',
        teamId: 'SEA',
        team: 'SEA',
        name: 'Ball Hawk',
        position: 'S',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-s-1',
        age: 25,
      },
    ])

    const nflIdpFlex = await getPlayerPoolForSport('NFL', { position: 'IDP FLEX', limit: 10 })
    expect(nflIdpFlex.map((p) => p.position)).toEqual(expect.arrayContaining(['LB', 'S']))
  })

  it('normalizes NFL defensive aliases in pool and slot eligibility (EDGE/OLB/FS/NT)', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const { isPositionEligibleForSlot } = await import('@/lib/roster-defaults/PositionEligibilityResolver')

    sportsPlayerFindManyMock.mockResolvedValueOnce([
      {
        id: 'nfl-edge-1',
        sport: 'NFL',
        teamId: 'DAL',
        team: 'DAL',
        name: 'Edge Alias',
        position: 'EDGE',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-edge-1',
        age: 24,
      },
      {
        id: 'nfl-olb-1',
        sport: 'NFL',
        teamId: 'DAL',
        team: 'DAL',
        name: 'Linebacker Alias',
        position: 'OLB',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-olb-1',
        age: 26,
      },
      {
        id: 'nfl-fs-1',
        sport: 'NFL',
        teamId: 'DAL',
        team: 'DAL',
        name: 'Safety Alias',
        position: 'FS',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-fs-1',
        age: 27,
      },
      {
        id: 'nfl-nt-1',
        sport: 'NFL',
        teamId: 'DAL',
        team: 'DAL',
        name: 'Nose Tackle Alias',
        position: 'NT',
        status: 'ACTIVE',
        sleeperId: null,
        externalId: 'nfl-nt-1',
        age: 29,
      },
    ])

    const aliases = await getPlayerPoolForSport('NFL', { teamId: 'DAL', limit: 10 })
    expect(aliases.map((p) => p.position)).toEqual(expect.arrayContaining(['DE', 'LB', 'S', 'DT']))

    expect(isPositionEligibleForSlot('NFL', 'DE', 'EDGE', 'IDP')).toBe(true)
    expect(isPositionEligibleForSlot('NFL', 'LB', 'OLB', 'IDP')).toBe(true)
    expect(isPositionEligibleForSlot('NFL', 'S', 'FS', 'IDP')).toBe(true)
    expect(isPositionEligibleForSlot('NFL', 'DT', 'NT', 'IDP')).toBe(true)
  })

  it('falls back to identity defensive players for NFL IDP when sportsPlayer rows are sparse', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')

    sportsPlayerFindManyMock.mockResolvedValueOnce([])
    playerIdentityFindManyMock.mockResolvedValueOnce([
      {
        id: 'idp-ident-1',
        canonicalName: 'Fallback Linebacker',
        position: 'LB',
        currentTeam: 'DAL',
        sleeperId: 'idp-slp-1',
        apiSportsId: null,
        fantasyCalcId: null,
        sport: 'NFL',
        status: 'ACTIVE',
      },
    ])

    const players = await getPlayerPoolForSport('NFL', { position: 'IDP_FLEX', limit: 10 })
    expect(players.length).toBe(1)
    expect(players[0]).toEqual(
      expect.objectContaining({
        full_name: 'Fallback Linebacker',
        position: 'LB',
        team_abbreviation: 'DAL',
        sport_type: 'NFL',
      })
    )
  })

  it('resolves logo from db first and static fallback otherwise', async () => {
    const { resolveTeamLogoUrl, resolveTeamLogoUrlSync } = await import('@/lib/sport-teams/TeamLogoResolver')

    sportsTeamFindFirstMock.mockResolvedValueOnce({ logo: 'https://cdn.example/bos.png' })
    const dbLogo = await resolveTeamLogoUrl('BOS', 'NBA')
    expect(dbLogo).toBe('https://cdn.example/bos.png')

    sportsTeamFindFirstMock.mockResolvedValueOnce(null)
    const fallbackLogo = await resolveTeamLogoUrl('LAL', 'NBA')
    expect(fallbackLogo).toContain('/nba/500/lal.png')

    const syncLogo = resolveTeamLogoUrlSync('LAL', 'NBA')
    expect(syncLogo).toContain('/nba/500/lal.png')
  })

  it('bootstraps league player pool context with sport-specific teams and players', async () => {
    const { bootstrapLeaguePlayerPool } = await import('@/lib/sport-teams/LeaguePlayerPoolBootstrapService')

    sportsPlayerFindManyMock.mockResolvedValue([
      { id: 'p1', sport: 'MLB', teamId: 'NYY', team: 'NYY', name: 'Aaron Judge', position: 'OF', status: 'ACTIVE', sleeperId: null, externalId: 'aj', age: 34 },
      { id: 'p2', sport: 'MLB', teamId: 'BOS', team: 'BOS', name: 'Rafael Devers', position: '3B', status: 'ACTIVE', sleeperId: null, externalId: 'rd', age: 29 },
    ])
    sportsTeamFindManyMock.mockResolvedValue([
      {
        sport: 'MLB',
        externalId: 'NYY',
        name: 'New York Yankees',
        shortName: 'NYY',
        city: 'New York',
        conference: null,
        division: 'AL East',
        logo: 'https://cdn.example/nyy.png',
        primaryColor: '#1c2841',
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        sport: 'MLB',
        externalId: 'BOS',
        name: 'Boston Red Sox',
        shortName: 'BOS',
        city: 'Boston',
        conference: null,
        division: 'AL East',
        logo: 'https://cdn.example/bos.png',
        primaryColor: '#bd3039',
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])

    const result = await bootstrapLeaguePlayerPool('league-1', 'MLB')
    expect(result.leagueSport).toBe('MLB')
    expect(result.playerCount).toBe(2)
    expect(result.teamCount).toBe(2)
  })

  it('exports SPORT_TEAM_METADATA_REGISTRY_VERSION with expected format', async () => {
    const { SPORT_TEAM_METADATA_REGISTRY_VERSION } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
    expect(typeof SPORT_TEAM_METADATA_REGISTRY_VERSION).toBe('string')
    expect(SPORT_TEAM_METADATA_REGISTRY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
  })

  it('getSupportedTeamSports returns all 7 sports', async () => {
    const { getSupportedTeamSports } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
    const sports = getSupportedTeamSports()
    expect(sports).toEqual(expect.arrayContaining(['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']))
    expect(sports).toHaveLength(7)
  })

  it('getTeamMetadataForSport returns correct static team counts per sport', async () => {
    const { getTeamMetadataForSport } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
    expect(getTeamMetadataForSport('NFL')).toHaveLength(32)
    expect(getTeamMetadataForSport('NBA')).toHaveLength(30)
    expect(getTeamMetadataForSport('MLB')).toHaveLength(30)
    expect(getTeamMetadataForSport('NHL')).toHaveLength(32)
    expect(getTeamMetadataForSport('SOCCER')).toHaveLength(24)
  })

  it('getTeamByAbbreviation finds a team by abbreviation for each sport', async () => {
    const { getTeamByAbbreviation } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
    const nfl = getTeamByAbbreviation('NFL', 'KC')
    expect(nfl).not.toBeNull()
    expect(nfl?.sport_type).toBe('NFL')

    const nba = getTeamByAbbreviation('NBA', 'LAL')
    expect(nba).not.toBeNull()
    expect(nba?.abbreviation).toBe('LAL')

    const mlb = getTeamByAbbreviation('MLB', 'NYY')
    expect(mlb).not.toBeNull()
    expect(mlb?.abbreviation).toBe('NYY')

    const nhl = getTeamByAbbreviation('NHL', 'TOR')
    expect(nhl).not.toBeNull()
    expect(nhl?.abbreviation).toBe('TOR')

    const soccer = getTeamByAbbreviation('SOCCER', 'MIA')
    expect(soccer).not.toBeNull()
    expect(soccer?.team_name).toBe('Inter Miami CF')
  })

  it('getPrimaryLogoUrlForTeam returns ESPN CDN URL for each sport', async () => {
    const { getPrimaryLogoUrlForTeam } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
    const nflUrl = getPrimaryLogoUrlForTeam('NFL', 'KC')
    expect(nflUrl).toMatch(/espncdn\.com\/i\/teamlogos\/nfl/)
    expect(nflUrl).toMatch(/\.png$/)

    const nbaUrl = getPrimaryLogoUrlForTeam('NBA', 'LAL')
    expect(nbaUrl).toContain('/nba/500/lal.png')

    const mlbUrl = getPrimaryLogoUrlForTeam('MLB', 'NYY')
    expect(mlbUrl).toContain('/mlb/500/nyy.png')

    const nhlUrl = getPrimaryLogoUrlForTeam('NHL', 'TOR')
    expect(nhlUrl).toContain('/nhl/500/tor.png')

    const soccerUrl = getPrimaryLogoUrlForTeam('SOCCER', 'MIA')
    expect(soccerUrl).toContain('/soccer/500/mia.png')
  })

  it('NBA logo URLs resolve NBA-standard and ESPN abbreviations to the same ESPN path', async () => {
    const { getPrimaryLogoUrlForTeam, logoUrlForAbbrev } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
    const pairs: Array<[string, string, string]> = [
      ['GSW', 'GS', 'gs'],
      ['NYK', 'NY', 'ny'],
      ['NOP', 'NO', 'no'],
      ['SAS', 'SA', 'sa'],
      ['UTA', 'UTAH', 'utah'],
      ['PHO', 'PHX', 'phx'],
      ['BRK', 'BKN', 'bkn'],
      ['WAS', 'WSH', 'wsh'],
    ]
    for (const [nbaStd, espn, key] of pairs) {
      const expected = `https://a.espncdn.com/i/teamlogos/nba/500/${key}.png`
      expect(getPrimaryLogoUrlForTeam('NBA', nbaStd)).toBe(expected)
      expect(getPrimaryLogoUrlForTeam('NBA', espn)).toBe(expected)
      expect(logoUrlForAbbrev('NBA', nbaStd.toLowerCase())).toBe(expected)
    }
    // Aliases are NBA-only: NFL's NO stays the Saints.
    expect(getPrimaryLogoUrlForTeam('NFL', 'NO')).toContain('/nfl/500/no.png')
  })

  it('getTeamIdByAbbreviationMap has correct size for NBA, MLB, NHL', async () => {
    const { getTeamIdByAbbreviationMap } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
    expect(getTeamIdByAbbreviationMap('NBA').size).toBe(30)
    expect(getTeamIdByAbbreviationMap('MLB').size).toBe(30)
    expect(getTeamIdByAbbreviationMap('NHL').size).toBe(32)
  })

  it('getTeamMetadataForSportDbAware falls back to static registry when DB returns empty', async () => {
    const { getTeamMetadataForSportDbAware } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
    sportsTeamFindManyMock.mockResolvedValueOnce([])
    const teams = await getTeamMetadataForSportDbAware('NHL')
    expect(teams.length).toBe(32)
    expect(teams.every((t) => t.sport_type === 'NHL')).toBe(true)
    expect(teams.every((t) => t.primary_logo_url?.includes('/nhl/500/'))).toBe(true)
  })
})
