import { NextResponse } from "next/server"
import { z } from "zod"
import { finalizeNbaCupDay } from "@/lib/playoffs/playoffService"
import { playoffEntryParamsSchema, requireWorldCupApiUser } from "../../../../_utils"

export const runtime = "nodejs"
const bodySchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timeZone: z.string().min(1).max(100) })

export async function POST(request: Request, context: { params: Promise<{ challengeId: string; entryId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response
  const params = playoffEntryParamsSchema.safeParse(await context.params)
  const body = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!params.success || !body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  try {
    const result = await finalizeNbaCupDay({ ...params.data, ...body.data, userId: auth.user.id })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to finalize this day." }, { status: 400 })
  }
}
