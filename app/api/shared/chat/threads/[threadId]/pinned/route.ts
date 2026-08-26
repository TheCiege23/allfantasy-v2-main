import { NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { getPlatformThreadMessages } from "@/lib/platform/chat-service"
import { bracketMessagesToPlatform } from "@/lib/chat-core/league-message-proxy"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core"
import { resolveLeagueAccess } from "@/lib/league-access"
import { getLeagueChatMessages } from "@/lib/league-chat/LeagueChatMessageService"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/shared/chat/threads/[threadId]/pinned
 * Returns messages that are pin-type (messageType === 'pin') for the thread.
 * Pinned refs are stored as typed messages with body JSON { messageId }.
 */
export async function GET(
  _req: Request,
  { params }: { params: { threadId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: "Invalid league room" }, { status: 400 })

    const bracketMember = await (prisma as any).bracketLeagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.appUserId } },
      select: { id: true },
    })
    if (bracketMember) {
      const rows = await (prisma as any).bracketLeagueMessage.findMany({
        where: { leagueId, type: "pin" },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              email: true,
              avatarUrl: true,
              profile: { select: { avatarPreset: true } },
            },
          },
          reactions: {
            select: {
              emoji: true,
              userId: true,
            },
          },
        },
      })
      const pinned = bracketMessagesToPlatform(rows.reverse(), threadId)
      return NextResponse.json({ status: "ok", pinned })
    }

    /*
     * ⚠ SAME WRONG PREDICATE THE REACTION ROUTE HAD. `canAccessLeagueDraft`
     * needs a Roster row or a CLAIMED LeagueTeam; production has 1,078 league
     * teams and 94 claimed. `/api/league/chat` admits anyone
     * `resolveLeagueAccess` recognises, so most members could read a thread and
     * be refused the moment they pinned in it.
     */
    const canAccessMainLeague = (await resolveLeagueAccess(leagueId, user.appUserId)) != null
    if (!canAccessMainLeague) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    /*
     * ⚠ THIS USED TO TAKE THE LAST 100 MESSAGES OF EVERY TYPE AND FILTER FOR
     * PINS AFTERWARDS, so a pin older than the hundred most recent messages
     * silently disappeared from the board. Production already holds 157
     * draft-pick rows in league chat, which is most of that window on its own.
     * `messageTypeIn` filters in SQL, so the board holds pins and not whatever
     * happens to be recent.
     */
    const pinned = await getLeagueChatMessages(leagueId, {
      limit: 100,
      requestingUserId: user.appUserId,
      messageTypeIn: ["pin"],
    })
    return NextResponse.json({ status: "ok", pinned })
  }
  const all = await getPlatformThreadMessages(user.appUserId, threadId, 100)
  const pinned = all.filter((m) => m.messageType === "pin")

  return NextResponse.json({ status: "ok", pinned })
}
