import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { submitPlayoffBracketEntry } from "@/lib/playoffs/playoffService"
import { notifyBracketSubmitted } from "@/lib/playoffs/playoffNotificationService"
import { playoffEntryParamsSchema, requireWorldCupApiUser } from "../../../_utils"

export const runtime = "nodejs"

const submitEntrySchema = z.object({
  action: z.literal("submit_entry"),
})

export async function POST(request: Request, context: { params: { challengeId: string; entryId: string } }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = playoffEntryParamsSchema.safeParse(context.params)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = submitEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await submitPlayoffBracketEntry({
      challengeId: params.data.challengeId,
      entryId: params.data.entryId,
      userId: auth.user.id,
    })

    // Fire submit notification non-blocking (load entry name + owner in background)
    const { challengeId, entryId } = params.data
    Promise.allSettled([
      (prisma as any).playoffBracketEntry.findUnique({
        where: { id: entryId },
        select: { name: true },
      }),
      (prisma as any).playoffBracketChallenge.findUnique({
        where: { id: challengeId },
        select: { name: true, ownerUserId: true },
      }),
    ]).then(([entryRes, challengeRes]) => {
      if (entryRes.status !== "fulfilled" || challengeRes.status !== "fulfilled") return
      const entryRow = entryRes.value as { name: string } | null
      const challengeRow = challengeRes.value as { name: string; ownerUserId: string } | null
      if (!entryRow || !challengeRow) return
      notifyBracketSubmitted({
        challengeId,
        challengeName: challengeRow.name,
        entryId,
        entryName: entryRow.name,
        submitterUserId: auth.user.id,
        ownerUserId: challengeRow.ownerUserId,
      }).catch((err) => console.warn("[SubmitRoute] notification error", err))
    }).catch((err) => console.warn("[SubmitRoute] notification lookup error", err))

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to submit bracket entry",
      },
      { status: 400 }
    )
  }
}