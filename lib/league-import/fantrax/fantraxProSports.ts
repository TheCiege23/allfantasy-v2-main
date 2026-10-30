/**
 * What is sport-specific about a Fantrax NBA or NHL league, kept pure so it can be pinned by tests.
 *
 * ⚠ NO NBA OR NHL LEAGUE HAS BEEN CAPTURED. The only committed Fantrax league capture is MLB
 * (`tests/fixtures/fantrax/mlb-points-public.json`), and the endpoints are the same for every sport —
 * `getLeagueInfo`, `getTeamRosters`, `getPlayerIds?sport=` — so the SHAPE is assumed to carry over.
 * What cannot be assumed, and is therefore read defensively here, is the VOCABULARY inside it:
 * how a basketball/hockey season is labelled, and which slot codes `positionConstraints` uses.
 * Anything unrecognised is named in `gaps` rather than guessed. See contracts/fantrax/GAPS.md.
 */
import type { FantraxLeagueInfo } from './fantraxApi'

/** Stored `FantraxLeague.sport` values whose season spans two calendar years. */
const SPLIT_SEASON_SPORTS = new Set(['nba', 'nhl'])

export function isFantraxSplitSeasonSport(sport: string | null | undefined): boolean {
  return SPLIT_SEASON_SPORTS.has(String(sport ?? '').trim().toLowerCase())
}

/**
 * NBA and NHL regular seasons open in October. A league whose calendar starts on or after July 1 began
 * that year's season; one that starts before July (a late-start league opening in January) belongs to
 * the season that began the previous autumn.
 */
const SEASON_ROLLOVER_MONTH = 6 // July, zero-based

function beginYearFor(date: Date): number {
  return date.getUTCMonth() >= SEASON_ROLLOVER_MONTH ? date.getUTCFullYear() : date.getUTCFullYear() - 1
}

function earliestLeagueDate(info: Pick<FantraxLeagueInfo, 'startDate' | 'scoringPeriods'>): Date | null {
  const candidates = [info.startDate, ...(info.scoringPeriods ?? []).map((p) => p?.startDate)]
    .map((raw) => (typeof raw === 'string' && raw.trim() ? new Date(raw) : null))
    .filter((d): d is Date => d != null && !Number.isNaN(d.getTime()))
  if (candidates.length === 0) return null
  return candidates.reduce((min, d) => (d.getTime() < min.getTime() ? d : min))
}

/**
 * The season an NBA/NHL league is keyed by: the year it BEGINS (2025-26 → 2025), which is how this
 * repo keys every other split-year sport.
 *
 * Read in order of how unambiguous the evidence is:
 *   1. a range label ("2025-26", "2025-2026") — its first year, stated outright;
 *   2. the league's own calendar (`startDate` / `scoringPeriods[].startDate`, both read already for
 *      the schedule) — which year the season opened in, whatever Fantrax calls it;
 *   3. a bare `seasonYear` number — ⚠ UNCONFIRMED whether Fantrax means the start or end year for
 *      basketball/hockey, so it is used only when there is no calendar to check it against;
 *   4. the season in progress on `now`.
 */
export function fantraxSplitSeasonStartYear(
  info: Pick<FantraxLeagueInfo, 'seasonYear' | 'startDate' | 'scoringPeriods'>,
  now: Date = new Date(),
): number {
  const raw = info.seasonYear
  if (typeof raw === 'string') {
    const range = raw.trim().match(/^(\d{4})\s*[-/–]\s*(\d{2}|\d{4})$/)
    if (range) return Number(range[1])
  }
  const start = earliestLeagueDate(info)
  if (start) return beginYearFor(start)
  const bare = Number(raw)
  if (Number.isInteger(bare) && bare >= 1900 && bare <= 9999) return bare
  return beginYearFor(now)
}

/**
 * The season a Fantrax import is stored under. Single-year sports (NFL, college, MLB) keep the rule
 * they always had — `seasonYear`, else the current year — byte for byte.
 */
export function fantraxImportSeason(
  info: Pick<FantraxLeagueInfo, 'seasonYear' | 'startDate' | 'scoringPeriods'>,
  sport: string | null | undefined,
  now: Date = new Date(),
): number {
  if (isFantraxSplitSeasonSport(sport)) return fantraxSplitSeasonStartYear(info, now)
  return Number(info.seasonYear) || now.getFullYear()
}

/** A split season keyed by its start year is over once the following summer arrives. */
export function isFantraxSplitSeasonFinished(season: number, now: Date = new Date()): boolean {
  return now.getTime() >= Date.UTC(season + 1, SEASON_ROLLOVER_MONTH, 1)
}

/**
 * Fantrax slot code → our NBA/NHL roster slot key (`lib/nba-roster`, `lib/nhl-roster`).
 *
 * Codes our catalog already uses map to themselves. `UT` is Fantrax's utility spelling (captured on
 * the MLB league). The remaining aliases are combined slots whose meaning is unambiguous; a code not
 * listed is reported, never coerced.
 */
const SLOT_CODES: Record<'NBA' | 'NHL', Record<string, string>> = {
  NBA: {
    PG: 'PG', SG: 'SG', SF: 'SF', PF: 'PF', C: 'C', G: 'G', F: 'F',
    UT: 'UTIL', UTIL: 'UTIL', FLX: 'UTIL',
    'G/F': 'FLEX_G_F', GF: 'FLEX_G_F', 'F/C': 'FLEX_F_C', FC: 'FLEX_F_C',
  },
  NHL: {
    C: 'C', LW: 'LW', RW: 'RW', D: 'D', G: 'G', W: 'W',
    /* A hockey forward is C, LW or RW — exactly our C/W flex. */
    F: 'FLEX_CW',
    UT: 'UTIL', UTIL: 'UTIL', SKT: 'SKT', SK: 'SKT',
  },
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/**
 * The league's real lineup, from `rosterInfo.positionConstraints[code].maxActive` (the field the MLB
 * capture carries), plus `maxTotalReservePlayers` as bench.
 *
 * ⚠ RESERVE IS BENCH, NOT IR. In the MLB capture `maxTotalActivePlayers + maxTotalReservePlayers ==
 * maxTotalPlayers` (22 + 8 = 30) with no IR term, so reserve is the non-starting remainder. Fantrax's
 * IR and minors limits are not in any capture and are not invented here.
 */
export function mapFantraxRosterSlots(
  sport: 'NBA' | 'NHL',
  rosterInfo: unknown,
): { slots: Array<{ position: string; count: number }>; gaps: string[] } {
  return mapSlots(SLOT_CODES[sport], sport, rosterInfo)
}

function mapSlots(
  codes: Record<string, string>,
  sport: string,
  rosterInfo: unknown,
): { slots: Array<{ position: string; count: number }>; gaps: string[] } {
  const info = record(rosterInfo)
  const counts = new Map<string, number>()
  const gaps: string[] = []
  for (const [code, raw] of Object.entries(record(info.positionConstraints))) {
    const count = record(raw).maxActive
    if (count === 0) continue
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      gaps.push(`Fantrax roster slot ${code} has no verified size`)
      continue
    }
    const key = codes[code.trim().toUpperCase()]
    if (!key) {
      gaps.push(`Fantrax roster slot ${code} has no ${sport} equivalent here`)
      continue
    }
    counts.set(key, (counts.get(key) ?? 0) + count)
  }
  /*
   * The captured NBA league sends no `maxTotalReservePlayers` at all — only 14 total and 10 active —
   * so its 4 bench seats were dropped. Total minus active is the same remainder the MLB capture
   * states outright (22 + 8 = 30), so it stands in when the reserve count is absent.
   */
  const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  const bench = isCount(info.maxTotalReservePlayers)
    ? info.maxTotalReservePlayers
    : isCount(info.maxTotalPlayers) && isCount(info.maxTotalActivePlayers)
      ? info.maxTotalPlayers - info.maxTotalActivePlayers
      : null
  if (counts.size > 0 && bench != null && bench > 0) counts.set('BN', bench)
  return { slots: Array.from(counts, ([position, count]) => ({ position, count })), gaps }
}

/**
 * Fantrax football / baseball slot code → the token our importers store in `roster_positions`
 * (the vocabulary `lib/league/importedLineupTemplate.ts` reads, and ESPN's adapter writes).
 *
 * Football: positional codes map to themselves; `RWT` / `SFX` are Fantrax's RB/WR/TE flex and
 * superflex (already treated as slots by `importedPlayerMetadata.ts`); `ID` is the IDP flex — the NFL
 * capture's `playerInfo.eligiblePos` lists it for DL, LB and DB players alike (`ID,DL`, `LB,ID`,
 * `DB,ID`). ⚠ `ER` (in that same capture, on a DL player) is deliberately absent: which of our
 * positions it accepts is not established, so it is reported rather than guessed.
 *
 * Baseball: the captured MLB codes (`C` … `UT`, `CI`, `MI`, `P`), `UT` spelled as our `UTIL`.
 */
const FOOTBALL_SLOT_CODES: Record<string, string> = {
  QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'DEF', DST: 'DST', 'D/ST': 'D/ST',
  RWT: 'FLEX', SFX: 'SUPER_FLEX',
  DL: 'DL', DE: 'DE', DT: 'DT', LB: 'LB', DB: 'DB', CB: 'CB', S: 'S', ID: 'IDP_FLEX',
}
const LINEUP_SLOT_CODES: Record<'NFL' | 'NCAAF' | 'MLB', Record<string, string>> = {
  NFL: FOOTBALL_SLOT_CODES,
  NCAAF: FOOTBALL_SLOT_CODES,
  MLB: {
    C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', OF: 'OF', CI: 'CI', MI: 'MI',
    SP: 'SP', RP: 'RP', P: 'P', UT: 'UTIL', UTIL: 'UTIL',
  },
}

/**
 * A Fantrax NFL, college-football or MLB league's starting lineup, as `SLOT:COUNT` entries.
 *
 * 🛑 ALL OR NOTHING, unlike the NBA/NHL mapper. These slots feed `importedLineupTemplateSlots`, which
 * trusts a pair list as the whole lineup — so a lineup with one seat dropped would be a smaller lineup
 * that looks real. Any unmapped code, or starters that do not add up to the league's own
 * `maxTotalActivePlayers`, yields no slots and a named gap, and the caller keeps its old "no stated
 * lineup" resolution.
 */
export function mapFantraxLineupSlots(
  sport: 'NFL' | 'NCAAF' | 'MLB',
  rosterInfo: unknown,
): { slots: Array<{ position: string; count: number }>; gaps: string[] } {
  const mapped = mapSlots(LINEUP_SLOT_CODES[sport], sport, rosterInfo)
  const active = record(rosterInfo).maxTotalActivePlayers
  const starters = mapped.slots.filter((s) => s.position !== 'BN').reduce((sum, s) => sum + s.count, 0)
  const gaps = [...mapped.gaps]
  if (gaps.length === 0 && starters > 0 && typeof active === 'number' && active !== starters) {
    gaps.push(`Fantrax lineup slots add up to ${starters}, but the league starts ${active}`)
  }
  return gaps.length > 0 ? { slots: [], gaps } : mapped
}
