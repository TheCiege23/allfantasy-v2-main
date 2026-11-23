import { NextResponse } from "next/server"
import { removePasskey } from "@/lib/auth/passkeys"
import { signedInUserId, unavailable } from "@/lib/auth/passkeyRequest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Removes one of the signed-in person's passkeys. Someone else's id is a 404, same as a missing one. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await signedInUserId()
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  const { id } = await params
  const removed = await removePasskey(userId, id).catch(() => null)
  if (removed === null) return unavailable()
  if (!removed) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
