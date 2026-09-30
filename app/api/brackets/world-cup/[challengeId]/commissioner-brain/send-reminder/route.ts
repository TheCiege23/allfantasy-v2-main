import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { userHasBracketBrainAi } from "@/lib/bracket-brain/bracketBrainAccess"
import {
  buildIncompleteBracketReminderDetailedLines,
  buildPoolBroadcastReminderLines,
  generateAiWrappedLines,
} from "@/lib/world-cup/worldCupCommissionerBrainService"
import { WORLD_CUP_BRACKET_EVENT_TYPES } from "@/lib/world-cup/worldCupBracketEvents"
import { worldCupIdempotencyKeys } from "@/lib/world-cup/worldCupBracketEventIdempotency"
import { emitWorldCupBracketChatEvent } from "@/lib/world-cup/worldCupBracketEventService"
import {
  assertWorldCupManager,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../../_utils"

export const runtime = "nodejs"

const postSchema = z.object({
  /** incomplete = per-entry missing picks + link; broadcast = short pool ping */
  target: z.enum(["incomplete", "broadcast"]).default("incomplete"),
  /** Requires AF Pro — wraps deterministic copy with Bracket Brain / OpenAI when configured */
  useAi: z.boolean().optional(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ challengeId: string }> }
) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(
    request,
    params.data.challengeId,
    auth.user
  )
  if (!access.ok) return access.response

  const json = await request.json().catch(() => ({}))
  const parsed = postSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const hasAi = await userHasBracketBrainAi(auth.user.id, auth.user.email ?? null)
  const wantsAi = Boolean(parsed.data.useAi)

  if (wantsAi && !hasAi) {
    return NextResponse.json(
      {
        error: "AF Pro required for AI-enhanced reminder copy.",
        upgrade: true,
      },
      { status: 402 }
    )
  }

  const challengeId = params.data.challengeId

  let lines: string[]
  let eventType: string
  let title: string

  if (parsed.data.target === "incomplete") {
    eventType = WORLD_CUP_BRACKET_EVENT_TYPES.INCOMPLETE_BRACKETS_WARNING
    title = "Incomplete brackets — finish picks"
    lines = wantsAi
      ? await generateAiWrappedLines("incomplete_reminder", challengeId)
      : await buildIncompleteBracketReminderDetailedLines(challengeId)
  } else {
    eventType = WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER
    title = "Pool reminder"
    lines = wantsAi
      ? await generateAiWrappedLines("pool_broadcast", challengeId)
      : await buildPoolBroadcastReminderLines(challengeId)
  }

  const bodyText = lines.join("\n").slice(0, 4000)

  await emitWorldCupBracketChatEvent({
    challengeId,
    eventType,
    eventTitle: title,
    eventBody: bodyText,
    idempotencyKey: worldCupIdempotencyKeys.lockReminder(challengeId, randomUUID()),
    userId: auth.user.id,
    isAiGenerated: wantsAi && hasAi,
    metadata: {
      manual: true,
      target: parsed.data.target,
      useAi: wantsAi,
    },
    force: true,
  })

  return NextResponse.json({
    ok: true,
    lines,
    target: parsed.data.target,
    useAi: wantsAi,
  })
}
