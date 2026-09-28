import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const member = await prisma.bracketLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId: params.leagueId, userId } },
  })
  if (!member) return NextResponse.json({ error: "Not a member" }, { status: 403 })

  const { messageId, emoji } = await req.json()
  if (!messageId || !emoji || typeof emoji !== "string" || emoji.length > 10) {
    return NextResponse.json({ error: "messageId and emoji required" }, { status: 400 })
  }

  const msg = await (prisma as any).bracketLeagueMessage.findUnique({
    where: { id: messageId },
    select: { leagueId: true },
  })
  if (!msg || msg.leagueId !== params.leagueId) {
    return NextResponse.json({ error: "Message not found in this league" }, { status: 404 })
  }

  const existing = await (prisma as any).bracketMessageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId, emoji } },
  })

  if (existing) {
    await (prisma as any).bracketMessageReaction.delete({ where: { id: existing.id } })
    return NextResponse.json({ removed: true })
  }

  const reaction = await (prisma as any).bracketMessageReaction.create({
    data: { messageId, userId, emoji },
    // No email: the reaction is returned to the pool chat.
    include: { user: { select: { id: true, displayName: true, username: true } } },
  })

  return NextResponse.json({ reaction })
}
