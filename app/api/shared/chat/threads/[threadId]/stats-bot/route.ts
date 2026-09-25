import { NextRequest, NextResponse } from "next/server"
import { requireAdminOrBearer } from "@/lib/adminAuth"
import { createStatsBotMessage } from "@/lib/platform/chat-service"

/**
 * POST: post a Chat Stats Bot message to the thread (weekly update).
 * Body: { weekLabel, bestTeam, worstTeam, bestPlayer, winStreak, lossStreak }
 *
 * 🛑 THIS WAS OPEN TO THE WHOLE INTERNET. The header said "optionally protect with CRON_SECRET or
 * admin auth" and nothing did: no session, no membership, no secret. Anyone — signed in or not —
 * could write a "Chat Stats Bot" message into any DM or huddle whose id they knew (live test
 * 2026-09-25: an anonymous POST reached `platformChatMessage.create`; the same thread's
 * `/messages` returned 401). Nothing in the repo calls this route, so the gate breaks no caller:
 * an internal job or an admin, and nobody else.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res

  const threadId = decodeURIComponent(params.threadId)
  const body = await req.json().catch(() => ({}))
  const weekLabel = typeof body?.weekLabel === "string" ? body.weekLabel : "Week 1"
  const bestTeam = typeof body?.bestTeam === "string" ? body.bestTeam : "—"
  const worstTeam = typeof body?.worstTeam === "string" ? body.worstTeam : "—"
  const bestPlayer = typeof body?.bestPlayer === "string" ? body.bestPlayer : "—"
  const winStreak = typeof body?.winStreak === "string" ? body.winStreak : "—"
  const lossStreak = typeof body?.lossStreak === "string" ? body.lossStreak : "—"

  const created = await createStatsBotMessage(threadId, {
    weekLabel,
    bestTeam,
    worstTeam,
    bestPlayer,
    winStreak,
    lossStreak,
  })

  if (!created) return NextResponse.json({ error: "Failed to create stats message" }, { status: 500 })
  return NextResponse.json({ status: "ok", message: created })
}
