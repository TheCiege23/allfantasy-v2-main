import { NextRequest, NextResponse } from "next/server"
import { requireVerifiedUser } from "@/lib/auth-guard"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({} as any))
  const { entryId } = body

  if (!entryId) {
    return NextResponse.json({ error: "MISSING_ENTRY_ID" }, { status: 400 })
  }

  const source = await prisma.bracketEntry.findUnique({
    where: { id: entryId },
    include: {
      picks: true,
      
      league: {
        select: {
          id: true,
          tournamentId: true,
          scoringRules: true,
        },
      },
    },
  })

  if (!source) {
    return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 })
  }

  if (source.userId !== auth.userId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
  }

  const rules = (source.league.scoringRules || {}) as any

  if (rules.allowCopyBracket === false) {
    return NextResponse.json(
      { error: "COPY_DISABLED", message: "Bracket copying is disabled for this league." },
      { status: 403 }
    )
  }

  const maxEntries = Number(rules.maxEntriesPerUser ?? 10)

  const currentCount = await prisma.bracketEntry.count({
    where: { leagueId: source.leagueId, userId: auth.userId },
  })

  if (currentCount >= maxEntries) {
    return NextResponse.json(
      { error: "ENTRY_LIMIT_REACHED", message: `Maximum ${maxEntries} entries per league.` },
      { status: 409 }
    )
  }

  /*
   * 🛑 NO IN-APP BRACKET FEE (owner's decision, 2026-09-25). A paid bracket league
   * used to answer 402 here until the member had bought a $2 "first bracket fee" and,
   * past three entries, a $3 unlock. That fee was never payable: compliance-guardrails
   * has refused `first_bracket_fee` as in-app league dues since 2026-03-30, and its
   * Stripe products were never created — so the gate could only ever say no. A paid
   * league is a commissioner-run pool paid outside AllFantasy (FanCred); the entry
   * limit above is the only cap.
   */

  const tournament = await prisma.bracketTournament.findUnique({
    where: { id: source.league.tournamentId },
    select: { lockAt: true },
  })

  if (tournament?.lockAt && new Date(tournament.lockAt) <= new Date()) {
    return NextResponse.json(
      { error: "BRACKET_LOCKED", message: "Tournament brackets are locked. Cannot copy." },
      { status: 403 }
    )
  }

  const newEntry = await prisma.bracketEntry.create({
    data: {
      leagueId: source.leagueId,
      userId: auth.userId,
      name: `${source.name} (Copy)`,
      tiebreakerPoints: source.tiebreakerPoints ?? null,
      status: "DRAFT",
    },
  })

  if (source.picks.length > 0) {
    await prisma.bracketPick.createMany({
      data: source.picks.map((p) => ({
        entryId: newEntry.id,
        nodeId: p.nodeId,
        pickedTeamName: p.pickedTeamName,
      })),
    })
  }

  return NextResponse.json({
    ok: true,
    entryId: newEntry.id,
    name: newEntry.name,
    picksCount: source.picks.length,
  })
}

