/**
 * The async half of `dailySportSeasonStarts.ts`: derive a daily sport's regular-season opener from
 * the schedule ALREADY IN POSTGRES when the curated table does not list that season yet.
 *
 * WHY. Dynasty leagues roll into `season + 1` every year, and the curated table only ever reaches as
 * far as someone last edited it (NBA/NHL 2026, MLB 2026-27). A year-2 NBA/NHL dynasty league — the
 * 2027-28 season — had no opener, so the week roller held at `NO_WEEK_SIGNAL`, the stat sync and the
 * finalizer declined, and the league never activated or scored. Every dynasty league, every year.
 *
 * WHAT COUNTS AS EVIDENCE — ONLY A GAME THE FEED ITSELF LABELS REGULAR SEASON:
 *   1. the Rolling Insights season schedule cached in `SportsDataCache` (`riScheduleCache.ts`), whose
 *      `seasonType` is the vendor's own `season_type` (MLB, NCAAB today);
 *   2. `SportsGame` rows whose `seasonType` says regular (Rolling Insights live rows carry it);
 *   3. `player_game_stats` rows the Rolling Insights `/live` ingest wrote, whose
 *      `normalizedStatMap.seasonType` is that game's own `season_type`, classified by
 *      `riSeasonType.ts` (`rollingInsightsGameLogs.ts` `normalizedMapFor`).
 * The opener is the EARLIEST such Eastern game day inside a ±21-day window around the estimate.
 *
 * 🛑 SOURCE 3 IS THE ONLY ONE THAT EXISTS FOR NBA AND NHL. `SportsGame.seasonType` is NULL for every
 * NBA/NHL row in production and the season-schedule sync runs for MLB, NCAAB and soccer only (there
 * is no committed NBA/NHL `schedule-season` capture to build one from). Without it, a 2027-28 dynasty
 * season would sit on the estimate forever. Its evidence is the vendor's own per-game label:
 * `contracts/rolling-insights/fixtures/live.NBA.json` and `live.NHL.json` carry
 * `season_type: "Regular Season"` on every game, and `riSeasonType.ts` classifies any label it does
 * not recognise (GAPS.md `N-13`) as `null`, never as regular — so a preseason game cannot be
 * promoted to an opener by a new spelling. The cost: stats exist only once a game is PLAYED and
 * ingested, so this source names the opener on opening night, not before it. Until then the season
 * reports `SEASON_OPENER_UNRECORDED` (seasonWeekService.ts) and the week roller holds, loudly.
 *
 * 🛑 AN UNLABELLED ROW IS NEVER EVIDENCE. Preseason and regular-season NBA/NHL rows are otherwise
 * indistinguishable (`dailySportSeasonStarts.ts` header: NHL preseason 19–27 Sep 2026 is real,
 * ingested, and must never score). "First game after the preseason gap" was considered and rejected:
 * a preseason has gaps of its own — the day before it starts is one — so the heuristic has two
 * candidates on the 2026 NHL data and no principled way to choose.
 *
 * ⚠ WHAT THIS ASSUMES, AND THE CURATED LINE OVERRIDES IT: that the labelled feed was being ingested
 * by opening night. If the first labelled day in Postgres is LATER than the true opener, the anchor is
 * late. The table remains authoritative for exactly that reason — add the line once the opener is
 * published and checked.
 *
 * WHY THE WINDOW IGNORES `SportsGame.season`: NBA/NHL games of one real season are split across
 * `season` 2026 and 2027 in production (see `playerWeeklyScoreService.ts`), so the date range is the
 * only dependable narrowing. ±21 days around the estimate cannot reach the previous season for any
 * sport here (NBA/NHL finals end in June, MLB in early November, NCAAB in April).
 *
 * DB-FIRST: reads Postgres only — no provider call — and takes the client as an argument with a
 * type-only Prisma import, so the client-reachable lineup lock can prime through it too.
 */
import type { PrismaClient } from '@prisma/client'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { readRiScheduleWindow, isoDay } from '@/lib/sports-data/riScheduleCache'
import {
  estimateDailySportSeasonStart,
  isCuratedDailySportSeason,
  recordDerivedDailySportSeasonStart,
  resolveDailySportSeasonStart,
} from './dailySportSeasonStarts'

export type DailySportSeasonStartResolution =
  | { opener: string; source: 'curated' | 'schedule'; estimated: false; detail: string }
  /** No labelled schedule yet. NEVER an anchor — `resolveDailySportSeasonStart` still returns null. */
  | { opener: string; source: 'estimate'; estimated: true; detail: string }
  | { opener: null; source: 'unknown'; estimated: false; detail: string }

export type DeriveSeasonStartDeps = {
  /** `playerGameStat` is optional so a caller holding a narrower client still derives from 1–2. */
  db: Pick<PrismaClient, 'sportsGame' | 'sportsDataCache'> & Partial<Pick<PrismaClient, 'playerGameStat'>>
  now?: Date
}

const DAY_MS = 86_400_000
const WINDOW_DAYS = 21
/** Re-read at most this often per process; a newly published schedule is picked up within it. */
const RECHECK_MS = 15 * 60_000

const checked = new Map<string, { at: number; result: DailySportSeasonStartResolution }>()
const inFlight = new Map<string, Promise<DailySportSeasonStartResolution>>()
const warnedEstimate = new Set<string>()

/** Test seam: forget what this process has checked (does not clear recorded openers). */
export function resetDailySportSeasonStartChecks(): void {
  checked.clear()
  inFlight.clear()
  warnedEstimate.clear()
}

const isRegular = (raw: unknown) => {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'regular' || v === 'regular season' || v === 'reg' || v === '2'
}

async function earliestLabelledRegularDay(
  sport: string,
  season: number,
  window: { start: Date; end: Date },
  db: DeriveSeasonStartDeps['db'],
): Promise<{ day: string; evidence: string } | null> {
  const candidates: Array<{ day: string; evidence: string }> = []

  // 1. The vendor's complete season schedule, where one is synced. `null` = never synced.
  if (db.sportsDataCache) {
    const games = await readRiScheduleWindow(db as never, { sport, season, window })
    const days = (games ?? [])
      .filter((g) => g.seasonType === 'regular' && !g.replacedBy)
      .map((g) => g.day)
      .sort()
    if (days[0]) candidates.push({ day: days[0], evidence: 'rolling_insights season schedule' })
  }

  // 2. Live/schedule rows the feed labelled. A one-day margin on each side, then bucketed by the
  //    US Eastern day the week arithmetic uses.
  const rows = await db.sportsGame.findMany({
    where: {
      sport,
      startTime: { gte: new Date(window.start.getTime() - DAY_MS), lt: new Date(window.end.getTime() + DAY_MS) },
    },
    select: { startTime: true, seasonType: true },
  })
  const days = rows
    .filter((r) => isRegular(r.seasonType))
    .map((r) => easternCalendarDay(r.startTime))
    .filter((d): d is Date => d != null && d.getTime() >= window.start.getTime() && d.getTime() < window.end.getTime())
    .map(isoDay)
    .sort()
  if (days[0]) candidates.push({ day: days[0], evidence: 'SportsGame rows labelled regular' })

  // 3. Played games the RI `/live` ingest stored with the vendor's per-game label. `game_date` is
  //    already the US Eastern day (a DATE column), so it needs no re-bucketing.
  if (db.playerGameStat) {
    const first = await db.playerGameStat.findFirst({
      where: {
        sportType: sport,
        gameDate: { gte: window.start, lt: window.end },
        normalizedStatMap: { path: ['seasonType'], equals: 'regular' },
      },
      orderBy: { gameDate: 'asc' },
      select: { gameDate: true },
    })
    if (first?.gameDate) candidates.push({ day: isoDay(first.gameDate), evidence: 'Rolling Insights /live game stats labelled regular' })
  }

  candidates.sort((a, b) => a.day.localeCompare(b.day))
  return candidates[0] ?? null
}

async function derive(sport: string, season: number, deps: DeriveSeasonStartDeps): Promise<DailySportSeasonStartResolution> {
  const estimate = estimateDailySportSeasonStart(sport, season)
  if (!estimate) {
    return { opener: null, source: 'unknown', estimated: false, detail: `no curated ${sport} ${season} opener and none can be derived for this sport/season` }
  }
  const centre = Date.parse(estimate)
  const window = { start: new Date(centre - WINDOW_DAYS * DAY_MS), end: new Date(centre + (WINDOW_DAYS + 1) * DAY_MS) }

  let found: { day: string; evidence: string } | null = null
  try {
    found = await earliestLabelledRegularDay(sport, season, window, deps.db)
  } catch (err) {
    // An unreadable schedule is "cannot tell", never "no games": keep any opener already derived.
    const kept = resolveDailySportSeasonStart(sport, season)
    const detail = `schedule read failed (${String(err).slice(0, 120)})`
    return kept
      ? { opener: kept, source: 'schedule', estimated: false, detail: `${detail}; keeping the opener derived earlier` }
      : { opener: null, source: 'unknown', estimated: false, detail }
  }

  if (found) {
    const opener = `${found.day}T00:00:00.000Z`
    recordDerivedDailySportSeasonStart(sport, season, opener)
    const offBy = Math.round((Date.parse(opener) - centre) / DAY_MS)
    return {
      opener,
      source: 'schedule',
      estimated: false,
      detail: `earliest ${found.evidence} game day (${offBy >= 0 ? '+' : ''}${offBy}d from the estimate); add it to REGULAR_SEASON_START_UTC once checked`,
    }
  }

  recordDerivedDailySportSeasonStart(sport, season, null)
  const key = `${sport}:${season}`
  if (!warnedEstimate.has(key)) {
    warnedEstimate.add(key)
    console.warn(
      `[dailySportSeasonStart] ${sport} ${season}: no curated opener and no game labelled regular season ` +
        `in the stored schedule; ESTIMATED opener ${estimate.slice(0, 10)} — not used as a week anchor, ` +
        'so weeks stay unresolved (SEASON_OPENER_UNRECORDED) until opening night is ingested or the published ' +
        'date is added to REGULAR_SEASON_START_UTC in lib/season-week/dailySportSeasonStarts.ts.',
    )
  }
  return {
    opener: estimate,
    source: 'estimate',
    estimated: true,
    detail: 'no labelled regular-season game stored yet; estimated from the latest curated opener — not an anchor',
  }
}

/**
 * Resolve a daily sport's opener, priming the synchronous resolver as a side effect. Call it from an
 * async entry point before anything that reads `resolveDailySportSeasonStart` /
 * `resolveDailySportWeekWindow` / `dailySportWeekForInstant` for a season that may not be curated.
 *
 * A curated season returns immediately with no database read.
 */
export async function ensureDailySportSeasonStart(
  sport: string | null | undefined,
  season: number | null | undefined,
  deps: DeriveSeasonStartDeps,
): Promise<DailySportSeasonStartResolution> {
  const key = String(sport ?? '').trim().toUpperCase()
  const year = Number(season)
  if (!Number.isInteger(year)) return { opener: null, source: 'unknown', estimated: false, detail: 'no season' }
  if (isCuratedDailySportSeason(key, year)) {
    return { opener: resolveDailySportSeasonStart(key, year)!, source: 'curated', estimated: false, detail: 'dailySportSeasonStarts.ts' }
  }

  const cacheKey = `${key}:${year}`
  const now = (deps.now ?? new Date()).getTime()
  const hit = checked.get(cacheKey)
  if (hit && now - hit.at < RECHECK_MS) return hit.result
  const pending = inFlight.get(cacheKey)
  if (pending) return pending

  const run = derive(key, year, deps)
    .then((result) => {
      checked.set(cacheKey, { at: now, result })
      return result
    })
    .finally(() => inFlight.delete(cacheKey))
  inFlight.set(cacheKey, run)
  return run
}
