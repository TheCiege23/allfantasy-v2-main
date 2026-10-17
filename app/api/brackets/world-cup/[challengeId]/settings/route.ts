import { NextResponse } from "next/server"
import { userHasBracketBrainAi } from "@/lib/bracket-brain/bracketBrainAccess"
import { userHasWorldCupCommissionerAccess } from "@/lib/world-cup/worldCupCommissionerAccess"
import {
  applyWorldCupBracketSettingsPatch,
  getWorldCupBracketSettingsBundle,
  worldCupPublicPicksEarlyGloballyAllowed,
} from "@/lib/world-cup/worldCupBracketSettingsService"
import { worldCupBracketSettingsPatchSchema } from "@/lib/world-cup/worldCupBracketSettingsSchema"
import {
  assertWorldCupManager,
  getWorldCupAdminState,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"

export const runtime = "nodejs"

export async function GET(
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

  const bundle = await getWorldCupBracketSettingsBundle(params.data.challengeId)
  if (!bundle) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  const [hasAfPro, hasAfCommissioner, isAdmin] = await Promise.all([
    userHasBracketBrainAi(auth.user.id, auth.user.email ?? null),
    userHasWorldCupCommissionerAccess(auth.user.id, auth.user.email ?? null),
    getWorldCupAdminState(request, auth.user),
  ])

  return NextResponse.json({
    ...bundle,
    hasAfPro,
    hasAfCommissioner: Boolean(isAdmin || hasAfCommissioner),
    isAdmin,
    earlyPublicPicksAllowed: worldCupPublicPicksEarlyGloballyAllowed(),
  })
}

export async function PATCH(
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

  const body = await request.json().catch(() => ({}))
  const parsed = worldCupBracketSettingsPatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 })
  }

  const [hasAfPro, hasAfCommissioner, isAdmin] = await Promise.all([
    userHasBracketBrainAi(auth.user.id, auth.user.email ?? null),
    userHasWorldCupCommissionerAccess(auth.user.id, auth.user.email ?? null),
    getWorldCupAdminState(request, auth.user),
  ])

  try {
    await applyWorldCupBracketSettingsPatch({
      challengeId: params.data.challengeId,
      userHasAfPro: hasAfPro,
      userHasAfCommissioner: hasAfCommissioner,
      isAdmin,
      actorUserId: auth.user.id,
      patch: parsed.data,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save settings"
    const lower = msg.toLowerCase()
    const status =
      lower.includes("af pro") || lower.includes("af commissioner") || lower.includes("platform approval") ? 403 : 400
    return NextResponse.json({ error: msg }, { status })
  }

  const bundle = await getWorldCupBracketSettingsBundle(params.data.challengeId)

  return NextResponse.json({
    ok: true,
    settings: bundle,
    hasAfPro,
    hasAfCommissioner: Boolean(isAdmin || hasAfCommissioner),
    isAdmin,
    earlyPublicPicksAllowed: worldCupPublicPicksEarlyGloballyAllowed(),
  })
}
