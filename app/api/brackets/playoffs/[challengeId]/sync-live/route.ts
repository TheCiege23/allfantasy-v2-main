import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWorldCupApiUser } from "../../_utils"
import {
  syncPlayoffLiveSeries,
  fetchEspnDiagnostics,
} from "@/lib/playoffs/playoffLiveSyncService"
import type { PlayoffSport } from "@/lib/playoffs/types"

export const runtime = "nodejs"
export const maxDuration = 30

/** Shared: load + auth-check the challenge */
async function loadChallenge(challengeId: string, userId: string | undefined) {
  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { id: true, ownerUserId: true, sport: true, seasonYear: true, isTestMode: true },
  })
  if (!challenge) return { challenge: null, forbidden: false }
  const isOwner = userId === challenge.ownerUserId
  const forbidden = !isOwner && !challenge.isTestMode
  return { challenge, forbidden }
}

/**
 * GET /api/brackets/playoffs/[challengeId]/sync-live
 *
 * Commissioner diagnostic: fetch the ESPN scoreboard and report how well
 * each non-final series matches ESPN game data. No DB writes.
 *
 * Useful for verifying team name matching during a live game without
 * actually triggering a sync. Compare espnGamesFound vs seriesMatchAttempts
 * to diagnose mismatches.
 */
export async function GET(
  request: Request,
  context: { params: { challengeId: string } }
) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const { challengeId } = context.params
  if (!challengeId) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const { challenge, forbidden } = await loadChallenge(challengeId, auth.user?.id)
  if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  if (forbidden) return NextResponse.json({ error: "Forbidden — owner or test-mode only" }, { status: 403 })

  try {
    const diagnostics = await fetchEspnDiagnostics({
      challengeId,
      sport: challenge.sport as PlayoffSport,
      season: challenge.seasonYear as number,
    })
    return NextResponse.json({ ok: true, diagnostics })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

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

  const { challenge, forbidden } = await loadChallenge(challengeId, auth.user?.id)
  if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  if (forbidden) return NextResponse.json({ error: "Forbidden — owner or test-mode only" }, { status: 403 })

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
