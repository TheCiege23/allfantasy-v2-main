import { NextResponse } from "next/server"
import { deleteWorldCupBracketEntry, getWorldCupBracketEntryDetail, renameWorldCupBracketEntry } from "@/lib/world-cup"
import { getWorldCupAdminState, getWorldCupApiUser, requireWorldCupApiUser, worldCupEntryParamsSchema } from "../../../_utils"

export const runtime = "nodejs"

export async function GET(request: Request, context: { params: Promise<{ challengeId: string; entryId: string }> }) {
  const params = worldCupEntryParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const user = await getWorldCupApiUser()
  const isAdmin = await getWorldCupAdminState(request, user)

  const detail = await getWorldCupBracketEntryDetail({
    entryId: params.data.entryId,
    userId: user?.id,
    isAdmin,
  })

  if (!detail) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 })
  }

  if (detail.challengeId !== params.data.challengeId) {
    return NextResponse.json({ error: "Entry not in this challenge" }, { status: 400 })
  }

  return NextResponse.json({ entry: detail })
}

export async function PATCH(request: Request, context: { params: Promise<{ challengeId: string; entryId: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupEntryParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const name = typeof body?.name === "string" ? body.name : ""
  if (!name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 })
  }
  if (name.trim().length > 40) {
    return NextResponse.json({ error: "Name must be 40 characters or fewer" }, { status: 400 })
  }

  try {
    const existing = await getWorldCupBracketEntryDetail({
      entryId: params.data.entryId,
      userId: auth.user.id,
    })
    if (!existing || existing.challengeId !== params.data.challengeId) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }
    const entry = await renameWorldCupBracketEntry({
      entryId: params.data.entryId,
      userId: auth.user.id,
      name,
    })
    return NextResponse.json({ ok: true, entry })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to rename entry"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ challengeId: string; entryId: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupEntryParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  try {
    const existing = await getWorldCupBracketEntryDetail({
      entryId: params.data.entryId,
      userId: auth.user.id,
    })
    if (!existing || existing.challengeId !== params.data.challengeId) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }
    await deleteWorldCupBracketEntry({ entryId: params.data.entryId, userId: auth.user.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete entry"
    const status = message.toLowerCase().includes("locked") ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
