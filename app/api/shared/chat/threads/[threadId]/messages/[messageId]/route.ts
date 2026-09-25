import { NextRequest, NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import {
  deletePlatformThreadMessage,
  editPlatformThreadMessage,
} from "@/lib/platform/chat-service"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core"
import { canAccessLeagueDraft } from "@/lib/live-draft-engine/auth"
import { prisma } from "@/lib/prisma"
import { isChimmyAuthored } from "@/lib/league-chat/chimmyIdentity"

async function canAccessVirtualLeague(leagueId: string, userId: string): Promise<boolean> {
  const bracketMember = await (prisma as any).bracketLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
    select: { id: true },
  })
  if (bracketMember) return true
  return canAccessLeagueDraft(leagueId, userId)
}

function mergeMetadata(existing: unknown, additions: Record<string, unknown>): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}
  return { ...base, ...additions }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { threadId: string; messageId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const messageId = decodeURIComponent(params.messageId)
  const body = await req.json().catch(() => ({}))
  const nextBody = String(body?.body || "").trim()
  if (!nextBody) return NextResponse.json({ error: "Message body required" }, { status: 400 })
  if (nextBody.length > 2000) return NextResponse.json({ error: "Message too long" }, { status: 400 })

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: "Invalid league room" }, { status: 400 })
    const allowed = await canAccessVirtualLeague(leagueId, user.appUserId)
    if (!allowed) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    const bracketMessage = await (prisma as any).bracketLeagueMessage.findFirst({
      where: { id: messageId, leagueId, userId: user.appUserId },
      select: { id: true, metadata: true },
    })
    if (bracketMessage) {
      const updated = await (prisma as any).bracketLeagueMessage.update({
        where: { id: messageId },
        data: {
          message: nextBody,
          metadata: mergeMetadata(bracketMessage.metadata, {
            editedAt: new Date().toISOString(),
            editedByUserId: user.appUserId,
          }),
        },
      })
      return NextResponse.json({ status: "ok", message: updated })
    }

    const leagueMessage = await (prisma as any).leagueChatMessage.findFirst({
      where: { id: messageId, leagueId, userId: user.appUserId },
      select: { id: true, metadata: true },
    })
    if (!leagueMessage) return NextResponse.json({ error: "Message not found" }, { status: 404 })
    /*
     * 🛑 A CHIMMY POST IS NOT ITS TECHNICAL AUTHOR'S TO REWRITE. It is stored under the league owner
     * (the row needs a real AppUser — lib/league-chat/chimmyIdentity.ts), so the sender check above
     * passes for the commissioner. Editing would put the commissioner's words under Chimmy's badge,
     * which is forging the badge from the inside. Deleting one stays allowed: that removes words,
     * it does not put new ones in Chimmy's mouth.
     */
    if (isChimmyAuthored(leagueMessage.metadata)) {
      return NextResponse.json({ error: "Chimmy's posts can't be edited." }, { status: 403 })
    }

    const updated = await (prisma as any).leagueChatMessage.update({
      where: { id: messageId },
      data: {
        message: nextBody,
        metadata: mergeMetadata(leagueMessage.metadata, {
          editedAt: new Date().toISOString(),
          editedByUserId: user.appUserId,
        }),
      },
    })
    return NextResponse.json({ status: "ok", message: updated })
  }

  const updated = await editPlatformThreadMessage(user.appUserId, threadId, messageId, nextBody)
  if (!updated) return NextResponse.json({ error: "Message not found" }, { status: 404 })
  return NextResponse.json({ status: "ok", message: updated })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { threadId: string; messageId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const messageId = decodeURIComponent(params.messageId)

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: "Invalid league room" }, { status: 400 })
    const allowed = await canAccessVirtualLeague(leagueId, user.appUserId)
    if (!allowed) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    const bracketMessage = await (prisma as any).bracketLeagueMessage.findFirst({
      where: { id: messageId, leagueId, userId: user.appUserId },
      select: { id: true, metadata: true },
    })
    if (bracketMessage) {
      await (prisma as any).bracketLeagueMessage.update({
        where: { id: messageId },
        data: {
          message: "[message deleted]",
          metadata: mergeMetadata(bracketMessage.metadata, {
            deletedAt: new Date().toISOString(),
            deletedByUserId: user.appUserId,
          }),
        },
      })
      return NextResponse.json({ status: "ok" })
    }

    const leagueMessage = await (prisma as any).leagueChatMessage.findFirst({
      where: { id: messageId, leagueId, userId: user.appUserId },
      select: { id: true, metadata: true },
    })
    if (!leagueMessage) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    await (prisma as any).leagueChatMessage.update({
      where: { id: messageId },
      data: {
        message: "[message deleted]",
        metadata: mergeMetadata(leagueMessage.metadata, {
          deletedAt: new Date().toISOString(),
          deletedByUserId: user.appUserId,
        }),
      },
    })
    return NextResponse.json({ status: "ok" })
  }

  const ok = await deletePlatformThreadMessage(user.appUserId, threadId, messageId)
  if (!ok) return NextResponse.json({ error: "Message not found" }, { status: 404 })
  return NextResponse.json({ status: "ok" })
}
