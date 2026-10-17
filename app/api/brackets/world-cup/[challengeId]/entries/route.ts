import { NextResponse } from "next/server"
import { createWorldCupBracketEntry, listWorldCupBracketEntries } from "@/lib/world-cup"
import { prisma } from "@/lib/prisma"
import { requireWorldCupApiUser, worldCupChallengeParamsSchema } from "../../_utils"
import { buildWorldCupBracketLeadMetaEvent } from "@/lib/world-cup/worldCupMetaEvents"
import { trackMetaServerEvent } from "@/lib/meta-capi"

export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const entries = await listWorldCupBracketEntries({
    challengeId: params.data.challengeId,
    userId: auth.user.id,
  })

  return NextResponse.json({ entries })
}

export async function POST(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const name = typeof body?.name === "string" ? body.name : undefined

  try {
    const entry = await createWorldCupBracketEntry({
      challengeId: params.data.challengeId,
      userId: auth.user.id,
      name: name ?? null,
    })
    const challenge = (prisma as any).worldCupBracketChallenge?.findUnique
      ? await prisma.worldCupBracketChallenge.findUnique({
          where: { id: params.data.challengeId },
          select: { name: true },
        }).catch(() => null)
      : null
    const metaEvent = buildWorldCupBracketLeadMetaEvent({
      challengeId: params.data.challengeId,
      entryId: entry.id,
      entryName: entry.name,
      poolName: challenge?.name ?? null,
    })
    await trackMetaServerEvent({
      eventName: metaEvent.eventName,
      eventId: metaEvent.eventId,
      customData: metaEvent.customData,
      email: auth.user.email ?? null,
      userId: auth.user.id,
      request,
      source: "world_cup_entry_create",
    }).catch((metaError) => {
      console.warn("[world-cup/entries] Meta Lead failed:", metaError)
    })
    return NextResponse.json({ ok: true, entry, metaEvent })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create entry"
    const status = message.toLowerCase().includes("maximum") ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
