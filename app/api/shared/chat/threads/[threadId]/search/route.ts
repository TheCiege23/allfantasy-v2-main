import { NextRequest, NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { searchPlatformThreadMessages } from "@/lib/platform/chat-service"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core"
import { canAccessLeagueDraft } from "@/lib/live-draft-engine/auth"
import { getLeagueChatMessages } from "@/lib/league-chat/LeagueChatMessageService"
import { bracketMessagesToPlatform } from "@/lib/chat-core/league-message-proxy"
import { prisma } from "@/lib/prisma"

const bracketInclude = {
  user: {
    select: {
      id: true,
      username: true,
      displayName: true,
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
}

function getSearchParams(req: NextRequest): URLSearchParams {
  return req.nextUrl?.searchParams ?? new URL(req.url).searchParams
}

function getQuery(req: NextRequest): string {
  const params = getSearchParams(req)
  const value = params.get("q") ?? params.get("query") ?? ""
  return String(value).trim()
}

function getLimit(req: NextRequest): number {
  const params = getSearchParams(req)
  const raw = Number(params.get("limit") ?? 25)
  if (!Number.isFinite(raw)) return 25
  return Math.max(1, Math.min(50, Math.trunc(raw)))
}

export async function GET(
  req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const query = getQuery(req)
  const limit = getLimit(req)
  if (!query) return NextResponse.json({ status: "ok", query: "", messages: [] })

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: "Invalid league room" }, { status: 400 })

    const bracketMember = await (prisma as any).bracketLeagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.appUserId } },
      select: { id: true },
    })

    if (bracketMember) {
      const rows = await (prisma as any).bracketLeagueMessage.findMany({
        where: {
          leagueId,
          message: { contains: query, mode: "insensitive" },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: bracketInclude,
      })
      return NextResponse.json({
        status: "ok",
        query,
        messages: bracketMessagesToPlatform(rows.reverse(), threadId),
      })
    }

    const mainLeagueAccess = await canAccessLeagueDraft(leagueId, user.appUserId)
    if (!mainLeagueAccess) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 })
    }

    const searchParams = getSearchParams(req)
    const source = searchParams.has("source")
      ? (searchParams?.get("source") || undefined)
      : undefined

    const messages = await getLeagueChatMessages(leagueId, {
      limit: 120,
      source,
      requestingUserId: user.appUserId,
    })
    const lower = query.toLowerCase()
    const filtered = messages.filter((message) => String(message.body || "").toLowerCase().includes(lower))
    return NextResponse.json({ status: "ok", query, messages: filtered.slice(-limit) })
  }

  const messages = await searchPlatformThreadMessages(user.appUserId, threadId, query, limit)
  return NextResponse.json({ status: "ok", query, messages })
}
