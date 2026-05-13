import { NextResponse } from "next/server"
import { z } from "zod"
import { createPlayoffBracketEntry, getPlayoffBracketView } from "@/lib/playoffs/playoffService"
import { prisma } from "@/lib/prisma"
import { playoffChallengeParamsSchema, requireWorldCupApiUser } from "../_utils"

export const runtime = "nodejs"

function toInviteCode(challengeId: string): string {
  return challengeId.slice(0, 8).toUpperCase()
}

const challengeActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_entry"),
    name: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    action: z.literal("join"),
    /** Invite code — must match the challenge's derived invite code */
    inviteCode: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(80).optional(),
  }),
])

export async function GET(request: Request, context: { params: { challengeId: string } }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = playoffChallengeParamsSchema.safeParse(context.params)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const view = await getPlayoffBracketView({
    challengeId: params.data.challengeId,
    user: auth.user,
    requestedEntryId: new URL(request.url).searchParams.get("entryId"),
  })

  if (!view) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, view })
}

export async function POST(request: Request, context: { params: { challengeId: string } }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = playoffChallengeParamsSchema.safeParse(context.params)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = challengeActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  if (parsed.data.action === "create_entry") {
    try {
      const result = await createPlayoffBracketEntry({
        challengeId: params.data.challengeId,
        user: auth.user,
        name: parsed.data.name,
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to create entry" },
        { status: 400 }
      )
    }
  }

  if (parsed.data.action === "join") {
    const { challengeId } = params.data
    const { inviteCode, name } = parsed.data

    const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
      where: { id: challengeId },
      select: { id: true, status: true },
    })

    if (!challenge) {
      return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
    }

    const expectedCode = toInviteCode(challengeId)
    if (inviteCode.toUpperCase() !== expectedCode) {
      return NextResponse.json({ error: "Invalid invite code" }, { status: 400 })
    }

    if (challenge.status === "closed") {
      return NextResponse.json({ error: "This pool is no longer accepting entries" }, { status: 400 })
    }

    // Check for duplicate join (same user already has an entry)
    const existingEntry = await (prisma as any).playoffBracketEntry.findFirst({
      where: { challengeId, userId: auth.user?.id },
      select: { id: true },
    })

    if (existingEntry) {
      return NextResponse.json({
        ok: true,
        joined: false,
        message: "Already a member of this pool",
        challengeId,
        entryId: existingEntry.id,
        redirectUrl: `/brackets/leagues/${challengeId}`,
      })
    }

    try {
      const result = await createPlayoffBracketEntry({
        challengeId,
        user: auth.user,
        name,
      })
      return NextResponse.json({ ok: true, joined: true, ...result })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to join pool" },
        { status: 400 }
      )
    }
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 })
}
