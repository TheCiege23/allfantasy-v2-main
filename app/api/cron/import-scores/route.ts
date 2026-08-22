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
 *   sport   — "NFL" or "NCAAF". OMITTED MEANS BOTH — see below.
 *   season  — 4-digit year string (defaults to current season)
 *   force   — "true" to skip the 90-second gate (admin/manual use)
 *
 * ⚠ OMITTING `sport` NOW RUNS EVERY SPORT, AND THAT IS THE POINT. This used to
 * default to NFL, so covering NCAAF took a SECOND cron entry pointing at the same
 * route with `?sport=NCAAF` on the identical two-minute schedule. Two Vercel cron
 * slots for one job. The route now iterates the sports itself and vercel.json
 * declares it once.
 *
 * Total provider load is unchanged: the same two sports are fetched on the same
 * cadence, sequentially in one invocation instead of in two. The 90-second gate
 * is keyed per sport, so one sport being gated never suppresses the other.
 *
 * An EXPLICIT `?sport=` still runs exactly that one sport and returns the
 * original single-sport response shape, because admin and manual callers pass it.
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
import { fetchGamesForSport, type ProviderGame } from "@/lib/scores/gameScoreProviders"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
/*
 * ⚠ RAISED BECAUSE ONE INVOCATION NOW DOES BOTH SPORTS. This ran per sport in
 * two separate crons, each with its own budget; folding them into one
 * sequential run roughly doubles the worst-case wall time, and the old ceiling
 * would have started timing out the second sport — which fails silently as a
 * partial sync rather than an obvious error. Vercel's ceiling is 300s.
 */
export const maxDuration = 120

const GATE_SECONDS = 90

type Sport = "NFL" | "NCAAF"

/** Every sport this cron covers when no explicit `sport` is given. */
const ALL_SPORTS: Sport[] = ["NFL", "NCAAF"]

function resolveSport(param: string | null): Sport {
  if (param?.toUpperCase() === "NCAAF") return "NCAAF"
  return "NFL"
}

/** Explicit `?sport=` → just that one. Absent → every sport. */
function resolveSports(param: string | null): Sport[] {
  return param ? [resolveSport(param)] : ALL_SPORTS
}

async function isGated(sport: string): Promise<boolean> {
  try {
    const row = await prisma.sportsGame.findFirst({
      // Any source counts. Keying on api_sports alone meant a successful RI or
      // CFBD sync never satisfied the gate, so every run re-hit the providers.
      where: { sport },
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    })
    if (!row?.fetchedAt) return false
    return Date.now() - row.fetchedAt.getTime() < GATE_SECONDS * 1000
  } catch {
    return false
  }
}

function toWeek(param: string | null): number | undefined {
  if (param == null) return undefined
  const n = Number(param)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

const GAME_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Upsert on (sport, externalId, source) — the table's own unique key — so each
 * provider keeps its own row for a game rather than fighting over one. A score
 * that arrives from two feeds is corroboration, not a conflict, and collapsing
 * them would hide a disagreement.
 */
async function persistGames(
  sport: string,
  source: string,
  games: ProviderGame[],
): Promise<number> {
  let written = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + GAME_TTL_MS)

  for (const g of games) {
    try {
      const data = {
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        status: g.status,
        startTime: g.startTime,
        week: g.week,
        /*
         * ⚠ THE DISCRIMINATOR THAT MAKES `week` MEAN ANYTHING. Preseason week 1
         * and regular week 1 are both stored as `1`; without this column the
         * live-scoring slate query cannot separate them. Rows keep their own
         * source, so a feed that does not report a season type (TheSportsDB)
         * writes null into ITS row rather than erasing what RI reported in a
         * different one.
         */
        seasonType: g.seasonType,
        season: g.season,
        fetchedAt: now,
        expiresAt,
        raw: g.raw as never,
      }
      await prisma.sportsGame.upsert({
        where: { sport_externalId_source: { sport, externalId: g.externalId, source } },
        update: data,
        create: { sport, externalId: g.externalId, source, ...data },
      })
      written += 1
    } catch (e) {
      console.warn(`[cron/import-scores] upsert failed ${source}/${g.externalId}:`, e)
    }
  }
  return written
}

async function runOneSport(url: URL, sport: Sport) {
  const season = url.searchParams.get("season") ?? undefined
  const force = url.searchParams.get("force") === "true"

  const startedAt = Date.now()

  try {
    if (!force && (await isGated(sport))) {
      return {
        ok: true,
        gated: true,
        sport,
        reason: `Last sync was within ${GATE_SECONDS}s — skipping to conserve provider quota.`,
        durationMs: Date.now() - startedAt,
      }
    }

    // API-Sports first, for continuity — but it is plan-blocked for the current
    // season ("Free plans do not have access to this season"), so it reliably
    // returns 0 and the real work happens below.
    clearAPISportsDiagnostics()
    let count = 0
    try {
      count = await syncAPISportsGamesToDb({ season, sport })
    } catch {
      count = 0
    }
    const diagnostics = getAPISportsDiagnostics()

    const seasonYear = Number(season ?? new Date().getFullYear())
    const attempts = await fetchGamesForSport(
      sport,
      Number.isFinite(seasonYear) ? seasonYear : new Date().getFullYear(),
      toWeek(url.searchParams.get("week")),
    )

    const bySource: Record<string, { fetched: number; written: number; error: string | null }> = {}
    for (const attempt of attempts) {
      const written = await persistGames(sport, attempt.source, attempt.games)
      bySource[attempt.source] = {
        fetched: attempt.games.length,
        written,
        error: attempt.error,
      }
      count += written
    }

    return {
      ok: true,
      gated: false,
      sport,
      season: season ?? "current",
      synced: count,
      bySource,
      diagnostics,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron/import-scores] ${sport} failed:`, message)
    return {
      ok: false,
      sport,
      error: message.slice(0, 240),
      durationMs: Date.now() - startedAt,
    }
  }
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const explicit = url.searchParams.get("sport")
  const sports = resolveSports(explicit)

  /*
   * Sequential, not Promise.all: these hit the same rate-limited providers, and
   * the whole reason this route self-gates is to protect that quota. Firing both
   * sports concurrently would undo it.
   *
   * ⚠ ONE SPORT FAILING MUST NOT SUPPRESS THE OTHER. runOneSport catches its own
   * errors and returns a result object rather than throwing, so NCAAF still runs
   * when NFL's provider is down. That is the property the two separate crons had
   * for free, and losing it would be a real regression.
   */
  const results = []
  for (const sport of sports) {
    results.push(await runOneSport(url, sport))
  }

  // Explicit single-sport callers keep the exact response they had before.
  if (explicit) {
    const only = results[0]!
    return NextResponse.json(only, { status: only.ok ? 200 : 500 })
  }

  const anyFailed = results.some((r) => !r.ok)
  return NextResponse.json(
    {
      ok: !anyFailed,
      sports: results,
      timestamp: new Date().toISOString(),
    },
    // A partial failure is still a 500 so the cron shows as failing rather than
    // silently succeeding with one sport missing.
    { status: anyFailed ? 500 : 200 },
  )
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
