import { NextRequest, NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { setThreadMuted } from "@/lib/platform/chat-service"
import { isLeagueVirtualRoom } from "@/lib/chat-core"

/**
 * POST: set mute state for the current user in this thread.
 * Body: { muted: boolean }
 */
export async function POST(req: NextRequest, props: { params: Promise<{ threadId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  if (isLeagueVirtualRoom(threadId)) {
    return NextResponse.json({ error: "Mute not supported for league room" }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const muted = Boolean(body?.muted)

  const ok = await setThreadMuted(user.appUserId, threadId, muted)
  if (!ok) return NextResponse.json({ error: "Could not update mute" }, { status: 400 })

  return NextResponse.json({ status: "ok", muted })
}
