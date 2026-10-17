import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import {
  computeHealthScore,
  computeBracketUniqueness,
  computePickDistribution,
  combineHealthComponents,
} from "@/lib/brackets/intelligence/data-engine"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  // Worker endpoint: it writes tournaments, nodes, picks or feed events, so it
  // takes the same cron/admin secret as sync-playoff. It was reachable anonymously.
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const body = await req.json().catch(() => ({} as any))
    const tournamentId =
      typeof body.tournamentId === "string" && body.tournamentId.trim()
        ? body.tournamentId.trim()
        : null
    const leagueId =
      typeof body.leagueId === "string" && body.leagueId.trim()
        ? body.leagueId.trim()
        : null

    if (!tournamentId) {
      return NextResponse.json({ error: "tournamentId is required" }, { status: 400 })
    }

    const whereEntry: any = {
      league: { tournamentId },
      status: { notIn: ["DRAFT", "INVALIDATED"] },
    }
    if (leagueId) {
      whereEntry.leagueId = leagueId
    }

    const entries = await prisma.bracketEntry.findMany({
      where: whereEntry,
      select: {
        id: true,
        leagueId: true,
        picks: {
          select: { nodeId: true, pickedTeamName: true },
        },
      },
    })

    if (!entries.length) {
      return NextResponse.json({
        ok: true,
        tournamentId,
        leagueId,
        entriesUpdated: 0,
      })
    }

    const distributions = await computePickDistribution(tournamentId)

    const snapshots: {
      tournamentId: string
      leagueId: string
      entryId: string
      healthScore: number
      statusLabel: string
    }[] = []

    for (const entry of entries) {
      const leagueForEntry = entry.leagueId
      if (!leagueForEntry) continue

      const health = await computeHealthScore(entry.id, tournamentId)
      const remainingPoints = Math.max(0, health.maxPossiblePoints - health.currentPoints)

      const validPicks = entry.picks.filter((p) => p.pickedTeamName != null) as Array<{
        nodeId: string
        pickedTeamName: string
      }>
      const uniqueness = computeBracketUniqueness(validPicks, distributions)

      const simSnapshot = await prisma.bracketSimulationSnapshot.findUnique({
        where: {
          tournamentId_leagueId_entryId: {
            tournamentId,
            leagueId: leagueForEntry,
            entryId: entry.id,
          },
        },
        select: { winLeagueProbability: true },
      })

      const ffRatio =
        health.finalFourTotal > 0 ? health.finalFourAlive / health.finalFourTotal : 0

      const combined = combineHealthComponents({
        health,
        remainingPoints,
        championAlive: health.championAlive,
        finalFourAliveRatio: ffRatio,
        uniquenessScore: uniqueness.score,
        winLeagueProbability: simSnapshot?.winLeagueProbability ?? 0,
      })

      snapshots.push({
        tournamentId,
        leagueId: leagueForEntry,
        entryId: entry.id,
        healthScore: combined.score,
        statusLabel: combined.statusLabel,
      })
    }

    const ops = snapshots.map((snap) =>
      prisma.bracketHealthSnapshot.upsert({
        where: {
          tournamentId_leagueId_entryId: {
            tournamentId: snap.tournamentId,
            leagueId: snap.leagueId,
            entryId: snap.entryId,
          },
        },
        update: {
          healthScore: snap.healthScore,
          statusLabel: snap.statusLabel,
        },
        create: {
          tournamentId: snap.tournamentId,
          leagueId: snap.leagueId,
          entryId: snap.entryId,
          healthScore: snap.healthScore,
          statusLabel: snap.statusLabel,
        },
      }),
    )

    if (ops.length) {
      await prisma.$transaction(ops)
    }

    return NextResponse.json({
      ok: true,
      tournamentId,
      leagueId,
      entriesUpdated: snapshots.length,
    })
  } catch (err: any) {
    console.error("[workers/health] Error:", err)
    return NextResponse.json(
      { error: err?.message || "Health worker failed" },
      { status: 500 },
    )
  }
}

