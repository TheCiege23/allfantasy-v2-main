import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVerifiedUser } from "@/lib/auth-guard"

export const runtime = "nodejs"

export async function POST(req: Request, props: { params: Promise<{ entryId: string }> }) {
  const params = await props.params
  try {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response

    const entry = await prisma.bracketEntry.findUnique({
      where: { id: params.entryId },
      select: {
        id: true,
        userId: true,
        leagueId: true,
        status: true,
        tiebreakerPoints: true,
        league: {
          select: {
            tournamentId: true,
            scoringRules: true,
            tournament: { select: { lockAt: true } },
          },
        },
      },
    })

    if (!entry || entry.userId !== auth.userId) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const lockAt = entry.league.tournament.lockAt
    if (lockAt && new Date(lockAt) <= new Date()) {
      return NextResponse.json(
        {
          error: "BRACKET_LOCKED",
          message: "Brackets are locked. The tournament has already started.",
        },
        { status: 409 },
      )
    }

    if (entry.status === "LOCKED" || entry.status === "SCORED" || entry.status === "INVALIDATED") {
      return NextResponse.json(
        { error: "ALREADY_LOCKED", message: "This bracket is already locked or scored." },
        { status: 409 },
      )
    }

    const scoringRules = (entry.league.scoringRules || {}) as any
    const tiebreakerEnabled = Boolean(scoringRules?.tiebreakerEnabled)
    if (tiebreakerEnabled && (entry.tiebreakerPoints == null || Number.isNaN(entry.tiebreakerPoints))) {
      return NextResponse.json(
        { error: "MISSING_TIEBREAKER", message: "Please enter a valid tiebreaker value." },
        { status: 400 },
      )
    }

    const nodes = await prisma.bracketNode.findMany({
      where: { tournamentId: entry.league.tournamentId, round: { gte: 1 } },
      select: { id: true },
    })
    const nodeIds = nodes.map((n) => n.id)

    const picks = await prisma.bracketPick.findMany({
      where: { entryId: entry.id, nodeId: { in: nodeIds } },
      select: { nodeId: true, pickedTeamName: true },
    })

    const pickedNodeIds = new Set(picks.filter((p) => p.pickedTeamName).map((p) => p.nodeId))
    const missing = nodeIds.filter((id) => !pickedNodeIds.has(id))

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "INCOMPLETE_BRACKET",
          message: "Please make picks for all games before submitting your bracket.",
          missingCount: missing.length,
        },
        { status: 400 },
      )
    }

    await prisma.bracketEntry.update({
      where: { id: entry.id },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[bracket/entry/submit] Error:", err)
    return NextResponse.json({ error: "Failed to submit bracket" }, { status: 500 })
  }
}

