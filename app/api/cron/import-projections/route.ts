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
import { getWeekBoard } from "@/lib/sports-data/sleeperMarketService"

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
/**
 * Whether a real projection source exists for the sport AT ALL.
 *
 * NFL has one (Sleeper, below). NCAAF does not: measured 2026-08-13, every
 * provider in the chain fails for `projections`, and CollegeFootballData — the
 * only NCAAF feed we hold a key for — returns 404 for both /projections/player
 * and /player/injuries. There is nothing to import.
 *
 * That distinction matters operationally. A sport with no source is not a
 * failing sport: reporting it as an error forever teaches the operator to
 * ignore this cron, which is exactly how the next REAL failure gets missed.
 */
const HAS_PROJECTION_SOURCE: Record<ProjectionSport, boolean> = {
  NFL: true,
  NCAAF: false,
}

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

/**
 * Real NFL projections from Sleeper.
 *
 * The provider chain (Rolling Insights -> ClearSports -> TheSportsDB ->
 * API-Sports -> Sleeper chain adapter) reports "All providers failed" for
 * projections, which is why fantasy_projections sat at 0 rows while the cron
 * ran daily. This is the same feed lib/sports-data/sleeperMarketService already
 * uses for stat boards, and it returns real rows today (3,111 for 2026 wk1).
 *
 * The FULL stat line is carried through, not just pts_ppr, because
 * fantasy_projections.stats is JSON and scoreStatLine can then rescore a
 * projection under a league's own settings — a TE-premium league should not
 * read a generic PPR number for its tight end.
 */
async function fetchSleeperNflProjections(
  season: string,
  week: number,
): Promise<Array<Record<string, unknown>>> {
  const board = await getWeekBoard(season, week)
  if (!board) return []
  const rows: Array<Record<string, unknown>> = []
  for (const p of Object.values(board.players)) {
    const points = p.stats?.pts_ppr
    if (typeof points !== "number" || !Number.isFinite(points)) continue
    rows.push({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      team: p.team,
      week,
      projectedPoints: points,
      // Preserved so consumers can rescore under league settings.
      stats: p.stats,
    })
  }
  return rows
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
      if (!HAS_PROJECTION_SOURCE[sport]) {
        results[sport] = {
          ok: true,
          skipped: true,
          reason:
            `No projection source exists for ${sport}. Every chain provider fails for ` +
            `projections, and CollegeFootballData returns 404 for /projections/player. ` +
            `Reported as idle rather than failed so a real failure elsewhere stays visible.`,
        }
        continue
      }

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

      let rows = Array.isArray(chainResult.data)
        ? chainResult.data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        : []
      let usedSource = chainResult.source ?? "chain"

      // The chain is tried first so a recovered provider is preferred, but it has
      // been failing outright — fall back to the Sleeper feed that actually works
      // rather than leaving the table empty for another day.
      if (rows.length === 0 && sport === "NFL") {
        // NOT toFiniteNumber(searchParams.get("week")): Number(null) is 0 and
        // Number.isFinite(0) is true, so an absent param resolved to week 0 —
        // a real Sleeper board (7,620 players) that carries ZERO pts_ppr because
        // preseason has no projections. It synced nothing and looked like the
        // provider failing again.
        const weekParam = url.searchParams.get("week")
        const parsedWeek = weekParam == null ? null : toFiniteNumber(weekParam)
        const week = parsedWeek != null && parsedWeek > 0 ? parsedWeek : approximateCurrentWeek()
        rows = await fetchSleeperNflProjections(season, week)
        if (rows.length > 0) usedSource = "sleeper"
      }

      if (rows.length === 0) {
        /**
         * An empty ingest during an ACTIVE season is a FAILURE, not a quiet
         * success. Reporting `ok: !chainResult.error` here is precisely what let
         * production run with an empty `fantasy_projections` table: the provider
         * returned nothing WITHOUT setting an error, so this evaluated to
         * `ok: true`, the cron returned 200, the health chip's Projections domain
         * read a `fetchedAt` that never advanced, and every downstream surface
         * (Player Command Center, replacement options, Chimmy's cited numbers,
         * Draft VORP, three war rooms) rendered "unavailable" with nobody told.
         *
         * Degrading gracefully and telling the operator are different jobs. This
         * is the second.
         */
        const emptyIsFailure = isInSeason(sport)
        results[sport] = {
          ok: !emptyIsFailure,
          synced: 0,
          error:
            chainResult.error ??
            (emptyIsFailure
              ? `No projection rows for ${sport} ${season} (provider: ${chainResult.source ?? "none"}). ` +
                `${sport} is in season, so an empty ingest is a failure, not an idle no-op.`
              : null),
        }
        continue
      }

      const synced = await persistProjectionRows(sport, season, rows, usedSource)
      // Report the source that actually produced the rows, not the chain's idea
      // of one — otherwise a Sleeper-sourced ingest reads as a chain success and
      // hides that the chain is still broken.
      results[sport] = { ok: true, synced, source: usedSource, chainSource: chainResult.source ?? null }
    }

    // Surface failure at the TOP level too, and with a non-2xx status — Vercel's
    // cron dashboard keys off the HTTP status, so a 200 body containing
    // `ok: false` would still read as a healthy run.
    const failed = Object.entries(results)
      .filter(([, r]) => (r as { ok?: boolean }).ok === false)
      .map(([sport]) => sport)

    return NextResponse.json(
      {
        ok: failed.length === 0,
        season,
        failedSports: failed.length ? failed : undefined,
        results,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: failed.length ? 500 : 200 },
    )
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
