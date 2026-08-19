import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/adminAuth"
import { getCampaignAttributionReport } from "@/lib/admin-dashboard/CampaignAttributionService"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/visitor-analytics/campaigns
 *   ?windowDays=1..365 &platform= &campaign= &content= &limit=
 *
 * Admin-gated social/campaign attribution reporting, sourced exclusively from first-party
 * `AnalyticsEvent` rows. GA4 and Meta Pixel are never read here — they are separate,
 * labeled comparison sources and their estimates are not summed with confirmed events.
 *
 * The gate is enforced HERE, in the route, not by hiding navigation: `requireAdmin()`
 * runs before any query, matching the sibling visitor-analytics route. Every funnel stage
 * without an emitter is reported as `not_implemented` with a null value, never as 0.
 *
 * Returns no per-user records — only aggregates and campaign identifiers the operator
 * themselves created. No emails, tokens, IPs, raw query strings, or another user's data.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const url = new URL(request.url)
  const rawWindow = url.searchParams.get("windowDays")
  const rawLimit = url.searchParams.get("limit")

  try {
    const report = await getCampaignAttributionReport({
      windowDays: rawWindow === null ? undefined : Number(rawWindow),
      platform: url.searchParams.get("platform"),
      campaign: url.searchParams.get("campaign"),
      content: url.searchParams.get("content"),
      limit: rawLimit === null ? undefined : Number(rawLimit),
    })
    return NextResponse.json(report)
  } catch (error) {
    // Surfaced as an explicit failure so the UI renders "query failed", never a zeroed report.
    const message = error instanceof Error ? error.message : "Campaign attribution report failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
