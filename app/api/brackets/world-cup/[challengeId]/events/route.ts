import { NextResponse } from "next/server"
import { listWorldCupBracketChatEvents } from "@/lib/world-cup/worldCupBracketEventService"
import {
  assertWorldCupChallengeMemberOrManager,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ challengeId: string }> }
) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupChallengeMemberOrManager(
    _request,
    params.data.challengeId,
    auth.user
  )
  if (!access.ok) return access.response

  const raw = await listWorldCupBracketChatEvents(params.data.challengeId, 60)
  const events = raw.map((e: (typeof raw)[number]) => ({
    id: e.id,
    challengeId: e.challengeId,
    bracketEntryId: e.bracketEntryId,
    userId: e.userId,
    eventType: e.eventType,
    eventTitle: e.eventTitle,
    eventBody: e.eventBody,
    metadata: e.metadata ?? {},
    createdAt: e.createdAt,
    isAiGenerated: e.isAiGenerated,
  }))
  return NextResponse.json({ events })
}
