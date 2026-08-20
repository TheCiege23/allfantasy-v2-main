import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireCronAuth } from "@/app/api/cron/_auth"
import {
  recalculateWorldCupChallenge,
  syncWorldCupFixtures,
  syncWorldCupLiveScores,
  syncWorldCupProviderGroupStandings,
  syncWorldCupTeams,
} from "@/lib/world-cup"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const jobSchema = z.enum(["teams", "fixtures", "live", "standings", "recalculate", "all"])
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
  const challengeIds = await getCronChallengeIds(challengeId)
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
    result.live = []
    for (const id of challengeIds) {
      ;(result.live as unknown[]).push({
        challengeId: id,
        result: await syncWorldCupLiveScores({ challengeId: id, provider, seasonYear, dryRun, recalculate }),
      })
    }
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

  if (job === "recalculate" || job === "all") {
    result.recalculated = []
    for (const id of challengeIds) {
      ;(result.recalculated as unknown[]).push({
        challengeId: id,
        leaderboard: dryRun ? null : await recalculateWorldCupChallenge(id),
      })
    }
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

export async function GET(request: NextRequest) {
  if (!isWorldCupCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  return jsonResult(await runWorldCupCronSync(parsed.data))
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

  return jsonResult(await runWorldCupCronSync(parsed.data))
}
