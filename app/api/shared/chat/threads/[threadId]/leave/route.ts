import { NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { leaveThread } from "@/lib/platform/chat-service"

/** POST: leave the thread (remove current user's membership). */
export async function POST(_req: Request, props: { params: Promise<{ threadId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const ok = await leaveThread(user.appUserId, threadId)
  if (!ok) return NextResponse.json({ error: "Unable to leave" }, { status: 400 })
  return NextResponse.json({ status: "ok" })
}
