import { NextResponse } from "next/server"
import { z } from "zod"
import { requireWorldCupApiUser } from "../../../_utils"
import { CoachAccessError, loadCoachView } from "@/lib/playoffs/bracketCoachService"
import { saveBracketAlerts } from "@/lib/playoffs/bracketExperienceService"
import { getServedOrigin } from "@/lib/http/served-origin"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const schema = z.object({ enabled: z.boolean(), missingPicks: z.boolean(), locks: z.boolean(), results: z.boolean(), rankChanges: z.boolean(), spoilerSafe: z.boolean(), leadMinutes: z.union([z.literal(15),z.literal(30),z.literal(60)]), locale: z.enum(["en","es"]) }).strict()
export async function PUT(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" }
  // Cookie sessions may only change settings from this site's origin. Native token requests have no Origin.
  const origin = request.headers.get("origin")
  if (origin && origin !== getServedOrigin(request)) return NextResponse.json({ code: "ORIGIN_REJECTED" },{ status: 403, headers })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_ALERT_PREFERENCES" },{ status: 400, headers })
  try {
    const { challengeId } = await context.params
    const view = await loadCoachView({ challengeId, user: auth.user })
    if (!view.challenge || !(view.challenge.sport === "nba_cup" || view.challenge.sport === "ncaaf" && process.env.BRACKET_AUTO_RESULT_SYNC_ENABLED === "true") || view.challenge.isTestMode) return NextResponse.json({ code: "SCHEDULED_ALERTS_UNSUPPORTED" }, { status: 400, headers })
    const alerts = await saveBracketAlerts(auth.user.id,challengeId,parsed.data)
    return NextResponse.json({ alerts }, { headers })
  } catch (error) {
    return NextResponse.json({ code: error instanceof CoachAccessError ? "POOL_ACCESS_REQUIRED" : "PREFERENCES_UNAVAILABLE" }, { status: error instanceof CoachAccessError ? error.status : 503, headers })
  }
}
