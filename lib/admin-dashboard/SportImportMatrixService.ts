import "server-only"

import type { AdminSportDataReliabilityRow } from "@/lib/admin-dashboard/AdminProviderHealthService"

export type SportImportDataType =
  | "teams"
  | "players"
  | "schedules"
  | "liveScores"
  | "standings"
  | "injuries"
  | "news"
  | "playerStats"
  | "projectionsRankings"
  | "odds"

export type SportImportStatus =
  | "active_importer"
  | "partial_importer"
  | "cached_only"
  | "provider_available_no_importer"
  | "not_tracked_yet"

export type SportImportMatrixCell = {
  label: string
  status: SportImportStatus
  count: number | null
  lastSyncedAt: string | null
  providers: string[]
  storage: string
  note: string
  stale: boolean
}

export type SportImportMatrixRow = {
  id: string
  sport: string
  label: string
  cells: Record<SportImportDataType, SportImportMatrixCell>
}

export type DashboardAiToolStatus = "active" | "preview" | "missing_data" | "coming_soon"

export type DashboardAiToolAvailability = {
  id: string
  label: string
  status: DashboardAiToolStatus
  lastSyncedAt: string | null
  supportedSports: string[]
  requiredAccess: string
  missingData: string[]
  note: string
}

export type ChimmySportReadiness = {
  sport: string
  label: string
  hasSchedules: boolean
  hasLiveScores: boolean
  hasStandings: boolean
  hasInjuries: boolean
  hasNews: boolean
  hasPlayerStats: boolean
  hasRankings: boolean
  lastSyncedAt: string | null
  staleFlags: string[]
  missingData: string[]
}

const DATA_LABELS: Record<SportImportDataType, string> = {
  teams: "Teams",
  players: "Players",
  schedules: "Schedules",
  liveScores: "Live scores",
  standings: "Standings",
  injuries: "Injuries",
  news: "News",
  playerStats: "Player stats",
  projectionsRankings: "Projections/rankings",
  odds: "Odds",
}

const STORAGE_LABELS: Record<SportImportDataType, string> = {
  teams: "sports_teams / world_cup_teams",
  players: "sports_players / sports_player_records",
  schedules: "game_schedules / sports_games / world_cup_official_fixtures",
  liveScores: "sports_games / world_cup fixture + match cache",
  standings: "sports_data_cache / world_cup_official_group_standings",
  injuries: "sports_injuries / injury_report_records",
  news: "sports_news / player_news_records",
  playerStats: "player_game_log_cache / player_season_stats / team_season_stats",
  projectionsRankings: "sports_player_records projections/rankings fields",
  odds: "Not persisted as a user-facing source of truth",
}

function latestIso(values: Array<string | null | undefined>): string | null {
  let latest = 0
  for (const value of values) {
    if (!value) continue
    const stamp = new Date(value).getTime()
    if (Number.isFinite(stamp) && stamp > latest) latest = stamp
  }
  return latest > 0 ? new Date(latest).toISOString() : null
}

function isOlderThan(value: string | null, hours: number): boolean {
  if (!value) return false
  const stamp = new Date(value).getTime()
  return !Number.isFinite(stamp) || Date.now() - stamp > hours * 60 * 60 * 1000
}

function hasCount(value: number | null): boolean {
  return typeof value === "number" && value > 0
}

function providersAvailable(row: AdminSportDataReliabilityRow): boolean {
  return row.configuredProviders.length > 0
}

function countFor(row: AdminSportDataReliabilityRow, key: SportImportDataType): number | null {
  if (key === "odds") return null
  // ⚠ Was hard-coded null, so no sport — NFL included — could ever read Ready here.
  if (key === "projectionsRankings") return row.counts.projections ?? null
  return row.counts[key]
}

function lastSyncFor(row: AdminSportDataReliabilityRow, key: SportImportDataType): string | null {
  if (key === "schedules") return latestIso([row.lastSyncAtByType.schedules, row.lastSyncAtByType.fixtures])
  if (key === "liveScores") return latestIso([row.lastSyncAtByType.games, row.lastSyncAtByType.fixtures])
  // Its own writers' timestamp — it used to borrow the players sync, which says nothing about projections.
  if (key === "projectionsRankings") return row.lastSyncAtByType.projections ?? null
  if (key === "odds") return null
  return row.lastSyncAtByType[key] ?? null
}

function knownImporter(row: AdminSportDataReliabilityRow, key: SportImportDataType): boolean {
  if (row.id === "world-cup") {
    return ["teams", "schedules", "liveScores", "standings", "injuries"].includes(key)
  }
  return ["teams", "players", "schedules", "liveScores", "standings", "injuries", "news", "playerStats", "projectionsRankings"].includes(key)
}

function buildNote(row: AdminSportDataReliabilityRow, key: SportImportDataType, status: SportImportStatus): string {
  if (status === "active_importer") return "Stored rows exist and a sync timestamp is available."
  if (status === "cached_only") return "Stored rows exist, but no importer sync state is visible for this data type."
  if (status === "partial_importer") return "A provider/import path exists, but no stored rows are currently available."
  if (status === "provider_available_no_importer") {
    if (key === "odds") return "Provider support may exist, but odds are not a user-facing cached data source for AI answers."
    return "Provider is configured, but this admin matrix cannot confirm a durable importer/table yet."
  }
  if (row.missingProviders.length > 0) return `Missing provider env: ${row.missingProviders.join(", ")}.`
  return "Not tracked yet."
}

function buildCell(row: AdminSportDataReliabilityRow, key: SportImportDataType): SportImportMatrixCell {
  const count = countFor(row, key)
  const lastSyncedAt = lastSyncFor(row, key)
  const hasRows = hasCount(count)
  const providerReady = providersAvailable(row)
  const importerKnown = knownImporter(row, key)
  let status: SportImportStatus

  if (hasRows && lastSyncedAt) status = "active_importer"
  else if (hasRows) status = "cached_only"
  else if (importerKnown && providerReady) status = "partial_importer"
  else if (providerReady && key !== "odds") status = "provider_available_no_importer"
  else if (providerReady && key === "odds") status = "provider_available_no_importer"
  else status = "not_tracked_yet"

  const staleHours = key === "liveScores" ? 1 : key === "news" || key === "injuries" ? 24 : 72
  return {
    label: DATA_LABELS[key],
    status,
    count,
    lastSyncedAt,
    providers: row.configuredProviders,
    storage: STORAGE_LABELS[key],
    note: buildNote(row, key, status),
    stale: isOlderThan(lastSyncedAt, staleHours),
  }
}

export function getSportImportMatrix(rows: AdminSportDataReliabilityRow[]): SportImportMatrixRow[] {
  return rows.map((row) => ({
    id: row.id,
    sport: row.sport,
    label: row.label,
    cells: {
      teams: buildCell(row, "teams"),
      players: buildCell(row, "players"),
      schedules: buildCell(row, "schedules"),
      liveScores: buildCell(row, "liveScores"),
      standings: buildCell(row, "standings"),
      injuries: buildCell(row, "injuries"),
      news: buildCell(row, "news"),
      playerStats: buildCell(row, "playerStats"),
      projectionsRankings: buildCell(row, "projectionsRankings"),
      odds: buildCell(row, "odds"),
    },
  }))
}

function cellReady(cell: SportImportMatrixCell): boolean {
  return cell.status === "active_importer" || cell.status === "cached_only"
}

function cellPartial(cell: SportImportMatrixCell): boolean {
  return cellReady(cell) || cell.status === "partial_importer"
}

function latestFromRows(rows: SportImportMatrixRow[], keys: SportImportDataType[]): string | null {
  return latestIso(rows.flatMap((row) => keys.map((key) => row.cells[key].lastSyncedAt)))
}

function sportsWhere(
  rows: SportImportMatrixRow[],
  predicate: (row: SportImportMatrixRow) => boolean
): string[] {
  return rows.filter(predicate).map((row) => row.label)
}

function toolStatus(activeSports: string[], partialSports: string[]): DashboardAiToolStatus {
  if (activeSports.length > 0) return "active"
  if (partialSports.length > 0) return "preview"
  return "missing_data"
}

function missingForAll(rows: SportImportMatrixRow[], keys: SportImportDataType[]): string[] {
  const missing = new Set<string>()
  for (const key of keys) {
    if (!rows.some((row) => cellReady(row.cells[key]))) missing.add(DATA_LABELS[key])
  }
  return Array.from(missing)
}

export function getDashboardAiToolAvailability(rows: AdminSportDataReliabilityRow[]): DashboardAiToolAvailability[] {
  const matrix = getSportImportMatrix(rows)
  const worldCup = matrix.find((row) => row.id === "world-cup")

  const startSitActive = sportsWhere(matrix, (row) =>
    cellReady(row.cells.players) && cellReady(row.cells.schedules) && (cellReady(row.cells.playerStats) || cellReady(row.cells.projectionsRankings))
  )
  const startSitPartial = sportsWhere(matrix, (row) =>
    cellPartial(row.cells.players) && (cellPartial(row.cells.schedules) || cellPartial(row.cells.injuries))
  )
  const tradeActive = sportsWhere(matrix, (row) =>
    cellReady(row.cells.players) && (cellReady(row.cells.playerStats) || cellReady(row.cells.projectionsRankings) || cellReady(row.cells.news))
  )
  const tradePartial = sportsWhere(matrix, (row) => cellPartial(row.cells.players))
  const waiverActive = sportsWhere(matrix, (row) => cellReady(row.cells.players) && (cellReady(row.cells.news) || cellReady(row.cells.injuries)))
  const waiverPartial = sportsWhere(matrix, (row) => cellPartial(row.cells.players))
  const injuryActive = sportsWhere(matrix, (row) => cellReady(row.cells.injuries) && (cellReady(row.cells.players) || row.id === "world-cup"))
  const injuryPartial = sportsWhere(matrix, (row) => cellPartial(row.cells.injuries))
  const powerActive = sportsWhere(matrix, (row) => cellReady(row.cells.standings) || cellReady(row.cells.playerStats))
  const powerPartial = sportsWhere(matrix, (row) => cellPartial(row.cells.standings) || cellPartial(row.cells.playerStats))
  const matchupActive = sportsWhere(matrix, (row) =>
    (cellReady(row.cells.schedules) || cellReady(row.cells.liveScores)) && (cellReady(row.cells.standings) || cellReady(row.cells.news))
  )
  const matchupPartial = sportsWhere(matrix, (row) => cellPartial(row.cells.schedules) || cellPartial(row.cells.liveScores))
  const worldCupActive = worldCup && cellReady(worldCup.cells.teams) && cellReady(worldCup.cells.schedules) && cellReady(worldCup.cells.standings)
    ? [worldCup.label]
    : []
  const worldCupPartial = worldCup && (cellPartial(worldCup.cells.teams) || cellPartial(worldCup.cells.schedules))
    ? [worldCup.label]
    : []

  return [
    {
      id: "startSit",
      label: "Start/Sit",
      status: toolStatus(startSitActive, startSitPartial),
      lastSyncedAt: latestFromRows(matrix, ["players", "schedules", "playerStats", "projectionsRankings"]),
      supportedSports: startSitActive.length ? startSitActive : startSitPartial,
      requiredAccess: "AF Pro or tokens for AI; free deterministic context remains available when present.",
      missingData: missingForAll(matrix, ["players", "schedules", "playerStats"]),
      note: "Needs cached rosters/player rows plus schedule and stats/projection context for confident advice.",
    },
    {
      id: "trade",
      label: "Trade Value",
      status: toolStatus(tradeActive, tradePartial),
      lastSyncedAt: latestFromRows(matrix, ["players", "playerStats", "news", "projectionsRankings"]),
      supportedSports: tradeActive.length ? tradeActive : tradePartial,
      requiredAccess: "AF Pro or tokens.",
      missingData: missingForAll(matrix, ["players", "playerStats", "news"]),
      note: "Can preview with cached player rows; stronger trade analysis requires stats, rankings, or news.",
    },
    {
      id: "waiver",
      label: "Waiver Wire",
      status: toolStatus(waiverActive, waiverPartial),
      lastSyncedAt: latestFromRows(matrix, ["players", "news", "injuries"]),
      supportedSports: waiverActive.length ? waiverActive : waiverPartial,
      requiredAccess: "AF Pro or tokens.",
      missingData: missingForAll(matrix, ["players", "news", "injuries"]),
      note: "Best when cached players, injury signals, and recent news are present.",
    },
    {
      id: "injury",
      label: "Injury Impact",
      status: toolStatus(injuryActive, injuryPartial),
      lastSyncedAt: latestFromRows(matrix, ["injuries", "players"]),
      supportedSports: injuryActive.length ? injuryActive : injuryPartial,
      requiredAccess: "AF Pro or tokens for deeper AI impact.",
      missingData: missingForAll(matrix, ["injuries"]),
      note: "Uses cached injury reports only; no provider calls occur from the user tool.",
    },
    {
      id: "power",
      label: "Power Rankings",
      status: toolStatus(powerActive, powerPartial),
      lastSyncedAt: latestFromRows(matrix, ["standings", "playerStats"]),
      supportedSports: powerActive.length ? powerActive : powerPartial,
      requiredAccess: "AF Pro or tokens for AI writeup.",
      missingData: missingForAll(matrix, ["standings", "playerStats"]),
      note: "Needs standings or stat rows to avoid fabricated rankings.",
    },
    {
      id: "matchupPrep",
      label: "Matchup Prep",
      status: toolStatus(matchupActive, matchupPartial),
      lastSyncedAt: latestFromRows(matrix, ["schedules", "liveScores", "standings", "news"]),
      supportedSports: matchupActive.length ? matchupActive : matchupPartial,
      requiredAccess: "AF Pro or tokens.",
      missingData: missingForAll(matrix, ["schedules", "liveScores"]),
      note: "Needs schedules/live scores and preferably standings or news.",
    },
    {
      id: "worldCupAnalysis",
      label: "World Cup Analysis",
      status: toolStatus(worldCupActive, worldCupPartial),
      lastSyncedAt: worldCup ? latestFromRows([worldCup], ["teams", "schedules", "standings", "injuries"]) : null,
      supportedSports: worldCupActive.length ? worldCupActive : worldCupPartial,
      requiredAccess: "AF Pro or tokens for premium AI; basic schedules/scores are free.",
      missingData: worldCup
        ? (["teams", "schedules", "standings"] as SportImportDataType[])
            .filter((key) => !cellReady(worldCup.cells[key]))
            .map((key) => DATA_LABELS[key])
        : ["World Cup cache"],
      note: "World Cup AI is grounded in dedicated Neon cache tables.",
    },
    {
      id: "commissionerReport",
      label: "Commissioner Report",
      status: toolStatus(worldCupActive, worldCupPartial),
      lastSyncedAt: worldCup ? latestFromRows([worldCup], ["schedules", "standings", "injuries"]) : null,
      supportedSports: worldCupActive.length ? worldCupActive : worldCupPartial,
      requiredAccess: "AF Commissioner plus AF Pro/tokens where AI is used.",
      missingData: worldCup ? (cellPartial(worldCup.cells.schedules) ? [] : ["World Cup schedules"]) : ["World Cup cache"],
      note: "Requires pool context at runtime; this matrix verifies only sports-data readiness.",
    },
  ]
}

export function getChimmySportReadiness(rows: AdminSportDataReliabilityRow[]): ChimmySportReadiness[] {
  return getSportImportMatrix(rows).map((row) => {
    const hasSchedules = cellReady(row.cells.schedules)
    const hasLiveScores = cellReady(row.cells.liveScores)
    const hasStandings = cellReady(row.cells.standings)
    const hasInjuries = cellReady(row.cells.injuries)
    const hasNews = cellReady(row.cells.news)
    const hasPlayerStats = cellReady(row.cells.playerStats)
    const hasRankings = cellReady(row.cells.projectionsRankings)
    const missingData = [
      !hasSchedules ? "schedules" : null,
      !hasLiveScores ? "live scores" : null,
      !hasStandings ? "standings" : null,
      !hasInjuries ? "injuries" : null,
      !hasNews ? "news" : null,
      !hasPlayerStats ? "player stats" : null,
      !hasRankings ? "rankings/projections" : null,
    ].filter((item): item is string => Boolean(item))
    return {
      sport: row.sport,
      label: row.label,
      hasSchedules,
      hasLiveScores,
      hasStandings,
      hasInjuries,
      hasNews,
      hasPlayerStats,
      hasRankings,
      lastSyncedAt: latestFromRows([row], ["schedules", "liveScores", "standings", "injuries", "news", "playerStats", "projectionsRankings"]),
      staleFlags: Object.values(row.cells)
        .filter((cell) => cell.stale)
        .map((cell) => `${cell.label} stale`),
      missingData,
    }
  })
}
