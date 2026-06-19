import { prisma } from '@/lib/prisma'
import { cfbdProvider } from '@/lib/workers/providers/cfbd'

type DbClient = typeof prisma

export type ProviderAvailabilityState = 'available' | 'limited' | 'unavailable'

export type NcaafProviderDatasetReport = {
  dataset: string
  provider: string
  availability: ProviderAvailabilityState
  rawRowsFetched: number
  normalizedRows: number
  rowsWritten: number
  skippedRows: Record<string, number>
  source: string
  lastRefreshedAt: string | null
  note: string | null
}

export type NormalizedNcaafTeam = {
  sport: 'NCAAF'
  externalId: string
  name: string
  shortName: string | null
  conference: string | null
  logoUrl: string | null
  source: 'cfbd'
}

export type NormalizedNcaafGame = {
  sport: 'NCAAF'
  season: number
  weekOrRound: number
  externalId: string
  homeTeam: string | null
  awayTeam: string | null
  homeTeamId: string | null
  awayTeamId: string | null
  homeScore: number | null
  awayScore: number | null
  startTime: Date | null
  status: string
  venue: string | null
  source: 'cfbd'
}

export type NormalizedNcaafPlayer = {
  sport: 'NCAAF'
  externalId: string
  name: string
  position: string | null
  team: string | null
  teamId: string | null
  jerseyNumber: number | null
  source: 'cfbd'
}

export type NormalizedNcaafSeasonStat = {
  sport: 'NCAAF'
  playerId: string
  playerName: string
  season: string
  seasonType: 'regular'
  position: string | null
  team: string | null
  stats: Record<string, unknown>
  gamesPlayed: number | null
  fantasyPoints: number | null
  fantasyPointsPerGame: number | null
  source: 'cfbd'
}

export type NormalizedNcaafTeamSeasonStat = {
  sport: 'NCAAF'
  team: string
  teamId: string | null
  season: string
  seasonType: 'regular'
  stats: Record<string, unknown>
  source: 'cfbd'
}

export type NcaafFallbackProjection = {
  playerId: string
  playerName: string
  sport: 'NCAAF'
  position: string | null
  season: number
  week: number | null
  baselineProjection: number
  afProjection: number
  confidenceLevel: 'low' | 'medium'
  projectionSource: 'allfantasy_cfbd_fallback'
  providerBacked: false
  fallbackGenerated: true
  unavailable: boolean
  reasonCodes: string[]
  adjustmentFactors: Record<string, unknown>
  adjustmentReason: string
}

export type NcaafFoundationSyncReport = {
  ok: true
  sport: 'NCAAF'
  season: number
  week: number | null
  mode: 'dry-run' | 'write'
  provider: 'cfbd'
  generatedAt: string
  datasets: Record<string, NcaafProviderDatasetReport>
  projections: {
    generated: number
    weeklyGenerated: number
    rosGenerated: number
    persisted: number
    weeklyPersisted: number
    rosPersisted: number
    providerBacked: number
    fallbackGenerated: number
    confidence: Record<string, number>
  }
  identity: {
    identityRows: number
    identityRowsWithCfbdId: number
    sportsPlayerRows: number
    identityMatchRate: number
    duplicateCandidateGroups: number
  }
  warnings: string[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asInt(value: unknown): number | null {
  const parsed = asNumber(value)
  return parsed == null ? null : Math.trunc(parsed)
}

function asDate(value: unknown): Date | null {
  const raw = asString(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = asString(value)
    if (stringValue) return stringValue
  }
  return null
}

function teamCode(value: unknown, fallbackName?: unknown): string | null {
  const direct = asString(value)
  if (direct && direct.length <= 12 && !/\s/.test(direct)) return direct.toUpperCase()
  const name = asString(fallbackName)
  if (!name) return direct ? direct.toUpperCase().slice(0, 12) : null
  return name
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 12) || null
}

function validUrl(value: unknown): string | null {
  const raw = asString(value)
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : null
  } catch {
    return null
  }
}

function pickLogo(row: Record<string, unknown>): string | null {
  const logos = row.logos
  if (Array.isArray(logos)) {
    for (const logo of logos) {
      const url = validUrl(logo)
      if (url) return url
    }
  }
  return firstString([row.logo, row.logoUrl, row.schoolLogo, row.altLogo].map(validUrl))
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1
}

function normalizeIdentityName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeCfbdTeam(row: unknown): NormalizedNcaafTeam | null {
  const obj = asRecord(row)
  const externalId = firstString([obj.id, obj.school, obj.name])
  const name = firstString([obj.school, obj.name])
  if (!externalId || !name) return null
  return {
    sport: 'NCAAF',
    externalId,
    name,
    shortName: teamCode(obj.abbreviation ?? obj.shortName, name),
    conference: firstString([obj.conference]),
    logoUrl: pickLogo(obj),
    source: 'cfbd',
  }
}

export function normalizeCfbdGame(row: unknown, fallbackSeason: number): NormalizedNcaafGame | null {
  const obj = asRecord(row)
  const externalId = firstString([obj.id, `${asString(obj.homeTeam ?? obj.home_team) ?? ''}-${asString(obj.awayTeam ?? obj.away_team) ?? ''}-${asString(obj.date ?? obj.start_date) ?? ''}`])
  if (!externalId) return null
  const season = asInt(obj.season) ?? fallbackSeason
  const week = asInt(obj.week) ?? asInt(obj.weekOrRound) ?? 0
  if (week <= 0) return null
  const completed = obj.completed === true || String(obj.status ?? '').toLowerCase() === 'final'
  return {
    sport: 'NCAAF',
    season,
    weekOrRound: week,
    externalId,
    homeTeam: teamCode(obj.homeTeam ?? obj.home_team, obj.homeTeam ?? obj.home_team),
    awayTeam: teamCode(obj.awayTeam ?? obj.away_team, obj.awayTeam ?? obj.away_team),
    homeTeamId: firstString([obj.homeId, obj.home_id, obj.homeTeamId]),
    awayTeamId: firstString([obj.awayId, obj.away_id, obj.awayTeamId]),
    homeScore: asInt(obj.homeScore ?? obj.home_points),
    awayScore: asInt(obj.awayScore ?? obj.away_points),
    startTime: asDate(obj.startDate ?? obj.start_date ?? obj.date),
    status: completed ? 'final' : (asString(obj.status) ?? 'scheduled').toLowerCase(),
    venue: firstString([obj.venue, obj.venueName]),
    source: 'cfbd',
  }
}

export function normalizeCfbdPlayer(row: unknown, teamFallback?: string | null): NormalizedNcaafPlayer | null {
  const obj = asRecord(row)
  const name = firstString([obj.name, obj.player, obj.fullName])
  const resolvedTeam = teamCode(obj.team, teamFallback ?? obj.team)
  const providerId = firstString([obj.id, obj.playerId])
  const externalId = providerId ?? (name && resolvedTeam ? `${resolvedTeam}:${name}` : name)
  if (!externalId || !name) return null
  return {
    sport: 'NCAAF',
    externalId,
    name,
    position: firstString([obj.position, obj.pos])?.toUpperCase() ?? null,
    team: resolvedTeam,
    teamId: firstString([obj.teamId, obj.team_id]),
    jerseyNumber: asInt(obj.jersey ?? obj.number),
    source: 'cfbd',
  }
}

export function normalizeCfbdPlayerSeasonStat(row: unknown, season: number): NormalizedNcaafSeasonStat | null {
  const obj = asRecord(row)
  const playerName = firstString([obj.player, obj.playerName, obj.name])
  const playerId = firstString([obj.playerId, obj.id, playerName])
  if (!playerName || !playerId) return null
  const category = firstString([obj.category])
  const statType = firstString([obj.statType, obj.statName])
  const statName = [category, statType].filter(Boolean).join('_') || statType || category || 'stat'
  const statValue = asNumber(obj.stat ?? obj.value)
  const stats = statValue == null ? { raw: obj } : { [statName]: statValue, raw: obj }
  const gamesPlayed = asInt(obj.games ?? obj.gamesPlayed)
  const fantasyPoints = asNumber(obj.fantasyPoints)
  return {
    sport: 'NCAAF',
    playerId,
    playerName,
    season: String(season),
    seasonType: 'regular',
    position: firstString([obj.position])?.toUpperCase() ?? null,
    team: teamCode(obj.team, obj.team),
    stats,
    gamesPlayed,
    fantasyPoints,
    fantasyPointsPerGame:
      fantasyPoints != null && gamesPlayed && gamesPlayed > 0
        ? Math.round((fantasyPoints / gamesPlayed) * 100) / 100
        : null,
    source: 'cfbd',
  }
}

export function aggregateNcaafPlayerSeasonStats(rows: unknown[], season: number): NormalizedNcaafSeasonStat[] {
  const grouped = new Map<string, NormalizedNcaafSeasonStat>()
  for (const row of rows) {
    const normalized = normalizeCfbdPlayerSeasonStat(row, season)
    if (!normalized) continue
    const key = `${normalized.playerId}|${normalized.team ?? ''}|${normalized.playerName}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        ...normalized,
        stats: {
          ...normalized.stats,
          rawRows: [asRecord(row)],
        },
      })
      continue
    }
    const nextStats = { ...existing.stats, ...normalized.stats }
    const rawRows = Array.isArray(existing.stats.rawRows) ? existing.stats.rawRows : []
    nextStats.rawRows = [...rawRows, asRecord(row)]
    existing.stats = nextStats
    existing.position = existing.position ?? normalized.position
    existing.team = existing.team ?? normalized.team
    existing.gamesPlayed = existing.gamesPlayed ?? normalized.gamesPlayed
    existing.fantasyPoints = existing.fantasyPoints ?? normalized.fantasyPoints
    existing.fantasyPointsPerGame = existing.fantasyPointsPerGame ?? normalized.fantasyPointsPerGame
  }
  return [...grouped.values()]
}

export function aggregateNcaafTeamSeasonStats(rows: unknown[], season: number): NormalizedNcaafTeamSeasonStat[] {
  const grouped = new Map<string, NormalizedNcaafTeamSeasonStat>()
  for (const row of rows) {
    const obj = asRecord(row)
    const rawTeam = firstString([obj.team, obj.school])
    const team = teamCode(rawTeam, rawTeam)
    if (!team) continue
    const statName = firstString([obj.statName, obj.stat, obj.category]) ?? 'stat'
    const statValue = asNumber(obj.statValue ?? obj.value)
    const existing = grouped.get(team) ?? {
      sport: 'NCAAF' as const,
      team,
      teamId: firstString([obj.teamId, obj.schoolId]),
      season: String(season),
      seasonType: 'regular' as const,
      stats: {},
      source: 'cfbd' as const,
    }
    existing.stats[statName] = statValue ?? obj.statValue ?? obj.value ?? null
    const rawRows = Array.isArray(existing.stats.rawRows) ? existing.stats.rawRows : []
    existing.stats.rawRows = [...rawRows, obj]
    grouped.set(team, existing)
  }
  return [...grouped.values()]
}

function defaultPositionProjection(position: string | null): number {
  switch (String(position ?? '').toUpperCase()) {
    case 'QB':
      return 12
    case 'RB':
      return 8
    case 'WR':
      return 7
    case 'TE':
      return 5
    case 'K':
      return 4
    case 'DEF':
    case 'DST':
      return 6
    default:
      return 4
  }
}

export function buildNcaafFallbackProjection(input: {
  playerId: string
  playerName: string
  position?: string | null
  season: number
  week?: number | null
  fantasyPointsPerGame?: number | null
  gamesPlayed?: number | null
  hasSchedule?: boolean
  unavailableReason?: string | null
}): NcaafFallbackProjection {
  const fppg = asNumber(input.fantasyPointsPerGame)
  const games = asInt(input.gamesPlayed)
  const baseline = fppg != null && fppg > 0 ? fppg : defaultPositionProjection(input.position ?? null)
  const schedulePenalty = input.hasSchedule === false ? 0.85 : 1
  const projected = input.unavailableReason ? 0 : Math.round(baseline * schedulePenalty * 100) / 100
  const confidenceLevel = fppg != null && games != null && games >= 4 && input.hasSchedule !== false ? 'medium' : 'low'
  const reasonCodes = ['cfbd_projection_unavailable', 'allfantasy_fallback_projection']
  if (fppg == null) reasonCodes.push('position_baseline')
  if (input.hasSchedule === false) reasonCodes.push('schedule_missing')
  if (input.unavailableReason) reasonCodes.push(input.unavailableReason)

  return {
    playerId: input.playerId,
    playerName: input.playerName,
    sport: 'NCAAF',
    position: input.position ?? null,
    season: input.season,
    week: input.week ?? null,
    baselineProjection: Math.round(baseline * 100) / 100,
    afProjection: projected,
    confidenceLevel,
    projectionSource: 'allfantasy_cfbd_fallback',
    providerBacked: false,
    fallbackGenerated: true,
    unavailable: Boolean(input.unavailableReason),
    reasonCodes,
    adjustmentFactors: {
      source: 'allfantasy_cfbd_fallback',
      providerBacked: false,
      fallbackGenerated: true,
      fantasyPointsPerGame: fppg,
      gamesPlayed: games,
      scheduleAvailable: input.hasSchedule !== false,
      reasonCodes,
    },
    adjustmentReason:
      'AllFantasy fallback projection: CFBD does not provide fantasy projections for this row; confidence is reduced.',
  }
}

function datasetReport(args: Partial<NcaafProviderDatasetReport> & { dataset: string }): NcaafProviderDatasetReport {
  return {
    dataset: args.dataset,
    provider: args.provider ?? 'cfbd',
    availability: args.availability ?? 'unavailable',
    rawRowsFetched: args.rawRowsFetched ?? 0,
    normalizedRows: args.normalizedRows ?? 0,
    rowsWritten: args.rowsWritten ?? 0,
    skippedRows: args.skippedRows ?? {},
    source: args.source ?? 'cfbd',
    lastRefreshedAt: args.lastRefreshedAt ?? null,
    note: args.note ?? null,
  }
}

async function countSafe(model: unknown, args: Record<string, unknown>): Promise<number> {
  const fn = (model as { count?: Function } | null)?.count
  if (!fn) return 0
  return Number((await fn(args).catch(() => 0)) ?? 0)
}

async function duplicateGroupsSafe(db: DbClient): Promise<number> {
  const rows = await (db as any).sportsPlayer
    ?.findMany?.({
      where: { sport: 'NCAAF' },
      select: { name: true, position: true, team: true },
      take: 10000,
    })
    .catch(() => []) ?? []
  const groups = new Map<string, number>()
  for (const row of rows) {
    const key = `${String(row.name ?? '').toLowerCase()}|${String(row.position ?? '').toUpperCase()}|${String(row.team ?? '').toUpperCase()}`
    if (!key.split('|')[0]) continue
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups.values()].filter((count) => count > 1).length
}

async function identityReport(db: DbClient) {
  const [identityRows, identityRowsWithCfbdId, sportsPlayerRows, duplicateCandidateGroups] = await Promise.all([
    countSafe((db as any).playerIdentityMap, { where: { sport: 'NCAAF' } }),
    countSafe((db as any).playerIdentityMap, { where: { sport: 'NCAAF', apiSportsId: { not: null } } }),
    countSafe((db as any).sportsPlayer, { where: { sport: 'NCAAF' } }),
    duplicateGroupsSafe(db),
  ])
  return {
    identityRows,
    identityRowsWithCfbdId,
    sportsPlayerRows,
    identityMatchRate: sportsPlayerRows > 0 ? Math.round((identityRowsWithCfbdId / sportsPlayerRows) * 1000) / 10 : 0,
    duplicateCandidateGroups,
  }
}

export async function syncNcaafCfbdFoundation(options: {
  season: number
  week?: number | null
  write?: boolean
  prismaClient?: DbClient
  provider?: typeof cfbdProvider
  rosterTeams?: string[]
  limit?: number
}): Promise<NcaafFoundationSyncReport> {
  const db = options.prismaClient ?? prisma
  const provider = options.provider ?? cfbdProvider
  const season = Math.trunc(options.season)
  const week = options.week == null ? null : Math.trunc(options.week)
  const write = options.write === true
  const generatedAt = new Date().toISOString()
  const datasets: Record<string, NcaafProviderDatasetReport> = {}
  const warnings: string[] = []
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const teamRows = ((await provider.fetch({ sport: 'NCAAF', dataType: 'teams', query: { season: String(season) } }).catch((error) => {
    warnings.push(`CFBD teams unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return []
  })) ?? []) as unknown[]
  const normalizedTeams = teamRows.map(normalizeCfbdTeam).filter((row): row is NormalizedNcaafTeam => Boolean(row))
  const teamSkipped: Record<string, number> = {}
  if (normalizedTeams.length < teamRows.length) increment(teamSkipped, 'missing_team_identity')
  let teamsWritten = 0
  if (write) {
    for (const team of normalizedTeams) {
      await (db as any).sportsTeam.upsert({
        where: { sport_externalId_source: { sport: 'NCAAF', externalId: team.externalId, source: 'cfbd' } },
        update: {
          name: team.name,
          shortName: team.shortName,
          conference: team.conference,
          logo: team.logoUrl,
          fetchedAt: now,
          expiresAt,
        },
        create: {
          sport: 'NCAAF',
          externalId: team.externalId,
          name: team.name,
          shortName: team.shortName,
          conference: team.conference,
          logo: team.logoUrl,
          source: 'cfbd',
          fetchedAt: now,
          expiresAt,
        },
      })
      if (team.shortName && team.logoUrl) {
        await (db as any).teamAsset.upsert({
          where: { uniq_team_assets_sport_team_code: { sport: 'NCAAF', teamCode: team.shortName } },
          update: {
            teamName: team.name,
            logoUrl: team.logoUrl,
            logoUrlSm: team.logoUrl,
            logoUrlLg: team.logoUrl,
            logoSource: 'cfbd',
          },
          create: {
            sport: 'NCAAF',
            teamCode: team.shortName,
            teamName: team.name,
            logoUrl: team.logoUrl,
            logoUrlSm: team.logoUrl,
            logoUrlLg: team.logoUrl,
            logoSource: 'cfbd',
          },
        })
      }
      teamsWritten += 1
    }
  }
  datasets.teams = datasetReport({
    dataset: 'teams',
    availability: normalizedTeams.length > 0 ? 'available' : 'unavailable',
    rawRowsFetched: teamRows.length,
    normalizedRows: normalizedTeams.length,
    rowsWritten: teamsWritten,
    skippedRows: teamSkipped,
    lastRefreshedAt: generatedAt,
  })

  const rosterTeamNames = (options.rosterTeams?.length ? options.rosterTeams : normalizedTeams.map((team) => team.name))
    .filter(Boolean)
    .slice(0, 160)
  const rosterResults = await Promise.all(
    rosterTeamNames.map(async (teamName) => {
      const rows = await provider
        .fetch({ sport: 'NCAAF', dataType: 'roster', query: { season: String(season), team: teamName } })
        .catch((error) => {
          warnings.push(`CFBD roster unavailable for ${teamName}: ${error instanceof Error ? error.message : String(error)}`)
          return []
        })
      return { teamName, rows: (rows ?? []) as unknown[] }
    }),
  )
  const playerRows = rosterResults.flatMap((result) => result.rows)
  const normalizedPlayers = rosterResults
    .flatMap((result) => result.rows.map((row) => normalizeCfbdPlayer(row, result.teamName)))
    .filter((row): row is NormalizedNcaafPlayer => Boolean(row))
    .slice(0, options.limit ?? 5000)
  const playerSkipped: Record<string, number> = {}
  if (normalizedPlayers.length < playerRows.length) increment(playerSkipped, 'missing_player_identity')
  let playersWritten = 0
  let identitiesWritten = 0
  if (write) {
    for (const player of normalizedPlayers) {
      await (db as any).sportsPlayer.upsert({
        where: { sport_externalId_source: { sport: 'NCAAF', externalId: player.externalId, source: 'cfbd' } },
        update: {
          name: player.name,
          position: player.position,
          team: player.team,
          teamId: player.teamId,
          number: player.jerseyNumber,
          fetchedAt: now,
          expiresAt,
        },
        create: {
          sport: 'NCAAF',
          externalId: player.externalId,
          name: player.name,
          position: player.position,
          team: player.team,
          teamId: player.teamId,
          number: player.jerseyNumber,
          source: 'cfbd',
          fetchedAt: now,
          expiresAt,
        },
      })
      playersWritten += 1

      const normalizedName = normalizeIdentityName(player.name)
      const existingIdentity = await (db as any).playerIdentityMap.findFirst({
        where: {
          sport: 'NCAAF',
          OR: [
            { apiSportsId: player.externalId },
            {
              normalizedName,
              currentTeam: player.team,
              position: player.position,
            },
          ],
        },
      })
      if (existingIdentity) {
        if (!existingIdentity.apiSportsId) {
          await (db as any).playerIdentityMap.update({
            where: { id: existingIdentity.id },
            data: {
              apiSportsId: player.externalId,
              currentTeam: player.team,
              position: player.position,
              status: existingIdentity.status ?? 'active',
              lastSyncedAt: now,
            },
          })
          identitiesWritten += 1
        }
      } else {
        await (db as any).playerIdentityMap.create({
          data: {
            canonicalName: player.name,
            normalizedName,
            position: player.position,
            currentTeam: player.team,
            apiSportsId: player.externalId,
            sport: 'NCAAF',
            status: 'active',
            lastSyncedAt: now,
          },
        })
        identitiesWritten += 1
      }
    }
  }
  datasets.players = datasetReport({
    dataset: 'players/rosters',
    availability: normalizedPlayers.length > 0 ? 'available' : rosterTeamNames.length > 0 ? 'limited' : 'unavailable',
    rawRowsFetched: playerRows.length,
    normalizedRows: normalizedPlayers.length,
    rowsWritten: playersWritten,
    skippedRows: playerSkipped,
    lastRefreshedAt: normalizedPlayers.length > 0 ? generatedAt : null,
    note: rosterTeamNames.length > 0 ? `Roster team probes=${rosterTeamNames.length}; identity rows written=${identitiesWritten}` : 'No CFBD teams available to request rosters.',
  })

  const gameRows = ((await provider.fetch({ sport: 'NCAAF', dataType: 'schedule', query: { season: String(season) } }).catch((error) => {
    warnings.push(`CFBD schedule unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return []
  })) ?? []) as unknown[]
  const normalizedGames = gameRows.map((row) => normalizeCfbdGame(row, season)).filter((row): row is NormalizedNcaafGame => Boolean(row))
  const gameSkipped: Record<string, number> = {}
  if (normalizedGames.length < gameRows.length) increment(gameSkipped, 'missing_game_identity_or_week')
  let gamesWritten = 0
  if (write) {
    for (const game of normalizedGames) {
      await (db as any).sportsGame.upsert({
        where: { sport_externalId_source: { sport: 'NCAAF', externalId: game.externalId, source: 'cfbd' } },
        update: {
          homeTeam: game.homeTeam ?? 'TBD',
          awayTeam: game.awayTeam ?? 'TBD',
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          status: game.status,
          startTime: game.startTime,
          venue: game.venue,
          week: game.weekOrRound,
          season: game.season,
          fetchedAt: now,
          expiresAt,
        },
        create: {
          sport: 'NCAAF',
          externalId: game.externalId,
          homeTeam: game.homeTeam ?? 'TBD',
          awayTeam: game.awayTeam ?? 'TBD',
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          status: game.status,
          startTime: game.startTime,
          venue: game.venue,
          week: game.weekOrRound,
          season: game.season,
          source: 'cfbd',
          fetchedAt: now,
          expiresAt,
          raw: {},
        },
      })
      await (db as any).gameSchedule.upsert({
        where: {
          sportType_season_weekOrRound_externalId: {
            sportType: 'NCAAF',
            season: game.season,
            weekOrRound: game.weekOrRound,
            externalId: game.externalId,
          },
        },
        update: {
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          startTime: game.startTime,
          status: game.status,
          venue: game.venue,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        },
        create: {
          sportType: 'NCAAF',
          season: game.season,
          weekOrRound: game.weekOrRound,
          externalId: game.externalId,
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          startTime: game.startTime,
          status: game.status,
          venue: game.venue,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        },
      })
      gamesWritten += 1
    }
  }
  datasets.schedule = datasetReport({
    dataset: 'schedule',
    availability: normalizedGames.length > 0 ? 'available' : 'unavailable',
    rawRowsFetched: gameRows.length,
    normalizedRows: normalizedGames.length,
    rowsWritten: gamesWritten,
    skippedRows: gameSkipped,
    lastRefreshedAt: generatedAt,
  })

  const playerStatRows = ((await provider
    .fetch({ sport: 'NCAAF', dataType: 'player_stats', query: { season: String(season) } })
    .catch((error) => {
      warnings.push(`CFBD player season stats unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return []
    })) ?? []) as unknown[]
  const normalizedSeasonStats = aggregateNcaafPlayerSeasonStats(playerStatRows, season).slice(0, options.limit ?? 5000)
  const playerStatSkipped: Record<string, number> = {}
  if (normalizedSeasonStats.length < playerStatRows.length) increment(playerStatSkipped, 'aggregated_or_missing_player_stat_identity')
  let playerStatsWritten = 0
  if (write) {
    for (const stat of normalizedSeasonStats) {
      await (db as any).playerSeasonStats.upsert({
        where: {
          sport_playerId_season_seasonType_source: {
            sport: 'NCAAF',
            playerId: stat.playerId,
            season: stat.season,
            seasonType: stat.seasonType,
            source: 'cfbd',
          },
        },
        update: {
          playerName: stat.playerName,
          position: stat.position,
          team: stat.team,
          stats: stat.stats,
          gamesPlayed: stat.gamesPlayed,
          fantasyPoints: stat.fantasyPoints,
          fantasyPointsPerGame: stat.fantasyPointsPerGame,
          fetchedAt: now,
          expiresAt,
        },
        create: {
          sport: 'NCAAF',
          playerId: stat.playerId,
          playerName: stat.playerName,
          season: stat.season,
          seasonType: stat.seasonType,
          position: stat.position,
          team: stat.team,
          stats: stat.stats,
          gamesPlayed: stat.gamesPlayed,
          fantasyPoints: stat.fantasyPoints,
          fantasyPointsPerGame: stat.fantasyPointsPerGame,
          source: 'cfbd',
          fetchedAt: now,
          expiresAt,
        },
      })
      playerStatsWritten += 1
    }
  }
  datasets.playerSeasonStats = datasetReport({
    dataset: 'player season stats',
    availability: normalizedSeasonStats.length > 0 ? 'available' : 'limited',
    rawRowsFetched: playerStatRows.length,
    normalizedRows: normalizedSeasonStats.length,
    rowsWritten: playerStatsWritten,
    skippedRows: playerStatSkipped,
    lastRefreshedAt: normalizedSeasonStats.length > 0 ? generatedAt : null,
    note: 'CFBD stats are raw football stats, not fantasy projections.',
  })

  const teamStatRows = ((await provider
    .fetch({ sport: 'NCAAF', dataType: 'team_stats', query: { season: String(season) } })
    .catch((error) => {
      warnings.push(`CFBD team season stats unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return []
    })) ?? []) as unknown[]
  const normalizedTeamStats = aggregateNcaafTeamSeasonStats(teamStatRows, season)
  const teamStatSkipped: Record<string, number> = {}
  if (normalizedTeamStats.length < teamStatRows.length) increment(teamStatSkipped, 'aggregated_or_missing_team_stat_identity')
  let teamStatsWritten = 0
  if (write) {
    for (const stat of normalizedTeamStats) {
      await (db as any).teamSeasonStats.upsert({
        where: {
          sport_team_season_seasonType_source: {
            sport: 'NCAAF',
            team: stat.team,
            season: stat.season,
            seasonType: stat.seasonType,
            source: 'cfbd',
          },
        },
        update: {
          teamId: stat.teamId,
          stats: stat.stats,
          fetchedAt: now,
          expiresAt,
        },
        create: {
          sport: 'NCAAF',
          team: stat.team,
          teamId: stat.teamId,
          season: stat.season,
          seasonType: stat.seasonType,
          stats: stat.stats,
          source: 'cfbd',
          fetchedAt: now,
          expiresAt,
        },
      })
      teamStatsWritten += 1
    }
  }
  datasets.teamSeasonStats = datasetReport({
    dataset: 'team season stats',
    availability: normalizedTeamStats.length > 0 ? 'available' : 'limited',
    rawRowsFetched: teamStatRows.length,
    normalizedRows: normalizedTeamStats.length,
    rowsWritten: teamStatsWritten,
    skippedRows: teamStatSkipped,
    lastRefreshedAt: normalizedTeamStats.length > 0 ? generatedAt : null,
  })

  const [rankingRows, standingRows] = await Promise.all([
    provider.fetch({ sport: 'NCAAF', dataType: 'rankings', query: { season: String(season), ...(week ? { week: String(week) } : {}) } }).catch(() => []),
    provider.fetch({ sport: 'NCAAF', dataType: 'standings', query: { season: String(season) } }).catch(() => []),
  ])
  datasets.rankings = datasetReport({
    dataset: 'rankings',
    availability: Array.isArray(rankingRows) && rankingRows.length > 0 ? 'available' : 'limited',
    rawRowsFetched: Array.isArray(rankingRows) ? rankingRows.length : 0,
    normalizedRows: Array.isArray(rankingRows) ? rankingRows.length : 0,
    note: 'CFBD rankings are team rankings, not fantasy ADP.',
  })
  datasets.standings = datasetReport({
    dataset: 'standings/records',
    availability: Array.isArray(standingRows) && standingRows.length > 0 ? 'available' : 'limited',
    rawRowsFetched: Array.isArray(standingRows) ? standingRows.length : 0,
    normalizedRows: Array.isArray(standingRows) ? standingRows.length : 0,
    note: 'CFBD records are source evidence for standings context, not fantasy standings.',
  })
  datasets.gameLogs = datasetReport({
    dataset: 'game logs',
    availability: 'unavailable',
    note: 'No CFBD game-log ingestion is wired in this pass; player/team season stats remain normalized.',
  })
  datasets.injuries = datasetReport({
    dataset: 'injuries',
    availability: 'unavailable',
    note: 'CFBD does not expose a fantasy injury feed in this integration; do not fabricate injuries.',
  })
  datasets.providerProjections = datasetReport({
    dataset: 'provider projections',
    availability: 'unavailable',
    note: 'CFBD does not expose fantasy projections; AllFantasy fallback snapshots must be labeled as fallback.',
  })
  datasets.adpRankings = datasetReport({
    dataset: 'ADP/rankings',
    availability: 'limited',
    note: 'CFBD rankings are team rankings, not fantasy ADP. Use AllFantasy fallback rankings for fantasy surfaces.',
  })

  const dbStatRows = await (db as any).playerSeasonStats
    ?.findMany?.({
      where: { sport: 'NCAAF', season: { in: [String(season), String(season - 1)] }, seasonType: 'regular' },
      take: options.limit ?? 5000,
      orderBy: { fetchedAt: 'desc' },
    })
    .catch(() => []) ?? []
  const hasSchedule = normalizedGames.length > 0 || (await countSafe((db as any).gameSchedule, { where: { sportType: 'NCAAF', season } })) > 0
  const projectionRows = new Map<
    string,
    {
      playerId: string
      playerName: string
      position?: string | null
      fantasyPointsPerGame?: number | null
      gamesPlayed?: number | null
    }
  >()
  for (const row of normalizedSeasonStats) {
    projectionRows.set(row.playerId, {
      playerId: row.playerId,
      playerName: row.playerName,
      position: row.position,
      fantasyPointsPerGame: row.fantasyPointsPerGame,
      gamesPlayed: row.gamesPlayed,
    })
  }
  for (const row of dbStatRows) {
    const playerId = String(row.playerId ?? '')
    if (!playerId || projectionRows.has(playerId)) continue
    projectionRows.set(playerId, {
      playerId,
      playerName: String(row.playerName ?? playerId),
      position: row.position ?? null,
      fantasyPointsPerGame: row.fantasyPointsPerGame ?? null,
      gamesPlayed: row.gamesPlayed ?? null,
    })
  }
  if (projectionRows.size === 0) {
    for (const player of normalizedPlayers.slice(0, options.limit ?? 5000)) {
      projectionRows.set(player.externalId, {
        playerId: player.externalId,
        playerName: player.name,
        position: player.position,
        fantasyPointsPerGame: null,
        gamesPlayed: null,
      })
    }
  }
  const projectionBaseRows = [...projectionRows.values()]
  const weeklyProjections =
    week != null
      ? projectionBaseRows.map((row) =>
          buildNcaafFallbackProjection({
            ...row,
            season,
            week,
            hasSchedule,
          }),
        )
      : []
  const rosProjections = projectionBaseRows.map((row) =>
    buildNcaafFallbackProjection({
      ...row,
      season,
      week: null,
      hasSchedule,
    }),
  )
  const projections = [...weeklyProjections, ...rosProjections]
  let weeklyPersisted = 0
  let rosPersisted = 0
  if (write) {
    for (const projection of projections) {
      const lookupKey = `${projection.playerId}|${projection.season}|${projection.week ?? 'ros'}|none`
      await (db as any).aFProjectionSnapshot.upsert({
        where: { snapshotLookupKey: lookupKey },
        update: {
          playerName: projection.playerName,
          position: projection.position ?? 'UNK',
          baselineProjection: projection.baselineProjection,
          afProjection: projection.afProjection,
          confidenceLevel: projection.confidenceLevel,
          adjustmentFactors: projection.adjustmentFactors,
          adjustmentReason: projection.adjustmentReason,
          computedAt: now,
          validUntil: expiresAt,
        },
        create: {
          playerId: projection.playerId,
          playerName: projection.playerName,
          sport: 'NCAAF',
          position: projection.position ?? 'UNK',
          week: projection.week,
          season: projection.season,
          eventId: null,
          baselineProjection: projection.baselineProjection,
          afProjection: projection.afProjection,
          confidenceLevel: projection.confidenceLevel,
          adjustmentFactors: projection.adjustmentFactors,
          adjustmentReason: projection.adjustmentReason,
          validUntil: expiresAt,
          snapshotLookupKey: lookupKey,
        },
      })
      if (projection.week == null) rosPersisted += 1
      else weeklyPersisted += 1
    }
  }

  const confidence = projections.reduce<Record<string, number>>((acc, projection) => {
    increment(acc, projection.confidenceLevel)
    return acc
  }, {})

  return {
    ok: true,
    sport: 'NCAAF',
    season,
    week,
    mode: write ? 'write' : 'dry-run',
    provider: 'cfbd',
    generatedAt,
    datasets,
    projections: {
      generated: projections.length,
      weeklyGenerated: weeklyProjections.length,
      rosGenerated: rosProjections.length,
      persisted: weeklyPersisted + rosPersisted,
      weeklyPersisted,
      rosPersisted,
      providerBacked: 0,
      fallbackGenerated: projections.length,
      confidence,
    },
    identity: await identityReport(db),
    warnings,
  }
}
