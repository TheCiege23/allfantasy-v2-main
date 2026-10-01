/**
 * Phase 2C Batch 3 — Shared current-week resolver for chimmy-context.
 *
 * Resolves `{ season, week, source, playoffStartWeek, isPlayoffWeek,
 * weeksUntilPlayoffs }` for a league using a deterministic fall-back chain.
 * Pure read, fail-safe, never throws. Memoised on `request.perRequestMemo`
 * so MatchupContextProvider (and future providers) share a single resolution.
 *
 * Cascade (in priority order):
 *   1. RedraftSeason.currentWeek (AF-native redraft)
 *   2. TeamWeekResult MAX(week WHERE status='final') + 1 (any AF-scored league)
 *   3. WeeklyMatchup MAX(week WHERE seasonYear === league.season) + 1 (Sleeper)
 *   4. League.settings JSON heuristic (current_week / currentWeek / leg)
 *   5. Fallback to 1
 *   Then, for an NFL league in the season under way, the calendar is a floor under 4 and 5.
 *
 * Playoff context (best-effort, never throws):
 *   - playoffStartWeek prefers RedraftSeason.playoffStartWeek when available,
 *     else League.playoffStartWeek (Int? @default(14)), else null.
 *   - isPlayoffWeek = week >= playoffStartWeek (when both known), else false.
 *   - weeksUntilPlayoffs = max(0, playoffStartWeek - week) when both known.
 */

import { prisma } from "@/lib/prisma"
import { nflWeekForDate } from "@/lib/import-os/season"
import type { ChimmyContextRequest } from "@/lib/chimmy-context/types"

export type CurrentWeekSource =
  | "requestOverride"
  | "redraftSeason"
  | "teamWeekResult"
  | "weeklyMatchup"
  | "leagueSettings"
  | "fallback"
  | "nflCalendar"

export type ResolvedCurrentWeek = {
  leagueId: string
  season: number
  week: number
  source: CurrentWeekSource
  playoffStartWeek: number | null
  isPlayoffWeek: boolean
  weeksUntilPlayoffs: number | null
}

export type ResolveCurrentWeekArgs = {
  leagueId: string
  /** Optional explicit week override (e.g. tests / debug). */
  week?: number | null
  /** Optional explicit season override. */
  season?: number | null
  /** Optional shared memo from the chimmy-context request. */
  memo?: Map<string, unknown>
  /** The clock, for tests. */
  now?: Date
}

const MEMO_KEY = "chimmyContext:currentWeek"

function memoKey(leagueId: string): string {
  return `${MEMO_KEY}:${leagueId}`
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

/**
 * `current_week` first, `leg` last — the order `lib/core-app/seasonTimeline.ts` already reads them in.
 *
 * 🛑 `leg` IS STALE ON AN IMPORTED SLEEPER LEAGUE. The legacy importer stored Sleeper's raw settings
 * (with `leg`) at the root, and the collector's refresh merges fresh settings OVER them — fresh
 * `current_week`, but no `leg` — so a preseason `leg: 1` survives all season. Read first, it made
 * Chimmy say "Week 1 of 2026, 14 weeks until playoffs" on 2026-09-30.
 */
function weekFromLeagueSettings(settings: unknown): number | null {
  const root = toJsonRecord(settings)
  const nested =
    root.settings && typeof root.settings === "object" && !Array.isArray(root.settings)
      ? (root.settings as Record<string, unknown>)
      : null
  const candidates: unknown[] = [
    nested?.current_week,
    root.current_week,
    nested?.currentWeek,
    root.currentWeek,
    nested?.leg,
    root.leg,
  ]
  for (const raw of candidates) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
      return Math.min(Math.floor(raw), 53)
    }
    if (typeof raw === "string") {
      const n = Number.parseInt(raw, 10)
      if (Number.isFinite(n) && n >= 1) return Math.min(n, 53)
    }
  }
  return null
}

function clampWeek(w: number | null | undefined): number | null {
  if (w == null || !Number.isFinite(w)) return null
  const n = Math.floor(w)
  if (n < 1) return null
  return Math.min(n, 53)
}

function currentNflSeason(now: Date): number {
  // NFL season conventionally rolls over in August.
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1 // 1-12
  return m >= 8 ? y : y - 1
}

/**
 * The NFL regular-season week the calendar is in, MINUS ONE, or null outside the regular season.
 *
 * A floor, not an answer: `nflWeekForDate` is a calendar estimate (Week 1 on Sep 4) that runs up to
 * a week ahead of Sleeper's own week at the turnover, so one week of slack keeps it from ever
 * overstating. It only lifts a week that came from settings or the bare fallback — a week read from
 * the league's own scored results or redraft season is never second-guessed.
 */
export function nflCalendarWeekFloor(now: Date): { season: number; week: number } | null {
  const month = now.getUTCMonth() + 1
  const day = now.getUTCDate()
  const inSeason = (month === 9 && day >= 4) || month >= 10 || (month === 1 && day <= 6)
  if (!inSeason) return null
  const season = month === 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
  return { season, week: Math.max(1, nflWeekForDate(now) - 1) }
}

export async function resolveCurrentWeek(
  args: ResolveCurrentWeekArgs
): Promise<ResolvedCurrentWeek> {
  const { leagueId, memo } = args
  const memoHit = memo?.get(memoKey(leagueId)) as ResolvedCurrentWeek | undefined
  if (memoHit && args.week == null && args.season == null) return memoHit

  // 1. Pull league + redraft-season meta in parallel; both reads are nullable.
  const [league, redraftSeason] = await Promise.all([
    prisma.league
      .findUnique({
        where: { id: leagueId },
        select: { season: true, playoffStartWeek: true, settings: true, sport: true },
      })
      .catch(() => null),
    prisma.redraftSeason
      .findFirst({
        where: { leagueId },
        orderBy: { createdAt: "desc" },
        select: {
          season: true,
          currentWeek: true,
          playoffStartWeek: true,
          totalWeeks: true,
        },
      })
      .catch(() => null),
  ])

  const fallbackSeason =
    args.season ??
    redraftSeason?.season ??
    league?.season ??
    currentNflSeason(new Date())

  let week: number | null = clampWeek(args.week ?? null)
  let source: CurrentWeekSource = week != null ? "requestOverride" : "fallback"

  // 2. RedraftSeason wins when available.
  if (week == null) {
    const rs = clampWeek(redraftSeason?.currentWeek ?? null)
    if (rs != null) {
      week = rs
      source = "redraftSeason"
    }
  }

  // 3. Derive from TeamWeekResult MAX(week WHERE status='final') + 1.
  if (week == null) {
    const latestFinal = await prisma.teamWeekResult
      .findFirst({
        where: { leagueId, season: fallbackSeason, status: "final" },
        orderBy: { week: "desc" },
        select: { week: true },
      })
      .catch(() => null)
    const derived = clampWeek((latestFinal?.week ?? 0) + 1)
    if (derived != null && latestFinal) {
      week = derived
      source = "teamWeekResult"
    }
  }

  // 4. Derive from WeeklyMatchup (Sleeper).
  if (week == null) {
    const latestSleeper = await prisma.weeklyMatchup
      .findFirst({
        where: { leagueId, seasonYear: fallbackSeason },
        orderBy: { week: "desc" },
        select: { week: true },
      })
      .catch(() => null)
    const derived = clampWeek((latestSleeper?.week ?? 0) + 1)
    if (derived != null && latestSleeper) {
      week = derived
      source = "weeklyMatchup"
    }
  }

  // 5. Settings JSON heuristic.
  if (week == null) {
    const fromSettings = weekFromLeagueSettings(league?.settings)
    if (fromSettings != null) {
      week = fromSettings
      source = "leagueSettings"
    }
  }

  // 6. Final fallback.
  if (week == null) {
    week = 1
    source = "fallback"
  }

  // 7. NFL calendar floor under the two sources that can be stale or absent.
  if (source === "leagueSettings" || source === "fallback") {
    // Only for a league read as NFL: an unread league is not assumed to be one.
    const floor = String(league?.sport ?? "").toUpperCase() === "NFL" ? nflCalendarWeekFloor(args.now ?? new Date()) : null
    if (floor && floor.season === fallbackSeason && floor.week > week) {
      week = floor.week
      source = "nflCalendar"
    }
  }

  const playoffStartWeek =
    clampWeek(redraftSeason?.playoffStartWeek ?? null) ??
    clampWeek(league?.playoffStartWeek ?? null)

  const isPlayoffWeek = playoffStartWeek != null && week >= playoffStartWeek
  const weeksUntilPlayoffs =
    playoffStartWeek != null ? Math.max(0, playoffStartWeek - week) : null

  const resolved: ResolvedCurrentWeek = {
    leagueId,
    season: fallbackSeason,
    week,
    source,
    playoffStartWeek,
    isPlayoffWeek,
    weeksUntilPlayoffs,
  }

  if (memo && args.week == null && args.season == null) {
    memo.set(memoKey(leagueId), resolved)
  }
  return resolved
}

export async function resolveCurrentWeekFromRequest(
  request: ChimmyContextRequest,
  leagueId: string
): Promise<ResolvedCurrentWeek> {
  return resolveCurrentWeek({
    leagueId,
    week: request.week ?? null,
    season: request.season ?? null,
    memo: request.perRequestMemo,
  })
}
