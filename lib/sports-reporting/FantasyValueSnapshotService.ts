import "server-only"

import { prisma } from "@/lib/prisma"

export type FantasyValueSnapshot = {
  sport: string
  playerId: string | null
  playerName: string
  position: string | null
  team: string | null
  leagueFormat: string
  scoringFormat: string
  shortTermValue: number | null
  longTermValue: number | null
  riskScore: number | null
  injuryRisk: "low" | "medium" | "high" | "unknown"
  roleConfidence: number | null
  dataFreshness: {
    latestAt: string | null
    stale: boolean
    staleDomains: string[]
  }
  sourcesUsed: string[]
  missingData: string[]
  confidence: number
}

export type FantasyValueSnapshotInput = {
  sport: string
  playerId?: string | null
  playerName: string
  position?: string | null
  team?: string | null
  leagueFormat?: string | null
  scoringFormat?: string | null
  adp?: number | null
  dynastyValue?: number | null
  injuryStatus?: string | null
  injuryNotes?: string | null
  projections?: unknown
  stats?: unknown
  seasonStats?: {
    fantasyPoints?: number | null
    fantasyPointsPerGame?: number | null
    gamesPlayed?: number | null
    fetchedAt?: Date | string | null
    source?: string | null
  } | null
  news?: Array<{ title?: string | null; publishedAt?: Date | string | null; source?: string | null }>
  lastUpdated?: Date | string | null
  source?: string | null
}

export type FantasyValueSnapshotRequest = {
  sport: string
  playerId?: string | null
  playerName?: string | null
  leagueFormat?: string | null
  scoringFormat?: string | null
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeSport(value: string): string {
  return value.trim().toUpperCase()
}

function normalizeLeagueFormat(value: string | null | undefined): string {
  const normalized = String(value ?? "redraft").trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (normalized.includes("dynasty")) return "dynasty"
  if (normalized.includes("keeper")) return "keeper"
  if (normalized.includes("best")) return "best_ball"
  if (normalized.includes("rookie")) return "rookie"
  return normalized || "redraft"
}

function normalizeScoring(value: string | null | undefined): string {
  return String(value ?? "ppr").trim().toLowerCase() || "ppr"
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function latestIso(values: Array<Date | string | null | undefined>): string | null {
  let latest = 0
  for (const value of values) {
    const date = toDate(value)
    if (date && date.getTime() > latest) latest = date.getTime()
  }
  return latest > 0 ? new Date(latest).toISOString() : null
}

function isOlderThan(value: string | null, hours: number): boolean {
  if (!value) return false
  const stamp = new Date(value).getTime()
  return !Number.isFinite(stamp) || Date.now() - stamp > hours * 60 * 60 * 1000
}

function objectValue(source: unknown, keys: string[]): number | null {
  if (!source || typeof source !== "object") return null
  const record = source as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function riskFromInjury(status: string | null): {
  injuryRisk: FantasyValueSnapshot["injuryRisk"]
  riskScore: number | null
} {
  const s = String(status ?? "").toLowerCase()
  if (!s) return { injuryRisk: "unknown", riskScore: null }
  if (/\b(out|ir|injured reserve|doubtful|suspended)\b/.test(s)) return { injuryRisk: "high", riskScore: 85 }
  if (/\b(questionable|limited|day-to-day|gtd|game time)\b/.test(s)) return { injuryRisk: "medium", riskScore: 55 }
  if (/\b(probable|healthy|active|available)\b/.test(s)) return { injuryRisk: "low", riskScore: 15 }
  return { injuryRisk: "medium", riskScore: 45 }
}

function shortTermFromInput(input: FantasyValueSnapshotInput): number | null {
  const projected =
    objectValue(input.projections, [
      "fantasyPoints",
      "projectedFantasyPoints",
      "points",
      "projection",
      "projected_points",
      "fpts",
      "fp",
    ]) ?? null
  const projectedPerGame =
    objectValue(input.projections, ["fantasyPointsPerGame", "fppg", "projectedFppg", "projected_fppg"]) ?? null
  const statPerGame =
    input.seasonStats?.fantasyPointsPerGame ??
    objectValue(input.stats, ["fantasyPointsPerGame", "fppg", "fantasy_points_per_game"]) ??
    null
  const statTotal =
    input.seasonStats?.fantasyPoints ??
    objectValue(input.stats, ["fantasyPoints", "fantasy_points", "points", "fpts"]) ??
    null
  const games =
    input.seasonStats?.gamesPlayed ??
    objectValue(input.stats, ["gamesPlayed", "games", "gp"]) ??
    null

  if (projectedPerGame != null) return clampScore(projectedPerGame * 7)
  if (projected != null) return clampScore(projected / 3)
  if (statPerGame != null) return clampScore(statPerGame * 7)
  if (statTotal != null && games && games > 0) return clampScore((statTotal / games) * 7)
  if (input.adp != null && Number.isFinite(input.adp)) return clampScore(100 - Math.min(Math.max(input.adp, 1), 300) / 3)
  return null
}

function longTermFromInput(input: FantasyValueSnapshotInput, shortTermValue: number | null): number | null {
  if (input.dynastyValue != null && Number.isFinite(input.dynastyValue)) return clampScore(input.dynastyValue)
  const age = objectValue(input.stats, ["age"])
  if (shortTermValue != null && age != null) {
    if (age <= 24) return clampScore(shortTermValue + 8)
    if (age >= 31) return clampScore(shortTermValue - 10)
    return shortTermValue
  }
  return shortTermValue
}

function freshness(input: FantasyValueSnapshotInput) {
  const latestAt = latestIso([
    input.lastUpdated,
    input.seasonStats?.fetchedAt,
    ...(input.news ?? []).map((item) => item.publishedAt),
  ])
  const staleDomains = [
    isOlderThan(latestIso([input.lastUpdated]), 72) ? "player value" : null,
    isOlderThan(latestIso([input.seasonStats?.fetchedAt]), 72) ? "stats" : null,
    isOlderThan(latestIso((input.news ?? []).map((item) => item.publishedAt)), 48) ? "news" : null,
  ].filter((item): item is string => Boolean(item))
  return { latestAt, stale: staleDomains.length > 0, staleDomains }
}

export function buildFantasyValueSnapshot(input: FantasyValueSnapshotInput): FantasyValueSnapshot {
  const leagueFormat = normalizeLeagueFormat(input.leagueFormat)
  const scoringFormat = normalizeScoring(input.scoringFormat)
  const missingData: string[] = []
  const sourcesUsed = new Set<string>()
  if (input.source) sourcesUsed.add(input.source)
  if (input.seasonStats?.source) sourcesUsed.add(input.seasonStats.source)
  for (const news of input.news ?? []) {
    if (news.source) sourcesUsed.add(news.source)
  }

  const shortTermValue = shortTermFromInput(input)
  const longTermValue = longTermFromInput(input, shortTermValue)
  const injury = riskFromInjury(input.injuryStatus ?? input.injuryNotes ?? null)
  const valueFreshness = freshness(input)

  if (!clean(input.playerId)) missingData.push("provider player id")
  if (!clean(input.team)) missingData.push("team")
  if (!clean(input.position)) missingData.push("position")
  if (shortTermValue == null) missingData.push("short-term projection/stat value")
  if (longTermValue == null) missingData.push("long-term/dynasty value")
  if (injury.injuryRisk === "unknown") missingData.push("injury status")
  if ((input.news ?? []).length === 0) missingData.push("recent news")

  const roleSignals = [clean(input.team), clean(input.position), shortTermValue != null, input.seasonStats != null]
    .filter(Boolean)
    .length
  const roleConfidence = roleSignals === 0 ? null : clampScore((roleSignals / 4) * 100)
  const confidenceSignals = [
    clean(input.playerId),
    clean(input.team),
    clean(input.position),
    shortTermValue != null,
    longTermValue != null,
    injury.injuryRisk !== "unknown",
    (input.news ?? []).length > 0,
    !valueFreshness.stale,
  ].filter(Boolean).length
  const confidence = Math.round((confidenceSignals / 8) * 100) / 100

  return {
    sport: normalizeSport(input.sport),
    playerId: clean(input.playerId ?? null),
    playerName: clean(input.playerName) ?? "Unknown player",
    position: clean(input.position ?? null),
    team: clean(input.team ?? null),
    leagueFormat,
    scoringFormat,
    shortTermValue,
    longTermValue,
    riskScore: injury.riskScore,
    injuryRisk: injury.injuryRisk,
    roleConfidence,
    dataFreshness: valueFreshness,
    sourcesUsed: Array.from(sourcesUsed),
    missingData: Array.from(new Set(missingData)),
    confidence,
  }
}

type FindFirstDelegate = {
  findFirst: (args?: Record<string, unknown>) => Promise<Record<string, unknown> | null>
}

function delegate<T>(name: string): T | null {
  return ((prisma as unknown as Record<string, unknown>)[name] as T | undefined) ?? null
}

async function safeFindFirst(modelName: string, args?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const model = delegate<FindFirstDelegate>(modelName)
  if (!model?.findFirst) return null
  try {
    return await model.findFirst(args)
  } catch {
    return null
  }
}

function rowString(row: Record<string, unknown> | null, key: string): string | null {
  return clean(row?.[key])
}

function rowNumber(row: Record<string, unknown> | null, key: string): number | null {
  const value = row?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function rowDate(row: Record<string, unknown> | null, key: string): Date | string | null {
  const value = row?.[key]
  return value instanceof Date || typeof value === "string" ? value : null
}

export async function getFantasyValueSnapshot(
  request: FantasyValueSnapshotRequest
): Promise<FantasyValueSnapshot> {
  const sport = normalizeSport(request.sport)
  const playerName = clean(request.playerName ?? null)
  const playerId = clean(request.playerId ?? null)
  const identityWhere = playerId
    ? { sport, OR: [{ sleeperId: playerId }, { fantasyCalcId: playerId }, { rollingInsightsId: playerId }, { apiSportsId: playerId }, { espnId: playerId }, { clearSportsId: playerId }] }
    : playerName
      ? { sport, normalizedName: playerName.toLowerCase().replace(/[^a-z0-9]+/g, "") }
      : { sport, id: "__missing__" }

  const [record, player, identity] = await Promise.all([
    safeFindFirst("sportsPlayerRecord", {
      where: playerId
        ? { sport, id: playerId }
        : { sport, name: { equals: playerName ?? "", mode: "insensitive" } },
      orderBy: { lastUpdated: "desc" },
    }),
    safeFindFirst("sportsPlayer", {
      where: playerId
        ? { sport, OR: [{ id: playerId }, { externalId: playerId }, { sleeperId: playerId }] }
        : { sport, name: { equals: playerName ?? "", mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
    }),
    safeFindFirst("playerIdentityMap", { where: identityWhere, orderBy: { updatedAt: "desc" } }),
  ])

  const resolvedPlayerId =
    rowString(record, "id") ??
    rowString(player, "externalId") ??
    rowString(player, "sleeperId") ??
    rowString(identity, "sleeperId") ??
    rowString(identity, "rollingInsightsId") ??
    playerId
  const resolvedName = rowString(record, "name") ?? rowString(player, "name") ?? rowString(identity, "canonicalName") ?? playerName ?? "Unknown player"
  const resolvedTeam = rowString(record, "team") ?? rowString(player, "team") ?? rowString(identity, "currentTeam")
  const resolvedPosition = rowString(record, "position") ?? rowString(player, "position") ?? rowString(identity, "position")
  const playerOrNameWhere: Array<{ playerId: string } | { playerName: { equals: string; mode: "insensitive" } }> = [
    resolvedPlayerId ? { playerId: resolvedPlayerId } : null,
    { playerName: { equals: resolvedName, mode: "insensitive" } },
  ].filter((item): item is { playerId: string } | { playerName: { equals: string; mode: "insensitive" } } => Boolean(item))

  const [seasonStats, injuryReport, sportsInjury, sportsNews, playerNews] = await Promise.all([
    safeFindFirst("playerSeasonStats", {
      where: {
        sport,
        OR: playerOrNameWhere,
      },
      orderBy: { updatedAt: "desc" },
    }),
    safeFindFirst("injuryReportRecord", {
      where: {
        sport,
        OR: playerOrNameWhere,
      },
      orderBy: { reportDate: "desc" },
    }),
    safeFindFirst("sportsInjury", {
      where: {
        sport,
        OR: playerOrNameWhere,
      },
      orderBy: { fetchedAt: "desc" },
    }),
    safeFindFirst("sportsNews", {
      where: {
        sport,
        OR: playerOrNameWhere,
      },
      orderBy: { publishedAt: "desc" },
    }),
    safeFindFirst("playerNewsRecord", {
      where: {
        sport,
        OR: playerOrNameWhere,
      },
      orderBy: { publishedAt: "desc" },
    }),
  ])

  return buildFantasyValueSnapshot({
    sport,
    playerId: resolvedPlayerId,
    playerName: resolvedName,
    position: resolvedPosition,
    team: resolvedTeam,
    leagueFormat: request.leagueFormat,
    scoringFormat: request.scoringFormat,
    adp: rowNumber(record, "adp"),
    dynastyValue: rowNumber(record, "dynastyValue"),
    injuryStatus: rowString(record, "injuryStatus") ?? rowString(injuryReport, "status") ?? rowString(sportsInjury, "status"),
    injuryNotes: rowString(record, "injuryNotes") ?? rowString(injuryReport, "notes") ?? rowString(sportsInjury, "description"),
    projections: record?.projections ?? null,
    stats: record?.stats ?? seasonStats?.stats ?? null,
    seasonStats: seasonStats
      ? {
          fantasyPoints: rowNumber(seasonStats, "fantasyPoints"),
          fantasyPointsPerGame: rowNumber(seasonStats, "fantasyPointsPerGame"),
          gamesPlayed: rowNumber(seasonStats, "gamesPlayed"),
          fetchedAt: rowDate(seasonStats, "fetchedAt") ?? rowDate(seasonStats, "updatedAt"),
          source: rowString(seasonStats, "source"),
        }
      : null,
    news: [sportsNews, playerNews]
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row) => ({
        title: rowString(row, "title"),
        publishedAt: rowDate(row, "publishedAt"),
        source: rowString(row, "source") ?? rowString(row, "sourceId"),
      })),
    lastUpdated: rowDate(record, "lastUpdated") ?? rowDate(player, "updatedAt") ?? rowDate(identity, "lastSyncedAt"),
    source: rowString(record, "dataSource") ?? rowString(player, "source"),
  })
}
