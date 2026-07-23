import { NextResponse } from "next/server"
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit"
import { logUsageEvent, withApiUsage } from "@/lib/telemetry/usage"

export const dynamic = "force-dynamic"

/**
 * POST: client-side tool-usage ingest.
 *
 * NOT admin-gated despite living under /api/admin — the callers are ordinary
 * end users: app/hooks/useAnalytics.ts (trackToolUse) and lib/telemetry/client.ts
 * (logLegacyToolUsage). Adding requireAdmin() here would silently drop all
 * real traffic, which is the opposite of the intent.
 *
 * It is rate limited instead: every accepted call writes one ApiUsageEvent row
 * and upserts four ApiUsageRollup buckets (hour/day/week/month), so an unbounded
 * anonymous endpoint is a write-amplification vector. Both callers are
 * fire-and-forget (`.catch{}`, keepalive), so a 429 is invisible to the user.
 */
export const POST = withApiUsage({ endpoint: "/api/admin/usage/log", tool: "AdminUsageLog" })(
  async (req: Request) => {
    // includeIpInKey is required: these callers send no username, so without it
    // every anonymous visitor shares one global bucket platform-wide.
    const limit = consumeRateLimit({
      scope: "telemetry",
      action: "usage_log",
      ip: getClientIp(req),
      includeIpInKey: true,
      maxRequests: 120,
      windowMs: 60_000,
    })

    if (!limit.success) {
      return NextResponse.json(
        { ok: false, error: "Rate limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      )
    }

    const body = await req.json().catch(() => ({} as any))

    // Bound what a client can persist — `tool` is a grouping key in the admin
    // panel and `meta` lands in a Json column.
    const tool = body?.tool ? String(body.tool).slice(0, 120) : "Unknown"
    const leagueId = body?.leagueId ? String(body.leagueId).slice(0, 120) : undefined
    const meta = body?.meta ?? null
    const safeMeta =
      meta && typeof meta === "object" && JSON.stringify(meta).length <= 4000 ? meta : null

    await logUsageEvent({
      scope: "legacy_tool",
      tool,
      leagueId,
      ok: true,
      meta: safeMeta,
    })

    return NextResponse.json({ ok: true })
  }
)
