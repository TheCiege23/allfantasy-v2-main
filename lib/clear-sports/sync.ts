import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordProviderSync } from '@/lib/provider-sync-logger'
import { normalizePosition, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import type { SupportedSport } from '@/lib/sport-scope'
import { clearSportsFetch } from './client'

type ClearSportsEntity =
  | 'teams'
  | 'games'
  | 'players'
  | 'injuries'
  | 'team_stats'
  | 'player_stats'
  | 'odds'
  | 'news'
  | 'predictions'
  | 'sportsbooks'
  | 'api_keys'

const DEFAULT_ENTITIES: ClearSportsEntity[] = [
  'teams',
  'games',
  'players',
  'injuries',
  'team_stats',
  'player_stats',
  'odds',
  'news',
  'predictions',
  'sportsbooks',
  'api_keys',
]

const SPORT_DOMAINS: Record<SupportedSport, string[]> = {
  NFL: ['nfl'],
  NBA: ['nba'],
  NHL: ['nhl'],
  MLB: ['mlb'],
  NCAAF: ['ncaaf'],
  NCAAB: ['ncaab'],
  SOCCER: [
    'epl',
    'la-liga',
    'bundesliga',
    'mls',
    'ligue-1',
    'liga-portugal',
    'uefa',
    'eredivisie',
    'serie-a',
    'liga-mx',
    'brazilian-serie-a',
  ],
}

const TTL_MS_BY_ENTITY: Record<ClearSportsEntity, number> = {
  teams: 24 * 60 * 60 * 1000,
  games: 60 * 60 * 1000,
  players: 24 * 60 * 60 * 1000,
  injuries: 5 * 60 * 1000,
  team_stats: 60 * 60 * 1000,
  player_stats: 60 * 60 * 1000,
  odds: 5 * 60 * 1000,
  news: 15 * 60 * 1000,
  predictions: 15 * 60 * 1000,
  sportsbooks: 24 * 60 * 60 * 1000,
  api_keys: 30 * 60 * 1000,
}

const SOURCE = 'clear_sports'
const GLOBAL_SYNC_SPORT = 'GLOBAL'

export interface ClearSportsSyncSummary {
  fetchedEndpoints: number
  cacheWrites: number
  imported: {
    teams: number
    games: number
    players: number
    injuries: number
    teamStats: number
    playerStats: number
    news: number
  }
  errors: string[]
}

export interface ClearSportsSyncOptions {
  season?: string
  syncType?: string
  soccerLeagues?: string[]
}

function stableId(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 40)
}

function parseIntOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = parseInt(value, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parseFloatOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = parseFloat(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

function asJsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue
}

function currentSeasonString(): string {
  const now = new Date()
  return String(now.getFullYear())
}

function entitySetFromSyncType(syncType: string | undefined): Set<ClearSportsEntity> {
  const raw = String(syncType || 'all').trim().toLowerCase()
  if (raw === 'all') return new Set(DEFAULT_ENTITIES)
  if (raw === 'teams') return new Set(['teams'])
  if (raw === 'games' || raw === 'schedule') return new Set(['games'])
  if (raw === 'players') return new Set(['players'])
  if (raw === 'injuries') return new Set(['injuries'])
  if (raw === 'team_stats') return new Set(['team_stats'])
  if (raw === 'player_stats') return new Set(['player_stats'])
  if (raw === 'stats') return new Set(['team_stats', 'player_stats'])
  if (raw === 'odds') return new Set(['odds'])
  if (raw === 'news') return new Set(['news'])
  if (raw === 'predictions') return new Set(['predictions'])
  if (raw === 'meta') return new Set(['sportsbooks', 'api_keys'])
  return new Set(DEFAULT_ENTITIES)
}

function extractRows(json: unknown, preferredKeys: string[] = []): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.filter((row) => row && typeof row === 'object') as Record<string, unknown>[]
  if (!json || typeof json !== 'object') return []

  const obj = json as Record<string, unknown>
  const keys = [...preferredKeys, 'data', 'results', 'items', 'teams', 'games', 'players', 'injuries', 'stats', 'news', 'odds', 'predictions']
  for (const key of keys) {
    const value = obj[key]
    if (Array.isArray(value)) {
      return value.filter((row) => row && typeof row === 'object') as Record<string, unknown>[]
    }
  }

  return [obj]
}

async function upsertCache(
  key: string,
  entity: ClearSportsEntity,
  payload: Record<string, unknown>,
): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS_BY_ENTITY[entity])
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: key },
    update: {
      data: asJsonInput(payload),
      expiresAt,
    },
    create: {
      cacheKey: key,
      data: asJsonInput(payload),
      expiresAt,
    },
  })
}

function toShortTeamLabel(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const normalized = normalizeTeamAbbrev(raw)
  if (normalized && normalized.length <= 5) return normalized
  return raw.trim()
}

async function importTeams(sport: SupportedSport, rows: Record<string, unknown>[]): Promise<number> {
  let imported = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS_BY_ENTITY.teams)

  for (const row of rows) {
    const externalId = String(row.id ?? row.team_id ?? row.teamId ?? row.slug ?? '')
    const name = String(row.name ?? row.full_name ?? row.fullName ?? row.display_name ?? row.city_name ?? '').trim()
    if (!externalId || !name) continue

    const shortName = toShortTeamLabel(
      row.abbreviation ?? row.abbrev ?? row.short_name ?? row.shortName ?? row.code,
    )

    await prisma.sportsTeam.upsert({
      where: {
        sport_externalId_source: {
          sport,
          externalId,
          source: SOURCE,
        },
      },
      update: {
        name,
        shortName,
        city: typeof row.city === 'string' ? row.city : (typeof row.location === 'string' ? row.location : null),
        logo: typeof row.logo === 'string' ? row.logo : (typeof row.logo_url === 'string' ? row.logo_url : null),
        conference: typeof row.conference === 'string' ? row.conference : null,
        division: typeof row.division === 'string' ? row.division : null,
        fetchedAt: now,
        expiresAt,
      },
      create: {
        sport,
        externalId,
        source: SOURCE,
        name,
        shortName,
        city: typeof row.city === 'string' ? row.city : (typeof row.location === 'string' ? row.location : null),
        logo: typeof row.logo === 'string' ? row.logo : (typeof row.logo_url === 'string' ? row.logo_url : null),
        conference: typeof row.conference === 'string' ? row.conference : null,
        division: typeof row.division === 'string' ? row.division : null,
        fetchedAt: now,
        expiresAt,
      },
    })
    imported += 1
  }

  return imported
}

async function importGames(sport: SupportedSport, rows: Record<string, unknown>[], seasonArg?: string): Promise<number> {
  let imported = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS_BY_ENTITY.games)

  for (const row of rows) {
    const externalId = String(row.id ?? row.game_id ?? row.gameId ?? stableId(JSON.stringify(row))).trim()
    if (!externalId) continue

    const homeObj = (row.home_team ?? row.homeTeam ?? row.home ?? null) as Record<string, unknown> | null
    const awayObj = (row.away_team ?? row.awayTeam ?? row.away ?? null) as Record<string, unknown> | null

    const homeTeam = String(
      row.home_team_name ?? homeObj?.name ?? row.home_team_abbr ?? row.home_team ?? row.home ?? 'HOME',
    )
    const awayTeam = String(
      row.away_team_name ?? awayObj?.name ?? row.away_team_abbr ?? row.away_team ?? row.away ?? 'AWAY',
    )

    const start = parseDateOrNull(
      row.start_time ?? row.startTime ?? row.game_time ?? row.date ?? row.datetime ?? row.commence_time,
    )

    const seasonRaw = row.season ?? seasonArg ?? currentSeasonString()
    const seasonInt = parseIntOrNull(seasonRaw)

    await prisma.sportsGame.upsert({
      where: {
        sport_externalId_source: {
          sport,
          externalId,
          source: SOURCE,
        },
      },
      update: {
        homeTeam: toShortTeamLabel(homeTeam) ?? homeTeam,
        awayTeam: toShortTeamLabel(awayTeam) ?? awayTeam,
        homeTeamId: String(row.home_team_id ?? homeObj?.id ?? '') || null,
        awayTeamId: String(row.away_team_id ?? awayObj?.id ?? '') || null,
        homeScore: parseIntOrNull(row.home_score ?? homeObj?.score),
        awayScore: parseIntOrNull(row.away_score ?? awayObj?.score),
        status: typeof row.status === 'string' ? row.status : (typeof row.game_status === 'string' ? row.game_status : null),
        startTime: start,
        venue: typeof row.venue === 'string' ? row.venue : (typeof row.stadium === 'string' ? row.stadium : null),
        week: parseIntOrNull(row.week),
        season: seasonInt,
        raw: asJsonInput(row),
        fetchedAt: now,
        expiresAt,
      },
      create: {
        sport,
        externalId,
        source: SOURCE,
        homeTeam: toShortTeamLabel(homeTeam) ?? homeTeam,
        awayTeam: toShortTeamLabel(awayTeam) ?? awayTeam,
        homeTeamId: String(row.home_team_id ?? homeObj?.id ?? '') || null,
        awayTeamId: String(row.away_team_id ?? awayObj?.id ?? '') || null,
        homeScore: parseIntOrNull(row.home_score ?? homeObj?.score),
        awayScore: parseIntOrNull(row.away_score ?? awayObj?.score),
        status: typeof row.status === 'string' ? row.status : (typeof row.game_status === 'string' ? row.game_status : null),
        startTime: start,
        venue: typeof row.venue === 'string' ? row.venue : (typeof row.stadium === 'string' ? row.stadium : null),
        week: parseIntOrNull(row.week),
        season: seasonInt,
        raw: asJsonInput(row),
        fetchedAt: now,
        expiresAt,
      },
    })
    imported += 1
  }

  return imported
}

async function importPlayers(sport: SupportedSport, rows: Record<string, unknown>[]): Promise<number> {
  let imported = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS_BY_ENTITY.players)

  for (const row of rows) {
    const externalId = String(row.id ?? row.player_id ?? row.playerId ?? row.slug ?? '').trim()
    const name = String(row.name ?? row.full_name ?? row.fullName ?? row.display_name ?? '').trim()
    if (!externalId || !name) continue

    const teamName = String(
      row.team_abbr ?? row.team ?? row.team_name ?? (typeof row.team === 'object' ? (row.team as Record<string, unknown>).name : ''),
    ).trim()

    await prisma.sportsPlayer.upsert({
      where: {
        sport_externalId_source: {
          sport,
          externalId,
          source: SOURCE,
        },
      },
      update: {
        name,
        position: normalizePosition(String(row.position ?? row.pos ?? '')),
        team: toShortTeamLabel(teamName),
        teamId: String(row.team_id ?? row.teamId ?? (typeof row.team === 'object' ? (row.team as Record<string, unknown>).id : '')) || null,
        number: parseIntOrNull(row.jersey ?? row.jersey_number ?? row.number),
        age: parseIntOrNull(row.age),
        height: typeof row.height === 'string' ? row.height : null,
        weight: typeof row.weight === 'string' ? row.weight : null,
        college: typeof row.college === 'string' ? row.college : null,
        imageUrl: typeof row.image === 'string' ? row.image : (typeof row.image_url === 'string' ? row.image_url : null),
        dob: typeof row.birth_date === 'string' ? row.birth_date : (typeof row.dob === 'string' ? row.dob : null),
        status: typeof row.status === 'string' ? row.status : null,
        fetchedAt: now,
        expiresAt,
      },
      create: {
        sport,
        externalId,
        source: SOURCE,
        name,
        position: normalizePosition(String(row.position ?? row.pos ?? '')),
        team: toShortTeamLabel(teamName),
        teamId: String(row.team_id ?? row.teamId ?? (typeof row.team === 'object' ? (row.team as Record<string, unknown>).id : '')) || null,
        number: parseIntOrNull(row.jersey ?? row.jersey_number ?? row.number),
        age: parseIntOrNull(row.age),
        height: typeof row.height === 'string' ? row.height : null,
        weight: typeof row.weight === 'string' ? row.weight : null,
        college: typeof row.college === 'string' ? row.college : null,
        imageUrl: typeof row.image === 'string' ? row.image : (typeof row.image_url === 'string' ? row.image_url : null),
        dob: typeof row.birth_date === 'string' ? row.birth_date : (typeof row.dob === 'string' ? row.dob : null),
        status: typeof row.status === 'string' ? row.status : null,
        fetchedAt: now,
        expiresAt,
      },
    })
    imported += 1
  }

  return imported
}

async function importInjuries(sport: SupportedSport, rows: Record<string, unknown>[], seasonArg?: string): Promise<number> {
  let imported = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS_BY_ENTITY.injuries)
  const season = parseIntOrNull(seasonArg ?? currentSeasonString())

  for (const row of rows) {
    const playerName = String(row.player_name ?? row.name ?? row.player ?? '').trim()
    if (!playerName) continue

    const playerId = String(row.player_id ?? row.playerId ?? '') || null
    const team = toShortTeamLabel(String(row.team_abbr ?? row.team ?? row.team_name ?? '').trim())
    const externalId = String(
      row.id ??
      row.injury_id ??
      stableId(`${sport}:${playerName}:${playerId ?? ''}:${team ?? ''}:${String(row.status ?? '')}`),
    )

    await prisma.sportsInjury.upsert({
      where: {
        sport_externalId_source: {
          sport,
          externalId,
          source: SOURCE,
        },
      },
      update: {
        playerName,
        playerId,
        team,
        teamId: String(row.team_id ?? row.teamId ?? '') || null,
        position: normalizePosition(String(row.position ?? row.pos ?? '')),
        type: typeof row.type === 'string' ? row.type : null,
        status: typeof row.status === 'string' ? row.status : null,
        description: typeof row.description === 'string' ? row.description : (typeof row.notes === 'string' ? row.notes : null),
        date: parseDateOrNull(row.updated_at ?? row.date ?? row.reported_at),
        season,
        week: parseIntOrNull(row.week),
        raw: asJsonInput(row),
        fetchedAt: now,
        expiresAt,
      },
      create: {
        sport,
        externalId,
        source: SOURCE,
        playerName,
        playerId,
        team,
        teamId: String(row.team_id ?? row.teamId ?? '') || null,
        position: normalizePosition(String(row.position ?? row.pos ?? '')),
        type: typeof row.type === 'string' ? row.type : null,
        status: typeof row.status === 'string' ? row.status : null,
        description: typeof row.description === 'string' ? row.description : (typeof row.notes === 'string' ? row.notes : null),
        date: parseDateOrNull(row.updated_at ?? row.date ?? row.reported_at),
        season,
        week: parseIntOrNull(row.week),
        raw: asJsonInput(row),
        fetchedAt: now,
        expiresAt,
      },
    })
    imported += 1
  }

  return imported
}

async function importTeamStats(sport: SupportedSport, rows: Record<string, unknown>[], seasonArg?: string): Promise<number> {
  let imported = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS_BY_ENTITY.team_stats)
  const season = String(seasonArg || currentSeasonString())

  for (const row of rows) {
    const teamRaw = String(row.team_abbr ?? row.team ?? row.team_name ?? '').trim()
    const team = toShortTeamLabel(teamRaw)
    if (!team) continue

    const seasonType = String(row.season_type ?? 'regular').trim() || 'regular'

    await prisma.teamSeasonStats.upsert({
      where: {
        sport_team_season_seasonType_source: {
          sport,
          team,
          season,
          seasonType,
          source: SOURCE,
        },
      },
      update: {
        teamId: String(row.team_id ?? row.teamId ?? '') || null,
        stats: asJsonInput(row),
        wins: parseIntOrNull(row.wins),
        losses: parseIntOrNull(row.losses),
        ties: parseIntOrNull(row.ties),
        pointsFor: parseIntOrNull(row.points_for ?? row.pointsFor),
        pointsAgainst: parseIntOrNull(row.points_against ?? row.pointsAgainst),
        totalYards: parseIntOrNull(row.total_yards ?? row.totalYards),
        passingYards: parseIntOrNull(row.passing_yards ?? row.passingYards),
        rushingYards: parseIntOrNull(row.rushing_yards ?? row.rushingYards),
        turnovers: parseIntOrNull(row.turnovers),
        sacks: parseFloatOrNull(row.sacks),
        fantasyPoints: parseFloatOrNull(row.fantasy_points ?? row.fantasyPoints),
        gamesPlayed: parseIntOrNull(row.games_played ?? row.gamesPlayed),
        fetchedAt: now,
        expiresAt,
      },
      create: {
        sport,
        team,
        teamId: String(row.team_id ?? row.teamId ?? '') || null,
        season,
        seasonType,
        source: SOURCE,
        stats: asJsonInput(row),
        wins: parseIntOrNull(row.wins),
        losses: parseIntOrNull(row.losses),
        ties: parseIntOrNull(row.ties),
        pointsFor: parseIntOrNull(row.points_for ?? row.pointsFor),
        pointsAgainst: parseIntOrNull(row.points_against ?? row.pointsAgainst),
        totalYards: parseIntOrNull(row.total_yards ?? row.totalYards),
        passingYards: parseIntOrNull(row.passing_yards ?? row.passingYards),
        rushingYards: parseIntOrNull(row.rushing_yards ?? row.rushingYards),
        turnovers: parseIntOrNull(row.turnovers),
        sacks: parseFloatOrNull(row.sacks),
        fantasyPoints: parseFloatOrNull(row.fantasy_points ?? row.fantasyPoints),
        gamesPlayed: parseIntOrNull(row.games_played ?? row.gamesPlayed),
        fetchedAt: now,
        expiresAt,
      },
    })
    imported += 1
  }

  return imported
}

async function importPlayerStats(sport: SupportedSport, rows: Record<string, unknown>[], seasonArg?: string): Promise<number> {
  let imported = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS_BY_ENTITY.player_stats)
  const season = String(seasonArg || currentSeasonString())

  for (const row of rows) {
    const playerId = String(row.player_id ?? row.playerId ?? row.id ?? '').trim()
    const playerName = String(row.player_name ?? row.name ?? row.player ?? '').trim()
    if (!playerId || !playerName) continue

    const seasonType = String(row.season_type ?? 'regular').trim() || 'regular'

    await prisma.playerSeasonStats.upsert({
      where: {
        sport_playerId_season_seasonType_source: {
          sport,
          playerId,
          season,
          seasonType,
          source: SOURCE,
        },
      },
      update: {
        playerName,
        position: normalizePosition(String(row.position ?? row.pos ?? '')),
        team: toShortTeamLabel(String(row.team_abbr ?? row.team ?? row.team_name ?? '').trim()),
        stats: asJsonInput(row),
        gamesPlayed: parseIntOrNull(row.games_played ?? row.gamesPlayed),
        fantasyPoints: parseFloatOrNull(row.fantasy_points ?? row.fantasyPoints),
        fantasyPointsPerGame: parseFloatOrNull(row.fantasy_points_per_game ?? row.fantasyPointsPerGame),
        fetchedAt: now,
        expiresAt,
      },
      create: {
        sport,
        playerId,
        playerName,
        season,
        seasonType,
        source: SOURCE,
        position: normalizePosition(String(row.position ?? row.pos ?? '')),
        team: toShortTeamLabel(String(row.team_abbr ?? row.team ?? row.team_name ?? '').trim()),
        stats: asJsonInput(row),
        gamesPlayed: parseIntOrNull(row.games_played ?? row.gamesPlayed),
        fantasyPoints: parseFloatOrNull(row.fantasy_points ?? row.fantasyPoints),
        fantasyPointsPerGame: parseFloatOrNull(row.fantasy_points_per_game ?? row.fantasyPointsPerGame),
        fetchedAt: now,
        expiresAt,
      },
    })
    imported += 1
  }

  return imported
}

async function importNews(rows: Record<string, unknown>[]): Promise<number> {
  let imported = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS_BY_ENTITY.news)

  for (const row of rows) {
    const title = String(row.title ?? row.headline ?? '').trim()
    if (!title) continue

    const sportRaw = String(row.sport ?? 'NFL').toUpperCase()
    const sport = (
      ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'].includes(sportRaw)
        ? sportRaw
        : 'NFL'
    ) as SupportedSport

    const sourceUrl = typeof row.url === 'string' ? row.url : (typeof row.link === 'string' ? row.link : null)
    const externalId = String(row.id ?? row.news_id ?? stableId(`${sport}:${sourceUrl ?? title}`))
    const publishedAt = parseDateOrNull(row.published_at ?? row.publishedAt ?? row.date)

    const teamList = Array.isArray(row.teams)
      ? row.teams.map((v) => String(v)).filter(Boolean)
      : []

    const playerNames = Array.isArray(row.player_names)
      ? row.player_names.map((v) => String(v)).filter(Boolean)
      : []

    const team = teamList.length > 0 ? (toShortTeamLabel(teamList[0]) ?? teamList[0]) : null

    await prisma.sportsNews.upsert({
      where: {
        sport_externalId_source: {
          sport,
          externalId,
          source: SOURCE,
        },
      },
      update: {
        title,
        content: typeof row.content === 'string' ? row.content : null,
        sourceUrl,
        playerName: playerNames[0] ?? null,
        playerId: String(row.player_id ?? row.playerId ?? '') || null,
        team,
        category: typeof row.category === 'string' ? row.category : null,
        publishedAt,
        fetchedAt: now,
        expiresAt,
        author: typeof row.author === 'string' ? row.author : null,
        description: typeof row.description === 'string' ? row.description : null,
        imageUrl: typeof row.image_url === 'string' ? row.image_url : (typeof row.image === 'string' ? row.image : null),
        playerNames,
        sentiment: typeof row.sentiment === 'string' ? row.sentiment : null,
        sourceId: String(row.source_id ?? row.sourceId ?? '') || null,
        teams: teamList,
      },
      create: {
        sport,
        externalId,
        source: SOURCE,
        title,
        content: typeof row.content === 'string' ? row.content : null,
        sourceUrl,
        playerName: playerNames[0] ?? null,
        playerId: String(row.player_id ?? row.playerId ?? '') || null,
        team,
        category: typeof row.category === 'string' ? row.category : null,
        publishedAt,
        fetchedAt: now,
        expiresAt,
        author: typeof row.author === 'string' ? row.author : null,
        description: typeof row.description === 'string' ? row.description : null,
        imageUrl: typeof row.image_url === 'string' ? row.image_url : (typeof row.image === 'string' ? row.image : null),
        playerNames,
        sentiment: typeof row.sentiment === 'string' ? row.sentiment : null,
        sourceId: String(row.source_id ?? row.sourceId ?? '') || null,
        teams: teamList,
      },
    })
    imported += 1
  }

  return imported
}

// Sports whose /players endpoint does not exist in ClearSports API.
// For these, player roster data comes from /player-stats?full_roster=true.
const DOMAINS_WITHOUT_PLAYERS_ENDPOINT = new Set(['nfl', 'ncaaf'])

// Sports whose /players endpoint does not support name search (only team_id).
// These are NBA, NHL, MLB — just fetch all via /players with no filter.
const DOMAINS_WITH_PLAYERS_ENDPOINT = new Set(['nba', 'nhl', 'mlb', 'ncaab'])

function endpointForEntity(domain: string, entity: ClearSportsEntity): string | null {
  switch (entity) {
    case 'teams':
      return `${domain}/teams`
    case 'games':
      return `${domain}/games`
    case 'players':
      // NFL and NCAAF have no /players endpoint — roster comes from /player-stats?full_roster=true
      if (DOMAINS_WITHOUT_PLAYERS_ENDPOINT.has(domain)) return `${domain}/player-stats`
      // NCAAB/NBA/NHL/MLB have /players endpoint
      if (DOMAINS_WITH_PLAYERS_ENDPOINT.has(domain)) return `${domain}/players`
      // Soccer leagues: no player endpoint documented
      return null
    case 'injuries':
      return `${domain}/injury-stats`
    case 'team_stats':
      return `${domain}/team-stats`
    case 'player_stats':
      return `${domain}/player-stats`
    case 'odds':
      return `${domain}/game-odds`
    case 'predictions':
      return domain === 'nba' ? `${domain}/predictions` : null
    default:
      return null
  }
}

async function markEntitySyncStart(entityType: string, sport: string | null, key: string): Promise<void> {
  try {
    await (prisma as any).providerSyncState.upsert({
      where: {
        provider_entityType_sport_key: {
          provider: SOURCE,
          entityType,
          sport,
          key,
        },
      },
      update: {
        lastStartedAt: new Date(),
      },
      create: {
        provider: SOURCE,
        entityType,
        sport,
        key,
        lastStartedAt: new Date(),
      },
    })
  } catch {
    // Non-blocking diagnostics state write.
  }
}

function payloadSizeBytes(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8')
  } catch {
    return 0
  }
}

export async function syncClearSportsToDb(options: ClearSportsSyncOptions = {}): Promise<ClearSportsSyncSummary> {
  const season = String(options.season || currentSeasonString())
  const syncType = String(options.syncType || 'all')
  const entities = entitySetFromSyncType(options.syncType)
  const startedAt = new Date()

  try {
    await (prisma as any).providerSyncState.upsert({
      where: {
        provider_entityType_sport_key: {
          provider: SOURCE,
          entityType: syncType,
          sport: GLOBAL_SYNC_SPORT,
          key: season,
        },
      },
      update: {
        lastStartedAt: startedAt,
      },
      create: {
        provider: SOURCE,
        entityType: syncType,
        sport: GLOBAL_SYNC_SPORT,
        key: season,
        lastStartedAt: startedAt,
        lastCompletedAt: null,
      },
    })
  } catch {
    // Non-blocking: sync should still proceed even if sync-state logging is unavailable.
  }

  const summary: ClearSportsSyncSummary = {
    fetchedEndpoints: 0,
    cacheWrites: 0,
    imported: {
      teams: 0,
      games: 0,
      players: 0,
      injuries: 0,
      teamStats: 0,
      playerStats: 0,
      news: 0,
    },
    errors: [],
  }

  const sports = Object.keys(SPORT_DOMAINS) as SupportedSport[]

  for (const sport of sports) {
    const domains = sport === 'SOCCER' && Array.isArray(options.soccerLeagues) && options.soccerLeagues.length > 0
      ? options.soccerLeagues
      : SPORT_DOMAINS[sport]

    for (const domain of domains) {
      for (const entity of entities) {
        const endpoint = endpointForEntity(domain, entity)
        if (!endpoint) continue
        const entityType = `${entity}:${domain}`
        const key = season

        const params: Record<string, string | number | undefined> = {}
        if (entity === 'games' || entity === 'injuries' || entity === 'team_stats' || entity === 'player_stats' || entity === 'odds') {
          params.season = season
        }
        // For NFL/NCAAF we route the 'players' entity to player-stats; full_roster=true returns the
        // complete team roster rather than just in-game stat lines.
        if (entity === 'players' && DOMAINS_WITHOUT_PLAYERS_ENDPOINT.has(domain)) {
          params.full_roster = 'true'
        }

        await markEntitySyncStart(entityType, sport, key)

        try {
          const json = await clearSportsFetch<unknown>(endpoint, params)
          summary.fetchedEndpoints += 1
          if (json == null) {
            const errorMessage = `No response for ${endpoint}`
            summary.errors.push(errorMessage)
            await recordProviderSync(
              {
                provider: SOURCE,
                entityType,
                sport,
                key,
              },
              {
                recordsImported: 0,
                recordsUpdated: 0,
                recordsSkipped: 1,
                lastPayloadBytes: 0,
                error: errorMessage,
              },
            )
            continue
          }

          const preferred =
            entity === 'teams' ? ['teams']
              : entity === 'games' ? ['games']
                : entity === 'players' ? ['players']
                  : entity === 'injuries' ? ['injuries']
                    : entity === 'team_stats' ? ['team_stats']
                      : entity === 'player_stats' ? ['player_stats']
                        : entity === 'odds' ? ['odds']
                          : entity === 'predictions' ? ['predictions']
                            : []
          const rows = extractRows(json, preferred)

          const cacheKey = `clearsports:${sport.toLowerCase()}:${domain}:${entity}:${season}`
          await upsertCache(cacheKey, entity, {
            source: SOURCE,
            sport,
            domain,
            entity,
            endpoint,
            params,
            syncedAt: new Date().toISOString(),
            count: rows.length,
            data: json,
          })
          summary.cacheWrites += 1

          let importedForEntity = 0

          if (entity === 'teams') {
            importedForEntity = await importTeams(sport, rows)
            summary.imported.teams += importedForEntity
          }
          if (entity === 'games') {
            importedForEntity = await importGames(sport, rows, season)
            summary.imported.games += importedForEntity
          }
          if (entity === 'players') {
            importedForEntity = await importPlayers(sport, rows)
            summary.imported.players += importedForEntity
          }
          if (entity === 'injuries') {
            importedForEntity = await importInjuries(sport, rows, season)
            summary.imported.injuries += importedForEntity
          }
          if (entity === 'team_stats') {
            importedForEntity = await importTeamStats(sport, rows, season)
            summary.imported.teamStats += importedForEntity
          }
          if (entity === 'player_stats') {
            importedForEntity = await importPlayerStats(sport, rows, season)
            summary.imported.playerStats += importedForEntity
          }

          await recordProviderSync(
            {
              provider: SOURCE,
              entityType,
              sport,
              key,
            },
            {
              recordsImported: importedForEntity,
              recordsUpdated: 1,
              recordsSkipped: 0,
              lastPayloadBytes: payloadSizeBytes(json),
              error: null,
            },
          )
        } catch (error) {
          const errorMessage = `${endpoint}: ${error instanceof Error ? error.message : String(error)}`
          summary.errors.push(errorMessage)
          await recordProviderSync(
            {
              provider: SOURCE,
              entityType,
              sport,
              key,
            },
            {
              recordsImported: 0,
              recordsUpdated: 0,
              recordsSkipped: 1,
              lastPayloadBytes: 0,
              error: errorMessage,
            },
          )
        }
      }
    }
  }

  if (entities.has('sportsbooks')) {
    await markEntitySyncStart('sportsbooks', null, season)
    try {
      const endpoint = 'sportsbooks'
      const json = await clearSportsFetch<unknown>(endpoint)
      summary.fetchedEndpoints += 1
      if (json != null) {
        const rows = extractRows(json, ['sportsbooks'])
        await upsertCache('clearsports:global:sportsbooks', 'sportsbooks', {
          source: SOURCE,
          endpoint,
          syncedAt: new Date().toISOString(),
          count: rows.length,
          data: json,
        })
        summary.cacheWrites += 1
        await recordProviderSync(
          {
            provider: SOURCE,
            entityType: 'sportsbooks',
            key: season,
          },
          {
            recordsImported: rows.length,
            recordsUpdated: 1,
            recordsSkipped: 0,
            lastPayloadBytes: payloadSizeBytes(json),
            error: null,
          },
        )
      } else {
        const errorMessage = 'sportsbooks: no response'
        summary.errors.push(errorMessage)
        await recordProviderSync(
          {
            provider: SOURCE,
            entityType: 'sportsbooks',
            key: season,
          },
          {
            recordsImported: 0,
            recordsUpdated: 0,
            recordsSkipped: 1,
            lastPayloadBytes: 0,
            error: errorMessage,
          },
        )
      }
    } catch (error) {
      const errorMessage = `sportsbooks: ${error instanceof Error ? error.message : String(error)}`
      summary.errors.push(errorMessage)
      await recordProviderSync(
        {
          provider: SOURCE,
          entityType: 'sportsbooks',
          key: season,
        },
        {
          recordsImported: 0,
          recordsUpdated: 0,
          recordsSkipped: 1,
          lastPayloadBytes: 0,
          error: errorMessage,
        },
      )
    }
  }

  if (entities.has('api_keys')) {
    const endpoints = ['api-keys/me', 'api-keys/me/usage', 'api-keys/me/stats']
    for (const endpoint of endpoints) {
      const entityType = `api_keys:${endpoint.replace(/\//g, '_')}`
      await markEntitySyncStart(entityType, null, season)
      try {
        const params = endpoint.endsWith('/usage') ? { limit: 100, offset: 0 } : undefined
        const json = await clearSportsFetch<unknown>(endpoint, params)
        summary.fetchedEndpoints += 1
        if (json != null) {
          await upsertCache(`clearsports:global:${endpoint.replace(/\//g, '_')}`, 'api_keys', {
            source: SOURCE,
            endpoint,
            params,
            syncedAt: new Date().toISOString(),
            data: json,
          })
          summary.cacheWrites += 1
          await recordProviderSync(
            {
              provider: SOURCE,
              entityType,
              key: season,
            },
            {
              recordsImported: 1,
              recordsUpdated: 1,
              recordsSkipped: 0,
              lastPayloadBytes: payloadSizeBytes(json),
              error: null,
            },
          )
        } else {
          const errorMessage = `${endpoint}: no response`
          summary.errors.push(errorMessage)
          await recordProviderSync(
            {
              provider: SOURCE,
              entityType,
              key: season,
            },
            {
              recordsImported: 0,
              recordsUpdated: 0,
              recordsSkipped: 1,
              lastPayloadBytes: 0,
              error: errorMessage,
            },
          )
        }
      } catch (error) {
        const errorMessage = `${endpoint}: ${error instanceof Error ? error.message : String(error)}`
        summary.errors.push(errorMessage)
        await recordProviderSync(
          {
            provider: SOURCE,
            entityType,
            key: season,
          },
          {
            recordsImported: 0,
            recordsUpdated: 0,
            recordsSkipped: 1,
            lastPayloadBytes: 0,
            error: errorMessage,
          },
        )
      }
    }
  }

  if (entities.has('news')) {
    const sports: SupportedSport[] = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']
    for (const sport of sports) {
      await markEntitySyncStart('news', sport, season)
      try {
        const endpoint = 'news'
        const params = { sport, limit: 100, offset: 0 }
        const json = await clearSportsFetch<unknown>(endpoint, params)
        summary.fetchedEndpoints += 1
        if (json == null) {
          const errorMessage = `news:${sport}: no response`
          summary.errors.push(errorMessage)
          await recordProviderSync(
            {
              provider: SOURCE,
              entityType: 'news',
              sport,
              key: season,
            },
            {
              recordsImported: 0,
              recordsUpdated: 0,
              recordsSkipped: 1,
              lastPayloadBytes: 0,
              error: errorMessage,
            },
          )
          continue
        }

        const rows = extractRows(json, ['news'])
        await upsertCache(`clearsports:${sport.toLowerCase()}:news`, 'news', {
          source: SOURCE,
          sport,
          endpoint,
          params,
          syncedAt: new Date().toISOString(),
          count: rows.length,
          data: json,
        })
        summary.cacheWrites += 1
        const importedNews = await importNews(rows.map((row) => ({ ...row, sport })))
        summary.imported.news += importedNews

        await recordProviderSync(
          {
            provider: SOURCE,
            entityType: 'news',
            sport,
            key: season,
          },
          {
            recordsImported: importedNews,
            recordsUpdated: 1,
            recordsSkipped: 0,
            lastPayloadBytes: payloadSizeBytes(json),
            error: null,
          },
        )
      } catch (error) {
        const errorMessage = `news:${sport}: ${error instanceof Error ? error.message : String(error)}`
        summary.errors.push(errorMessage)
        await recordProviderSync(
          {
            provider: SOURCE,
            entityType: 'news',
            sport,
            key: season,
          },
          {
            recordsImported: 0,
            recordsUpdated: 0,
            recordsSkipped: 1,
            lastPayloadBytes: 0,
            error: errorMessage,
          },
        )
      }
    }
  }

  if (entities.has('predictions')) {
    await markEntitySyncStart('predictions', 'SOCCER', season)
    try {
      const endpoint = 'soccer/predictions'
      const json = await clearSportsFetch<unknown>(endpoint)
      summary.fetchedEndpoints += 1
      if (json != null) {
        const rows = extractRows(json, ['predictions'])
        await upsertCache('clearsports:soccer:predictions', 'predictions', {
          source: SOURCE,
          endpoint,
          syncedAt: new Date().toISOString(),
          count: rows.length,
          data: json,
        })
        summary.cacheWrites += 1
        await recordProviderSync(
          {
            provider: SOURCE,
            entityType: 'predictions',
            sport: 'SOCCER',
            key: season,
          },
          {
            recordsImported: rows.length,
            recordsUpdated: 1,
            recordsSkipped: 0,
            lastPayloadBytes: payloadSizeBytes(json),
            error: null,
          },
        )
      } else {
        const errorMessage = 'soccer/predictions: no response'
        summary.errors.push(errorMessage)
        await recordProviderSync(
          {
            provider: SOURCE,
            entityType: 'predictions',
            sport: 'SOCCER',
            key: season,
          },
          {
            recordsImported: 0,
            recordsUpdated: 0,
            recordsSkipped: 1,
            lastPayloadBytes: 0,
            error: errorMessage,
          },
        )
      }
    } catch (error) {
      const errorMessage = `soccer/predictions: ${error instanceof Error ? error.message : String(error)}`
      summary.errors.push(errorMessage)
      await recordProviderSync(
        {
          provider: SOURCE,
          entityType: 'predictions',
          sport: 'SOCCER',
          key: season,
        },
        {
          recordsImported: 0,
          recordsUpdated: 0,
          recordsSkipped: 1,
          lastPayloadBytes: 0,
          error: errorMessage,
        },
      )
    }
  }

  const recordsImported =
    summary.imported.teams +
    summary.imported.games +
    summary.imported.players +
    summary.imported.injuries +
    summary.imported.teamStats +
    summary.imported.playerStats +
    summary.imported.news

  await recordProviderSync(
    {
      provider: SOURCE,
      entityType: syncType,
      sport: GLOBAL_SYNC_SPORT,
      key: season,
    },
    {
      recordsImported,
      recordsUpdated: summary.cacheWrites,
      recordsSkipped: summary.errors.length,
      lastPayloadBytes: 0,
      error: summary.errors.length > 0 ? summary.errors.slice(0, 3).join(' | ') : null,
    },
  )

  return summary
}
