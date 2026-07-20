/**
 * GET/POST /api/cron/import-projections
 *
 * Vercel Cron schedule: see vercel.json.
 * Closes the projections scheduled-ingest gap: previously `FantasyProjection`
 * was only ever written by dev/test seed scripts — live projection data flowed
 * on-demand through lib/workers/api-chain.ts (fetchWithChain) but was used only
 * as ephemeral enrichment input (see lib/workers/sports-data-importer.ts), never
 * persisted. This handler fetches via the same chain (ClearSports is currently
 * the only provider exposing a `projections` dataType — see
 * lib/workers/providers/clearsports.ts) and writes real rows so the per-feed
 * health chip's Projections domain can read a genuine, advancing `fetchedAt`.
 *
 * Cleanly no-ops outside each sport's active season (Aug season kickoff through
 * the following Feb) so the health chip's honest "idle" reading during the NFL
 * offseason stays a no-op, not an error.
 *
 * Optional query params:
 *   sport  — "NFL", "NCAAF", or "all" (default)
 *   season — 4-digit year string (defaults to the current NFL/NCAAF season)
 *   force  — "true" to ingest even during the offseason (admin/manual use)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { fetchWithChain } from "@/lib/workers/api-chain"
import { prisma } from "@/lib/prisma"
import { toPrismaJsonInput } from "@/lib/prisma-json"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 120

type ProjectionSport = "NFL" | "NCAAF"

const SCORING_PRESET_ID = "ppr"
const PROJECTION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Preseason through championship for each sport — see lib/sport-defaults/SeasonCalendarResolver.ts. */
const SEASON_ACTIVE_MONTHS: Record<ProjectionSport, readonly number[]> = {
  NFL: [8, 9, 10, 11, 12, 1, 2],
  NCAAF: [8, 9, 10, 11, 12, 1],
}

function resolveSports(param: string | null): ProjectionSport[] {
  const value = param?.toUpperCase()
  if (value === "NFL" || value === "NCAAF") return [value]
  return ["NFL", "NCAAF"]
}

/** NFL/NCAAF seasons are named for the year they kick off in (Aug — spans into the next calendar year). */
function currentSeason(): string {
  const now = new Date()
  const month = now.getMonth() + 1
  return String(month >= 8 ? now.getFullYear() : now.getFullYear() - 1)
}

function isInSeason(sport: ProjectionSport, now = new Date()): boolean {
  return SEASON_ACTIVE_MONTHS[sport].includes(now.getMonth() + 1)
}

/** Best-effort week when the provider row doesn't include one — not used for freshness (fetchedAt is). */
function approximateCurrentWeek(now = new Date()): number {
  const seasonStart = new Date(now.getFullYear(), 8, 1) // September 1
  const diffDays = Math.floor((now.getTime() - seasonStart.getTime()) / 86_400_000)
  const week = Math.floor(diffDays / 7) + 1
  return Math.min(22, Math.max(1, week))
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function persistProjectionRows(
  sport: ProjectionSport,
  season: string,
  rows: Array<Record<string, unknown>>,
  source: string
): Promise<number> {
  let written = 0
  for (const row of rows) {
    const providerId = String(row.playerId ?? row.id ?? row.player_id ?? "").trim()
    const playerName = String(row.name ?? row.playerName ?? row.player ?? "").trim()
    if (!providerId && !playerName) continue

    const projectedPoints = toFiniteNumber(
      row.projectedPoints ?? row.points ?? row.fpts ?? row.fantasyPoints ?? row.projection
    )
    if (projectedPoints == null) continue

    const playerId = providerId || `${sport}:${playerName.toLowerCase().replace(/\s+/g, "-")}`
    const week = toFiniteNumber(row.week) ?? approximateCurrentWeek()
    const fetchedAt = new Date()
    const expiresAt = new Date(fetchedAt.getTime() + PROJECTION_TTL_MS)

    try {
      await prisma.fantasyProjection.upsert({
        where: {
          uniq_fantasy_projection_player_week_scoring_source: {
            playerId,
            sport,
            season,
            week,
            scoringPresetId: SCORING_PRESET_ID,
            source,
          },
        },
        update: {
          projectedPoints,
          stats: toPrismaJsonInput(row),
          fetchedAt,
          expiresAt,
        },
        create: {
          playerId,
          sport,
          season,
          week,
          scoringPresetId: SCORING_PRESET_ID,
          projectedPoints,
          stats: toPrismaJsonInput(row),
          source,
          fetchedAt,
          expiresAt,
        },
      })
      written += 1
    } catch (e) {
      console.warn(`[cron/import-projections] failed to upsert ${sport} projection row:`, e)
    }
  }
  return written
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sports = resolveSports(url.searchParams.get("sport"))
  const season = url.searchParams.get("season") ?? currentSeason()
  const force = url.searchParams.get("force") === "true"

  const startedAt = Date.now()
  const results: Record<string, unknown> = {}

  try {
    for (const sport of sports) {
      if (!force && !isInSeason(sport)) {
        results[sport] = {
          ok: true,
          skipped: true,
          reason: `${sport} is in its offseason — no-op so the health chip stays honestly idle, not errored.`,
        }
        continue
      }

      const chainResult = await fetchWithChain({
        sport: sport.toLowerCase(),
        dataType: "projections",
        query: { season },
        forceRefresh: true,
      })

      const rows = Array.isArray(chainResult.data)
        ? chainResult.data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        : []

      if (rows.length === 0) {
        results[sport] = {
          ok: !chainResult.error,
          synced: 0,
          error: chainResult.error ?? null,
        }
        continue
      }

      const synced = await persistProjectionRows(sport, season, rows, chainResult.source ?? "clearsports")
      results[sport] = { ok: true, synced, source: chainResult.source ?? null }
    }

    return NextResponse.json({
      ok: true,
      season,
      results,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-projections] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
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
