import { NextRequest, NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import {
  getLeagueIdFromVirtualRoom,
  getVirtualThreadReadReceipts,
  isLeagueVirtualRoom,
  markVirtualThreadRead,
} from "@/lib/chat-core"
import { canAccessLeagueDraft } from "@/lib/live-draft-engine/auth"
import { getThreadReadReceipts, markPlatformThreadRead } from "@/lib/platform/chat-service"
import { prisma } from "@/lib/prisma"

async function assertVirtualMembership(threadId: string, appUserId: string): Promise<boolean> {
  const leagueId = getLeagueIdFromVirtualRoom(threadId)
  if (!leagueId) return false

  const bracketMember = await (prisma as any).bracketLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId, userId: appUserId } },
    select: { id: true },
  })
  if (bracketMember) return true

  return canAccessLeagueDraft(leagueId, appUserId)
}

export async function GET(_req: NextRequest, props: { params: Promise<{ threadId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)

  if (isLeagueVirtualRoom(threadId)) {
    const allowed = await assertVirtualMembership(threadId, user.appUserId)
    if (!allowed) return NextResponse.json({ error: "Thread not available" }, { status: 403 })

    const receipts = getVirtualThreadReadReceipts(threadId)
    return NextResponse.json({ status: "ok", receipts })
  }

  const receipts = await getThreadReadReceipts(user.appUserId, threadId)
  return NextResponse.json({ status: "ok", receipts })
}

export async function POST(_req: NextRequest, props: { params: Promise<{ threadId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)

  if (isLeagueVirtualRoom(threadId)) {
    const allowed = await assertVirtualMembership(threadId, user.appUserId)
    if (!allowed) return NextResponse.json({ error: "Thread not available" }, { status: 403 })

    markVirtualThreadRead(threadId, user.appUserId)
    const receipts = getVirtualThreadReadReceipts(threadId)
    return NextResponse.json({ status: "ok", receipts })
  }

  const ok = await markPlatformThreadRead(user.appUserId, threadId)
  if (!ok) return NextResponse.json({ error: "Thread not available" }, { status: 403 })
  const receipts = await getThreadReadReceipts(user.appUserId, threadId)
  return NextResponse.json({ status: "ok", receipts })
}
