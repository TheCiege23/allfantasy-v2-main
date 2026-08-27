import { NextRequest, NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { deletePinMessage } from "@/lib/platform/chat-service"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core"
import { resolveLeagueAccess } from "@/lib/league-access"
import { prisma } from "@/lib/prisma"

/**
 * POST /api/shared/chat/threads/[threadId]/unpin
 * Body: { pinMessageId: string }
 * Removes the pin (deletes the pin-type message).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const body = await req.json().catch(() => ({}))
  const pinMessageId = String(body?.pinMessageId || "").trim()
  if (!pinMessageId) return NextResponse.json({ error: "pinMessageId required" }, { status: 400 })

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: "Invalid league room" }, { status: 400 })

    const bracketMember = await (prisma as any).bracketLeagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.appUserId } },
      select: { id: true },
    })
    if (bracketMember) {
      const result = await (prisma as any).bracketLeagueMessage.deleteMany({
        where: { id: pinMessageId, leagueId, type: "pin" },
      })
      if (!result?.count) return NextResponse.json({ error: "Unable to unpin" }, { status: 400 })
      return NextResponse.json({ status: "ok" })
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

    const result = await (prisma as any).leagueChatMessage.deleteMany({
      where: { id: pinMessageId, leagueId, type: "pin" },
    })
    if (!result?.count) return NextResponse.json({ error: "Unable to unpin" }, { status: 400 })
    return NextResponse.json({ status: "ok" })
  }

  const ok = await deletePinMessage(user.appUserId, threadId, pinMessageId)
  if (!ok) return NextResponse.json({ error: "Unable to unpin" }, { status: 400 })
  return NextResponse.json({ status: "ok" })
}
