import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdditionalWorldCupInvite } from "@/lib/world-cup"
import {
  assertWorldCupManager,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"

export const runtime = "nodejs"

const createInviteSchema = z.object({
  maxUses: z.coerce.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
})

export async function POST(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(request, params.data.challengeId, auth.user)
  if (!access.ok) return access.response

  const body = await request.json().catch(() => ({}))
  const parsed = createInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  const invite = await createAdditionalWorldCupInvite({
    challengeId: params.data.challengeId,
    createdByUserId: auth.user.id,
    maxUses: parsed.data.maxUses ?? null,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  })

  return NextResponse.json({ ok: true, ...invite })
}
