import { NextRequest, NextResponse } from "next/server"
import { requireAdminOrBearer } from "@/lib/adminAuth"
import {
  getPlayerGameLogHealthDashboard,
  importPlayerGameLogs,
} from "@/lib/sports-reporting/PlayerGameLogImportService"

export const dynamic = "force-dynamic"
export const maxDuration = 60

function listParam(value: string | null): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  const { searchParams } = new URL(request.url)
  const sports = listParam(searchParams.get("sports") ?? searchParams.get("sport"))
  const health = await getPlayerGameLogHealthDashboard(sports)
  return NextResponse.json({
    ok: true,
    health,
    actions: {
      endpoint: "/api/admin/sports/game-logs",
      methods: ["GET health", "POST import/backfill"],
      examples: [
        {
          action: "import NFL game logs for rostered players",
          body: { sport: "NFL", provider: "sleeper", season: "2026", week: 1, leagueId: "league_id" },
        },
        {
          action: "backfill explicit NFL players",
          body: { sport: "NFL", provider: "sleeper", season: "2026", weeks: [1, 2], playerIds: ["1234"] },
        },
      ],
      notes: [
        "Admin/bearer protected.",
        "Provider calls are allowed here only; user-facing score routes remain cache-only.",
        "Unsupported provider/sport adapters return scaffold warnings instead of fabricated stats.",
      ],
    },
  })
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  const body = (await request.json().catch(() => ({}))) as {
    sport?: string
    provider?: string
    season?: string | number
    seasonType?: string
    week?: number | string
    weeks?: Array<number | string> | number | string
    leagueId?: string
    seasonId?: string
    playerIds?: string[]
    limit?: number
    dryRun?: boolean
  }

  const weeks = body.weeks ?? body.week ?? null
  const result = await importPlayerGameLogs({
    sport: body.sport,
    provider: body.provider,
    season: body.season,
    seasonType: body.seasonType,
    weeks,
    leagueId: body.leagueId,
    seasonId: body.seasonId,
    playerIds: body.playerIds,
    limit: body.limit,
    dryRun: body.dryRun,
    actorId: gate.user.id ?? gate.user.email ?? "admin",
    trigger: "admin",
  })

  const status = result.ok ? 200 : 500
  return NextResponse.json({ ok: result.ok, result }, { status })
}
