import { NextRequest, NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core"
/*
 * ⚠ SWAPPED OFF THE IN-MEMORY STORE. `ThreadRealtimeState` keeps typing in
 * module-level Maps, which on serverless is per-instance: you type on one
 * instance, the person watching is served by another, and they see nothing. The
 * route existed and its tests passed while the feature could not work for two
 * people in two requests. This store is shared.
 */
import { clearTyping, markTyping, readTyping } from "@/lib/chat-core/durableTyping"
import { canAccessLeagueDraft } from "@/lib/live-draft-engine/auth"
import { prisma } from "@/lib/prisma"

async function canAccessThread(threadId: string, appUserId: string): Promise<boolean> {
  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return false

    const bracketMember = await (prisma as any).bracketLeagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: appUserId } },
      select: { id: true },
    })
    if (bracketMember) return true

    return canAccessLeagueDraft(leagueId, appUserId)
  }

  const member = await (prisma as any).platformChatThreadMember.findFirst({
    where: { threadId, userId: appUserId, isBlocked: false },
    select: { id: true },
  })
  return Boolean(member)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const allowed = await canAccessThread(threadId, user.appUserId)
  if (!allowed) return NextResponse.json({ error: "Thread not available" }, { status: 403 })

  const typing = await readTyping(threadId, user.appUserId)
  return NextResponse.json({ status: "ok", typing })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const allowed = await canAccessThread(threadId, user.appUserId)
  if (!allowed) return NextResponse.json({ error: "Thread not available" }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const isTyping = Boolean(body?.isTyping)
  const profile = await (prisma as any).appUser.findUnique({
    where: { id: user.appUserId },
    select: { displayName: true, username: true },
  })

  const name = profile?.displayName || profile?.username || 'Someone'

  if (isTyping) {
    await markTyping(threadId, { userId: user.appUserId, name })
  } else {
    /* Sending clears it immediately; waiting out the TTL would leave the sender
       shown as still typing after their message had already arrived. */
    await clearTyping(threadId, user.appUserId)
  }

  const typing = await readTyping(threadId, user.appUserId)
  return NextResponse.json({ status: "ok", typing })
}
