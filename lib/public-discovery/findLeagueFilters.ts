/**
 * Find a League — the filters that are about PEOPLE rather than settings: when the
 * draft is for the person looking, which part of the country the league runs on, and
 * where the league sits against the viewer's rank. Plus the search box parser that
 * turns "12 team dynasty snake free" into those same filters.
 *
 * Pure: no database, no session, no `Date.now()` unless a caller omits `now`. The
 * server applies these to cards, the client uses the parser, and the tests exercise
 * both without either.
 */

import type {
  DiscoveryLeagueStyle,
  DraftTypeFilter,
  DraftWhenFilter,
  EntryFeeFilter,
  RankBand,
  TimeZoneRegionFilter,
} from "./types"

// ── Rank bands ──────────────────────────────────────────────────────────────

/**
 * Where a league sits against the viewer. Higher tier is the stronger rank
 * (tiers come from XP, see lib/ranking/tier-visibility).
 *
 * Null when either side is unknown — an anonymous viewer has no rank, and the
 * discovery pipeline seeds them at tier 1, which would label every league "Step up".
 */
export function rankBandFor(leagueTier: number | null | undefined, viewerTier: number | null | undefined): RankBand | null {
  if (leagueTier == null || viewerTier == null) return null
  if (!Number.isFinite(leagueTier) || !Number.isFinite(viewerTier)) return null
  if (leagueTier > viewerTier) return "step_up"
  if (leagueTier < viewerTier) return "chill"
  return "your_level"
}

export const RANK_BAND_LABELS: Record<RankBand, string> = {
  step_up: "Step up",
  your_level: "Your level",
  chill: "Chill",
}

export const RANK_BAND_HINTS: Record<RankBand, string> = {
  step_up: "Managers here are ranked above you. Good place to get better.",
  your_level: "Managers here are ranked at your level.",
  chill: "Managers here are ranked below you. Lower stakes.",
}

// ── Time zones ──────────────────────────────────────────────────────────────

/**
 * UTC offset of a zone in hours, read in JANUARY so daylight saving never moves a
 * zone between buckets (Phoenix and Denver must both read as Mountain all year).
 * Null for an unknown zone.
 */
function standardOffsetHours(timeZone: string): number | null {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(Date.UTC(2026, 0, 15, 12)))
      .find((p) => p.type === "timeZoneName")?.value
    if (!part) return null
    if (part === "GMT" || part === "UTC") return 0
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part)
    if (!m) return null
    const hours = Number(m[2]) + Number(m[3] ?? 0) / 60
    return m[1] === "-" ? -hours : hours
  } catch {
    return null
  }
}

/**
 * Which US region a league's official zone falls in. Bucketed by offset rather than
 * by a list of zone names, so America/Detroit, America/Indiana/Indianapolis and
 * America/Toronto all land in Eastern without anyone having to remember them.
 *
 * ⚠ Only zones under `America/` or `Pacific/Honolulu` are treated as US-region
 * candidates; Bogotá is UTC−5 in January too, and is not "Eastern".
 */
export function timeZoneRegionFor(timeZone: string | null | undefined): Exclude<TimeZoneRegionFilter, "any"> | null {
  const tz = String(timeZone ?? "").trim()
  if (!tz) return null
  const offset = standardOffsetHours(tz)
  if (offset == null) return null
  const northAmerican =
    /^(America\/(New_York|Detroit|Indiana\/|Kentucky\/|Toronto|Montreal|Nipigon|Thunder_Bay|Chicago|Menominee|North_Dakota\/|Winnipeg|Denver|Boise|Phoenix|Edmonton|Los_Angeles|Vancouver|Tijuana|Anchorage|Juneau|Sitka|Nome|Yakutat|Metlakatla|Adak)|Pacific\/Honolulu|US\/)/.test(tz)
  if (!northAmerican) return "outside_us"
  if (offset === -5) return "eastern"
  if (offset === -6) return "central"
  if (offset === -7) return "mountain"
  if (offset === -8) return "pacific"
  if (offset === -9 || offset === -10) return "alaska_hawaii"
  return "outside_us"
}

export const TIME_ZONE_REGION_LABELS: Record<TimeZoneRegionFilter, string> = {
  any: "Any",
  eastern: "Eastern",
  central: "Central",
  mountain: "Mountain",
  pacific: "Pacific",
  alaska_hawaii: "Alaska / Hawaii",
  outside_us: "Outside the US",
}

// ── Draft windows ───────────────────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

/** Weekday (0 = Sunday) and hour of an instant, as the wall clock reads in `timeZone`. */
function wallClock(instant: Date, timeZone: string): { weekday: number; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(instant)
    const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value as (typeof WEEKDAYS)[number])
    const hour = Number(parts.find((p) => p.type === "hour")?.value)
    if (weekday < 0 || !Number.isFinite(hour)) return null
    return { weekday, hour }
  } catch {
    return null
  }
}

/**
 * Whether a league's draft lands in a window, judged on the VIEWER's clock, not the
 * league's. A 9pm Eastern draft is a weeknight-evening draft for someone in New York
 * and a 6pm one for someone in Los Angeles; the filter answers "can I make it".
 *
 * - `upcoming`: has a scheduled draft that has not started yet
 * - `next_7_days`: upcoming and within a week
 * - `weeknight`: upcoming, Mon–Thu, 6pm–11pm viewer time
 * - `weekend`: upcoming, Friday 6pm through Sunday night viewer time
 *
 * An unscheduled draft fits no window: "any" is the way to see those.
 */
export function draftFitsWindow(
  draftIso: string | null | undefined,
  window: DraftWhenFilter,
  viewerTimeZone: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (window === "any") return true
  if (!draftIso) return false
  const at = new Date(draftIso)
  if (Number.isNaN(at.getTime())) return false
  if (at.getTime() <= now.getTime()) return false
  if (window === "upcoming") return true
  if (window === "next_7_days") return at.getTime() - now.getTime() <= 7 * 24 * 60 * 60 * 1000

  const clock = wallClock(at, viewerTimeZone || "America/New_York") ?? wallClock(at, "America/New_York")
  if (!clock) return false
  const { weekday, hour } = clock
  if (window === "weeknight") return weekday >= 1 && weekday <= 4 && hour >= 18 && hour < 23
  // weekend
  return (weekday === 5 && hour >= 18) || weekday === 6 || weekday === 0
}

/**
 * The zone "your clock" means: the one in the person's settings when they set one,
 * otherwise the device's. The card that prints a draft time and the filter that asks
 * "weeknight evening?" must both call this, or a league can be filtered on one clock
 * and displayed on another.
 */
export function resolveViewerTimeZone(preferred?: string | null): string | null {
  const isValid = (tz: string) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz })
      return true
    } catch {
      return false
    }
  }
  if (preferred && isValid(preferred)) return preferred
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export const DRAFT_WHEN_LABELS: Record<DraftWhenFilter, string> = {
  any: "Any time",
  upcoming: "Scheduled",
  next_7_days: "Next 7 days",
  weeknight: "Weeknight evenings",
  weekend: "Weekends",
}

// ── Free-text search ────────────────────────────────────────────────────────

/** Lower-cased words, with `-`/`_`/`/` treated as spaces so "best_ball" and "best-ball" both read as two words. */
export function searchWords(text: string | null | undefined): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Every query word must START one of the field words. "dyn" finds "Dynasty Degenerates",
 * "ken" finds commissioner "Kenny", and "12" does not find "2012".
 */
export function matchesSearchText(fields: Array<string | null | undefined>, query: string | null | undefined): boolean {
  const wanted = searchWords(query)
  if (wanted.length === 0) return true
  const haystack = fields.flatMap((f) => searchWords(f))
  return wanted.every((w) => haystack.some((h) => h.startsWith(w)))
}

export type ParsedLeagueSearch = {
  sport?: string
  style?: DiscoveryLeagueStyle
  draftType?: Exclude<DraftTypeFilter, "all">
  teamCount?: number
  entryFee?: Exclude<EntryFeeFilter, "all">
  draftWhen?: Exclude<DraftWhenFilter, "any">
  tzRegion?: Exclude<TimeZoneRegionFilter, "any">
  /** What is left over once the recognised words are taken out: matched against names. */
  text: string
}

const SPORT_WORDS: Array<[RegExp, string]> = [
  [/\bcollege\s+football\b|\bcfb\b|\bncaaf\b|\bncaa\s+football\b/, "NCAAF"],
  [/\bcollege\s+basketball\b|\bcbb\b|\bncaab\b|\bncaa\s+basketball\b|\bmarch\s+madness\b/, "NCAAB"],
  [/\bnfl\b|\bfootball\b/, "NFL"],
  [/\bnba\b|\bbasketball\b/, "NBA"],
  [/\bmlb\b|\bbaseball\b/, "MLB"],
  [/\bnhl\b|\bhockey\b/, "NHL"],
  [/\bsoccer\b|\bmls\b|\bepl\b|\bpremier\s+league\b/, "SOCCER"],
]

const STYLE_WORDS: Array<[RegExp, DiscoveryLeagueStyle]> = [
  [/\bbest\s*ball\b/, "best_ball"],
  [/\bdynasty\b/, "dynasty"],
  [/\bredraft\b/, "redraft"],
  [/\bkeepers?\b/, "keeper"],
  [/\bsurvivor\b/, "survivor"],
  [/\bbrackets?\b/, "bracket"],
]

const DRAFT_WORDS: Array<[RegExp, Exclude<DraftTypeFilter, "all">]> = [
  [/\bsnake\b/, "snake"],
  [/\bauction\b|\bsalary\s+cap\s+draft\b/, "auction"],
  [/\blinear\b/, "linear"],
]

const FEE_WORDS: Array<[RegExp, Exclude<EntryFeeFilter, "all">]> = [
  [/\bfree\b|\bno\s+buy\s*-?\s*in\b/, "free"],
  [/\bpaid\b|\bmoney\b|\bcash\b|\bbuy\s*-?\s*in\b|\$\d*/, "paid"],
]

const WHEN_WORDS: Array<[RegExp, Exclude<DraftWhenFilter, "any">]> = [
  [/\bweeknights?\b|\bweekday\s+(evening|night)s?\b/, "weeknight"],
  [/\bweekends?\b|\bsaturday\b|\bsunday\b/, "weekend"],
  [/\bthis\s+week\b|\bnext\s+7\s+days\b|\bsoon\b/, "next_7_days"],
]

const ZONE_WORDS: Array<[RegExp, Exclude<TimeZoneRegionFilter, "any">]> = [
  [/\beastern\b|\be[sd]t\b/, "eastern"],
  [/\bcentral\b|\bc[sd]t\b/, "central"],
  [/\bmountain\b|\bm[sd]t\b/, "mountain"],
  [/\bpacific\b|\bp[sd]t\b|\bwest\s+coast\b/, "pacific"],
]

/**
 * "12 team dynasty superflex snake, free, weeknights" → filters plus leftover text.
 *
 * Each vocabulary takes its FIRST match and removes it, so a word is never counted
 * twice (`college football` must not also set NFL). Anything unrecognised is kept
 * and searched against league names, so "superflex" still narrows the results.
 */
export function parseLeagueSearch(raw: string | null | undefined): ParsedLeagueSearch {
  let rest = ` ${String(raw ?? "").toLowerCase().replace(/[,;]+/g, " ")} `
  const out: ParsedLeagueSearch = { text: "" }

  const take = <T>(table: Array<[RegExp, T]>): T | undefined => {
    for (const [re, value] of table) {
      if (re.test(rest)) {
        rest = rest.replace(re, " ")
        return value
      }
    }
    return undefined
  }

  const teams = /\b(\d{1,2})\s*-?\s*(?:teams?|man|tm|person)\b/.exec(rest)
  if (teams) {
    const n = Number(teams[1])
    if (n >= 2 && n <= 32) out.teamCount = n
    rest = rest.replace(teams[0], " ")
  }

  out.sport = take(SPORT_WORDS)
  out.style = take(STYLE_WORDS)
  out.draftType = take(DRAFT_WORDS)
  out.entryFee = take(FEE_WORDS)
  out.draftWhen = take(WHEN_WORDS)
  out.tzRegion = take(ZONE_WORDS)

  // Filler that carries no meaning once the facets are gone.
  rest = rest.replace(/\b(league|leagues|draft|drafts|with|a|an|the|in|for|and|time|zone|looking|need|want)\b/g, " ")
  out.text = rest.replace(/\s+/g, " ").trim()

  for (const key of Object.keys(out) as Array<keyof ParsedLeagueSearch>) {
    if (out[key] === undefined) delete out[key]
  }
  return out
}
