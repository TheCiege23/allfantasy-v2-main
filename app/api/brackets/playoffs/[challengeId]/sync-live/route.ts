import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWorldCupApiUser } from "../../_utils"
import { syncPlayoffLiveSeries } from "@/lib/playoffs/playoffLiveSyncService"
import type { PlayoffSport } from "@/lib/playoffs/types"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * POST /api/brackets/playoffs/[challengeId]/sync-live
 *
 * Commissioner-only: trigger a live sync for this specific challenge.
 * Fetches the ESPN scoreboard and updates series win counts, live status,
 * and winner detection.
 *
 * Query params:
 *   ?dryRun=true  — simulate without writing
 */
export async function POST(
  request: Request,
  context: { params: { challengeId: string } }
) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const { challengeId } = context.params
  if (!challengeId) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  // Load challenge to verify ownership and get sport/season
  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { id: true, ownerUserId: true, sport: true, seasonYear: true, isTestMode: true },
  })

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  const isOwner = auth.user?.id === challenge.ownerUserId
  if (!isOwner && !challenge.isTestMode) {
    return NextResponse.json({ error: "Forbidden — owner or test-mode only" }, { status: 403 })
  }

  const sport = challenge.sport as PlayoffSport
  const season = challenge.seasonYear as number
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true"

  try {
    const result = await syncPlayoffLiveSeries({ challengeId, sport, season, dryRun })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
