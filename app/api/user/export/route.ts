import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-guard"
import { prisma } from "@/lib/prisma"
import { buildRateLimit429, consumeRateLimit } from "@/lib/rate-limit"
import { buildUserDataExport, serializeUserDataExport } from "@/lib/user-data-export/buildUserDataExport"

export const dynamic = "force-dynamic"

/**
 * GET /api/user/export — "Download my data" (Settings › Account).
 *
 * Returns everything AllFantasy holds about the signed-in account as a JSON file download. What is
 * in it, what is deliberately left out and why, and the secret-safety rule (every read names its
 * fields) all live in lib/user-data-export/buildUserDataExport.ts.
 *
 * The gate is a session only — an account must be able to get its own data out without first
 * confirming its age or verifying an email.
 */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  // ~30 table reads per call: generous for a person, useless for a scraper.
  const rl = consumeRateLimit({
    scope: "user",
    action: "data_export",
    sleeperUsername: auth.userId,
    maxRequests: 5,
    windowMs: 60 * 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(
      buildRateLimit429({ message: "You've downloaded your data a few times recently — try again in an hour.", rl }),
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    )
  }

  const now = new Date()
  const data = await buildUserDataExport(prisma, auth.userId, now)
  if (!data.account) {
    const failed = data.unavailableSections.includes("account")
    return NextResponse.json(
      { error: failed ? "Your data could not be gathered. Please try again." : "Not found" },
      { status: failed ? 503 : 404 },
    )
  }

  const day = now.toISOString().slice(0, 10)
  return new NextResponse(serializeUserDataExport(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="allfantasy-data-${day}.json"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  })
}
