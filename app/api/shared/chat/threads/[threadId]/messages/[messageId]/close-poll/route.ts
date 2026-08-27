import { NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { closePollMessage } from "@/lib/platform/chat-service"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core"
import { resolveLeagueAccess } from "@/lib/league-access"
import { prisma } from "@/lib/prisma"

/**
 * POST: close (resolve) a poll so no more votes can be cast.
 *
 * ⚠ THIS HAD THE SAME GAP AS THE VOTE ROUTE BESIDE IT: no league branch, so
 * `closePollMessage` looked for a `PlatformChatMessage` that a league poll is
 * not. Production holds 15 platform chat threads and all 15 are 'ai', so no
 * poll anybody posted could be closed early.
 *
 * ⚠ CLOSING IS NARROWER THAN VOTING. Reading gets you a vote; ending everyone
 * else's says otherwise. Only the person who asked the question, or a
 * commissioner, may close it.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export async function POST(
  _req: Request,
  { params }: { params: { threadId: string; messageId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const messageId = decodeURIComponent(params.messageId)

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: "Invalid league room" }, { status: 400 })

    const access = await resolveLeagueAccess(leagueId, user.appUserId)
    if (!access) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    const row = await (prisma as any).leagueChatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, leagueId: true, senderUserId: true, metadata: true },
    })
    if (!row || row.leagueId !== leagueId) {
      return NextResponse.json({ error: "Message not found in this league" }, { status: 404 })
    }

    const isAuthor = Boolean(row.senderUserId) && row.senderUserId === user.appUserId
    if (!isAuthor && !access.isCommissioner) {
      return NextResponse.json({ error: "Only the author or a commissioner can close this" }, { status: 403 })
    }

    const metadata = isRecord(row.metadata) ? row.metadata : {}
    const poll = isRecord(metadata.poll) ? metadata.poll : null
    if (!poll) return NextResponse.json({ error: "That message is not a poll" }, { status: 400 })

    /*
     * Idempotent: closing an already-closed poll is a no-op rather than an
     * error. Two commissioners tapping at once is not a failure worth surfacing.
     */
    await (prisma as any).leagueChatMessage.update({
      where: { id: messageId },
      data: { metadata: { ...metadata, poll: { ...poll, closed: true } } },
    })

    return NextResponse.json({ status: "ok" })
  }

  const ok = await closePollMessage(user.appUserId, threadId, messageId)
  if (!ok) return NextResponse.json({ error: "Could not close poll" }, { status: 400 })

  return NextResponse.json({ status: "ok" })
}
