/**
 * GET/POST /api/cron/import-scores
 *
 * Vercel Cron schedule: every 2 minutes (see vercel.json).
 * Syncs NFL/NCAAF game results from API-Sports into the sportsGame table.
 * Fires on every execution but self-gates: if the most-recent sportsGame row
 * was fetched within the last 90 seconds the handler returns early without
 * calling the provider, protecting the API-Sports daily quota.
 *
 * Optional query params:
 *   sport   — "NFL" (default) or "NCAAF"
 *   season  — 4-digit year string (defaults to current season)
 *   force   — "true" to skip the 90-second gate (admin/manual use)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import {
  syncAPISportsGamesToDb,
  clearAPISportsDiagnostics,
  getAPISportsDiagnostics,
} from "@/lib/api-sports"
import { prisma } from "@/lib/prisma"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 60

const GATE_SECONDS = 90

function resolveSport(param: string | null): "NFL" | "NCAAF" {
  if (param?.toUpperCase() === "NCAAF") return "NCAAF"
  return "NFL"
}

async function isGated(sport: string): Promise<boolean> {
  try {
    const row = await prisma.sportsGame.findFirst({
      where: { sport, source: "api_sports" },
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    })
    if (!row?.fetchedAt) return false
    return Date.now() - row.fetchedAt.getTime() < GATE_SECONDS * 1000
  } catch {
    return false
  }
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sport = resolveSport(url.searchParams.get("sport"))
  const season = url.searchParams.get("season") ?? undefined
  const force = url.searchParams.get("force") === "true"

  const startedAt = Date.now()

  try {
    if (!force && (await isGated(sport))) {
      return NextResponse.json({
        ok: true,
        gated: true,
        sport,
        reason: `Last sync was within ${GATE_SECONDS}s — skipping to conserve provider quota.`,
        durationMs: Date.now() - startedAt,
      })
    }

    clearAPISportsDiagnostics()
    const count = await syncAPISportsGamesToDb({ season, sport })
    const diagnostics = getAPISportsDiagnostics()

    return NextResponse.json({
      ok: true,
      gated: false,
      sport,
      season: season ?? "current",
      synced: count,
      diagnostics,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-scores] failed:", message)
    return NextResponse.json(
      { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
