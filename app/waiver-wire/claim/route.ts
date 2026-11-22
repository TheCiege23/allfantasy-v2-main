import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  isRedraftLeagueMovesLocked,
  REDRAFT_MOVES_LOCKED_CODE,
  REDRAFT_MOVES_LOCKED_STATUS,
  REDRAFT_ROSTER_MOVES_LOCKED_MESSAGE,
} from "@/lib/redraft/tradeMoveLock"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { leagueId, playerId, bidAmount } = body

    if (!leagueId || !playerId) {
      return NextResponse.json(
        { error: "League ID and Player ID required" },
        { status: 400 }
      )
    }

    const bid = parseInt(bidAmount) || 0
    if (bid < 0) {
      return NextResponse.json(
        { error: "Bid amount cannot be negative" },
        { status: 400 }
      )
    }

    // The commissioner's move lock (see app/api/redraft/waivers/route.ts): no UI caller, so no way around it.
    if (await isRedraftLeagueMovesLocked(String(leagueId))) {
      return NextResponse.json(
        { error: REDRAFT_ROSTER_MOVES_LOCKED_MESSAGE, code: REDRAFT_MOVES_LOCKED_CODE },
        { status: REDRAFT_MOVES_LOCKED_STATUS }
      )
    }

    const roster = await prisma.redraftRoster.findFirst({
      where: {
        season: {
          leagueId: leagueId,
        },
        ownerId: session.user.id,
      },
      select: {
        id: true,
        seasonId: true,
        faabBalance: true,
      },
    })

    if (!roster) {
      return NextResponse.json(
        { error: "Roster not found for this league" },
        { status: 404 }
      )
    }

    const currentBalance = roster.faabBalance ?? 100
    if (bid > currentBalance) {
      return NextResponse.json(
        { error: `Insufficient FAAB balance. You have $${currentBalance}` },
        { status: 400 }
      )
    }

    const player = await prisma.sportsPlayer.findUnique({
      where: { id: playerId },
      select: { name: true },
    })

    const claim = await prisma.redraftWaiverClaim.create({
      data: {
        seasonId: roster.seasonId,
        leagueId: leagueId,
        rosterId: roster.id,
        addPlayerId: playerId,
        addPlayerName: player?.name || "Unknown",
        bidAmount: bid,
        status: "pending",
        submittedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      claim: {
        id: claim.id,
        playerId: claim.addPlayerId,
        playerName: claim.addPlayerName,
        bidAmount: claim.bidAmount,
        status: claim.status,
      },
    })
  } catch (error) {
    console.error("Failed to submit claim:", error)
    return NextResponse.json(
      { error: "Failed to submit claim" },
      { status: 500 }
    )
  }
}