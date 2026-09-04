import "server-only"

import { recordProviderSync } from "@/lib/provider-sync-logger"
import { rateLimitManager } from "@/lib/workers/rate-limit-manager"
import { runInjuryImporter } from "@/lib/workers/injury-importer"
import { runNewsImporter } from "@/lib/workers/news-importer"
import { runScheduleImporter } from "@/lib/workers/schedule-importer"
import { runSportsDataImporter } from "@/lib/workers/sports-data-importer"
import { getSportsIdentityHealthSnapshot } from "@/lib/sports-reporting/SportsIdentityHealthService"
import { importPlayerGameLogs } from "@/lib/sports-reporting/PlayerGameLogImportService"

export type AdminSportsSyncType =
  | "schedules"
  | "injuries"
  | "news"
  | "players"
  | "player_game_logs"
  | "player_stats"
  | "rankings"
  | "projections"
  | "identity_health"
  | "image_audit"
  | "fantasy_value_snapshots"
  | "all"

export type AdminSportsSyncResult = {
  ok: boolean
  type: AdminSportsSyncType
  sports: string[]
  season: number | null
  dryRun: boolean
  startedAt: string
  finishedAt: string
  durationMs: number
  jobs: Array<{
    type: string
    imported: number
    sports: string[]
    warning?: string | null
  }>
  blockedByBudget: string[]
  warnings: string[]
}

const KNOWN_PROVIDER_GUARDS = ["api_sports", "api_football", "rolling_insights", "clearsports", "espn", "cfbd", "sleeper"]

function normalizeSyncType(raw: string | null | undefined): AdminSportsSyncType {
  const value = String(raw ?? "all").trim().toLowerCase()
  if (value === "schedule") return "schedules"
  if (value === "injury") return "injuries"
  if (value === "player_stats" || value === "stats") return "player_stats"
  if (value === "player_game_logs" || value === "game_logs" || value === "gamelogs") return "player_game_logs"
  if (value === "identity" || value === "identity_health") return "identity_health"
  if (value === "image" || value === "images" || value === "image_audit") return "image_audit"
  if (value === "fantasy_value" || value === "fantasy_value_snapshots") return "fantasy_value_snapshots"
  if (["schedules", "injuries", "news", "players", "player_game_logs", "rankings", "projections", "all"].includes(value)) {
    return value as AdminSportsSyncType
  }
  return "all"
}

function normalizeSports(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : []
  return values
    .map((sport) => String(sport).trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 12)
}

async function guardBudgets(endpoint: string): Promise<string[]> {
  const checks = await Promise.all(
    KNOWN_PROVIDER_GUARDS.map(async (provider) => ({
      provider,
      ok: await rateLimitManager.canCall(provider, endpoint),
    }))
  )
  return checks.filter((row) => !row.ok).map((row) => row.provider)
}

async function recordJobSync(input: {
  entityType: string
  sports: string[]
  imported: number
  error?: string | null
}) {
  await recordProviderSync(
    {
      provider: "api_chain",
      entityType: input.entityType,
      sport: input.sports.length === 1 ? input.sports[0] : "MULTI",
      key: input.sports.join(",") || "all",
    },
    {
      recordsImported: input.imported,
      error: input.error ?? null,
    }
  )
}

export async function runAdminSportsSync(input: {
  type?: string | null
  sports?: unknown
  season?: number | null
  leagueId?: string | null
  seasonId?: string | null
  playerIds?: string[] | null
  weeks?: Array<number | string> | number | string | null
  limit?: number | null
  dryRun?: boolean
}): Promise<AdminSportsSyncResult> {
  const type = normalizeSyncType(input.type)
  const sports = normalizeSports(input.sports)
  const season = input.season ?? null
  const dryRun = input.dryRun === true
  const started = Date.now()
  const endpoint = `admin:sports-sync:${type}`
  const blockedByBudget = await guardBudgets(endpoint)
  const jobs: AdminSportsSyncResult["jobs"] = []
  const warnings: string[] = []

  if (blockedByBudget.length > 0) {
    warnings.push(`Some provider budgets are exhausted and provider clients must skip them: ${blockedByBudget.join(", ")}`)
  }

  if (dryRun) {
    const planned = type === "all"
      ? ["schedules", "injuries", "news", "players", "identity_health", "image_audit", "fantasy_value_snapshots"]
      : [type]
    const finishedAt = new Date().toISOString()
    return {
      ok: true,
      type,
      sports,
      season,
      dryRun,
      startedAt: new Date(started).toISOString(),
      finishedAt,
      durationMs: Date.now() - started,
      jobs: planned.map((job) => ({
        type: job,
        imported: 0,
        sports,
        warning: "Dry run only. No provider calls or DB writes were made.",
      })),
      blockedByBudget,
      warnings,
    }
  }

  const shouldRun = (job: AdminSportsSyncType) => type === "all" || type === job

  if (shouldRun("schedules")) {
    const result = await runScheduleImporter({ sports, season: season ?? undefined })
    jobs.push({ type: "schedules", imported: result.imported, sports: result.sports })
    await recordJobSync({ entityType: "schedules", sports: result.sports, imported: result.imported })
  }

  if (shouldRun("injuries")) {
    const result = await runInjuryImporter({ sports })
    jobs.push({ type: "injuries", imported: result.imported, sports: result.sports })
    await recordJobSync({ entityType: "injuries", sports: result.sports, imported: result.imported })
  }

  if (shouldRun("news")) {
    const result = await runNewsImporter({ sports })
    jobs.push({ type: "news", imported: result.imported, sports: result.sports })
    await recordJobSync({ entityType: "news", sports: result.sports, imported: result.imported })
  }

  if (shouldRun("players") || shouldRun("player_stats") || shouldRun("rankings") || shouldRun("projections")) {
    const result = await runSportsDataImporter({ sports })
    const jobType = type === "all" ? "players" : type
    const warning =
      jobType === "player_stats" || jobType === "rankings" || jobType === "projections"
        ? "Generic sports-data importer enriches player rows with available stats/projection/ranking context; no separate importer table is created."
        : null
    jobs.push({ type: jobType, imported: result.imported, sports: result.sports, warning })
    if (warning) warnings.push(warning)
    await recordJobSync({ entityType: jobType, sports: result.sports, imported: result.imported })
  }

  if (type === "player_game_logs") {
    const targetSports = sports.length ? sports : ["NFL"]
    let imported = 0
    const jobWarnings: string[] = []
    for (const sport of targetSports) {
      const result = await importPlayerGameLogs({
        sport,
        season: season ?? undefined,
        leagueId: input.leagueId,
        seasonId: input.seasonId,
        playerIds: input.playerIds ?? undefined,
        weeks: input.weeks ?? undefined,
        limit: input.limit,
        dryRun,
        trigger: "admin_sports_sync",
      })
      imported += result.importedCount + result.updatedCount
      jobWarnings.push(...result.warnings, ...result.providerErrors)
    }
    const warning = jobWarnings.length
      ? jobWarnings.slice(0, 3).join(" ")
      : "Player game logs imported into PlayerGameLogCache; PlayerWeeklyScore sync remains cache-only."
    jobs.push({ type: "player_game_logs", imported, sports: targetSports, warning })
    if (warning) warnings.push(warning)
    await recordJobSync({ entityType: "player_game_logs", sports: targetSports, imported })
  }

  if (shouldRun("identity_health")) {
    const snapshot = await getSportsIdentityHealthSnapshot()
    jobs.push({
      type: "identity_health",
      imported: 0,
      sports: sports.length ? sports : snapshot.rows.map((row) => row.sport),
      warning: `${snapshot.summary.identityProblems} cached identity problem(s) detected across ${snapshot.summary.sportsAudited} sport(s).`,
    })
    warnings.push("Identity health refresh is cache-only. No provider calls or DB writes were made.")
  }

  if (shouldRun("image_audit")) {
    const snapshot = await getSportsIdentityHealthSnapshot()
    jobs.push({
      type: "image_audit",
      imported: 0,
      sports: sports.length ? sports : snapshot.imageRows.map((row) => row.sport),
      warning: `${snapshot.summary.imageProblems} cached image/logo problem(s) detected. External image URLs were not probed.`,
    })
    warnings.push("Image audit checks URL metadata only. It does not fetch thousands of remote images.")
  }

  if (shouldRun("fantasy_value_snapshots")) {
    jobs.push({
      type: "fantasy_value_snapshots",
      imported: 0,
      sports,
      warning: "FantasyValueSnapshot is generated on demand from cached player/stat/news/injury rows; no persistent snapshot table exists yet.",
    })
    warnings.push("Persistent FantasyValueSnapshot refresh is not tracked yet; on-demand snapshots are available for grounded tools.")
  }

  const finishedAt = new Date().toISOString()
  return {
    ok: true,
    type,
    sports,
    season,
    dryRun,
    startedAt: new Date(started).toISOString(),
    finishedAt,
    durationMs: Date.now() - started,
    jobs,
    blockedByBudget,
    warnings,
  }
}
