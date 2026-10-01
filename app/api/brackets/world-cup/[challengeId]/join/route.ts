import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { joinWorldCupChallengeByInvite } from "@/lib/world-cup"
import { revalidateWorldCupJoinSurfaces } from "@/lib/world-cup/worldCupRevalidation"
import { requireWorldCupApiUser, worldCupChallengeParamsSchema } from "../../_utils"

export const runtime = "nodejs"

export async function POST(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const joinPassword =
    typeof (body as { joinPassword?: unknown }).joinPassword === "string"
      ? (body as { joinPassword: string }).joinPassword
      : undefined

  const challenge = await (prisma as any).worldCupBracketChallenge.findUnique({
    where: { id: params.data.challengeId },
    select: { inviteCode: true },
  })
  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  try {
    const result = await joinWorldCupChallengeByInvite({
      inviteCode: challenge.inviteCode,
      user: auth.user,
      joinPassword,
    })
    revalidateWorldCupJoinSurfaces({
      challengeId: result.challengeId,
      inviteCode: challenge.inviteCode,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to join bracket"
    const lower = message.toLowerCase()
    const status = lower.includes("invalid join password") ? 401 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
