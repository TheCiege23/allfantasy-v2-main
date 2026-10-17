import { NextResponse } from "next/server"
import {
  WORLD_CUP_BRACKET_LOCKED_MESSAGE,
  getWorldCupChallengeView,
} from "@/lib/world-cup/worldCupBracketService"
import {
  finalizeWorldCupEntry,
  getWorldCupEntryCompletionReview,
} from "@/lib/world-cup/worldCupEntryFinalizeService"
import { notifyWorldCupBracketFinalized } from "@/lib/world-cup/worldCupNotifications"
import { requireWorldCupApiUser, worldCupEntryParamsSchema } from "../../../../_utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function completionFromError(error: unknown) {
  return (error as { completion?: unknown })?.completion ?? null
}

function isLockedMessage(message: string) {
  return message === WORLD_CUP_BRACKET_LOCKED_MESSAGE || message.toLowerCase().includes("locked")
}

export async function GET(request: Request, context: { params: Promise<{ challengeId: string; entryId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupEntryParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  try {
    const completion = await getWorldCupEntryCompletionReview({
      challengeId: params.data.challengeId,
      entryId: params.data.entryId,
      userId: auth.user.id,
    })
    return NextResponse.json(
      { ok: true, completion },
      { headers: { "cache-control": "no-store" } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load completion review"
    return NextResponse.json({ error: message }, { status: message === "Entry not found" ? 404 : 400 })
  }
}

export async function POST(request: Request, context: { params: Promise<{ challengeId: string; entryId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupEntryParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  try {
    const result = await finalizeWorldCupEntry({
      challengeId: params.data.challengeId,
      entryId: params.data.entryId,
      userId: auth.user.id,
    })
    const view = await getWorldCupChallengeView({
      challengeId: params.data.challengeId,
      user: auth.user,
    })
    if (view) {
      await notifyWorldCupBracketFinalized({
        challengeId: params.data.challengeId,
        poolName: view.challenge.name,
        userId: auth.user.id,
        entryId: params.data.entryId,
      })
    }
    return NextResponse.json(
      { ok: true, ...result, view },
      { headers: { "cache-control": "no-store" } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to finalize entry"
    if (isLockedMessage(message)) {
      return NextResponse.json({ error: WORLD_CUP_BRACKET_LOCKED_MESSAGE }, { status: 423 })
    }
    const completion = completionFromError(error)
    return NextResponse.json(
      { error: message, completion },
      { status: message === "Entry not found" ? 404 : 400 }
    )
  }
}
