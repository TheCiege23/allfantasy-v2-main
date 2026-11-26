import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { legacyRedraftWaiverClaimsRetiredResponse } from "@/lib/redraft/legacyWaiverClaimsRetired"

/**
 * Retired 2026-11-26. This route only ever wrote claims to the old redraft waiver table, and nothing in
 * the app calls it. Claims go through the main waiver system now (lib/redraft/legacyWaiverClaimsRetired.ts).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = (await req.json().catch(() => null)) as { leagueId?: string } | null
  return legacyRedraftWaiverClaimsRetiredResponse(body?.leagueId ?? null)
}
