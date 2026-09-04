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

export const CADENCE_MINUTES: Record<SeasonState, number> = {
  preseason: 30,
  regular_season: 30,
  postseason: 30,
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
