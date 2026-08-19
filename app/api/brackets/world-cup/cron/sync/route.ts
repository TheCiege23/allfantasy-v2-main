import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { WorldCupProviderConfigError } from "@/lib/world-cup/worldCupDataProvider"
import {
  recalculateWorldCupChallenge,
  syncWorldCupFixtures,
  syncWorldCupInjuries,
  syncWorldCupLiveScoresBatch,
  syncWorldCupProviderGroupStandings,
  syncWorldCupTeams,
} from "@/lib/world-cup"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const jobSchema = z.enum(["teams", "fixtures", "live", "standings", "injuries", "recalculate", "all"])
const booleanLike = z.preprocess((value) => {
  if (typeof value === "string") return value === "true" || value === "1"
  return value
}, z.boolean())
const bodySchema = z.object({
  job: jobSchema.optional().default("live"),
  challengeId: z.string().min(1).optional(),
  provider: z.enum(["mock", "apifootball", "sportsdata", "manual"]).optional(),
  seasonYear: z.coerce.number().int().min(2022).max(2030).optional().default(2026),
  dryRun: booleanLike.optional().default(false),
  recalculate: booleanLike.optional().default(true),
})

function cleanEnv(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function resolveProviderName(provider?: z.infer<typeof bodySchema>["provider"]) {
  return provider ?? cleanEnv(process.env.WORLD_CUP_DATA_PROVIDER) ?? "mock"
}

function hasApiFootballKey() {
  return Boolean(
    cleanEnv(process.env.API_SPORTS_KEY) ??
      cleanEnv(process.env.API_FOOTBALL_KEY) ??
      cleanEnv(process.env.APISPORTS_FOOTBALL_KEY) ??
      cleanEnv(process.env.RAPIDAPI_KEY)
  )
}

function assertWorldCupCronEnvironment(input: z.infer<typeof bodySchema>) {
  const provider = resolveProviderName(input.provider)
  if (provider === "apifootball" && !hasApiFootballKey()) {
    throw new WorldCupProviderConfigError(
      "apifootball",
      "No API key configured. Set API_SPORTS_KEY or API_FOOTBALL_KEY in your environment."
    )
  }
}

type WorldCupCronErrorKind =
  | "missing_provider_key"
  | "unsupported_provider"
  | "provider_fetch_failed"
  | "database_write_failed"
  | "sync_service_failed"

type WorldCupCronRecalculateResult =
  | { challengeId: string; ok: true; leaderboardCount: number | null }
  | { challengeId: string; ok: false; error: WorldCupCronErrorKind; message: string }

function sanitizeErrorMessage(message: string) {
  return message
    .replace(/(x-apisports-key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
}

function classifyCronError(error: unknown): {
  kind: WorldCupCronErrorKind
  message: string
  provider?: string
} {
  if (error instanceof WorldCupProviderConfigError) {
    const message = sanitizeErrorMessage(error.message)
    return {
      kind: /not configured|no api key|api key/i.test(message)
        ? "missing_provider_key"
        : "unsupported_provider",
      message,
      provider: error.provider,
    }
  }

  const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error))
  if (/api-football|apisports|sportsdata|fetch|network|response\.json|unexpected token|budget|cooldown|quota|rate limit/i.test(message)) {
    return { kind: "provider_fetch_failed", message }
  }
  if (/prisma|database|worldCup|unique constraint|foreign key|timed out|connection/i.test(message)) {
    return { kind: "database_write_failed", message }
  }
  return { kind: "sync_service_failed", message }
}

async function getCronChallengeIds(challengeId?: string) {
  if (challengeId) return [challengeId]
  const rows = await prisma.worldCupBracketChallenge.findMany({
    where: { status: { in: ["open", "locked", "live"] } },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: 25,
  })
  return rows.map((row) => row.id)
}

function isWorldCupCronAuthorized(request: NextRequest) {
  return requireCronAuth(request, "WORLD_CUP_CRON_SECRET") || requireCronAuth(request, "CRON_SECRET")
}

async function runWorldCupCronSync(input: z.infer<typeof bodySchema>) {
  const { job, challengeId, provider, seasonYear, dryRun, recalculate } = input
  assertWorldCupCronEnvironment(input)
  const challengeIds =
    job === "teams" ? (challengeId ? [challengeId] : []) : await getCronChallengeIds(challengeId)
  const result: Record<string, unknown> = { job, challengeIds, dryRun }

  if (job === "teams" || job === "all") {
    result.teams = await syncWorldCupTeams({ provider, seasonYear, dryRun })
  }

  if (job === "fixtures" || job === "all") {
    result.fixtures = []
    for (const id of challengeIds) {
      ;(result.fixtures as unknown[]).push({
        challengeId: id,
        result: await syncWorldCupFixtures({ challengeId: id, provider, seasonYear, dryRun }),
      })
    }
  }

  if (job === "live" || job === "all") {
    // Single API-Football fetch fans out to all active challenges — eliminates the N×call-per-challenge loop.
    result.live = await syncWorldCupLiveScoresBatch({ challengeIds, provider, seasonYear, dryRun, recalculate })
  }

  if (job === "standings" || job === "all") {
    result.standings = []
    for (const id of challengeIds) {
      ;(result.standings as unknown[]).push({
        challengeId: id,
        result: await syncWorldCupProviderGroupStandings({ challengeId: id, provider, seasonYear }),
      })
    }
  }

  if (job === "injuries" || job === "all") {
    result.injuries = await syncWorldCupInjuries({ provider, seasonYear, dryRun })
  }

  if (job === "recalculate" || job === "all") {
    // Process each challenge independently: one bad challenge (malformed
    // entry/pick/match relation, Prisma row issue, or edge-case data) must not
    // fail the entire scheduled cron. Per-challenge errors are captured, not thrown,
    // so the route can still return 200 with a per-challenge breakdown.
    const recalculated: WorldCupCronRecalculateResult[] = []
    let succeeded = 0
    let failed = 0
    for (const id of challengeIds) {
      if (dryRun) {
        recalculated.push({ challengeId: id, ok: true, leaderboardCount: null })
        succeeded += 1
        continue
      }
      try {
        const rows = await recalculateWorldCupChallenge(id)
        recalculated.push({
          challengeId: id,
          ok: true,
          leaderboardCount: Array.isArray(rows) ? rows.length : 0,
        })
        succeeded += 1
      } catch (error) {
        const classified = classifyCronError(error)
        console.error("[world-cup-cron-sync] challenge recalculate failed", {
          challengeId: id,
          kind: classified.kind,
          message: classified.message,
        })
        recalculated.push({
          challengeId: id,
          ok: false,
          error: classified.kind,
          message: classified.message,
        })
        failed += 1
      }
    }
    result.recalculated = recalculated
    result.recalculateSummary = { attempted: recalculated.length, succeeded, failed }
  }

  return result
}

function jsonResult(result: Record<string, unknown>) {
  return NextResponse.json({
    ok: true,
    result,
    syncedAt: new Date().toISOString(),
  })
}

function jsonError(error: unknown, input?: Partial<z.infer<typeof bodySchema>>) {
  const classified = classifyCronError(error)
  console.error("[world-cup-cron-sync] job failed", {
    job: input?.job,
    provider: input?.provider ?? classified.provider,
    seasonYear: input?.seasonYear,
    dryRun: input?.dryRun,
    kind: classified.kind,
    message: classified.message,
  })

  return NextResponse.json(
    {
      ok: false,
      error: classified.kind,
      message: classified.message,
      job: input?.job ?? null,
      provider: input?.provider ?? classified.provider ?? null,
      seasonYear: input?.seasonYear ?? null,
      syncedAt: new Date().toISOString(),
    },
    { status: 500 }
  )
}

export async function GET(request: NextRequest) {
  if (!isWorldCupCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    return jsonResult(await runWorldCupCronSync(parsed.data))
  } catch (error) {
    return jsonError(error, parsed.data)
  }
}

export async function POST(request: NextRequest) {
  if (!isWorldCupCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    return jsonResult(await runWorldCupCronSync(parsed.data))
  } catch (error) {
    return jsonError(error, parsed.data)
  }
}
