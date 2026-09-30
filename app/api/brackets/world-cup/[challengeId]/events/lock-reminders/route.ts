import { NextResponse } from "next/server"
import {
  describeWorldCupLockReminderSchedule,
  getWorldCupChallengeEffectiveLockAt,
  runWorldCupLockRemindersForChallenge,
} from "@/lib/world-cup/worldCupBracketReminderService"
import { prisma } from "@/lib/prisma"
import {
  assertWorldCupManager,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../../_utils"

export const runtime = "nodejs"

/** Preview scheduled reminder windows (commissioner). */
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

  const access = await assertWorldCupManager(
    _request,
    params.data.challengeId,
    auth.user
  )
  if (!access.ok) return access.response

  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: params.data.challengeId },
    select: { pickLockAt: true },
  })

  const eff = challenge
    ? await getWorldCupChallengeEffectiveLockAt(params.data.challengeId)
    : null

  const schedule = describeWorldCupLockReminderSchedule({
    pickLockAt: challenge?.pickLockAt ?? null,
    effectiveLockAt: eff,
  })

  return NextResponse.json({ schedule })
}

/** Run one sweep for this challenge (fires only windows whose clock bucket matches “now”). */
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

  const result = await runWorldCupLockRemindersForChallenge(params.data.challengeId)
  return NextResponse.json({ ok: true, ...result })
}
