import { NextRequest, NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { createPlatformThread } from "@/lib/platform/chat-service"
import { prisma } from "@/lib/prisma"
import { hasBlockBetween } from "@/lib/moderation"

/**
 * POST /api/shared/chat/dm/start
 * Body: { username: string }
 * Creates or returns existing DM thread with the user who has that username.
 */
export async function POST(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const username = String(body?.username ?? "").trim()
  if (!username) return NextResponse.json({ error: "username required" }, { status: 400 })

  const other = await (prisma as any).appUser.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { id: true },
  })
  if (!other?.id) return NextResponse.json({ error: "User not found" }, { status: 404 })
  if (other.id === user.appUserId) return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 })

  /*
   * A block in either direction stops a new DM. Neutral wording — it must not reveal who blocked
   * whom — and a failed lookup refuses rather than assuming nobody is blocked.
   */
  let blocked: boolean
  try {
    blocked = await hasBlockBetween(user.appUserId, [other.id])
  } catch {
    return NextResponse.json(
      { error: "Unable to start this conversation right now. Try again in a moment." },
      { status: 503 }
    )
  }
  if (blocked) {
    return NextResponse.json({ error: "You can't start a conversation with this person." }, { status: 403 })
  }

  const thread = await createPlatformThread({
    creatorUserId: user.appUserId,
    threadType: "dm",
    productType: "shared",
    memberUserIds: [other.id],
  })
  if (!thread) return NextResponse.json({ error: "Unable to create or find conversation" }, { status: 400 })

  return NextResponse.json({ status: "ok", thread })
}
