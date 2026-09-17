import { computePrestige, winRateOf, type PrestigeComponent } from '@/lib/core-app/prestige'
import { getLevelFromXp } from '@/lib/rank/levels'

/**
 * Career — the pure half. Rows in, a trophy room out.
 *
 * ⚠ SPLIT OUT OF `career.ts` SO THAT ONE READ CAN ANSWER EVERY FILTER. The page
 * used to re-read every source for each `?platform=`; with league, sport and era
 * filters on top that is one full read per combination. Now `career.ts` reads the
 * rows once (and `careerProfile.ts` stores them after an import), and every view
 * is `buildCareerData(identity, rows, filter)` — no database, no clock.
 *
 * ⚠ NOTHING HERE INVENTS A NUMBER. The repo has fixed this same bug repeatedly —
 * the rank route used to hand every user a fabricated 70/"C-" from a table that
 * has never held a row. So: a rate with no games behind it is `null`, not 0; a
 * score with no history is `null`, not 0; and a dimension we cannot compute is
 * reported as unavailable by name rather than being quietly scored zero and
 * dragging the total down. `null` means "we do not know", and the UI must render
 * that differently from a real low number.
 *
 * ⚠ PURE ON PURPOSE — NO PRISMA, NO `server-only`, NO `Date`. It is imported by
 * the profile store, the share card and unit tests; a clock in here would make a
 * stored profile disagree with a fresh build of the same rows.
 */

export type CareerPlatform = string

/**
 * League lifecycle. The provider's own vocabulary, not ours — measured on
 * production, `status` only ever holds `complete`, `in_season`, `drafting`,
 * `pre_draft` (plus `setup` and NULL on modern rows), and every 2026 row is one
 * of the live three while every 2020–2025 row is `complete`. So the split needs
 * no heuristic.
 *
 * ⚠ `archived` IS NOT A ROW STATUS AND `classifyStatus` NEVER RETURNS IT. That
 * is the whole point of the distinction: `status` describes a league-SEASON
 * ("this year's edition finished"), while archived is a property of the LEAGUE
 * ("it ran, and it is not running now"). No row can carry it, because a 2023 row
 * looks identical whether the league died in 2023 or is still going in 2026.
 * It is resolved one level up, in `rollUpLeagues`, by asking whether the league
 * appears in the current season at all.
 */
export type LeagueLifecycle = 'active' | 'completed' | 'archived' | 'unknown'

export function classifyStatus(status: string | null | undefined): LeagueLifecycle {
  const s = (status ?? '').trim().toLowerCase()
  if (s === 'complete' || s === 'completed') return 'completed'
  if (s === 'in_season' || s === 'drafting' || s === 'pre_draft' || s === 'setup') return 'active'
  return 'unknown'
}

/* ───────────────────────────────── rows ───────────────────────────────── */

/**
 * One league-season of yours, from whichever source recorded it.
 *
 *   import   — `leagues.import_*`, one row per league, the only multi-platform
 *              source that says which platform a season came from.
 *   standing — `SeasonStandingFact` through your claimed team. A record and
 *              points, never a title or a berth (rank 1 is the regular-season
 *              leader, not the champion).
 *   legacy   — `legacy_leagues` + your `legacy_rosters` row. Sleeper-only, and
 *              the richest: size, cut, scoring, seed, champion flag.
 *
 * ⚠ ROWS ARE ALREADY DEDUPLICATED when they reach here, in precedence order
 * import → standing → legacy, on `platform|season|name`. Filtering after the
 * dedup is equivalent to filtering before it for every filter this screen has,
 * because the key carries the platform and the season and the name.
 */
export type CareerRow = {
  source: 'import' | 'standing' | 'legacy'
  /** `platform|season|lower(name)` — the cross-source dedup key. */
  key: string
  /** Lower-cased league name — the identity of a league across seasons. */
  leagueKey: string
  leagueName: string
  platform: CareerPlatform
  /** Upper-case sport code, or null when the source had none. */
  sport: string | null
  season: number
  status: string | null
  wins: number
  losses: number
  ties: number
  /** Null when the source recorded no points (a stored 0 on an unplayed season is not a score). */
  pointsFor: number | null
  pointsAgainst: number | null
  madePlayoffs: boolean
  /** False for sources that cannot say anything about the playoffs at all. */
  playoffKnown: boolean
  isChampion: boolean
  /** League size, when the source recorded one. */
  teamCount: number | null
  playoffTeams: number | null
  leagueType: string | null
  scoringType: string | null
  settingsLabel: string | null
  /** `League.id` for import/standing rows, `LegacyLeague.id` for legacy rows. */
  refId: string
  /** The provider's own league id when known — Sleeper's for legacy rows. */
  providerLeagueId: string | null
  /** Counted in career totals. Import/legacy rows only once their season completed. */
  counted: boolean
  /** Part of the league lifecycle rollup. Standing rows never were. */
  inRollup: boolean
}

export function recordLine(w: number, l: number, t: number): string | null {
  return w + l + t > 0 ? `${w}-${l}${t > 0 ? `-${t}` : ''}` : null
}

export function settingsLabel(parts: {
  leagueType?: string | null
  scoringType?: string | null
  teamCount?: number | null
  sport?: string | null
}): string | null {
  const bits: string[] = []
  const primary = parts.leagueType?.trim() || parts.sport?.trim()
  if (primary) bits.push(primary.toUpperCase())
  if (parts.scoringType?.trim()) bits.push(parts.scoringType.trim().toUpperCase())
  if (parts.teamCount != null) bits.push(`${parts.teamCount} TEAM`)
  return bits.length ? bits.join(' · ') : null
}

export function normalizeCareerSport(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toUpperCase()
  return s || null
}

/* ─────────────────────────────── filters ─────────────────────────────── */

/**
 * What the screen is narrowed to. Every field null means every league, every
 * platform, every sport, every season.
 *
 * ⚠ `league` IS A LEAGUE KEY, NOT `?league=`. `?league=` is the page-level
 * authorization boundary and swaps the whole screen to that one league's own
 * career (38a·6). A league-season from 2021 that was never re-imported has no
 * `League.id` to put there, so the in-page filter uses the name key the rollup
 * already groups seasons by, on its own parameter (`lg`).
 */
export type CareerFilter = {
  platform: string | null
  sport: string | null
  league: string | null
  fromSeason: number | null
  toSeason: number | null
}

export const NO_CAREER_FILTER: CareerFilter = {
  platform: null,
  sport: null,
  league: null,
  fromSeason: null,
  toSeason: null,
}

type Params = Record<string, string | string[] | undefined>

function one(sp: Params, key: string): string | null {
  const v = sp[key]
  const s = Array.isArray(v) ? v[0] : v
  const t = typeof s === 'string' ? s.trim() : ''
  return t ? t : null
}

function seasonParam(raw: string | null): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null
  const n = Number(raw)
  return n >= 1990 && n <= 2100 ? n : null
}

/**
 * Parse the URL. Folded once here — lower-case platform and league key,
 * upper-case sport — so the builder, the stored profile and the links all agree
 * on one spelling. A reversed era is swapped rather than rejected.
 */
export function parseCareerFilter(sp: Params): CareerFilter {
  let from = seasonParam(one(sp, 'from'))
  let to = seasonParam(one(sp, 'to'))
  if (from != null && to != null && from > to) [from, to] = [to, from]
  const league = one(sp, 'lg')
  return {
    platform: one(sp, 'platform')?.toLowerCase() ?? null,
    sport: normalizeCareerSport(one(sp, 'sport')),
    league: league ? league.toLowerCase().slice(0, 200) : null,
    fromSeason: from,
    toSeason: to,
  }
}

export function isUnfiltered(f: CareerFilter): boolean {
  return !f.platform && !f.sport && !f.league && f.fromSeason == null && f.toSeason == null
}

/** Query pairs for a filter, in a fixed order — links and forms build from this. */
export function careerFilterParams(f: CareerFilter): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (f.platform) out.push(['platform', f.platform])
  if (f.sport) out.push(['sport', f.sport])
  if (f.league) out.push(['lg', f.league])
  if (f.fromSeason != null) out.push(['from', String(f.fromSeason)])
  if (f.toSeason != null) out.push(['to', String(f.toSeason)])
  return out
}

/** `/core/career?…` with the filter kept and `extra` applied (null removes a key). */
export function careerHref(f: CareerFilter, extra: Record<string, string | null> = {}): string {
  const params = new URLSearchParams()
  const view = extra.view
  if (view) params.set('view', view)
  for (const [k, v] of careerFilterParams(f)) params.set(k, v)
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'view') continue
    if (v == null) params.delete(k)
    else params.set(k, v)
  }
  const qs = params.toString()
  return qs ? `/core/career?${qs}` : '/core/career'
}

export function matchesCareerFilter(r: CareerRow, f: CareerFilter): boolean {
  if (f.platform && r.platform !== f.platform) return false
  if (f.sport && r.sport !== f.sport) return false
  if (f.league && r.leagueKey !== f.league) return false
  if (f.fromSeason != null && r.season < f.fromSeason) return false
  if (f.toSeason != null && r.season > f.toSeason) return false
  return true
}

/* ─────────────────────────────── outputs ─────────────────────────────── */

/**
 * One league across every season of it, with its lifecycle resolved.
 *
 * ⚠ THE ARCHIVED RULE: a league is archived when it has recorded history and no
 * entry in the CURRENT season. Not an age cutoff — "older than two years" would
 * archive a league that simply skipped a year and came back. The current season
 * is taken from the data (the newest season the user has), not from the clock.
 * It is DERIVED, never stored, so a returning league un-archives itself the
 * moment a new season lands.
 */
export type CareerLeague = {
  /** Lower-cased name — the identity key across seasons. */
  key: string
  name: string
  platform: CareerPlatform
  sport: string | null
  firstSeason: number
  lastSeason: number
  /** How many seasons of this league are on record. */
  seasonCount: number
  championships: number
  lifecycle: LeagueLifecycle
}

/** A league still being played — the design's "open slot", never career totals. */
export type ActiveLeague = {
  season: number
  leagueName: string
  platform: CareerPlatform
  sport: string | null
  status: string | null
  /** Record so far this season; null before any games. */
  record: string | null
}

export type CareerSeasonRow = {
  season: number
  wins: number
  losses: number
  ties: number
  games: number
  /** Null when no games were played that season — never 0. */
  winRate: number | null
  leagueCount: number
  championships: number
  playoffAppearances: number
  /** League-seasons that season whose source can say whether you made the playoffs. */
  playoffKnownCount: number
  /** Points across league-seasons that recorded them. Null when none did. */
  pointsFor: number | null
  /** Games behind `pointsFor` — the denominator for points per game. */
  pointsGames: number
  /** Points per game, or null when no league-season that year recorded points. */
  pointsPerGame: number | null
  /** Championships won up to and including this season. */
  titlesToDate: number
  /** That year's standout league-season — a title first, then win rate. */
  best: BestSeason | null
}

export type CareerTitle = {
  season: number
  leagueName: string
  leagueKey: string
  platform: CareerPlatform
  sport: string | null
  /** "12-2" — null when the source row carried no record. */
  record: string | null
  /** "DYNASTY PPR · 12 TEAM" — assembled from whatever settings exist. */
  settingsLabel: string | null
}

/** One standout league-season. */
export type BestSeason = {
  season: number
  leagueName: string
  leagueKey: string
  platform: CareerPlatform
  record: string
  winRate: number
  champion: boolean
  madePlayoffs: boolean
  pointsPerGame: number | null
  settingsLabel: string | null
}

export type { PrestigeComponent }

export type LegacyDimension = {
  key: 'championship' | 'playoff' | 'consistency' | 'dynasty'
  label: string
  /** 0-100. */
  score: number
  /** Share of the legacy total. Re-normalised across available dimensions. */
  weight: number
  /** score × weight — the stacked bar segment width. */
  contribution: number
}

/**
 * The first thing the screen says: what you have won.
 *
 * ⚠ `finals` IS NULL, AND WILL STAY NULL UNTIL AN IMPORT RECORDS A RUNNER-UP.
 * Measured 2026-09-16: every source stores the champion, and none stores who lost
 * the final. `legacy_rosters.finalStanding` is "champion ? 1 : Sleeper's
 * settings.rank" — a REGULAR-SEASON rank that is populated on 19 of 1,121 rows —
 * and `import_final_standing` is set mid-season. Counting `finalStanding = 2` as
 * a final would credit a second-place regular season with a title game nobody
 * played. The tile names the gap instead.
 */
export type CareerAccomplishments = {
  championships: number
  finals: number | null
  finalsNote: string
  playoffAppearances: number
  /** League-seasons whose source can say whether you made the playoffs. */
  playoffKnown: number
  /** Berths per league-season where that is knowable; null when none is. */
  playoffRate: number | null
  winRate: number | null
  record: string | null
  /** The three standout league-seasons, best first. */
  bestSeasons: BestSeason[]
  /** The calendar year with the best win rate across at least `BEST_YEAR_MIN_GAMES` games. */
  bestYear: { season: number; winRate: number; record: string; leagues: number; championships: number } | null
}

export type CoverageSeason = {
  season: number
  /** Every league-season on file that year, finished or not. */
  onFile: number
  /** Counted in the totals — finished (or a standings fact). */
  counted: number
  /** Still running (or of a status we cannot classify) — not in the totals. */
  inProgress: number
  withRecord: number
  withPoints: number
  withPlayoffCut: number
  withChampionFlag: number
  platforms: string[]
  sources: Array<CareerRow['source']>
}

export type CareerCoverage = {
  seasons: CoverageSeason[]
  platforms: Array<{ platform: string; leagueSeasons: number; firstSeason: number; lastSeason: number }>
  /** League-seasons with a record but no points — scoring comparisons skip them. */
  missingPoints: number
  /** Finished league-seasons whose source cannot say whether you made the playoffs. */
  missingPlayoffs: number
  /** Legacy leagues that were imported without a roster of yours — never counted. */
  rosterless: number
}

export type CareerFilterOptions = {
  platforms: string[]
  sports: string[]
  leagues: Array<{ key: string; name: string; platform: string; seasons: number; firstSeason: number; lastSeason: number }>
  seasons: number[]
}

export type CareerIdentity = {
  handle: string | null
  avatarUrl: string | null
  xpTotal: number | null
}

export type CareerData = {
  /** Display handle. Null rather than a placeholder if we have no name. */
  handle: string | null
  /** `AppUser.avatarUrl` — the account's own profile image, not a league avatar. */
  avatarUrl: string | null
  /** 25-rung ladder position, from the canonical XP engine. Null if never scored. */
  level: number | null
  levelName: string | null
  nextLevelName: string | null
  xp: { total: number; nextThreshold: number | null; toNext: number | null; progressPct: number | null } | null

  /** Every platform the user has imported from — drives the dropdown. */
  platforms: CareerPlatform[]
  /** Active platform filter; null = all platforms. Kept for existing readers. */
  platform: CareerPlatform | null
  /** The whole filter the board was built under. */
  filter: CareerFilter
  /** What the filter can be set to — always from the UNFILTERED rows. */
  filterOptions: CareerFilterOptions

  seasonsPlayed: number
  /**
   * Completed league-SEASONS. A dynasty league running six years is six here.
   * This is what rates are computed against.
   */
  leaguesPlayed: number
  /**
   * Distinct leagues by name. Measured on a real account: 543 rows resolved to
   * 287 distinct names, so counting rows as "leagues" nearly doubled it.
   */
  distinctLeagues: number
  /** Every league, one row each, with its lifecycle resolved. */
  leagues: CareerLeague[]
  /** The season "now" is measured against — the newest the user has, not the clock. */
  currentSeason: number | null
  leagueCounts: { active: number; completed: number; archived: number; unknown: number }
  /** Still being played — the design's open slot. Never in career totals. */
  activeLeagues: ActiveLeague[]
  /** Rows whose status we could not classify, so the UI can be honest about them. */
  unknownStatusCount: number
  wins: number
  losses: number
  ties: number
  games: number
  /** Null when no games are recorded — a 0% career is not the same as no data. */
  winRate: number | null
  championships: number
  playoffAppearances: number
  /** Distinct sports seen across the imported leagues. */
  sports: string[]
  firstSeason: number | null
  lastSeason: number | null

  /** Null when there is no history to score. */
  prestige: { total: number; components: PrestigeComponent[] } | null
  /** `unavailable` names the dimensions the design asks for that imports cannot
   *  answer, so the UI can say so instead of showing a silent zero. */
  legacy: { total: number; dimensions: LegacyDimension[]; unavailable: string[] } | null

  accomplishments: CareerAccomplishments
  coverage: CareerCoverage
  titles: CareerTitle[]
  seasons: CareerSeasonRow[]

  /** True when the filtered rows hold nothing we can build a career from. */
  isEmpty: boolean
  /** True when the ACCOUNT holds nothing — as opposed to a filter that matches nothing. */
  accountIsEmpty: boolean
}

/* ─────────────────────────────── scoring ─────────────────────────────── */

/*
 * ⚠ FOUR DIMENSIONS, NOT THE DESIGN'S SIX. Rivalry and Awards are in the mock
 * but nothing in an import can produce them. The four weights below are the
 * design's own, re-normalised to sum to 1 across what is actually computable.
 */
const LEGACY_SPEC = [
  { key: 'championship', label: 'Championship', weight: 0.28 },
  { key: 'playoff', label: 'Playoff', weight: 0.2 },
  { key: 'consistency', label: 'Consistency', weight: 0.18 },
  { key: 'dynasty', label: 'Dynasty', weight: 0.12 },
] as const

const LEGACY_UNAVAILABLE = ['Rivalry', 'Awards']

/** A best year needs enough games that one hot league cannot carry it. */
export const BEST_YEAR_MIN_GAMES = 10
/** A best league-season needs a real schedule behind its win rate. */
export const BEST_SEASON_MIN_GAMES = 6

export const FINALS_NOTE =
  'Imports record who won each title but not who lost the final, so title-game appearances cannot be counted yet.'

/**
 * Consistency: how steady the season-by-season win rate is. Needs at least two
 * seasons — with one there is no spread to measure, so it is skipped rather
 * than scored 100.
 */
function consistencyScore(seasons: CareerSeasonRow[]): number | null {
  const rates = seasons.map((s) => s.winRate).filter((r): r is number => r != null)
  if (rates.length < 2) return null
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length
  const variance = rates.reduce((a, r) => a + (r - mean) ** 2, 0) / rates.length
  const sd = Math.sqrt(variance)
  // An SD of 0.25 across seasons is about as swingy as fantasy gets; clamp there.
  return Math.max(0, Math.min(100, Math.round((1 - Math.min(sd / 0.25, 1)) * 100)))
}

/**
 * Dynasty: title rate plus deep playoff runs, PER LEAGUE ENTERED, each measured
 * against what the league size makes likely. Volume divides out, so a manager in
 * ninety leagues is not buried by averaging. It can score low on a big career,
 * and that is the point.
 */
function dynastyScore(input: {
  championships: number
  playoffAppearances: number
  leagueSeasons: number
  avgTeamCount: number | null
  avgPlayoffTeams: number | null
}): number | null {
  const { championships, playoffAppearances, leagueSeasons } = input
  if (leagueSeasons <= 0) return null

  const teams = input.avgTeamCount && input.avgTeamCount > 1 ? input.avgTeamCount : 12
  const berths = input.avgPlayoffTeams && input.avgPlayoffTeams > 0 ? input.avgPlayoffTeams : teams / 2

  const expectedTitleRate = 1 / teams
  const expectedRunRate = Math.min(berths / teams, 0.95)

  const titleLift = Math.min(championships / leagueSeasons / expectedTitleRate, 3) / 3
  const runLift = Math.min(playoffAppearances / leagueSeasons / expectedRunRate, 2) / 2

  return Math.max(0, Math.min(100, Math.round((titleLift * 0.6 + runLift * 0.4) * 100)))
}

/**
 * Collapse league-seasons into leagues and resolve each one's lifecycle.
 *
 *   active    — it has an entry in the current season whose status is live
 *   completed — its current-season entry is finished
 *   archived  — it has history but NO entry in the current season at all
 */
export function rollUpLeagues(
  rows: Array<{
    key: string
    name: string
    platform: CareerPlatform
    sport: string | null
    season: number
    status: string | null
    isChampion: boolean
  }>,
): { leagues: CareerLeague[]; currentSeason: number | null } {
  if (rows.length === 0) return { leagues: [], currentSeason: null }

  const currentSeason = rows.reduce((m, r) => Math.max(m, r.season), rows[0].season)

  const byKey = new Map<string, CareerLeague & { currentRowStatuses: LeagueLifecycle[] }>()
  for (const r of rows) {
    let entry = byKey.get(r.key)
    if (!entry) {
      entry = {
        key: r.key,
        name: r.name,
        platform: r.platform,
        sport: r.sport,
        firstSeason: r.season,
        lastSeason: r.season,
        seasonCount: 0,
        championships: 0,
        lifecycle: 'unknown',
        currentRowStatuses: [],
      }
      byKey.set(r.key, entry)
    }
    entry.firstSeason = Math.min(entry.firstSeason, r.season)
    entry.lastSeason = Math.max(entry.lastSeason, r.season)
    entry.seasonCount += 1
    if (r.isChampion) entry.championships += 1
    if (r.season === currentSeason) entry.currentRowStatuses.push(classifyStatus(r.status))
  }

  const leagues: CareerLeague[] = [...byKey.values()].map((e) => {
    const { currentRowStatuses, ...league } = e
    let lifecycle: LeagueLifecycle
    if (currentRowStatuses.length === 0) lifecycle = 'archived'
    else if (currentRowStatuses.includes('active')) lifecycle = 'active'
    else if (currentRowStatuses.includes('completed')) lifecycle = 'completed'
    else lifecycle = 'unknown'
    return { ...league, lifecycle }
  })

  leagues.sort((a, b) => b.lastSeason - a.lastSeason || a.name.localeCompare(b.name))
  return { leagues, currentSeason }
}

function toBest(r: CareerRow): BestSeason | null {
  const games = r.wins + r.losses + r.ties
  const wr = winRateOf(r.wins, r.losses, r.ties)
  if (wr == null) return null
  return {
    season: r.season,
    leagueName: r.leagueName,
    leagueKey: r.leagueKey,
    platform: r.platform,
    record: recordLine(r.wins, r.losses, r.ties) ?? '0-0',
    winRate: wr,
    champion: r.isChampion,
    madePlayoffs: r.madePlayoffs,
    pointsPerGame: r.pointsFor != null && games > 0 ? r.pointsFor / games : null,
    settingsLabel: r.settingsLabel,
  }
}

/**
 * Rank league-seasons: a title first, then a berth, then win rate, then points
 * per game. A season needs `BEST_SEASON_MIN_GAMES` games to be eligible, so a
 * 2-0 league abandoned in week two cannot top a 12-2 title run.
 */
export function rankBestSeasons(rows: CareerRow[], limit = 3): BestSeason[] {
  return rows
    .filter((r) => r.counted && r.wins + r.losses + r.ties >= BEST_SEASON_MIN_GAMES)
    .map(toBest)
    .filter((b): b is BestSeason => b != null)
    .sort(
      (a, b) =>
        Number(b.champion) - Number(a.champion) ||
        Number(b.madePlayoffs) - Number(a.madePlayoffs) ||
        b.winRate - a.winRate ||
        (b.pointsPerGame ?? -1) - (a.pointsPerGame ?? -1) ||
        b.season - a.season ||
        a.leagueName.localeCompare(b.leagueName),
    )
    .slice(0, limit)
}

/** Options come from EVERY row, so narrowing the board never hides the way back. */
export function careerFilterOptions(rows: CareerRow[], platforms: string[]): CareerFilterOptions {
  const sports = new Set<string>()
  const seasons = new Set<number>()
  const leagues = new Map<string, CareerFilterOptions['leagues'][number]>()
  for (const r of rows) {
    if (r.sport) sports.add(r.sport)
    seasons.add(r.season)
    const held = leagues.get(r.leagueKey)
    if (held) {
      held.seasons += 1
      held.firstSeason = Math.min(held.firstSeason, r.season)
      if (r.season > held.lastSeason) {
        held.lastSeason = r.season
        held.name = r.leagueName
      }
    } else {
      leagues.set(r.leagueKey, {
        key: r.leagueKey,
        name: r.leagueName,
        platform: r.platform,
        seasons: 1,
        firstSeason: r.season,
        lastSeason: r.season,
      })
    }
  }
  return {
    platforms: [...new Set(platforms)].sort(),
    sports: [...sports].sort(),
    leagues: [...leagues.values()].sort(
      (a, b) => b.lastSeason - a.lastSeason || b.seasons - a.seasons || a.name.localeCompare(b.name),
    ),
    seasons: [...seasons].sort((a, b) => a - b),
  }
}

export function buildCoverage(rows: CareerRow[], rosterless: number): CareerCoverage {
  const bySeason = new Map<number, CoverageSeason>()
  const byPlatform = new Map<string, CareerCoverage['platforms'][number]>()
  let missingPoints = 0
  let missingPlayoffs = 0
  for (const r of rows) {
    let s = bySeason.get(r.season)
    if (!s) {
      s = {
        season: r.season,
        onFile: 0,
        counted: 0,
        inProgress: 0,
        withRecord: 0,
        withPoints: 0,
        withPlayoffCut: 0,
        withChampionFlag: 0,
        platforms: [],
        sources: [],
      }
      bySeason.set(r.season, s)
    }
    const games = r.wins + r.losses + r.ties
    s.onFile += 1
    if (r.counted) s.counted += 1
    else s.inProgress += 1
    if (games > 0) s.withRecord += 1
    if (r.pointsFor != null) s.withPoints += 1
    if (r.playoffTeams != null) s.withPlayoffCut += 1
    if (r.source !== 'standing') s.withChampionFlag += 1
    if (!s.platforms.includes(r.platform)) s.platforms.push(r.platform)
    if (!s.sources.includes(r.source)) s.sources.push(r.source)
    if (r.counted && games > 0 && r.pointsFor == null) missingPoints += 1
    if (r.counted && !r.playoffKnown) missingPlayoffs += 1

    const p = byPlatform.get(r.platform)
    if (p) {
      p.leagueSeasons += 1
      p.firstSeason = Math.min(p.firstSeason, r.season)
      p.lastSeason = Math.max(p.lastSeason, r.season)
    } else {
      byPlatform.set(r.platform, { platform: r.platform, leagueSeasons: 1, firstSeason: r.season, lastSeason: r.season })
    }
  }
  for (const s of bySeason.values()) {
    s.platforms.sort()
    s.sources.sort()
  }
  return {
    seasons: [...bySeason.values()].sort((a, b) => b.season - a.season),
    platforms: [...byPlatform.values()].sort((a, b) => b.leagueSeasons - a.leagueSeasons),
    missingPoints,
    missingPlayoffs,
    rosterless,
  }
}

type SeasonAccumulator = {
  season: number
  wins: number
  losses: number
  ties: number
  leagues: number
  championships: number
  playoffs: number
  playoffKnown: number
  points: number
  pointsGames: number
  pointsRows: number
  rows: CareerRow[]
}

export type CareerSource = {
  identity: CareerIdentity
  rows: CareerRow[]
  /** Every platform seen, including legacy leagues with no roster of yours. */
  platforms: string[]
  /** Legacy leagues imported without a roster of yours. */
  rosterless: number
}

export function buildCareerData(source: CareerSource, filter: CareerFilter = NO_CAREER_FILTER): CareerData {
  const { identity } = source
  const rows = source.rows.filter((r) => matchesCareerFilter(r, filter))

  const bySeason = new Map<number, SeasonAccumulator>()
  const titles: CareerTitle[] = []
  const activeLeagues: ActiveLeague[] = []
  const sportsSeen = new Set<string>()
  let leaguesPlayed = 0
  let unknownStatusCount = 0
  let teamCountSum = 0
  let teamCountN = 0
  let playoffTeamsSum = 0
  let playoffTeamsN = 0

  const bump = (season: number): SeasonAccumulator => {
    let acc = bySeason.get(season)
    if (!acc) {
      acc = {
        season,
        wins: 0,
        losses: 0,
        ties: 0,
        leagues: 0,
        championships: 0,
        playoffs: 0,
        playoffKnown: 0,
        points: 0,
        pointsGames: 0,
        pointsRows: 0,
        rows: [],
      }
      bySeason.set(season, acc)
    }
    return acc
  }

  for (const r of rows) {
    if (r.inRollup && classifyStatus(r.status) === 'unknown') unknownStatusCount += 1

    if (!r.counted) {
      // Live (or unclassifiable) leagues feed the open slot, never the career.
      activeLeagues.push({
        season: r.season,
        leagueName: r.leagueName,
        platform: r.platform,
        sport: r.sport,
        status: r.status,
        record: recordLine(r.wins, r.losses, r.ties),
      })
      if (r.sport) sportsSeen.add(r.sport)
      continue
    }

    if (r.teamCount != null) {
      teamCountSum += r.teamCount
      teamCountN += 1
    }
    if (r.playoffTeams != null) {
      playoffTeamsSum += r.playoffTeams
      playoffTeamsN += 1
    }

    const games = r.wins + r.losses + r.ties
    const acc = bump(r.season)
    acc.wins += r.wins
    acc.losses += r.losses
    acc.ties += r.ties
    acc.leagues += 1
    acc.rows.push(r)
    leaguesPlayed += 1
    if (r.sport) sportsSeen.add(r.sport)
    if (r.playoffKnown) acc.playoffKnown += 1
    if (r.madePlayoffs) acc.playoffs += 1
    if (r.pointsFor != null && games > 0) {
      acc.points += r.pointsFor
      acc.pointsGames += games
      acc.pointsRows += 1
    }
    if (r.isChampion) {
      acc.championships += 1
      titles.push({
        season: r.season,
        leagueName: r.leagueName,
        leagueKey: r.leagueKey,
        platform: r.platform,
        sport: r.sport,
        record: recordLine(r.wins, r.losses, r.ties),
        settingsLabel: r.settingsLabel,
      })
    }
  }

  let titlesToDate = 0
  const seasons: CareerSeasonRow[] = [...bySeason.values()]
    .sort((a, b) => a.season - b.season)
    .map((a) => {
      titlesToDate += a.championships
      return {
        season: a.season,
        wins: a.wins,
        losses: a.losses,
        ties: a.ties,
        games: a.wins + a.losses + a.ties,
        winRate: winRateOf(a.wins, a.losses, a.ties),
        leagueCount: a.leagues,
        championships: a.championships,
        playoffAppearances: a.playoffs,
        playoffKnownCount: a.playoffKnown,
        pointsFor: a.pointsRows > 0 ? Math.round(a.points * 10) / 10 : null,
        pointsGames: a.pointsGames,
        pointsPerGame: a.pointsGames > 0 ? a.points / a.pointsGames : null,
        titlesToDate,
        best: rankBestSeasons(a.rows, 1)[0] ?? null,
      }
    })

  const wins = seasons.reduce((s, r) => s + r.wins, 0)
  const losses = seasons.reduce((s, r) => s + r.losses, 0)
  const ties = seasons.reduce((s, r) => s + r.ties, 0)
  const games = wins + losses + ties
  const championships = seasons.reduce((s, r) => s + r.championships, 0)
  const playoffAppearances = seasons.reduce((s, r) => s + r.playoffAppearances, 0)
  const playoffKnown = seasons.reduce((s, r) => s + r.playoffKnownCount, 0)
  const winRate = winRateOf(wins, losses, ties)
  const seasonsPlayed = seasons.length

  const isEmpty = seasonsPlayed === 0 && leaguesPlayed === 0
  const accountIsEmpty = !source.rows.some((r) => r.counted)

  let prestige: CareerData['prestige'] = null
  if (!isEmpty) {
    prestige = computePrestige({ championships, winRate, seasonsPlayed, leaguesPlayed, playoffAppearances })
  }

  let legacy: CareerData['legacy'] = null
  if (!isEmpty) {
    const scores: Partial<Record<LegacyDimension['key'], number | null>> = {
      championship: Math.min(championships / 10, 1) * 100,
      playoff: leaguesPlayed > 0 ? Math.min(playoffAppearances / leaguesPlayed, 1) * 100 : null,
      consistency: consistencyScore(seasons),
      dynasty: dynastyScore({
        championships,
        playoffAppearances,
        leagueSeasons: leaguesPlayed,
        avgTeamCount: teamCountN > 0 ? teamCountSum / teamCountN : null,
        avgPlayoffTeams: playoffTeamsN > 0 ? playoffTeamsSum / playoffTeamsN : null,
      }),
    }
    const available = LEGACY_SPEC.filter((s) => scores[s.key] != null)
    if (available.length > 0) {
      const weightSum = available.reduce((s, d) => s + d.weight, 0)
      const dimensions: LegacyDimension[] = available.map((d) => {
        const score = Math.round(scores[d.key] as number)
        const weight = d.weight / weightSum
        return { key: d.key, label: d.label, score, weight, contribution: Math.round(score * weight * 10) / 10 }
      })
      const total = Math.round(dimensions.reduce((s, d) => s + d.contribution, 0))
      legacy = { total, dimensions, unavailable: LEGACY_UNAVAILABLE }
    }
  }

  titles.sort((a, b) => b.season - a.season || a.leagueName.localeCompare(b.leagueName))
  activeLeagues.sort((a, b) => b.season - a.season || a.leagueName.localeCompare(b.leagueName))

  const { leagues, currentSeason } = rollUpLeagues(
    rows
      .filter((r) => r.inRollup)
      .map((r) => ({
        key: r.leagueKey,
        name: r.leagueName,
        platform: r.platform,
        sport: r.sport,
        season: r.season,
        status: r.status,
        isChampion: r.isChampion,
      })),
  )
  const leagueCounts = leagues.reduce(
    (acc, l) => {
      acc[l.lifecycle] += 1
      return acc
    },
    { active: 0, completed: 0, archived: 0, unknown: 0 },
  )

  const bestYear =
    seasons
      .filter((s) => s.winRate != null && s.games >= BEST_YEAR_MIN_GAMES)
      .sort((a, b) => (b.winRate as number) - (a.winRate as number) || b.championships - a.championships || b.season - a.season)
      .map((s) => ({
        season: s.season,
        winRate: s.winRate as number,
        record: recordLine(s.wins, s.losses, s.ties) ?? '0-0',
        leagues: s.leagueCount,
        championships: s.championships,
      }))[0] ?? null

  const level = identity.xpTotal != null ? getLevelFromXp(identity.xpTotal) : null

  return {
    handle: identity.handle,
    avatarUrl: identity.avatarUrl,
    level: level?.level ?? null,
    levelName: level?.name ?? null,
    nextLevelName: level?.nextLevel?.name ?? null,
    xp:
      identity.xpTotal != null && level
        ? {
            total: identity.xpTotal,
            /*
             * ⚠ ABSOLUTE, NOT THE BAND SIZE. `xpForLevel` is the WIDTH of the
             * current level, while the handoff's "next 55,000" is the total you
             * must reach. Confirmed against the mock: 43,908 + 11,092 = 55,000.
             */
            nextThreshold:
              level.xpForLevel != null && level.xpIntoLevel != null
                ? identity.xpTotal + Math.max(0, level.xpForLevel - level.xpIntoLevel)
                : null,
            toNext:
              level.xpForLevel != null && level.xpIntoLevel != null
                ? Math.max(0, level.xpForLevel - level.xpIntoLevel)
                : null,
            progressPct: level.progressPct ?? null,
          }
        : null,
    platforms: [...new Set(source.platforms)].sort(),
    platform: filter.platform,
    filter,
    filterOptions: careerFilterOptions(source.rows, source.platforms),
    seasonsPlayed,
    leaguesPlayed,
    /*
     * ⚠ DERIVED FROM THE ROLLUP, NOT FROM A SEPARATE NAME SET. Two answers to
     * "how many leagues" on the same screen make every other number look
     * untrustworthy, so there is one source.
     */
    distinctLeagues: leagues.length,
    leagues,
    currentSeason,
    leagueCounts,
    activeLeagues,
    unknownStatusCount,
    wins,
    losses,
    ties,
    games,
    winRate,
    championships,
    playoffAppearances,
    sports: [...sportsSeen].sort(),
    firstSeason: seasons.length ? seasons[0].season : null,
    lastSeason: seasons.length ? seasons[seasons.length - 1].season : null,
    prestige,
    legacy,
    accomplishments: {
      championships,
      finals: null,
      finalsNote: FINALS_NOTE,
      playoffAppearances,
      playoffKnown,
      playoffRate: playoffKnown > 0 ? playoffAppearances / playoffKnown : null,
      winRate,
      record: recordLine(wins, losses, ties),
      bestSeasons: rankBestSeasons(rows.filter((r) => r.counted), 3),
      bestYear,
    },
    coverage: buildCoverage(rows, source.rosterless),
    titles,
    seasons,
    isEmpty,
    accountIsEmpty,
  }
}
