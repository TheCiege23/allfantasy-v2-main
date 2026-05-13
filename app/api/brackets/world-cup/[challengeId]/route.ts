import { NextResponse } from "next/server"
import { z } from "zod"
import {
  getWorldCupChallengeView,
  updateWorldCupChallengeSettings,
} from "@/lib/world-cup"
import {
  assertWorldCupManager,
  getWorldCupAdminState,
  getWorldCupApiUser,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../_utils"

export const runtime = "nodejs"

const patchWorldCupChallengeSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  pickLockStrategy: z.enum(["per_match", "tournament_start"]).optional(),
  pickLockAt: z.string().datetime().nullable().optional(),
  status: z.enum(["setup", "open", "locked", "live", "final"]).optional(),
  isTestMode: z.boolean().optional(),
  simulationEnabled: z.boolean().optional(),
  simulationStatus: z.string().min(1).max(64).nullable().optional(),
  bracketLeagueId: z.string().min(8).nullable().optional(),
})

export async function GET(request: Request, context: { params: { challengeId: string } }) {
  try {
    const params = worldCupChallengeParamsSchema.safeParse(context.params)
    if (!params.success) {
      return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
    }

    const user = await getWorldCupApiUser()
    const isAdmin = await getWorldCupAdminState(request, user)
    const view = await getWorldCupChallengeView({
      challengeId: params.data.challengeId,
      user,
      isAdmin,
    })

    if (!view) {
      return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
    }

    return NextResponse.json(view)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error("[world-cup/GET]", context.params?.challengeId, msg, stack)
    return NextResponse.json({ error: "Internal server error", detail: msg }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: { params: { challengeId: string } }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse(context.params)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(request, params.data.challengeId, auth.user)
  if (!access.ok) return access.response

  const body = await request.json().catch(() => ({}))
  const parsed = patchWorldCupChallengeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  // Prevent accidentally setting a lock time in the past which would immediately
  // lock all entries. Require at least 60 seconds in the future.
  if (parsed.data.pickLockAt) {
    const lockAt = new Date(parsed.data.pickLockAt)
    const minAllowed = new Date(Date.now() + 60_000)
    if (lockAt < minAllowed) {
      return NextResponse.json(
        { error: "pickLockAt must be at least 60 seconds in the future" },
        { status: 422 }
      )
    }
  }

  await updateWorldCupChallengeSettings({
    challengeId: params.data.challengeId,
    name: parsed.data.name,
    visibility: parsed.data.visibility,
    pickLockStrategy: parsed.data.pickLockStrategy,
    pickLockAt:
      Object.prototype.hasOwnProperty.call(parsed.data, "pickLockAt") && parsed.data.pickLockAt
        ? new Date(parsed.data.pickLockAt)
        : parsed.data.pickLockAt === null
          ? null
          : undefined,
    status: parsed.data.status,
    isTestMode: parsed.data.isTestMode,
    simulationEnabled: parsed.data.simulationEnabled,
    simulationStatus: parsed.data.simulationStatus,
    simulatedAt: parsed.data.simulationStatus ? new Date() : undefined,
    bracketLeagueId: Object.prototype.hasOwnProperty.call(parsed.data, "bracketLeagueId")
      ? parsed.data.bracketLeagueId
      : undefined,
  })

  const view = await getWorldCupChallengeView({
    challengeId: params.data.challengeId,
    user: auth.user,
    isAdmin: access.isAdmin,
  })

  return NextResponse.json({ ok: true, view })
}
