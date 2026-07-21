import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canonicalName, canonicalPosition, canonicalTeam } from '@/lib/draft-room/player-canonical-identity'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import {
  fetchNFLPlayerStats,
  fetchNFLSchedule,
  getCurrentNFLSeason,
  type RIScheduleGame,
} from '@/lib/rolling-insights'
import { rollingInsightsProvider } from '@/lib/workers/providers/rolling-insights'

type DbClient = typeof prisma

type SportsPlayerIdentityRow = {
  id: string
  externalId: string
  name: string
  position: string | null
  team: string | null
  teamId?: string | null
  source: string
  sleeperId?: string | null
  imageUrl?: string | null
  fetchedAt?: Date
  updatedAt?: Date
}

type IdentityRow = {
  id: string
  canonicalName: string
  normalizedName: string
  position: string | null
  currentTeam: string | null
  rollingInsightsId: string | null
  sleeperId?: string | null
  fantasyCalcId?: string | null
  apiSportsId?: string | null
  espnId?: string | null
  clearSportsId?: string | null
}

export type NflFoundationWriteMode = 'dry-run' | 'write'

export type NflScheduleSeasonProbe = {
  season: string
  fetched: number
  validForGameSchedule: number
  error: string | null
}

export type NflScheduleSyncReport = {
  mode: NflFoundationWriteMode
  requestedSeason: number
  selectedRollingInsightsSeason: string | null
  seasonAttempts: NflScheduleSeasonProbe[]
  fetched: number
  validForGameSchedule: number
  skippedMissingWeek: number
  written: number
  targetTable: 'GameSchedule'
  samples: NormalizedNflScheduleGame[]
}

export type NflSeasonStatsSyncReport = {
  mode: NflFoundationWriteMode
  requestedSeason: string
  season: string
  fallbackSeasonUsed: boolean
  providerRows: number
  rowsWithRegularSeason: number
  rowsWithFantasyPoints: number
  matchedSportsPlayers: number
  writeCandidates: number
  written: number
  skippedMissingStats: number
  errors: string[]
  samples: Array<{
    playerId: string
    playerName: string
    team: string | null
    fantasyPoints: number | null
    fantasyPointsPerGame: number | null
    gamesPlayed: number | null
  }>
}

export type NflIdentityAuditReport = {
  totalRollingInsightsPlayers: number
  matchedByRollingInsightsId: number
  matchedByNameTeamPosition: number
  unmatched: number
  duplicateCandidateGroups: number
  duplicateCandidateRows: number
  extraDuplicateRows: number
  matchRate: number
  duplicateSamples: Array<{
    key: string
    count: number
    selectedCanonicalRow: Pick<SportsPlayerIdentityRow, 'id' | 'externalId' | 'name' | 'position' | 'team' | 'source'>
  }>
}

export type NflIdentityBackfillReport = NflIdentityAuditReport & {
  mode: NflFoundationWriteMode
  created: number
  updated: number
  skippedExistingRollingInsightsId: number
  skippedAmbiguous: number
  errors: string[]
  estimatedMatchRateAfter: number
}

export type NflInjurySyncReport = {
  mode: NflFoundationWriteMode
  available: boolean
  providerRows: number
  normalizedRows: number
  written: number
  error: string | null
}

export type NormalizedNflScheduleGame = {
  sportType: 'NFL'
  season: number
  weekOrRound: number
  externalId: string
  homeTeamId: string | null
  awayTeamId: string | null
  homeTeam: string | null
  awayTeam: string | null
  startTime: Date | null
  status: string
  venue: string | null
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function yearFromSeason(value: string | number | null | undefined, fallback: number): number {
  const raw = String(value ?? '').trim()
  const parsed = Number(raw.includes('-') ? raw.split('-')[0] : raw)
  return Number.isFinite(parsed) && parsed > 2000 ? Math.trunc(parsed) : fallback
}

function seasonForDb(season: string | number): string {
  const raw = String(season).trim()
  return raw.includes('-') ? raw.split('-')[0]! : raw
}

function playerKey(row: Pick<SportsPlayerIdentityRow, 'name' | 'position' | 'team'>): string {
  return `${canonicalName(row.name)}|${canonicalPosition(row.position)}|${canonicalTeam(row.team)}`
}

function identityKey(row: Pick<IdentityRow, 'normalizedName' | 'position' | 'currentTeam'>): string {
  return `${row.normalizedName}|${canonicalPosition(row.position)}|${canonicalTeam(row.currentTeam)}`
}

function sourceScore(source: string | null | undefined): number {
  const s = String(source ?? '').toLowerCase()
  if (s.includes('rolling')) return 50
  if (s.includes('sleeper')) return 45
  if (s.includes('fantasycalc')) return 40
  return 10
}

export function selectCanonicalNflSportsPlayerRow<T extends SportsPlayerIdentityRow>(rows: T[]): T {
  return [...rows].sort((a, b) => {
    const score = (row: T) =>
      sourceScore(row.source) +
      (row.sleeperId ? 20 : 0) +
      (row.externalId ? 12 : 0) +
      (row.team ? 8 : 0) +
      (row.imageUrl ? 4 : 0)
    return score(b) - score(a) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
  })[0]!
}

export function summarizeNflSportsPlayerDuplicates(rows: SportsPlayerIdentityRow[]): {
  duplicateCandidateGroups: number
  duplicateCandidateRows: number
  extraDuplicateRows: number
  duplicateSamples: NflIdentityAuditReport['duplicateSamples']
} {
  const groups = new Map<string, SportsPlayerIdentityRow[]>()
  for (const row of rows) {
    const key = playerKey(row)
    if (!key.split('|')[0] || !key.split('|')[1]) continue
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const duplicateGroups = [...groups.entries()].filter(([, group]) => group.length > 1)
  return {
    duplicateCandidateGroups: duplicateGroups.length,
    duplicateCandidateRows: duplicateGroups.reduce((sum, [, group]) => sum + group.length, 0),
    extraDuplicateRows: duplicateGroups.reduce((sum, [, group]) => sum + group.length - 1, 0),
    duplicateSamples: duplicateGroups.slice(0, 25).map(([key, group]) => {
      const selected = selectCanonicalNflSportsPlayerRow(group)
      return {
        key,
        count: group.length,
        selectedCanonicalRow: {
          id: selected.id,
          externalId: selected.externalId,
          name: selected.name,
          position: selected.position,
          team: selected.team,
          source: selected.source,
        },
      }
    }),
  }
}

/** How many seasons back `syncNflFoundationSeasonStats` will walk when the requested one is empty. */
const SEASON_FALLBACK_MAX_YEARS = 3

export function rollingInsightsSeasonRange(season: number): string {
  return `${season}-${season + 1}`
}

export function rollingInsightsScheduleSeasonCandidates(season: number): string[] {
  return unique([String(season), rollingInsightsSeasonRange(season), getCurrentNFLSeason()])
}

export function normalizeNflScheduleGame(
  game: RIScheduleGame,
  fallbackSeason: number,
): NormalizedNflScheduleGame | null {
  const week = asNumber(game.week)
  if (week == null || week <= 0) return null
  const homeTeam = normalizeTeamAbbrev(game.homeTeam) ?? game.homeTeam ?? null
  const awayTeam = normalizeTeamAbbrev(game.awayTeam) ?? game.awayTeam ?? null
  return {
    sportType: 'NFL',
    season: yearFromSeason(game.season, fallbackSeason),
    weekOrRound: Math.trunc(week),
    externalId: String(game.gameId),
    homeTeamId: game.homeTeamId ?? null,
    awayTeamId: game.awayTeamId ?? null,
    homeTeam,
    awayTeam,
    startTime: validDate(game.date),
    status: String(game.status ?? 'scheduled').toLowerCase(),
    venue: game.venue?.arena ?? null,
  }
}

export async function syncNflFoundationSchedule(options: {
  season: number
  write?: boolean
  prismaClient?: DbClient
  fetchSchedule?: typeof fetchNFLSchedule
}): Promise<NflScheduleSyncReport> {
  const db = (options.prismaClient ?? prisma) as DbClient
  const write = Boolean(options.write)
  const fetchSchedule = options.fetchSchedule ?? fetchNFLSchedule
  let selectedSeason: string | null = null
  let selectedGames: RIScheduleGame[] = []
  let selectedNormalized: NormalizedNflScheduleGame[] = []

  const attempts = await Promise.all(
    rollingInsightsScheduleSeasonCandidates(options.season).map(async (season) => {
      let games: RIScheduleGame[] = []
      let normalized: NormalizedNflScheduleGame[] = []
      let error: string | null = null
      try {
        games = await fetchSchedule({ season })
        normalized = games
          .map((game) => normalizeNflScheduleGame(game, options.season))
          .filter((game): game is NormalizedNflScheduleGame => Boolean(game))
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
      return {
        season,
        games,
        normalized,
        probe: {
          season,
          fetched: games.length,
          validForGameSchedule: normalized.length,
          error,
        } satisfies NflScheduleSeasonProbe,
      }
    }),
  )

  for (const attempt of attempts) {
    try {
      if (!selectedSeason && attempt.normalized.length > 0) {
        selectedSeason = attempt.season
        selectedGames = attempt.games
        selectedNormalized = attempt.normalized
      }
    } catch {
      // This loop is selection-only; probe errors are already captured above.
    }
  }

  let written = 0
  if (write) {
    for (const row of selectedNormalized) {
      await (db as any).gameSchedule.upsert({
        where: {
          sportType_season_weekOrRound_externalId: {
            sportType: row.sportType,
            season: row.season,
            weekOrRound: row.weekOrRound,
            externalId: row.externalId,
          },
        },
        create: row,
        update: {
          homeTeamId: row.homeTeamId,
          awayTeamId: row.awayTeamId,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          startTime: row.startTime,
          status: row.status,
          venue: row.venue,
        },
      })
      written += 1
    }
  }

  return {
    mode: write ? 'write' : 'dry-run',
    requestedSeason: options.season,
    selectedRollingInsightsSeason: selectedSeason,
    seasonAttempts: attempts.map((attempt) => attempt.probe),
    fetched: selectedGames.length,
    validForGameSchedule: selectedNormalized.length,
    skippedMissingWeek: Math.max(0, selectedGames.length - selectedNormalized.length),
    written,
    targetTable: 'GameSchedule',
    samples: selectedNormalized.slice(0, 5),
  }
}

function numberFromStats(stats: Record<string, unknown> | null | undefined, key: string): number | null {
  return asNumber(stats?.[key])
}

export async function syncNflFoundationSeasonStats(options: {
  season: number | string
  write?: boolean
  limit?: number
  prismaClient?: DbClient
  fetchStats?: typeof fetchNFLPlayerStats
}): Promise<NflSeasonStatsSyncReport> {
  const db = (options.prismaClient ?? prisma) as DbClient
  const write = Boolean(options.write)
  const requestedSeason = seasonForDb(options.season)
  let season = requestedSeason
  const fetchStats = options.fetchStats ?? fetchNFLPlayerStats
  const errors: string[] = []
  let rows = await fetchStats({ season })
  let fallbackSeasonUsed = false
  // Walk back a bounded number of seasons until one returns rows. Rolling Insights 400s on a
  // season that has not started (verified: `2026` -> HTTP 400 while `2025` -> 2,155 rows), so a
  // scheduled caller asking for the current year would otherwise write nothing all offseason.
  // Looping rather than a single step means a season that is empty for any other reason also
  // self-heals without a code change. `season` is what gets written to the row, so whichever
  // season actually supplied the data is the one labelled — 2025 totals are never stored as 2026.
  if (!rows.length) {
    for (let back = 1; back <= SEASON_FALLBACK_MAX_YEARS; back += 1) {
      const candidate = String(Number(requestedSeason) - back)
      if (!Number.isFinite(Number(candidate)) || Number(candidate) <= 2000) break
      const fallbackRows = await fetchStats({ season: candidate })
      if (fallbackRows.length) {
        rows = fallbackRows
        season = candidate
        fallbackSeasonUsed = true
        break
      }
    }
  }
  if (options.limit && options.limit > 0) rows = rows.slice(0, options.limit)

  const ids = unique(rows.map((row) => String(row.player_id ?? '')))
  const sportsPlayers = ids.length
    ? ((await (db as any).sportsPlayer
        .findMany({
          where: { sport: 'NFL', source: 'rolling_insights', externalId: { in: ids } },
          select: { externalId: true, name: true, position: true, team: true },
        })
        .catch(() => [])) as Array<{ externalId: string; name: string; position: string | null; team: string | null }>)
    : []
  const byExternalId = new Map(sportsPlayers.map((row) => [String(row.externalId), row]))

  const report: NflSeasonStatsSyncReport = {
    mode: write ? 'write' : 'dry-run',
    requestedSeason,
    season,
    fallbackSeasonUsed,
    providerRows: rows.length,
    rowsWithRegularSeason: 0,
    rowsWithFantasyPoints: 0,
    matchedSportsPlayers: 0,
    writeCandidates: 0,
    written: 0,
    skippedMissingStats: 0,
    errors,
    samples: [],
  }

  for (const row of rows) {
    const riId = String(row.player_id ?? '').trim()
    const stats = asObject(row.regular_season)
    if (!riId || !stats || !Object.keys(stats).length) {
      report.skippedMissingStats += 1
      continue
    }
    report.rowsWithRegularSeason += 1
    if (stats.DK_fantasy_points != null) report.rowsWithFantasyPoints += 1
    const sportsPlayer = byExternalId.get(riId)
    if (sportsPlayer) report.matchedSportsPlayers += 1

    const fantasyPoints = numberFromStats(stats, 'DK_fantasy_points')
    const fantasyPointsPerGame = numberFromStats(stats, 'DK_fantasy_points_per_game')
    const gamesPlayed = numberFromStats(stats, 'games_played')
    const playerName = row.player || sportsPlayer?.name || 'Unknown Player'
    const team = normalizeTeamAbbrev(String(row.team ?? sportsPlayer?.team ?? '')) ?? sportsPlayer?.team ?? null
    const position = sportsPlayer?.position ?? null

    report.writeCandidates += 1
    if (report.samples.length < 8) {
      report.samples.push({
        playerId: riId,
        playerName,
        team,
        fantasyPoints,
        fantasyPointsPerGame,
        gamesPlayed,
      })
    }

    if (!write) continue

    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      await (db as any).playerSeasonStats.upsert({
        where: {
          sport_playerId_season_seasonType_source: {
            sport: 'NFL',
            playerId: riId,
            season,
            seasonType: 'regular',
            source: 'rolling_insights',
          },
        },
        create: {
          sport: 'NFL',
          playerId: riId,
          playerName,
          season,
          seasonType: 'regular',
          position,
          team,
          stats: stats as Prisma.InputJsonValue,
          gamesPlayed: gamesPlayed != null ? Math.round(gamesPlayed) : null,
          fantasyPoints,
          fantasyPointsPerGame,
          source: 'rolling_insights',
          fetchedAt: new Date(),
          expiresAt,
        },
        update: {
          playerName,
          position,
          team,
          stats: stats as Prisma.InputJsonValue,
          gamesPlayed: gamesPlayed != null ? Math.round(gamesPlayed) : null,
          fantasyPoints,
          fantasyPointsPerGame,
          fetchedAt: new Date(),
          expiresAt,
        },
      })
      report.written += 1
    } catch (error) {
      errors.push(`${playerName} (${riId}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return report
}

async function loadIdentityAuditRows(db: DbClient): Promise<{
  players: SportsPlayerIdentityRow[]
  identities: IdentityRow[]
}> {
  const [players, identities] = await Promise.all([
    (db as any).sportsPlayer
      .findMany({
        where: { sport: 'NFL', source: 'rolling_insights' },
        select: {
          id: true,
          externalId: true,
          name: true,
          position: true,
          team: true,
          teamId: true,
          source: true,
          sleeperId: true,
          imageUrl: true,
          fetchedAt: true,
          updatedAt: true,
        },
      })
      .catch(() => []),
    (db as any).playerIdentityMap
      .findMany({
        where: { sport: 'NFL' },
        select: {
          id: true,
          canonicalName: true,
          normalizedName: true,
          position: true,
          currentTeam: true,
          rollingInsightsId: true,
          sleeperId: true,
          fantasyCalcId: true,
          apiSportsId: true,
          espnId: true,
          clearSportsId: true,
        },
      })
      .catch(() => []),
  ])
  return { players: players as SportsPlayerIdentityRow[], identities: identities as IdentityRow[] }
}

export async function auditNflRollingInsightsIdentity(options?: {
  prismaClient?: DbClient
}): Promise<NflIdentityAuditReport> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const { players, identities } = await loadIdentityAuditRows(db)
  const identityByRiId = new Map<string, IdentityRow[]>()
  const identitiesByName = new Map<string, IdentityRow[]>()
  for (const identity of identities) {
    if (identity.rollingInsightsId) {
      const list = identityByRiId.get(identity.rollingInsightsId) ?? []
      list.push(identity)
      identityByRiId.set(identity.rollingInsightsId, list)
    }
    const key = identityKey(identity)
    const list = identitiesByName.get(key) ?? []
    list.push(identity)
    identitiesByName.set(key, list)
  }

  let matchedByRollingInsightsId = 0
  let matchedByNameTeamPosition = 0
  let unmatched = 0

  for (const player of players) {
    if (identityByRiId.has(player.externalId)) {
      matchedByRollingInsightsId += 1
      continue
    }
    const candidates = identitiesByName.get(playerKey(player)) ?? []
    if (candidates.length === 1) matchedByNameTeamPosition += 1
    else unmatched += 1
  }

  const duplicateSummary = summarizeNflSportsPlayerDuplicates(players)
  const matched = matchedByRollingInsightsId + matchedByNameTeamPosition
  return {
    totalRollingInsightsPlayers: players.length,
    matchedByRollingInsightsId,
    matchedByNameTeamPosition,
    unmatched,
    ...duplicateSummary,
    matchRate: players.length ? Math.round((matched / players.length) * 1000) / 10 : 0,
  }
}

export async function backfillNflRollingInsightsIdentities(options?: {
  write?: boolean
  prismaClient?: DbClient
}): Promise<NflIdentityBackfillReport> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const write = Boolean(options?.write)
  const { players, identities } = await loadIdentityAuditRows(db)
  const audit = await auditNflRollingInsightsIdentity({ prismaClient: db })
  const identitiesByRiId = new Map(identities.filter((row) => row.rollingInsightsId).map((row) => [row.rollingInsightsId!, row]))
  const identitiesByName = new Map<string, IdentityRow[]>()
  for (const identity of identities) {
    const key = identityKey(identity)
    const list = identitiesByName.get(key) ?? []
    list.push(identity)
    identitiesByName.set(key, list)
  }

  const report: NflIdentityBackfillReport = {
    ...audit,
    mode: write ? 'write' : 'dry-run',
    created: 0,
    updated: 0,
    skippedExistingRollingInsightsId: 0,
    skippedAmbiguous: 0,
    errors: [],
    estimatedMatchRateAfter: audit.matchRate,
  }

  for (const player of players) {
    if (identitiesByRiId.has(player.externalId)) {
      report.skippedExistingRollingInsightsId += 1
      continue
    }
    const key = playerKey(player)
    const exactMatches = identitiesByName.get(key) ?? []
    const normalizedName = canonicalName(player.name)
    const position = canonicalPosition(player.position) || null
    const currentTeam = canonicalTeam(player.team) || null
    if (!normalizedName) continue

    if (exactMatches.length === 1) {
      const match = exactMatches[0]!
      if (match.rollingInsightsId && match.rollingInsightsId !== player.externalId) {
        report.skippedExistingRollingInsightsId += 1
        continue
      }
      report.updated += 1
      if (!write) continue
      try {
        await (db as any).playerIdentityMap.update({
          where: { id: match.id },
          data: {
            rollingInsightsId: player.externalId,
            canonicalName: match.canonicalName || player.name,
            normalizedName,
            position: match.position ?? position,
            currentTeam: match.currentTeam ?? currentTeam,
            status: undefined,
            lastSyncedAt: new Date(),
          },
        })
      } catch (error) {
        report.errors.push(`${player.name} (${player.externalId}): ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }

    if (exactMatches.length > 1) {
      report.skippedAmbiguous += 1
      continue
    }

    report.created += 1
    if (!write) continue
    try {
      await (db as any).playerIdentityMap.create({
        data: {
          sport: 'NFL',
          canonicalName: player.name,
          normalizedName,
          position,
          currentTeam,
          rollingInsightsId: player.externalId,
          status: null,
          lastSyncedAt: new Date(),
        },
      })
    } catch (error) {
      report.errors.push(`${player.name} (${player.externalId}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const estimatedMatched = audit.matchedByRollingInsightsId + audit.matchedByNameTeamPosition + report.created + report.updated
  report.estimatedMatchRateAfter = players.length ? Math.round((estimatedMatched / players.length) * 1000) / 10 : 0
  return report
}

function normalizeInjuryRows(payload: unknown[]): Array<{
  externalId: string
  playerId: string | null
  playerName: string
  team: string | null
  teamId: string | null
  type: string | null
  status: string | null
  date: Date | null
  raw: Prisma.InputJsonValue
}> {
  const out: Array<{
    externalId: string
    playerId: string | null
    playerName: string
    team: string | null
    teamId: string | null
    type: string | null
    status: string | null
    date: Date | null
    raw: Prisma.InputJsonValue
  }> = []

  const pushOne = (raw: Record<string, unknown>, inheritedTeam?: Record<string, unknown>) => {
    const playerId = asString(raw.playerId ?? raw.player_id ?? raw.id)
    const playerName = asString(raw.player ?? raw.playerName ?? raw.name)
    if (!playerName) return
    const team = normalizeTeamAbbrev(asString(raw.team ?? raw.team_abbr ?? inheritedTeam?.abbrv ?? inheritedTeam?.team)) ?? null
    const teamId = asString(raw.team_id ?? raw.teamId ?? inheritedTeam?.id)
    const type = asString(raw.injury ?? raw.type ?? raw.bodyPart)
    const status = asString(raw.returns ?? raw.status ?? raw.gameStatus ?? type)
    const date = validDate(asString(raw.date ?? raw.date_injured ?? raw.reportDate))
    out.push({
      externalId: playerId ?? `${canonicalName(playerName)}:${team ?? 'FA'}:${date?.toISOString() ?? 'unknown'}`,
      playerId,
      playerName,
      team,
      teamId,
      type,
      status,
      date,
      raw: raw as Prisma.InputJsonValue,
    })
  }

  for (const item of payload) {
    const obj = asObject(item)
    if (!obj) continue
    const nested = Array.isArray(obj.injuries) ? obj.injuries : null
    if (nested) {
      for (const injury of nested) {
        const injuryObj = asObject(injury)
        if (injuryObj) pushOne(injuryObj, obj)
      }
    } else {
      pushOne(obj)
    }
  }

  return out
}

export async function syncNflFoundationInjuries(options?: {
  write?: boolean
  prismaClient?: DbClient
}): Promise<NflInjurySyncReport> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const write = Boolean(options?.write)
  const result = await rollingInsightsProvider({ sport: 'NFL', dataType: 'injuries' })
  if (!Array.isArray(result.data)) {
    return {
      mode: write ? 'write' : 'dry-run',
      available: false,
      providerRows: 0,
      normalizedRows: 0,
      written: 0,
      error: result.error ?? 'Rolling Insights injuries returned no array payload',
    }
  }
  const normalized = normalizeInjuryRows(result.data as unknown[])
  let written = 0
  if (write) {
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000)
    for (const row of normalized) {
      await (db as any).sportsInjury.upsert({
        where: {
          sport_externalId_source: {
            sport: 'NFL',
            externalId: row.externalId,
            source: 'rolling_insights',
          },
        },
        create: {
          sport: 'NFL',
          externalId: row.externalId,
          playerName: row.playerName,
          playerId: row.playerId,
          team: row.team,
          teamId: row.teamId,
          type: row.type,
          status: row.status,
          date: row.date,
          source: 'rolling_insights',
          fetchedAt: new Date(),
          expiresAt,
          raw: row.raw,
        },
        update: {
          playerName: row.playerName,
          playerId: row.playerId,
          team: row.team,
          teamId: row.teamId,
          type: row.type,
          status: row.status,
          date: row.date,
          fetchedAt: new Date(),
          expiresAt,
          raw: row.raw,
        },
      })
      written += 1
    }
  }
  return {
    mode: write ? 'write' : 'dry-run',
    available: true,
    providerRows: result.data.length,
    normalizedRows: normalized.length,
    written,
    error: null,
  }
}
