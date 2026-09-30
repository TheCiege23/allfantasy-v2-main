import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVerifiedUser } from "@/lib/auth-guard"

export const runtime = "nodejs"

export async function POST(req: Request, props: { params: Promise<{ entryId: string }> }) {
  const params = await props.params
  try {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response

    const body = await req.json()
    const { nodeId } = body as { nodeId: string | null }

    const entry = await prisma.bracketEntry.findUnique({
      where: { id: params.entryId },
      select: {
        id: true,
        userId: true,
        leagueId: true,
        league: {
          select: {
            scoringRules: true,
            tournament: { select: { lockAt: true } },
          },
        },
      },
    })

    if (!entry || entry.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const rules = (entry.league?.scoringRules || {}) as any
    if (rules.scoringMode !== "fancred_edge" || !rules.insuranceEnabled) {
      return NextResponse.json(
        { error: "Insurance tokens are not enabled for this league" },
        { status: 400 }
      )
    }

    const lockAt = entry.league?.tournament?.lockAt
    if (lockAt && new Date(lockAt) <= new Date()) {
      return NextResponse.json(
        { error: "Bracket is locked — cannot change insurance" },
        { status: 409 }
      )
    }

    if (nodeId) {
      const node = await prisma.bracketNode.findUnique({
        where: { id: nodeId },
        select: { id: true, round: true },
      })
      if (!node) {
        return NextResponse.json({ error: "Node not found" }, { status: 404 })
      }

      const defaultAllowedRounds = [1, 3, 4, 5, 6]
      const allowedRounds: number[] =
        Array.isArray(rules.insuranceAllowedRounds)
          ? (rules.insuranceAllowedRounds as number[])
          : defaultAllowedRounds
      if (!allowedRounds.includes(node.round)) {
        return NextResponse.json(
          { error: "Insurance is not allowed for this round in this league" },
          { status: 400 },
        )
      }

      const pick = await prisma.bracketPick.findUnique({
        where: { entryId_nodeId: { entryId: entry.id, nodeId } },
        select: { id: true },
      })
      if (!pick) {
        return NextResponse.json(
          { error: "You must pick a team for this game before insuring it" },
          { status: 400 }
        )
      }
    }

    await prisma.bracketEntry.update({
      where: { id: entry.id },
      data: { insuredNodeId: nodeId || null },
    })

    return NextResponse.json({ ok: true, insuredNodeId: nodeId || null })
  } catch (err) {
    console.error("[bracket/insurance] Error:", err)
    return NextResponse.json(
      { error: "Failed to set insurance" },
      { status: 500 }
    )
  }
}

export async function GET(req: Request, props: { params: Promise<{ entryId: string }> }) {
  const params = await props.params
  try {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response

    const entry = await prisma.bracketEntry.findUnique({
      where: { id: params.entryId },
      select: { id: true, userId: true, insuredNodeId: true },
    })

    if (!entry || entry.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json({ ok: true, insuredNodeId: entry.insuredNodeId })
  } catch (err) {
    console.error("[bracket/insurance GET] Error:", err)
    return NextResponse.json(
      { error: "Failed to get insurance" },
      { status: 500 }
    )
  }
}
