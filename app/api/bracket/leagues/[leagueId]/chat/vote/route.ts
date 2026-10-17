import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const member = await prisma.bracketLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId: params.leagueId, userId } },
  })
  if (!member) return NextResponse.json({ error: "Not a member" }, { status: 403 })

  const { messageId, optionIndex } = await req.json()
  if (!messageId || optionIndex === undefined || typeof optionIndex !== "number") {
    return NextResponse.json({ error: "messageId and optionIndex required" }, { status: 400 })
  }

  const msg = await (prisma as any).bracketLeagueMessage.findUnique({
    where: { id: messageId },
  })
  if (!msg || msg.type !== "poll" || !msg.metadata || msg.leagueId !== params.leagueId) {
    return NextResponse.json({ error: "Not a valid poll in this league" }, { status: 400 })
  }

  const meta = msg.metadata as any
  const options = meta.options || []
  if (optionIndex < 0 || optionIndex >= options.length) {
    return NextResponse.json({ error: "Invalid option index" }, { status: 400 })
  }

  const votes = meta.votes || {}
  for (const key of Object.keys(votes)) {
    votes[key] = (votes[key] || []).filter((id: string) => id !== userId)
  }
  const optKey = String(optionIndex)
  if (!votes[optKey]) votes[optKey] = []
  votes[optKey].push(userId)

  await (prisma as any).bracketLeagueMessage.update({
    where: { id: messageId },
    data: { metadata: { ...meta, votes } },
  })

  return NextResponse.json({ ok: true, votes })
}
