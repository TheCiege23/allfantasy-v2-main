import "server-only"
import { prisma } from "@/lib/prisma"
import {
  getWorldCupLeagueId,
  fetchWorldCupTeams,
  fetchWorldCupFixtures,
} from "./apiSportsWorldCup"

export type WorldCupDiagnosticsResult = {
  apiKeyConfigured: boolean
  leagueIdConfigured: boolean
  leagueId: string
  dbConnected: boolean
  worldCupTablesAvailable: boolean
  teamCount: number
  fixtureCount: number
  openBracketCount: number
  liveBracketCount: number
  finalBracketCount: number
  participantCount: number
  lastSuccessfulSync: string | null
  lastSyncError: string | null
  apiFetchSample: "ok" | "skipped" | "error"
  apiFetchError: string | null
  canNormalizeStatus: boolean
  canIdentifyWinner: boolean
  errors: string[]
}

/**
 * Run a full World Cup health/diagnostics check.
 * Never exposes API keys or DB credentials in the returned object.
 */
export async function runWorldCupDiagnostics(): Promise<WorldCupDiagnosticsResult> {
  const errors: string[] = []
  const result: WorldCupDiagnosticsResult = {
    apiKeyConfigured: false,
    leagueIdConfigured: false,
    leagueId: "",
    dbConnected: false,
    worldCupTablesAvailable: false,
    teamCount: 0,
    fixtureCount: 0,
    openBracketCount: 0,
    liveBracketCount: 0,
    finalBracketCount: 0,
    participantCount: 0,
    lastSuccessfulSync: null,
    lastSyncError: null,
    apiFetchSample: "skipped",
    apiFetchError: null,
    canNormalizeStatus: false,
    canIdentifyWinner: false,
    errors,
  }

  // Check API key (without revealing it)
  const apiKey =
    process.env.API_FOOTBALL_KEY ||
    process.env.APISPORTS_FOOTBALL_KEY ||
    process.env.API_SPORTS_KEY ||
    process.env.RAPIDAPI_KEY
  result.apiKeyConfigured = Boolean(apiKey && apiKey.length > 8)

  const leagueId = getWorldCupLeagueId()
  result.leagueId = leagueId
  result.leagueIdConfigured = Boolean(leagueId)

  // DB connectivity
  try {
    const db = prisma as any
    await db.$queryRaw`SELECT 1`
    result.dbConnected = true
  } catch (err) {
    errors.push("DB connection failed: " + sanitizeError(err))
  }

  // World Cup table availability + counts
  if (result.dbConnected) {
    try {
      const db = prisma as any
      const [teams, open, live, final, participants, logs] = await Promise.all([
        db.worldCupTeam.count().catch(() => -1),
        db.worldCupBracketChallenge.count({ where: { status: "open" } }).catch(() => -1),
        db.worldCupBracketChallenge.count({ where: { status: "live" } }).catch(() => -1),
        db.worldCupBracketChallenge.count({ where: { status: "final" } }).catch(() => -1),
        db.worldCupBracketParticipant.count().catch(() => -1),
        db.worldCupSyncLog
          .findMany({
            orderBy: { createdAt: "desc" },
            take: 1,
          })
          .catch(() => [] as any[]),
      ])

      result.worldCupTablesAvailable = teams !== -1
      result.teamCount = teams >= 0 ? teams : 0
      result.openBracketCount = open >= 0 ? open : 0
      result.liveBracketCount = live >= 0 ? live : 0
      result.finalBracketCount = final >= 0 ? final : 0
      result.participantCount = participants >= 0 ? participants : 0

      const lastLog = Array.isArray(logs) ? logs[0] : null
      if (lastLog) {
        if (lastLog.status === "success" || lastLog.status === "partial") {
          result.lastSuccessfulSync = lastLog.finishedAt?.toISOString() ?? lastLog.createdAt?.toISOString() ?? null
        }
        if (lastLog.status === "error" || lastLog.errorMessage) {
          result.lastSyncError = lastLog.errorMessage ?? "unknown error"
        }
      }

      // Fixture count from matches table
      const fixtureCount = await db.worldCupBracketMatch
        .count({ where: { apiFixtureId: { not: null } } })
        .catch(() => -1)
      result.fixtureCount = fixtureCount >= 0 ? fixtureCount : 0
    } catch (err) {
      errors.push("Table query failed: " + sanitizeError(err))
    }
  }

  // Static validation checks (no API call needed)
  result.canNormalizeStatus = checkNormalizeStatus()
  result.canIdentifyWinner = checkIdentifyWinner()

  // Live API fetch sample (only if key is configured)
  if (result.apiKeyConfigured) {
    try {
      const teams = await fetchWorldCupTeams(2026)
      result.apiFetchSample = teams.length >= 0 ? "ok" : "error"
    } catch (err) {
      result.apiFetchSample = "error"
      result.apiFetchError = sanitizeError(err)
    }
  }

  return result
}

function checkNormalizeStatus(): boolean {
  try {
    const { normalizeWorldCupStatus } = require("./apiSportsWorldCup")
    return (
      normalizeWorldCupStatus("FT") === "final" &&
      normalizeWorldCupStatus("1H") === "live" &&
      normalizeWorldCupStatus("HT") === "halftime"
    )
  } catch {
    return false
  }
}

function checkIdentifyWinner(): boolean {
  try {
    const { normalizeWorldCupFixture } = require("./apiSportsWorldCup")
    const mockFixture = {
      fixture: { id: 1, date: null, status: { short: "PEN", long: "Penalties" } },
      league: { id: 1, season: 2026, round: "Final" },
      teams: {
        home: { id: 1, name: "Brazil", logo: null, winner: null },
        away: { id: 2, name: "France", logo: null, winner: null },
      },
      goals: { home: 1, away: 1 },
      score: { fulltime: { home: 1, away: 1 }, penalty: { home: 5, away: 4 } },
    }
    const n = normalizeWorldCupFixture(mockFixture)
    return n.winnerApiTeamId === 1 && n.winnerName === "Brazil"
  } catch {
    return false
  }
}

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg
    .replace(/[A-Za-z0-9+/]{32,}={0,2}/g, "[REDACTED]")
    .replace(/(?:key|secret|token|password|DATABASE_URL|postgresql:\/\/)[^\s&]*/gi, "[REDACTED]")
    .slice(0, 200)
}
