/**
 * Fantasy OS — season-aware refresh cadence resolver (provider/sport-neutral).
 *
 * Determines the SeasonState from an authoritative, EXPLICIT season calendar (not a manual env flag), then
 * maps it to a deterministic refresh cadence. Boundaries are evaluated on the UTC calendar DATE only, so a
 * clock shift (daylight-saving) can never change which cadence applies — the date is invariant to DST.
 *
 * Cadence: preseason / regular_season / postseason = 30 min; offseason = 240 min (4h);
 * unknown = 240 min fail-safe + an operational warning.
 */
export type SeasonState = 'preseason' | 'regular_season' | 'postseason' | 'offseason' | 'unknown'

/**
 * Per-league minimum interval between syncs, by season state.
 *
 * 🛑 THIS IS THE KNOB THAT CONTROLS FRESHNESS — NOT THE CRON EXPRESSION. `syncConnectedLeague`
 * skips any league whose last attempt is inside its cadence (`isSyncDue`), so tightening the cron
 * alone changes NOTHING: the fire happens, every league reports "not due for this season cadence",
 * and the run does no work. Both have to move together, and the cron is the cheaper half to get
 * wrong unnoticed.
 *
 * ⚠ IN-SEASON WENT 30 -> 10 ON 2026-09-05, WITH THE TRADE SCOPE. The pairing is the point: a trade
 * now lands within one cadence window instead of waiting on the 4-hourly historical backfill's
 * ~1.6-day rotation, so the cadence IS the visible trade latency. 10 minutes was the user's ask
 * against a product promise that trades appear without pressing Sync.
 *
 * ⚠ THE 3x LOAD THIS ORIGINALLY CARRIED HAS BEEN PAID DOWN — AND THE TRANSACTION HALF IS NOW
 * CHEAPER AT 10 MINUTES THAN IT WAS AT 30. `resolveTransactionWeekWindow` below narrows the LIVE
 * refresh from 18 `/transactions/{week}` requests to at most 3, so per sync that half is 6x
 * cheaper; at 3x the frequency the net is ~half the transaction requests of the old 30-minute
 * behaviour. The follow-up this comment used to name as standing is done.
 *
 * ⚠ THE MATCHUP HALF IS NOW CAPPED TOO — see `resolveMatchupWeekCap`. This comment previously said
 * it was untouched and that narrowing it was "a real behavioural question rather than the pure
 * waste the transaction sweep was". The first half was right and the second was resolved by
 * measurement: those weeks ARE read (they feed `TeamPerformance`), which is why the matchup knob is
 * a CAP that keeps every played week rather than a window that would drop them.
 *
 * Offseason stays at 4 hours. Nothing trades at 3am in June, and the same multiplier applied there
 * would be pure spend.
 */
export const CADENCE_MINUTES: Record<SeasonState, number> = {
  preseason: 10,
  regular_season: 10,
  postseason: 10,
  offseason: 240,
  unknown: 240,
}

export function cadenceForState(state: SeasonState): number {
  return CADENCE_MINUTES[state]
}

/** A calendar segment expressed as inclusive UTC month/day boundaries (mmdd), with wrap support. */
type Segment = { state: Exclude<SeasonState, 'unknown'>; startMd: number; endMd: number }

/**
 * Explicit season calendars per sport. NFL is the proof path (Sleeper). Segments partition the year with
 * no gaps or overlaps; the regular season wraps across the year end (Sep → early Jan).
 */
const SPORT_CALENDARS: Record<string, Segment[]> = {
  nfl: [
    { state: 'regular_season', startMd: 904, endMd: 106 }, // Sep 4 – Jan 6 (wraps)
    { state: 'postseason', startMd: 107, endMd: 215 }, // Jan 7 – Feb 15 (playoffs + Super Bowl)
    { state: 'offseason', startMd: 216, endMd: 731 }, // Feb 16 – Jul 31
    { state: 'preseason', startMd: 801, endMd: 903 }, // Aug 1 – Sep 3
  ],
}

/** Providers known to map onto the shared sport calendars (all use the same season boundaries per sport). */
const SUPPORTED_PROVIDERS = new Set(['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker'])

function mmdd(now: Date): number {
  return (now.getUTCMonth() + 1) * 100 + now.getUTCDate()
}

/** True when `md` falls within [startMd, endMd], honoring year-wrap segments. */
function inSegment(md: number, startMd: number, endMd: number): boolean {
  if (startMd <= endMd) return md >= startMd && md <= endMd
  return md >= startMd || md <= endMd // wraps year boundary
}

export type SeasonInput = {
  sport: string
  provider?: string
  now: Date
  /** Optional explicit league season year (metadata only; boundaries are calendar-based). */
  season?: number
}

/**
 * Resolve the season state deterministically. Unknown sport (or unknown provider) fails safe to `unknown`
 * (→ 4h cadence) with a warning, never guessing an in-season cadence.
 */
export function resolveSeasonState(input: SeasonInput): { state: SeasonState; warning?: string } {
  const sport = input.sport?.toLowerCase()
  const provider = input.provider?.toLowerCase()
  if (provider && !SUPPORTED_PROVIDERS.has(provider)) {
    return { state: 'unknown', warning: `unknown provider "${input.provider}" — defaulting to 4h offseason cadence` }
  }
  const calendar = sport ? SPORT_CALENDARS[sport] : undefined
  if (!calendar) {
    return { state: 'unknown', warning: `no season calendar for sport "${input.sport}" — defaulting to 4h cadence` }
  }
  const md = mmdd(input.now)
  for (const seg of calendar) {
    if (inSegment(md, seg.startMd, seg.endMd)) return { state: seg.state }
  }
  // Calendars are exhaustive; reaching here is a defect — fail safe.
  return { state: 'unknown', warning: `date ${md} matched no ${sport} segment — defaulting to 4h cadence` }
}

export function resolveCadence(input: SeasonInput): { state: SeasonState; cadenceMinutes: number; warning?: string } {
  const { state, warning } = resolveSeasonState(input)
  return { state, cadenceMinutes: cadenceForState(state), warning }
}

/** True for the frequent-refresh states (everything except offseason/unknown). */
export function isInSeason(state: SeasonState): boolean {
  return state === 'preseason' || state === 'regular_season' || state === 'postseason'
}

/** Sleeper serves `/transactions/{week}` for weeks 1..18; there is no week 0 and no week 19. */
export const MAX_TRANSACTION_WEEK = 18

/**
 * Weeks either side of the computed week that are fetched anyway.
 *
 * 🛑 THIS IS NOT PADDING, IT IS THE ERROR BUDGET, AND REMOVING IT MAKES A MISS SILENT. The week
 * below is derived from a CALENDAR; Sleeper's own `leg` advances on Sleeper's schedule, and the
 * two need not agree at a boundary. A window that is wrong by one and has no margin fetches a week
 * with nothing in it, writes nothing, and reports a completed scope — the exact shape of failure
 * this subsystem has already paid for twice. One extra request per league per sync buys immunity
 * to an off-by-one in EITHER direction, which is why the margin is symmetric even though only the
 * backward half looks useful.
 */
export const TRANSACTION_WEEK_MARGIN = 1

/**
 * NFL scoring week for a UTC instant, by the same calendar `SPORT_CALENDARS` uses.
 *
 * Week 1 opens on Sep 4 (`regular_season.startMd`), so this and the segment table cannot drift
 * apart — a season boundary edited in one place moves both. Clamped to 1..18: a date past week 18
 * is still inside the wrapping regular-season segment (to Jan 6) and answers 18, which is correct
 * for a league still transacting in the final week.
 */
export function nflWeekForDate(now: Date): number {
  const month = now.getUTCMonth() + 1
  /* The segment wraps the year end, so Jan belongs to the season that began the PREVIOUS September. */
  const seasonStartYear = month <= 6 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
  const start = Date.UTC(seasonStartYear, 8, 4) // month is 0-based: 8 = September
  const days = Math.floor((now.getTime() - start) / 86_400_000)
  const week = Math.floor(days / 7) + 1
  return Math.min(MAX_TRANSACTION_WEEK, Math.max(1, week))
}

/**
 * Which `/transactions/{week}` weeks a LIVE refresh needs — or `null` for "cannot say, fetch them all".
 *
 * 🛑 NULL IS A REAL ANSWER AND MUST NOT BE COLLAPSED TO A DEFAULT WEEK. Offseason is when dynasty
 * leagues trade hardest, and the calendar cannot say which week Sleeper files an offseason trade
 * under — so this returns null and the caller keeps the full 1..18 sweep. That costs nothing worth
 * saving, because `CADENCE_MINUTES.offseason` is 240: a 4-hourly full sweep is ~1/24th the load of
 * the in-season cadence this exists to cut. Narrowing where we are confident and refusing to guess
 * where we are not is the whole design.
 *
 * ⚠ PRESEASON IS WEEK 1, MEASURED RATHER THAN ASSUMED. The four rows the live writer first
 * ingested on production (2026-09-05 13:32Z) carried `week = 1` with `tradeDate` 2026-08-30 and
 * 08-31 — dates BEFORE the Sep 4 opener. Sleeper files a preseason trade under week 1, so that is
 * the window; week 2 rides along on the standard margin.
 */
/**
 * Highest `/matchups/{week}` week a LIVE refresh needs — or `null` for "fetch all 18".
 *
 * 🛑 A CAP, NOT A WINDOW, AND THE ASYMMETRY WITH TRANSACTIONS IS THE WHOLE POINT. A transaction
 * is an EVENT: last week's trades are already stored, so the live path only wants the weeks around
 * now, and `maxTransactionWeeks` (weeks 1..N, anchored at week 1 forever) was the wrong shape.
 * A matchup is a SEASON RECORD: `bootstrapLeagueFromNormalizedImport` upserts `TeamPerformance`
 * from every week it is given, so dropping a PAST week would stop refreshing a real score and
 * nothing else would fix it — `SleeperHistoricalMatchupSyncService` has no scheduled caller. Past
 * weeks must stay. Only the unplayed future is waste, and "1..current+1" says exactly that.
 *
 * ⚠ WHY THE FUTURE IS PURE WASTE, MEASURED ON PRODUCTION 2026-09-05. Every 2026 row in
 * `team_performances` is zero-point — all 18 weeks, ~2,974 rows each, avg 0.0. Sleeper reports
 * `points: 0` for an unplayed week, so the sweep was re-writing ~53,000 placeholder rows six times
 * an hour to record that nothing had happened yet. In week 1 that is 16 of 18 requests spent on
 * weeks that cannot contain a score.
 *
 * ⚠ THE SAVING SHRINKS AS THE SEASON RUNS, AND THAT IS CORRECT, NOT A DEFECT. Week 1 saves 16
 * requests; week 10 saves 7; week 17 saves none — by which point those weeks hold real scores and
 * refreshing them is the job. It is the mirror image of the transaction window, which stays a
 * constant 3 all season.
 *
 * ⚠ `+1` RATHER THAN THE CURRENT WEEK, so next week's pairings are on hand before it starts. The
 * one behaviour this drops is a `TeamPerformance` row for a week further out than that, which
 * today would be a zero-point placeholder; `resolveMatchupOpponent` reads Sleeper directly for an
 * upcoming opponent rather than trusting such a row.
 */
export function resolveMatchupWeekCap(input: SeasonInput): number | null {
  const { state } = resolveSeasonState(input)
  if (state === 'offseason' || state === 'unknown') return null
  const centre = state === 'preseason' ? 1 : nflWeekForDate(input.now)
  return Math.min(MAX_TRANSACTION_WEEK, centre + 1)
}

export function resolveTransactionWeekWindow(input: SeasonInput): number[] | null {
  const { state } = resolveSeasonState(input)
  if (state === 'offseason' || state === 'unknown') return null

  const centre = state === 'preseason' ? 1 : nflWeekForDate(input.now)
  const lo = Math.max(1, centre - TRANSACTION_WEEK_MARGIN)
  const hi = Math.min(MAX_TRANSACTION_WEEK, centre + TRANSACTION_WEEK_MARGIN)

  const weeks: number[] = []
  for (let w = lo; w <= hi; w += 1) weeks.push(w)
  return weeks
}
