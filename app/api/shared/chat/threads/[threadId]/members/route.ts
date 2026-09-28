import { NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { addThreadParticipants, getThreadMembers } from "@/lib/platform/chat-service"
import { prisma } from "@/lib/prisma"
import { hasBlockBetween } from "@/lib/moderation"

/**
 * GET /api/shared/chat/threads/[threadId]/members
 * Returns thread members for mention suggestions: { id, username, displayName }[].
 */
export async function GET(
  _req: Request,
  { params }: { params: { threadId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const members = await getThreadMembers(user.appUserId, threadId)
  return NextResponse.json({ status: "ok", members })
}

/**
 * POST /api/shared/chat/threads/[threadId]/members
 * Body: { usernames?: string[]; memberUserIds?: string[] }
 * Adds members to an existing group thread.
 */
export async function POST(
  req: Request,
  { params }: { params: { threadId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const body = await req.json().catch(() => ({}))

  const usernames = Array.isArray(body?.usernames)
    ? (body.usernames as unknown[]).map((u) => String(u).trim()).filter(Boolean)
    : []
  const memberUserIds = Array.isArray(body?.memberUserIds)
    ? (body.memberUserIds as unknown[]).map((v) => String(v).trim()).filter(Boolean)
    : []

  let resolvedUserIds = memberUserIds
  if (usernames.length > 0) {
    const users = await prisma.appUser.findMany({
      where: {
        OR: usernames.map((username) => ({
          username: { equals: username, mode: "insensitive" as const },
        })),
      },
      select: { id: true },
    })
    resolvedUserIds = Array.from(new Set([...resolvedUserIds, ...users.map((u) => u.id)]))
  }

  if (resolvedUserIds.length === 0) {
    return NextResponse.json({ error: "No valid participants supplied" }, { status: 400 })
  }

  /*
   * Adding someone to a huddle is starting a conversation with them, so the same block rule applies,
   * in both directions, with the same neutral refusal — and a failed lookup refuses.
   */
  let blocked: boolean
  try {
    blocked = await hasBlockBetween(user.appUserId, resolvedUserIds)
  } catch {
    return NextResponse.json(
      { error: "Unable to add participants right now. Try again in a moment." },
      { status: 503 }
    )
  }
  if (blocked) {
    return NextResponse.json({ error: "You can't add one or more of these people." }, { status: 403 })
  }

  const ok = await addThreadParticipants(user.appUserId, threadId, resolvedUserIds)
  if (!ok) return NextResponse.json({ error: "Unable to add participants" }, { status: 400 })

  const members = await getThreadMembers(user.appUserId, threadId)
  return NextResponse.json({ status: "ok", members })
}
