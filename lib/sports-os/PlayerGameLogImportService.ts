import "server-only"

import { prisma } from "@/lib/prisma"
import { toPrismaJsonInput } from "@/lib/prisma-json"
import { recordProviderSync } from "@/lib/provider-sync-logger"
import { normalizePlayerName, normalizeTeamAbbrev } from "@/lib/team-abbrev"
import { rateLimitManager } from "@/lib/workers/rate-limit-manager"

const GAME_LOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_IMPORT_LIMIT = 50
const MAX_IMPORT_LIMIT = 250

export type PlayerGameLogImportSport =
  | "NFL"
  | "NBA"
  | "MLB"
  | "NHL"
  | "NCAAF"
  | "NCAAB"
  | "SOCCER"
  | "WC_SOCCER"

export type PlayerGameLogProvider =
  | "sleeper"
  | "rolling_insights"
  | "api_sports"
  | "api_football"
  | "clearsports"
  | "espn"
  | "cfbd"
  | "thesportsdb"
  | "cache"

export type ProviderGameLogRow = {
  provider: PlayerGameLogProvider
  sport: PlayerGameLogImportSport
  providerPlayerId: string
  playerName?: string | null
  providerTeamId?: string | null
  team?: string | null
  opponent?: string | null
  gameId?: string | null
  week?: number | null
  season: string
  seasonType: string
  playedAt?: string | null
  status?: string | null
  stats: Record<string, unknown>
  raw: unknown
}

export type NormalizedGameLogEntry = {
  week: number
  gameId: string | null
  team: string | null
  opponent: string | null
  playedAt: string | null
  status: string | null
  sourceProvider: PlayerGameLogProvider
  providerPlayerId: string
  canonicalIdentityId: string | null
  stats: Record<string, unknown>
  raw: unknown
}

export type PlayerIdentityResolution =
  | {
      ok: true
      cachePlayerId: string
      canonicalIdentityId: string | null
      matchType: "provider_id" | "sports_player" | "normalized_name"
    }
  | {
      ok: false
      reason: "unmapped" | "ambiguous"
      candidates?: string[]
    }

export type TeamIdentityResolution =
  | { ok: true; teamCode: string; teamId: string | null; matchType: "provider_id" | "team_code" | "team_name" }
  | { ok: false; reason: "unmapped" | "ambiguous"; candidates?: string[] }

export type PlayerGameLogImportTarget = {
  providerPlayerId: string
  playerName?: string | null
  team?: string | null
}

export type PlayerGameLogImportSummary = {
  ok: boolean
  dryRun: boolean
  sport: PlayerGameLogImportSport
  provider: PlayerGameLogProvider
  season: string
  seasonType: string
  weeks: number[]
  targets: number
  rawRowsRead: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  duplicateCount: number
  staleRows: number
  unmappedPlayers: Array<{ providerPlayerId: string; playerName?: string | null; reason: string }>
  unmappedTeams: Array<{ team?: string | null; providerTeamId?: string | null; reason: string }>
  providerErrors: string[]
  warnings: string[]
  syncJobRunId: string | null
}

export type PlayerGameLogHealthRow = {
  sport: PlayerGameLogImportSport
  label: string
  totalCacheRows: number
  sampledGameLogs: number
  latestWeekImported: number | null
  staleRecords: number
  missingMappings: number
  duplicateRecords: number
  failedImports: number
  providerFreshness: Array<{
    provider: string
    lastSuccessAt: string | null
    lastErrorAt: string | null
    lastError: string | null
  }>
  topIssues: string[]
}

export type PlayerGameLogHealthDashboard = {
  generatedAt: string
  rows: PlayerGameLogHealthRow[]
}

type ImportOptions = {
  sport?: string | null
  provider?: string | null
  season?: string | number | null
  seasonType?: string | null
  weeks?: Array<number | string> | number | string | null
  leagueId?: string | null
  seasonId?: string | null
  playerIds?: string[] | null
  limit?: number | null
  dryRun?: boolean
  actorId?: string | null
  trigger?: string | null
}

type ImportProviderAdapter = {
  provider: PlayerGameLogProvider
  sport: PlayerGameLogImportSport
  status: "real" | "cached_only" | "scaffold"
  fetchRows: (input: {
    targets: PlayerGameLogImportTarget[]
    season: string
    seasonType: string
    weeks: number[]
  }) => Promise<{ rows: ProviderGameLogRow[]; errors: string[]; warnings: string[] }>
}

type ExistingCacheRow = {
  playerId: string
  payload: unknown
  expiresAt: Date
}

const SPORTS: PlayerGameLogImportSport[] = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "SOCCER", "WC_SOCCER"]

const PROVIDER_ID_FIELD: Partial<Record<PlayerGameLogProvider, string>> = {
  sleeper: "sleeperId",
  rolling_insights: "rollingInsightsId",
  api_sports: "apiSportsId",
  api_football: "apiSportsId",
  clearsports: "clearSportsId",
  espn: "espnId",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeSport(value: string | null | undefined): PlayerGameLogImportSport {
  const raw = String(value ?? "NFL").trim().toUpperCase().replace(/-/g, "_")
  if (raw === "WORLD_CUP" || raw === "WORLDCUP") return "WC_SOCCER"
  if (raw === "SOCCER_EURO" || raw === "SOCCER_MLS") return "SOCCER"
  return SPORTS.includes(raw as PlayerGameLogImportSport) ? (raw as PlayerGameLogImportSport) : "NFL"
}

function normalizeProvider(value: string | null | undefined, sport: PlayerGameLogImportSport): PlayerGameLogProvider {
  const raw = String(value ?? "").trim().toLowerCase().replace(/-/g, "_")
  if (raw === "rollinginsights") return "rolling_insights"
  if (raw === "api_sports" || raw === "apisports") return "api_sports"
  if (raw === "api_football" || raw === "apifootball") return "api_football"
  if (raw === "clear_sports" || raw === "clearsports") return "clearsports"
  if (raw === "the_sports_db" || raw === "sportsdb" || raw === "thesportsdb") return "thesportsdb"
  if (raw === "cfbd") return "cfbd"
  if (raw === "espn") return "espn"
  if (raw === "cache") return "cache"
  if (raw === "sleeper") return "sleeper"
  if (sport === "NFL") return "sleeper"
  if (sport === "NCAAF") return "cache"
  return "cache"
}

function toSeason(value: string | number | null | undefined): string {
  const raw = String(value ?? new Date().getUTCFullYear()).trim()
  return /^\d{4}$/.test(raw) ? raw : String(new Date().getUTCFullYear())
}

function toSeasonType(value: string | null | undefined): string {
  const raw = String(value ?? "regular").trim().toLowerCase().replace(/\s+/g, "_")
  if (raw === "postseason" || raw === "playoffs" || raw === "post") return "postseason"
  return raw || "regular"
}

function toWeeks(value: ImportOptions["weeks"]): number[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : String(value).split(",")
  return Array.from(
    new Set(
      raw
        .map((week) => Number(week))
        .filter((week) => Number.isFinite(week) && week > 0)
        .map((week) => Math.floor(week))
    )
  ).sort((a, b) => a - b)
}

function clampLimit(value: number | null | undefined): number {
  const parsed = Number(value ?? DEFAULT_IMPORT_LIMIT)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IMPORT_LIMIT
  return Math.min(MAX_IMPORT_LIMIT, Math.floor(parsed))
}

function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 240)
}

function payloadLogs(payload: unknown): NormalizedGameLogEntry[] {
  if (Array.isArray(payload)) return payload.filter(isRecord) as NormalizedGameLogEntry[]
  if (!isRecord(payload)) return []
  for (const key of ["gameLogs", "weeklyStats", "weeks", "logs"]) {
    const value = payload[key]
    if (Array.isArray(value)) return value.filter(isRecord) as NormalizedGameLogEntry[]
  }
  return []
}

function entryKey(row: NormalizedGameLogEntry): string {
  return `${row.week}:${row.gameId ?? "week"}:${row.sourceProvider}`
}

export function mergeGameLogPayload(input: {
  existingPayload: unknown
  incomingRows: NormalizedGameLogEntry[]
  provider: PlayerGameLogProvider
  sport: PlayerGameLogImportSport
  season: string
  seasonType: string
  importedAt?: Date
}): { payload: Record<string, unknown>; imported: number; updated: number; duplicates: number; unchanged: number } {
  const importedAt = input.importedAt ?? new Date()
  const map = new Map<string, NormalizedGameLogEntry>()
  for (const row of payloadLogs(input.existingPayload)) map.set(entryKey(row), row)

  let imported = 0
  let updated = 0
  let duplicates = 0
  let unchanged = 0
  const seenIncoming = new Set<string>()

  for (const row of input.incomingRows) {
    const key = entryKey(row)
    if (seenIncoming.has(key)) {
      duplicates += 1
      continue
    }
    seenIncoming.add(key)
    const current = map.get(key)
    if (!current) {
      imported += 1
      map.set(key, row)
      continue
    }
    if (JSON.stringify(current.stats) !== JSON.stringify(row.stats) || JSON.stringify(current.raw) !== JSON.stringify(row.raw)) {
      updated += 1
      map.set(key, row)
    } else {
      unchanged += 1
    }
  }

  const gameLogs = Array.from(map.values()).sort((a, b) => a.week - b.week)
  return {
    payload: {
      version: 1,
      sport: input.sport,
      season: input.season,
      seasonType: input.seasonType,
      provider: input.provider,
      importedAt: importedAt.toISOString(),
      gameLogs,
    },
    imported,
    updated,
    duplicates,
    unchanged,
  }
}

function normalizeStats(source: Record<string, unknown>): Record<string, unknown> {
  const stats = isRecord(source.stats) ? source.stats : source
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(stats)) {
    if (value == null) continue
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value
    else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) out[key] = Number(value)
  }
  return out
}

function weekFromRow(row: Record<string, unknown>, fallback?: number | null): number | null {
  return asNumber(row.week) ?? asNumber(row.weekNumber) ?? asNumber(row.gameWeek) ?? fallback ?? null
}

function normalizeProviderRows(input: {
  provider: PlayerGameLogProvider
  sport: PlayerGameLogImportSport
  providerPlayerId: string
  playerName?: string | null
  team?: string | null
  season: string
  seasonType: string
  rawPayload: unknown
}): ProviderGameLogRow[] {
  const rows: ProviderGameLogRow[] = []
  const rawRows = Array.isArray(input.rawPayload)
    ? input.rawPayload
    : isRecord(input.rawPayload)
      ? Object.entries(input.rawPayload).map(([week, value]) => ({ week, ...(isRecord(value) ? value : { stats: value }) }))
      : []

  for (const raw of rawRows) {
    if (!isRecord(raw)) continue
    const stats = normalizeStats(raw)
    const week = weekFromRow(raw)
    if (!week || Object.keys(stats).length === 0) continue
    rows.push({
      provider: input.provider,
      sport: input.sport,
      providerPlayerId: input.providerPlayerId,
      playerName: input.playerName,
      team: normalizeTeamAbbrev(input.team) ?? input.team ?? null,
      opponent: typeof raw.opponent === "string" ? raw.opponent : null,
      gameId: String(raw.game_id ?? raw.gameId ?? raw.eventId ?? "").trim() || null,
      week,
      season: input.season,
      seasonType: input.seasonType,
      playedAt: typeof raw.date === "string" ? raw.date : typeof raw.playedAt === "string" ? raw.playedAt : null,
      status: typeof raw.status === "string" ? raw.status : null,
      stats,
      raw,
    })
  }
  return rows
}

async function findTargetMetadata(providerPlayerId: string, sport: PlayerGameLogImportSport) {
  const [identity, sportsPlayer] = await Promise.all([
    prisma.playerIdentityMap.findFirst({
      where: {
        sport,
        OR: [
          { sleeperId: providerPlayerId },
          { apiSportsId: providerPlayerId },
          { rollingInsightsId: providerPlayerId },
          { espnId: providerPlayerId },
          { clearSportsId: providerPlayerId },
        ],
      },
      select: { canonicalName: true, currentTeam: true },
    }).catch(() => null),
    prisma.sportsPlayer.findFirst({
      where: { sport, externalId: providerPlayerId },
      select: { name: true, team: true },
    }).catch(() => null),
  ])
  return {
    playerName: identity?.canonicalName ?? sportsPlayer?.name ?? null,
    team: normalizeTeamAbbrev(identity?.currentTeam ?? sportsPlayer?.team) ?? identity?.currentTeam ?? sportsPlayer?.team ?? null,
  }
}

async function resolveImportTargets(input: {
  sport: PlayerGameLogImportSport
  provider: PlayerGameLogProvider
  playerIds: string[]
  leagueId?: string | null
  seasonId?: string | null
  limit: number
}): Promise<PlayerGameLogImportTarget[]> {
  if (input.playerIds.length > 0) {
    const rows = await Promise.all(
      input.playerIds.slice(0, input.limit).map(async (providerPlayerId) => ({
        providerPlayerId,
        ...(await findTargetMetadata(providerPlayerId, input.sport)),
      }))
    )
    return rows
  }

  if (input.seasonId || input.leagueId) {
    const season = await prisma.redraftSeason.findFirst({
      where: input.seasonId ? { id: input.seasonId } : { leagueId: input.leagueId ?? undefined },
      orderBy: input.seasonId ? undefined : { createdAt: "desc" },
      select: { id: true, leagueId: true },
    })
    if (!season) return []
    const rosters = await prisma.redraftRoster.findMany({
      where: { seasonId: season.id, leagueId: season.leagueId },
      select: { id: true },
    })
    const rosterIds = rosters.map((row) => row.id)
    const players = rosterIds.length
      ? await prisma.redraftRosterPlayer.findMany({
          where: { rosterId: { in: rosterIds }, droppedAt: null },
          select: { playerId: true, playerName: true, team: true },
          take: input.limit,
        })
      : []
    return Array.from(new Map(players.map((row) => [row.playerId, row])).values()).map((row) => ({
      providerPlayerId: row.playerId,
      playerName: row.playerName,
      team: row.team,
    }))
  }

  const providerField = PROVIDER_ID_FIELD[input.provider] ?? (input.sport === "NFL" ? "sleeperId" : null)
  if (providerField) {
    const rows = await prisma.playerIdentityMap.findMany({
      where: {
        sport: input.sport,
        [providerField]: { not: null },
      },
      select: {
        canonicalName: true,
        currentTeam: true,
        [providerField]: true,
      },
      take: input.limit,
    } as any)
    return rows
      .flatMap((row): PlayerGameLogImportTarget[] => {
        const id = String((row as Record<string, unknown>)[providerField] ?? "").trim()
        return id
          ? [{
              providerPlayerId: id,
              playerName: row.canonicalName,
              team: normalizeTeamAbbrev(row.currentTeam) ?? row.currentTeam,
            }]
          : []
      })
  }

  return []
}

export async function resolveProviderPlayerIdentity(input: {
  sport: PlayerGameLogImportSport
  provider: PlayerGameLogProvider
  providerPlayerId: string
  playerName?: string | null
  team?: string | null
}): Promise<PlayerIdentityResolution> {
  const providerField = PROVIDER_ID_FIELD[input.provider]
  if (providerField && input.providerPlayerId) {
    const exact = await prisma.playerIdentityMap.findFirst({
      where: { sport: input.sport, [providerField]: input.providerPlayerId } as any,
      select: { id: true, sleeperId: true, canonicalName: true },
    })
    if (exact) {
      return {
        ok: true,
        cachePlayerId: exact.sleeperId ?? input.providerPlayerId,
        canonicalIdentityId: exact.id,
        matchType: "provider_id",
      }
    }
  }

  const sportsPlayer = await prisma.sportsPlayer.findFirst({
    where: {
      sport: input.sport,
      externalId: input.providerPlayerId,
      source: { equals: input.provider, mode: "insensitive" },
    },
    select: { id: true, externalId: true },
  }).catch(() => null)
  if (sportsPlayer) {
    return {
      ok: true,
      cachePlayerId: sportsPlayer.externalId,
      canonicalIdentityId: null,
      matchType: "sports_player",
    }
  }

  const normalizedName = normalizePlayerName(input.playerName ?? "")
  if (!normalizedName) return { ok: false, reason: "unmapped" }

  const nameMatches = await prisma.playerIdentityMap.findMany({
    where: {
      sport: input.sport,
      normalizedName,
      ...(input.team ? { currentTeam: { equals: input.team, mode: "insensitive" } } : {}),
    },
    select: { id: true, sleeperId: true, canonicalName: true },
    take: 3,
  })
  if (nameMatches.length === 1) {
    const match = nameMatches[0]
    return {
      ok: true,
      cachePlayerId: match.sleeperId ?? input.providerPlayerId,
      canonicalIdentityId: match.id,
      matchType: "normalized_name",
    }
  }
  if (nameMatches.length > 1) {
    return { ok: false, reason: "ambiguous", candidates: nameMatches.map((row) => row.canonicalName) }
  }
  return { ok: false, reason: "unmapped" }
}

export async function resolveProviderTeamIdentity(input: {
  sport: PlayerGameLogImportSport
  provider: PlayerGameLogProvider
  providerTeamId?: string | null
  team?: string | null
}): Promise<TeamIdentityResolution> {
  const normalizedTeam = normalizeTeamAbbrev(input.team) ?? input.team?.trim() ?? ""
  if (!input.providerTeamId && !normalizedTeam) return { ok: false, reason: "unmapped" }

  if (input.providerTeamId) {
    const team = await prisma.sportsTeam.findFirst({
      where: {
        sport: input.sport,
        externalId: input.providerTeamId,
        source: { equals: input.provider, mode: "insensitive" },
      },
      select: { id: true, shortName: true, name: true },
    }).catch(() => null)
    if (team) {
      return {
        ok: true,
        teamCode: normalizeTeamAbbrev(team.shortName ?? team.name) ?? team.shortName ?? team.name,
        teamId: team.id,
        matchType: "provider_id",
      }
    }
  }

  if (!normalizedTeam) return { ok: false, reason: "unmapped" }

  const matches = await prisma.sportsTeam.findMany({
    where: {
      sport: input.sport,
      OR: [
        { shortName: { equals: normalizedTeam, mode: "insensitive" } },
        { name: { equals: normalizedTeam, mode: "insensitive" } },
        { externalId: { equals: normalizedTeam, mode: "insensitive" } },
      ],
    },
    select: { id: true, shortName: true, name: true },
    take: 3,
  }).catch(() => [])

  if (matches.length === 1) {
    const match = matches[0]
    return {
      ok: true,
      teamCode: normalizeTeamAbbrev(match.shortName ?? match.name) ?? match.shortName ?? match.name,
      teamId: match.id,
      matchType: match.shortName?.toLowerCase() === normalizedTeam.toLowerCase() ? "team_code" : "team_name",
    }
  }
  if (matches.length > 1) return { ok: false, reason: "ambiguous", candidates: matches.map((row) => row.name) }
  return { ok: false, reason: "unmapped" }
}

async function fetchSleeperRawLogs(input: {
  playerId: string
  season: string
  seasonType: string
}): Promise<{ payload: unknown | null; error: string | null }> {
  const endpoint = "player-game-logs:nfl:sleeper"
  const canCall = await rateLimitManager.canCall("sleeper", endpoint)
  if (!canCall) return { payload: null, error: "Sleeper call budget exhausted for NFL game log import." }

  const url = `https://api.sleeper.com/stats/nfl/player/${encodeURIComponent(input.playerId)}?season_type=${encodeURIComponent(input.seasonType)}&season=${encodeURIComponent(input.season)}&grouping=week`
  const startedAt = Date.now()
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) })
    const latency = Math.max(0, Date.now() - startedAt)
    await rateLimitManager.recordCall("sleeper", endpoint, res.status, latency, { cached: false, error: res.ok ? null : `HTTP ${res.status}` })
    if (!res.ok) return { payload: null, error: `Sleeper returned HTTP ${res.status} for player ${input.playerId}.` }
    return { payload: await res.json(), error: null }
  } catch (error) {
    await rateLimitManager.recordCall("sleeper", endpoint, 0, Math.max(0, Date.now() - startedAt), {
      cached: false,
      error: redactError(error),
    })
    return { payload: null, error: redactError(error) }
  }
}

function buildSleeperNflAdapter(): ImportProviderAdapter {
  return {
    provider: "sleeper",
    sport: "NFL",
    status: "real",
    async fetchRows(input) {
      const rows: ProviderGameLogRow[] = []
      const errors: string[] = []
      for (const target of input.targets) {
        const { payload, error } = await fetchSleeperRawLogs({
          playerId: target.providerPlayerId,
          season: input.season,
          seasonType: input.seasonType,
        })
        if (error) {
          errors.push(error)
          continue
        }
        rows.push(
          ...normalizeProviderRows({
            provider: "sleeper",
            sport: "NFL",
            providerPlayerId: target.providerPlayerId,
            playerName: target.playerName,
            team: target.team,
            season: input.season,
            seasonType: input.seasonType,
            rawPayload: payload,
          }).filter((row) => !input.weeks.length || input.weeks.includes(row.week ?? -1))
        )
      }
      return { rows, errors, warnings: [] }
    },
  }
}

async function fetchCachedRowsForSport(input: {
  sport: PlayerGameLogImportSport
  provider: PlayerGameLogProvider
  season: string
  seasonType: string
  weeks: number[]
  limit: number
}): Promise<{ rows: ProviderGameLogRow[]; errors: string[]; warnings: string[] }> {
  const sportKey = input.sport.toLowerCase()
  const cacheRows = await prisma.sportsDataCache.findMany({
    where: {
      OR: [
        { cacheKey: { contains: `${sportKey}:player_stats` } },
        { cacheKey: { contains: `${sportKey}:stats` } },
        { cacheKey: { contains: `${input.sport}:player_stats` } },
        { cacheKey: { contains: `${input.sport}:stats` } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  })
  const rows: ProviderGameLogRow[] = []
  for (const cacheRow of cacheRows) {
    const payload = isRecord(cacheRow.data) && Array.isArray(cacheRow.data.data) ? cacheRow.data.data : cacheRow.data
    const values = Array.isArray(payload) ? payload : isRecord(payload) ? Object.values(payload) : []
    for (const value of values) {
      if (!isRecord(value)) continue
      const providerPlayerId = String(value.playerId ?? value.player_id ?? value.id ?? value.externalId ?? "").trim()
      const playerName = String(value.playerName ?? value.player_name ?? value.name ?? "").trim()
      const week = weekFromRow(value)
      if (!providerPlayerId || !week) continue
      rows.push({
        provider: input.provider,
        sport: input.sport,
        providerPlayerId,
        playerName,
        team: typeof value.team === "string" ? value.team : null,
        providerTeamId: typeof value.teamId === "string" ? value.teamId : null,
        opponent: typeof value.opponent === "string" ? value.opponent : null,
        gameId: String(value.gameId ?? value.game_id ?? value.eventId ?? "").trim() || null,
        week,
        season: input.season,
        seasonType: input.seasonType,
        playedAt: typeof value.date === "string" ? value.date : null,
        status: typeof value.status === "string" ? value.status : null,
        stats: normalizeStats(value),
        raw: value,
      })
      if (rows.length >= input.limit * 20) break
    }
  }
  return {
    rows: rows.filter((row) => !input.weeks.length || input.weeks.includes(row.week ?? -1)),
    errors: [],
    warnings: cacheRows.length ? [] : [`No cached ${input.sport} player stat payloads found in SportsDataCache.`],
  }
}

function getImportAdapter(sport: PlayerGameLogImportSport, provider: PlayerGameLogProvider, limit: number): ImportProviderAdapter {
  if (sport === "NFL" && provider === "sleeper") return buildSleeperNflAdapter()
  if (provider === "cache" || sport === "NCAAF") {
    return {
      provider,
      sport,
      status: "cached_only",
      fetchRows: (input) =>
        fetchCachedRowsForSport({
          sport,
          provider,
          season: input.season,
          seasonType: input.seasonType,
          weeks: input.weeks,
          limit,
        }),
    }
  }
  return {
    provider,
    sport,
    status: "scaffold",
    async fetchRows() {
      return {
        rows: [],
        errors: [],
        warnings: [`${provider} ${sport} player game-log import is scaffolded but not implemented yet.`],
      }
    },
  }
}

async function createSyncRun(input: {
  sport: PlayerGameLogImportSport
  provider: PlayerGameLogProvider
  trigger: string
  metadata: Record<string, unknown>
}): Promise<string | null> {
  try {
    const row = await prisma.syncJobRun.create({
      data: {
        jobName: "player_game_log_import",
        jobScope: `${input.sport}:${input.provider}`,
        trigger: input.trigger,
        status: "running",
        metadata: toPrismaJsonInput(input.metadata),
      },
      select: { id: true },
    })
    return row.id
  } catch {
    return null
  }
}

async function completeSyncRun(input: {
  id: string | null
  status: "success" | "failed"
  rowsRead: number
  rowsWritten: number
  rowsSkipped: number
  metadata: Record<string, unknown>
  errorMessage?: string | null
}) {
  if (!input.id) return
  try {
    const existing = await prisma.syncJobRun.findUnique({ where: { id: input.id }, select: { startedAt: true } })
    const durationMs = existing?.startedAt ? Math.max(0, Date.now() - existing.startedAt.getTime()) : null
    await prisma.syncJobRun.update({
      where: { id: input.id },
      data: {
        status: input.status,
        rowsRead: input.rowsRead,
        rowsWritten: input.rowsWritten,
        rowsSkipped: input.rowsSkipped,
        metadata: toPrismaJsonInput(input.metadata),
        errorMessage: input.errorMessage ?? null,
        completedAt: new Date(),
        durationMs,
      },
    })
  } catch {
    // Sync telemetry is best-effort.
  }
}

export async function importPlayerGameLogs(options: ImportOptions): Promise<PlayerGameLogImportSummary> {
  const sport = normalizeSport(options.sport)
  const provider = normalizeProvider(options.provider, sport)
  const season = toSeason(options.season)
  const seasonType = toSeasonType(options.seasonType)
  const weeks = toWeeks(options.weeks)
  const limit = clampLimit(options.limit)
  const dryRun = options.dryRun === true
  const trigger = options.trigger ?? "admin"
  const playerIds = Array.isArray(options.playerIds)
    ? options.playerIds.map((id) => String(id).trim()).filter(Boolean)
    : []
  const syncJobRunId = await createSyncRun({
    sport,
    provider,
    trigger,
    metadata: { sport, provider, season, seasonType, weeks, dryRun, leagueId: options.leagueId ?? null },
  })
  const summary: PlayerGameLogImportSummary = {
    ok: true,
    dryRun,
    sport,
    provider,
    season,
    seasonType,
    weeks,
    targets: 0,
    rawRowsRead: 0,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    staleRows: 0,
    unmappedPlayers: [],
    unmappedTeams: [],
    providerErrors: [],
    warnings: [],
    syncJobRunId,
  }

  try {
    const targets = await resolveImportTargets({
      sport,
      provider,
      playerIds,
      leagueId: options.leagueId,
      seasonId: options.seasonId,
      limit,
    })
    summary.targets = targets.length
    const adapter = getImportAdapter(sport, provider, limit)
    if (adapter.status === "scaffold") summary.warnings.push(`${provider} adapter is scaffold-only for ${sport}.`)
    if (!targets.length && adapter.status !== "cached_only") {
      summary.warnings.push("No import targets found. Pass playerIds, leagueId, seasonId, or backfill PlayerIdentityMap first.")
      summary.skippedCount += 1
    }
    if (dryRun) {
      await completeSyncRun({
        id: syncJobRunId,
        status: "success",
        rowsRead: 0,
        rowsWritten: 0,
        rowsSkipped: 0,
        metadata: summary as unknown as Record<string, unknown>,
      })
      return summary
    }

    const providerResult = await adapter.fetchRows({ targets, season, seasonType, weeks })
    summary.rawRowsRead = providerResult.rows.length
    summary.providerErrors.push(...providerResult.errors)
    summary.warnings.push(...providerResult.warnings)

    const grouped = new Map<string, NormalizedGameLogEntry[]>()
    for (const row of providerResult.rows) {
      const player = await resolveProviderPlayerIdentity({
        sport,
        provider,
        providerPlayerId: row.providerPlayerId,
        playerName: row.playerName,
        team: row.team,
      })
      if (!player.ok) {
        summary.unmappedPlayers.push({
          providerPlayerId: row.providerPlayerId,
          playerName: row.playerName,
          reason: player.reason,
        })
        summary.skippedCount += 1
        continue
      }

      if (row.team || row.providerTeamId) {
        const team = await resolveProviderTeamIdentity({
          sport,
          provider,
          providerTeamId: row.providerTeamId,
          team: row.team,
        })
        if (!team.ok) {
          summary.unmappedTeams.push({ team: row.team, providerTeamId: row.providerTeamId, reason: team.reason })
        }
      }

      const week = row.week ?? null
      if (!week || Object.keys(row.stats).length === 0) {
        summary.skippedCount += 1
        continue
      }
      const normalized: NormalizedGameLogEntry = {
        week,
        gameId: row.gameId ?? null,
        team: normalizeTeamAbbrev(row.team) ?? row.team ?? null,
        opponent: normalizeTeamAbbrev(row.opponent) ?? row.opponent ?? null,
        playedAt: row.playedAt ?? null,
        status: row.status ?? null,
        sourceProvider: row.provider,
        providerPlayerId: row.providerPlayerId,
        canonicalIdentityId: player.canonicalIdentityId,
        stats: row.stats,
        raw: row.raw,
      }
      const current = grouped.get(player.cachePlayerId) ?? []
      current.push(normalized)
      grouped.set(player.cachePlayerId, current)
    }

    const now = new Date()
    const expiresAt = new Date(Date.now() + GAME_LOG_CACHE_TTL_MS)
    const playerIdsToWrite = Array.from(grouped.keys())
    const existingRows = playerIdsToWrite.length
      ? await prisma.playerGameLogCache.findMany({
          where: { playerId: { in: playerIdsToWrite }, sport, season, seasonType },
          select: { playerId: true, payload: true, expiresAt: true },
        })
      : []
    const existingByPlayer = new Map(existingRows.map((row) => [row.playerId, row as ExistingCacheRow]))
    summary.staleRows = existingRows.filter((row) => row.expiresAt <= now).length

    for (const [cachePlayerId, incomingRows] of grouped) {
      const existing = existingByPlayer.get(cachePlayerId)
      const merged = mergeGameLogPayload({
        existingPayload: existing?.payload,
        incomingRows,
        provider,
        sport,
        season,
        seasonType,
        importedAt: now,
      })
      summary.importedCount += merged.imported
      summary.updatedCount += merged.updated
      summary.duplicateCount += merged.duplicates
      summary.skippedCount += merged.unchanged
      await prisma.playerGameLogCache.upsert({
        where: {
          uniq_player_game_log_cache: {
            playerId: cachePlayerId,
            sport,
            season,
            seasonType,
          },
        },
        update: {
          payload: toPrismaJsonInput(merged.payload),
          syncedAt: now,
          expiresAt,
        },
        create: {
          playerId: cachePlayerId,
          sport,
          season,
          seasonType,
          payload: toPrismaJsonInput(merged.payload),
          syncedAt: now,
          expiresAt,
        },
      })
    }

    await recordProviderSync(
      { provider, entityType: "player_game_logs", sport, key: `${season}:${seasonType}` },
      {
        recordsImported: summary.importedCount,
        recordsUpdated: summary.updatedCount,
        recordsSkipped: summary.skippedCount,
        error: summary.providerErrors[0] ?? null,
      }
    )
    await completeSyncRun({
      id: syncJobRunId,
      status: summary.providerErrors.length && summary.importedCount + summary.updatedCount === 0 ? "failed" : "success",
      rowsRead: summary.rawRowsRead,
      rowsWritten: summary.importedCount + summary.updatedCount,
      rowsSkipped: summary.skippedCount,
      metadata: summary as unknown as Record<string, unknown>,
      errorMessage: summary.providerErrors[0] ?? null,
    })
    return summary
  } catch (error) {
    const message = redactError(error)
    summary.ok = false
    summary.providerErrors.push(message)
    await recordProviderSync(
      { provider, entityType: "player_game_logs", sport, key: `${season}:${seasonType}` },
      { error: message }
    )
    await completeSyncRun({
      id: syncJobRunId,
      status: "failed",
      rowsRead: summary.rawRowsRead,
      rowsWritten: summary.importedCount + summary.updatedCount,
      rowsSkipped: summary.skippedCount,
      metadata: summary as unknown as Record<string, unknown>,
      errorMessage: message,
    })
    return summary
  }
}

function duplicateCountForPayload(payload: unknown): number {
  const seen = new Set<string>()
  let duplicates = 0
  for (const row of payloadLogs(payload)) {
    const key = entryKey(row)
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates
}

async function missingMappingCountForSport(sport: PlayerGameLogImportSport): Promise<number> {
  const rows = await prisma.playerGameLogCache.findMany({
    where: { sport },
    select: { playerId: true },
    take: 500,
  })
  let missing = 0
  for (const row of rows) {
    const mapped = await prisma.playerIdentityMap.findFirst({
      where: {
        sport,
        OR: [
          { sleeperId: row.playerId },
          { apiSportsId: row.playerId },
          { rollingInsightsId: row.playerId },
          { clearSportsId: row.playerId },
          { espnId: row.playerId },
        ],
      },
      select: { id: true },
    }).catch(() => null)
    if (!mapped) missing += 1
  }
  return missing
}

async function healthRowForSport(sport: PlayerGameLogImportSport): Promise<PlayerGameLogHealthRow> {
  const now = new Date()
  const [totalCacheRows, staleRecords, latest, sampleRows, failedImports, syncStates, missingMappings] = await Promise.all([
    prisma.playerGameLogCache.count({ where: { sport } }).catch(() => 0),
    prisma.playerGameLogCache.count({ where: { sport, expiresAt: { lte: now } } }).catch(() => 0),
    prisma.playerGameLogCache.findFirst({
      where: { sport },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }).catch(() => null),
    prisma.playerGameLogCache.findMany({
      where: { sport },
      orderBy: { syncedAt: "desc" },
      select: { payload: true },
      take: 500,
    }).catch(() => []),
    prisma.syncJobRun.count({
      where: {
        jobName: "player_game_log_import",
        jobScope: { startsWith: `${sport}:` },
        status: "failed",
      },
    }).catch(() => 0),
    prisma.providerSyncState.findMany({
      where: { entityType: "player_game_logs", sport },
      orderBy: { updatedAt: "desc" },
      select: { provider: true, lastSuccessAt: true, lastErrorAt: true, lastError: true },
      take: 8,
    }).catch(() => []),
    missingMappingCountForSport(sport).catch(() => 0),
  ])
  let sampledGameLogs = 0
  let latestWeekImported: number | null = null
  let duplicateRecords = 0
  for (const row of sampleRows) {
    const logs = payloadLogs(row.payload)
    sampledGameLogs += logs.length
    duplicateRecords += duplicateCountForPayload(row.payload)
    for (const log of logs) {
      if (latestWeekImported == null || log.week > latestWeekImported) latestWeekImported = log.week
    }
  }
  const topIssues = [
    totalCacheRows === 0 ? "No PlayerGameLogCache rows imported" : null,
    staleRecords > 0 ? `${staleRecords} stale cache row(s)` : null,
    missingMappings > 0 ? `${missingMappings} sampled player mapping gap(s)` : null,
    duplicateRecords > 0 ? `${duplicateRecords} duplicate sampled game-log row(s)` : null,
    failedImports > 0 ? `${failedImports} failed import run(s)` : null,
    !latest ? "No provider freshness timestamp" : null,
  ].filter((issue): issue is string => Boolean(issue))

  return {
    sport,
    label: sport === "WC_SOCCER" ? "World Cup" : sport,
    totalCacheRows,
    sampledGameLogs,
    latestWeekImported,
    staleRecords,
    missingMappings,
    duplicateRecords,
    failedImports,
    providerFreshness: syncStates.map((row) => ({
      provider: row.provider,
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
      lastError: row.lastError?.slice(0, 180) ?? null,
    })),
    topIssues,
  }
}

export async function getPlayerGameLogHealthDashboard(sports?: string[]): Promise<PlayerGameLogHealthDashboard> {
  const requested = sports?.length ? sports.map(normalizeSport) : SPORTS
  const uniqueSports = Array.from(new Set(requested))
  return {
    generatedAt: new Date().toISOString(),
    rows: await Promise.all(uniqueSports.map((sport) => healthRowForSport(sport))),
  }
}
