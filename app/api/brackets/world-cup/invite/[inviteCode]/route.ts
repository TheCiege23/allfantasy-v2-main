import { NextResponse } from "next/server"
import {
  getWorldCupChallengeByInvite,
  joinWorldCupChallengeByInvite,
} from "@/lib/world-cup"
import { revalidateWorldCupJoinSurfaces } from "@/lib/world-cup/worldCupRevalidation"
import { requireWorldCupApiUser, worldCupInviteParamsSchema } from "../../_utils"

export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ inviteCode: string }> }) {
  const params = worldCupInviteParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 400 })
  }

  const invite = await getWorldCupChallengeByInvite(params.data.inviteCode)
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 })
  }

  return NextResponse.json({ invite })
}

export async function POST(request: Request, context: { params: Promise<{ inviteCode: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupInviteParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const joinPassword =
    typeof (body as { joinPassword?: unknown }).joinPassword === "string"
      ? (body as { joinPassword: string }).joinPassword
      : undefined

  try {
    const result = await joinWorldCupChallengeByInvite({
      inviteCode: params.data.inviteCode,
      user: auth.user,
      joinPassword,
    })
    revalidateWorldCupJoinSurfaces({
      challengeId: result.challengeId,
      inviteCode: params.data.inviteCode,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to join bracket"
    const lower = message.toLowerCase()
    const status = lower.includes("invalid join password") ? 401 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
