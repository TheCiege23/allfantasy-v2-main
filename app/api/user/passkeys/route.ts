import { NextResponse } from "next/server"
import { listPasskeys } from "@/lib/auth/passkeys"
import { signedInUserId, unavailable } from "@/lib/auth/passkeyRequest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The signed-in person's saved passkeys, for Settings → Security. */
export async function GET() {
  const userId = await signedInUserId()
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  const passkeys = await listPasskeys(userId).catch(() => null)
  if (!passkeys) return unavailable()
  return NextResponse.json({ passkeys }, { headers: { "Cache-Control": "no-store" } })
}
