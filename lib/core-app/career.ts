import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLevelFromXp } from '@/lib/rank/levels'

/**
 * Career — the trophy room's data layer, derived from imported league history.
 *
 * Everything here comes from what the user actually imported. Two sources:
 *
 *   `legacy_leagues` + `legacy_rosters` — Sleeper career history. Carries the
 *     rich per-season detail (scoring type, team count, points for/against,
 *     final standing, champion flag), but is Sleeper-only: the table is keyed on
 *     `sleeperLeagueId` and has no platform column.
 *   `leagues.import_*`               — the multi-platform import columns
 *     (Sleeper, ESPN, Yahoo, …). Thinner — wins/losses/ties/playoffs/champion —
 *     but it is the only source that knows which platform a season came from.
 *
 * ⚠ THE PLATFORM FILTER IS WHY BOTH ARE READ. The design asks for every platform
 * at once with a dropdown to narrow to one. Legacy rows can only ever answer
 * "Sleeper", so a filter built on them alone would silently drop every ESPN and
 * Yahoo season the moment someone picked one.
 *
 * ⚠ NOTHING HERE INVENTS A NUMBER. The repo has fixed this same bug repeatedly —
 * the rank route used to hand every user a fabricated 70/"C-" from a table that
 * has never held a row. So: a rate with no games behind it is `null`, not 0; a
 * score with no history is `null`, not 0; and a dimension we cannot compute is
 * reported as unavailable by name rather than being quietly scored zero and
 * dragging the total down. `null` means "we do not know", and the UI must render
 * that differently from a real low number.
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

/**
 * One league across every season of it, with its lifecycle resolved.
 *
 * ⚠ THE ARCHIVED RULE: a league is archived when it has recorded history and no
 * entry in the CURRENT season. Not an age cutoff — "older than two years" would
 * archive a league that simply skipped a year and came back, and would also
 * archive everything for a user who stopped importing. Absence from the current
 * season is the signal that means what a person means by archived: it ran, and
 * you are not in it now.
 *
 * The current season is taken from the data (the newest season the user has),
 * not from the clock. A user whose newest import is 2025 should see their 2025
 * leagues as current rather than have the entire portfolio go archived because
 * the calendar rolled over.
 *
 * It is DERIVED, never stored, so a returning league un-archives itself the
 * moment a new season lands. Nothing has to be migrated or un-set.
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
}

export type CareerTitle = {
  season: number
  leagueName: string
  platform: CareerPlatform
  sport: string | null
  /** "12-2" — null when the source row carried no record. */
  record: string | null
  /** "DYNASTY PPR · 12 TEAM" — assembled from whatever settings exist. */
  settingsLabel: string | null
}

/** One capped component of the GM prestige score. */
export type PrestigeComponent = {
  key: 'championships' | 'winRate' | 'tenure' | 'leagues' | 'playoffs'
  label: string
  /** Raw achieved value (3 championships, 9 seasons…). */
  value: number
  /** The cap. Beyond this the component stops contributing — one huge number
   *  must not be able to carry the whole score. */
  max: number
  /** value/max clamped to 0..1. */
  ratio: number
  /** Share of the total prestige score this component is worth. */
  weight: number
  /** How this component is written on screen: "3/10", "58%". */
  display: string
  /**
   * True when the raw value is at or past the cap. Measured on a real account:
   * 521 leagues against a cap of 15 rendered as "521/15", which reads as a
   * broken widget rather than a maxed one. The UI shows saturated components as
   * MAXED — the cap is working as the handoff intends, and saying so is honest.
   */
  saturated: boolean
}

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

export type CareerData = {
  /** Display handle. Null rather than a placeholder if we have no name. */
  handle: string | null
  /** 25-rung ladder position, from the canonical XP engine. Null if never scored. */
  level: number | null
  levelName: string | null
  nextLevelName: string | null
  xp: { total: number; nextThreshold: number | null; toNext: number | null; progressPct: number | null } | null

  /** Every platform the user has imported from — drives the dropdown. */
  platforms: CareerPlatform[]
  /** Active filter; null = all platforms. */
  platform: CareerPlatform | null

  seasonsPlayed: number
  /**
   * Completed league-SEASONS. A dynasty league running six years is six here.
   * This is what rates are computed against.
   */
  leaguesPlayed: number
  /**
   * Distinct leagues by name. Measured on a real account: 543 rows resolved to
   * 287 distinct names, so counting rows as "leagues" nearly doubled it. This is
   * the number a human means by "how many leagues am I in".
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

  titles: CareerTitle[]
  seasons: CareerSeasonRow[]

  /** True when the user has imported nothing we can build a career from. */
  isEmpty: boolean
}

/* ── prestige weights ──────────────────────────────────────────────────────
 * The handoff's own help text: championships 30%, win rate 20%, tenure 20%,
 * league diversity 15%, playoff appearances 15%, each capped. Caps are the
 * handoff's too (3/10, 9/20, 11/15, 14/30).
 */
const PRESTIGE_SPEC = [
  { key: 'championships', label: 'Championships', max: 10, weight: 0.3 },
  { key: 'winRate', label: 'Win rate', max: 1, weight: 0.2 },
  { key: 'tenure', label: 'Tenure', max: 20, weight: 0.2 },
  { key: 'leagues', label: 'Leagues', max: 15, weight: 0.15 },
  { key: 'playoffs', label: 'Playoffs', max: 30, weight: 0.15 },
] as const

/*
 * ⚠ FOUR DIMENSIONS, NOT THE DESIGN'S SIX. Rivalry and Awards are in the mock
 * but nothing in an import can produce them: rivalry needs head-to-head results
 * against a named manager (imports carry a season record, not an opponent
 * ledger) and awards needs an awards table these rows never populate. They are
 * returned in `unavailable` so the screen can name what is missing. The four
 * weights below are the design's own, re-normalised to sum to 1 across what is
 * actually computable — otherwise every legacy score would be depressed by a
 * fixed 22% representing data we never had.
 */
const LEGACY_SPEC = [
  { key: 'championship', label: 'Championship', weight: 0.28 },
  { key: 'playoff', label: 'Playoff', weight: 0.2 },
  { key: 'consistency', label: 'Consistency', weight: 0.18 },
  { key: 'dynasty', label: 'Dynasty', weight: 0.12 },
] as const

const LEGACY_UNAVAILABLE = ['Rivalry', 'Awards']

function pct(n: number): number {
  return Math.round(n * 1000) / 10
}

/** Games-weighted win rate, or null when nothing was played. */
function rate(wins: number, losses: number, ties: number): number | null {
  const games = wins + losses + ties
  if (games <= 0) return null
  return (wins + ties * 0.5) / games
}

type SeasonAccumulator = {
  season: number
  wins: number
  losses: number
  ties: number
  leagues: number
  championships: number
  playoffs: number
}

function settingsLabel(parts: {
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

/**
 * Consistency: how steady the season-by-season win rate is. Expressed as
 * 100 - (spread × 100), so a manager who hovers around one number scores high
 * and one who oscillates scores low. Needs at least two seasons to mean
 * anything — with one season there is no spread to measure, so it is skipped
 * rather than scored 100 (which would read as flawless consistency from a
 * single data point).
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
 * Dynasty: title rate plus deep playoff runs, PER LEAGUE ENTERED.
 *
 * ⚠ THIS REPLACES A SHARE-OF-WINNING-SEASONS METRIC THAT COULD NOT SEE A REAL
 * CAREER. That version scored the share of seasons averaging >=50%, which broke
 * on a manager playing ~90 leagues at once: averaging across that many entries
 * pulls every season toward the mean, so an account with twelve championships
 * scored Dynasty 0. Averaging hides exactly the excellence the metric exists to
 * find.
 *
 * Rate-per-league is immune to that, because volume divides out. Both halves are
 * measured against what the league SIZE makes likely rather than a flat number:
 * in a 12-team league random title rate is 1/12 and a playoff berth is
 * playoffTeams/teamCount. Beating those is the signal; entering more leagues is
 * not.
 *
 * ⚠ IT CAN SCORE LOW ON A BIG CAREER, AND THAT IS THE POINT. Winning twelve
 * titles across several hundred entries can still be below what entering that
 * many would hand you by chance. This returns what the arithmetic says.
 */
function dynastyScore(input: {
  championships: number
  playoffAppearances: number
  leagueSeasons: number
  /** Mean team count across entered leagues; falls back to 12. */
  avgTeamCount: number | null
  /** Mean playoff berths per league; falls back to half the field. */
  avgPlayoffTeams: number | null
}): number | null {
  const { championships, playoffAppearances, leagueSeasons } = input
  if (leagueSeasons <= 0) return null

  const teams = input.avgTeamCount && input.avgTeamCount > 1 ? input.avgTeamCount : 12
  const berths =
    input.avgPlayoffTeams && input.avgPlayoffTeams > 0 ? input.avgPlayoffTeams : teams / 2

  const expectedTitleRate = 1 / teams
  const expectedRunRate = Math.min(berths / teams, 0.95)

  const titleRate = championships / leagueSeasons
  const runRate = playoffAppearances / leagueSeasons

  // Lift over chance. 3x random titles is an elite ceiling; 2x playoff rate is
  // near the practical maximum, so both saturate rather than run away.
  const titleLift = Math.min(titleRate / expectedTitleRate, 3) / 3
  const runLift = Math.min(runRate / expectedRunRate, 2) / 2

  // Titles carry more than runs — reaching the playoffs is the price of entry.
  return Math.max(0, Math.min(100, Math.round((titleLift * 0.6 + runLift * 0.4) * 100)))
}

/**
 * Collapse league-seasons into leagues and resolve each one's lifecycle.
 *
 * A league is:
 *   active    — it has an entry in the current season whose status is live
 *   completed — its current-season entry is finished (this year's edition is done)
 *   archived  — it has history but NO entry in the current season at all
 *
 * `currentSeason` comes from the data rather than the clock, so a user who has
 * not imported this year still sees their newest season as current instead of
 * having every league they own flip to archived on New Year's Day.
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
  }>
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
    if (currentRowStatuses.length === 0) {
      // Nothing this season — it ran and it is not running now.
      lifecycle = 'archived'
    } else if (currentRowStatuses.includes('active')) {
      lifecycle = 'active'
    } else if (currentRowStatuses.includes('completed')) {
      lifecycle = 'completed'
    } else {
      lifecycle = 'unknown'
    }
    return { ...league, lifecycle }
  })

  leagues.sort(
    (a, b) => b.lastSeason - a.lastSeason || a.name.localeCompare(b.name)
  )
  return { leagues, currentSeason }
}

export async function getCareerData(
  userId: string,
  platformFilter?: string | null
): Promise<CareerData> {
  const wanted = platformFilter?.trim().toLowerCase() || null

  /*
   * Identity and ladder position. Read from the SAME denormalised columns
   * /api/user/rank uses, deliberately — two surfaces disagreeing about someone's
   * level is worse than either being slightly stale. `xp_total` is the canonical
   * engine's output; `getLevelFromXp` is the one ladder.
   */
  let handle: string | null = null
  let xpTotal: number | null = null
  try {
    const [appUser, rows] = await Promise.all([
      prisma.appUser.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true },
      }),
      prisma.$queryRaw<Array<{ xp_total: bigint | number | null }>>`
        SELECT xp_total FROM user_profiles WHERE "userId" = ${userId} LIMIT 1
      `,
    ])
    handle = appUser?.displayName?.trim() || appUser?.username?.trim() || null
    const raw = rows[0]?.xp_total
    if (raw != null) xpTotal = Number(raw)
  } catch (err) {
    console.error('[core-app/career] identity/xp read failed:', err)
  }

  const level = xpTotal != null ? getLevelFromXp(xpTotal) : null

  /* ── source 1: multi-platform import columns on `leagues` ──────────────── */
  type ImportRow = {
    season: number
    platform: string
    sport: string | null
    name: string | null
    import_wins: number | null
    import_losses: number | null
    import_ties: number | null
    import_made_playoffs: boolean | null
    import_won_championship: boolean | null
    scoring: string | null
    status: string | null
  }

  let importRows: ImportRow[] = []
  try {
    importRows = await prisma.$queryRaw<ImportRow[]>`
      SELECT season, platform, sport::text AS sport, name,
             import_wins, import_losses, import_ties,
             import_made_playoffs, import_won_championship, scoring, status
      FROM leagues
      WHERE "userId" = ${userId}
        AND import_wins IS NOT NULL
    `
  } catch (err) {
    // The import_* columns are additive and have been missing on some
    // deployments; a career page is not the place to 500 over it.
    console.error('[core-app/career] leagues import_* read failed:', err)
    importRows = []
  }

  /* ── source 2: Sleeper legacy history (richer, single-platform) ────────── */
  let legacyLeagues: Array<{
    id: string
    name: string
    season: number
    sport: string
    leagueType: string | null
    scoringType: string | null
    teamCount: number | null
    playoffTeams: number | null
    status: string | null
    rosters: Array<{
      wins: number
      losses: number
      ties: number
      isChampion: boolean
      finalStanding: number | null
      playoffSeed: number | null
    }>
  }> = []

  try {
    const appUser = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { legacyUserId: true },
    })
    if (appUser?.legacyUserId) {
      legacyLeagues = await prisma.legacyLeague.findMany({
        where: { userId: appUser.legacyUserId },
        orderBy: [{ season: 'desc' }],
        select: {
          id: true,
          name: true,
          season: true,
          sport: true,
          leagueType: true,
          scoringType: true,
          teamCount: true,
          playoffTeams: true,
          status: true,
          rosters: {
            where: { isOwner: true },
            take: 1,
            select: {
              wins: true,
              losses: true,
              ties: true,
              isChampion: true,
              finalStanding: true,
              playoffSeed: true,
            },
          },
        },
      })
    }
  } catch (err) {
    console.error('[core-app/career] legacy league read failed:', err)
    legacyLeagues = []
  }

  /*
   * ⚠ DEDUPE ACROSS THE TWO SOURCES. A Sleeper league that was imported through
   * the modern path can appear in BOTH tables for the same season, and counting
   * it twice would inflate leagues played, games and — worst of all —
   * championships. Keyed on platform+season+name, which is the most specific
   * thing the two rows share; legacy rows are Sleeper by definition.
   */
  const seen = new Set<string>()
  const key = (platform: string, season: number, name: string | null) =>
    `${platform}|${season}|${(name ?? '').trim().toLowerCase()}`

  const platformsSeen = new Set<CareerPlatform>()
  const sportsSeen = new Set<string>()
  const bySeason = new Map<number, SeasonAccumulator>()
  const titles: CareerTitle[] = []
  const activeLeagues: ActiveLeague[] = []
  const distinctNames = new Set<string>()
  /** Every league-season seen, live or finished — the input to the lifecycle rollup. */
  const leagueSeasonRows: Array<{
    key: string
    name: string
    platform: CareerPlatform
    sport: string | null
    season: number
    status: string | null
    isChampion: boolean
  }> = []
  let leaguesPlayed = 0
  let unknownStatusCount = 0
  // League size, gathered only from completed entries — dynasty is measured
  // against what the field size makes likely.
  let teamCountSum = 0
  let teamCountN = 0
  let playoffTeamsSum = 0
  let playoffTeamsN = 0

  const bump = (season: number): SeasonAccumulator => {
    let acc = bySeason.get(season)
    if (!acc) {
      acc = { season, wins: 0, losses: 0, ties: 0, leagues: 0, championships: 0, playoffs: 0 }
      bySeason.set(season, acc)
    }
    return acc
  }

  for (const row of importRows) {
    const platform = (row.platform || 'unknown').toLowerCase()
    platformsSeen.add(platform)
    if (wanted && platform !== wanted) continue
    const k = key(platform, row.season, row.name)
    if (seen.has(k)) continue
    seen.add(k)
    const importName = row.name?.trim() || 'Unnamed league'
    if (row.name?.trim()) distinctNames.add(importName.toLowerCase())
    leagueSeasonRows.push({
      key: importName.toLowerCase(),
      name: importName,
      platform,
      sport: row.sport,
      season: row.season,
      status: row.status,
      isChampion: row.import_won_championship === true,
    })

    const w = row.import_wins ?? 0
    const l = row.import_losses ?? 0
    const t = row.import_ties ?? 0

    const lifecycle = classifyStatus(row.status)
    if (lifecycle === 'unknown') unknownStatusCount += 1
    if (lifecycle !== 'completed') {
      // Live (or unclassifiable) leagues feed the open slot, never the career.
      activeLeagues.push({
        season: row.season,
        leagueName: row.name?.trim() || 'Unnamed league',
        platform,
        sport: row.sport,
        status: row.status,
        record: w + l + t > 0 ? `${w}-${l}${t > 0 ? `-${t}` : ''}` : null,
      })
      if (row.sport) sportsSeen.add(row.sport)
      continue
    }

    const acc = bump(row.season)
    acc.wins += w
    acc.losses += l
    acc.ties += t
    acc.leagues += 1
    leaguesPlayed += 1
    if (row.sport) sportsSeen.add(row.sport)
    if (row.import_made_playoffs === true) acc.playoffs += 1
    if (row.import_won_championship === true) {
      acc.championships += 1
      titles.push({
        season: row.season,
        leagueName: row.name?.trim() || 'Unnamed league',
        platform,
        sport: row.sport,
        record: w + l + t > 0 ? `${w}-${l}${t > 0 ? `-${t}` : ''}` : null,
        settingsLabel: settingsLabel({ scoringType: row.scoring, sport: row.sport }),
      })
    }
  }

  for (const league of legacyLeagues) {
    const platform = 'sleeper'
    platformsSeen.add(platform)
    if (wanted && platform !== wanted) continue
    const k = key(platform, league.season, league.name)
    if (seen.has(k)) continue
    seen.add(k)
    if (league.name.trim()) distinctNames.add(league.name.trim().toLowerCase())

    const roster = league.rosters[0]
    if (!roster) continue

    leagueSeasonRows.push({
      key: league.name.trim().toLowerCase(),
      name: league.name,
      platform,
      sport: league.sport,
      season: league.season,
      status: league.status,
      isChampion: roster.isChampion,
    })

    const lifecycle = classifyStatus(league.status)
    if (lifecycle === 'unknown') unknownStatusCount += 1
    if (lifecycle !== 'completed') {
      activeLeagues.push({
        season: league.season,
        leagueName: league.name,
        platform,
        sport: league.sport,
        status: league.status,
        record:
          roster.wins + roster.losses + roster.ties > 0
            ? `${roster.wins}-${roster.losses}${roster.ties > 0 ? `-${roster.ties}` : ''}`
            : null,
      })
      if (league.sport) sportsSeen.add(league.sport)
      continue
    }

    if (league.teamCount != null) {
      teamCountSum += league.teamCount
      teamCountN += 1
    }
    if (league.playoffTeams != null) {
      playoffTeamsSum += league.playoffTeams
      playoffTeamsN += 1
    }

    const acc = bump(league.season)
    acc.wins += roster.wins
    acc.losses += roster.losses
    acc.ties += roster.ties
    acc.leagues += 1
    leaguesPlayed += 1
    if (league.sport) sportsSeen.add(league.sport)

    /*
     * ⚠ A PLAYOFF BERTH REQUIRES GAMES. Measured on production: the 2026 season
     * came back as 0-0-0 with 25 playoff appearances across 54 leagues, because
     * `finalStanding` and `playoffSeed` are already populated on leagues that
     * have not played a snap — seeding, not a result. Crediting those produces a
     * season that made the playoffs 25 times without winning a game, and it
     * inflates the career playoff total that prestige is scored on.
     */
    const playedGames = roster.wins + roster.losses + roster.ties > 0
    const madePlayoffs =
      playedGames &&
      (roster.isChampion ||
        (league.playoffTeams != null &&
          ((roster.playoffSeed != null && roster.playoffSeed <= league.playoffTeams) ||
            (roster.finalStanding != null && roster.finalStanding <= league.playoffTeams))))
    if (madePlayoffs) acc.playoffs += 1

    if (roster.isChampion) {
      acc.championships += 1
      titles.push({
        season: league.season,
        leagueName: league.name,
        platform,
        sport: league.sport,
        record:
          roster.wins + roster.losses + roster.ties > 0
            ? `${roster.wins}-${roster.losses}${roster.ties > 0 ? `-${roster.ties}` : ''}`
            : null,
        settingsLabel: settingsLabel({
          leagueType: league.leagueType,
          scoringType: league.scoringType,
          teamCount: league.teamCount,
          sport: league.sport,
        }),
      })
    }
  }

  const seasons: CareerSeasonRow[] = [...bySeason.values()]
    .sort((a, b) => a.season - b.season)
    .map((a) => ({
      season: a.season,
      wins: a.wins,
      losses: a.losses,
      ties: a.ties,
      games: a.wins + a.losses + a.ties,
      winRate: rate(a.wins, a.losses, a.ties),
      leagueCount: a.leagues,
      championships: a.championships,
      playoffAppearances: a.playoffs,
    }))

  const wins = seasons.reduce((s, r) => s + r.wins, 0)
  const losses = seasons.reduce((s, r) => s + r.losses, 0)
  const ties = seasons.reduce((s, r) => s + r.ties, 0)
  const games = wins + losses + ties
  const championships = seasons.reduce((s, r) => s + r.championships, 0)
  const playoffAppearances = seasons.reduce((s, r) => s + r.playoffAppearances, 0)
  const winRate = rate(wins, losses, ties)
  const seasonsPlayed = seasons.length

  // Empty means no COMPLETED history to build a career from. Someone mid-way
  // through their first season has active leagues and no career yet — the shelf
  // and the arc have nothing to show, and saying so beats drawing an empty chart.
  const isEmpty = seasonsPlayed === 0 && leaguesPlayed === 0

  /* ── prestige ──────────────────────────────────────────────────────────── */
  let prestige: CareerData['prestige'] = null
  if (!isEmpty) {
    const raw: Record<string, { value: number; display: string }> = {
      championships: { value: championships, display: `${championships}/10` },
      winRate: {
        value: winRate ?? 0,
        display: winRate != null ? `${pct(winRate)}%` : '—',
      },
      tenure: { value: seasonsPlayed, display: `${seasonsPlayed}/20` },
      leagues: { value: leaguesPlayed, display: `${leaguesPlayed}/15` },
      playoffs: { value: playoffAppearances, display: `${playoffAppearances}/30` },
    }
    const components: PrestigeComponent[] = PRESTIGE_SPEC.map((spec) => {
      const r = raw[spec.key]
      const ratio = Math.max(0, Math.min(r.value / spec.max, 1))
      return {
        key: spec.key,
        label: spec.label,
        value: r.value,
        max: spec.max,
        ratio,
        weight: spec.weight,
        display: r.display,
        saturated: r.value >= spec.max,
      }
    })
    const total =
      Math.round(components.reduce((s, c) => s + c.ratio * c.weight, 0) * 1000) / 10
    prestige = { total, components }
  }

  /* ── legacy ────────────────────────────────────────────────────────────── */
  let legacy: CareerData['legacy'] = null
  if (!isEmpty) {
    const scores: Partial<Record<LegacyDimension['key'], number | null>> = {
      // Capped at ten titles, same ceiling the prestige component uses.
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
        return {
          key: d.key,
          label: d.label,
          score,
          weight,
          contribution: Math.round(score * weight * 10) / 10,
        }
      })
      const total = Math.round(dimensions.reduce((s, d) => s + d.contribution, 0))
      legacy = { total, dimensions, unavailable: LEGACY_UNAVAILABLE }
    }
  }

  titles.sort((a, b) => b.season - a.season)
  activeLeagues.sort((a, b) => b.season - a.season || a.leagueName.localeCompare(b.leagueName))

  const { leagues: rolledLeagues, currentSeason: rolledCurrentSeason } =
    rollUpLeagues(leagueSeasonRows)
  const leagueCounts = rolledLeagues.reduce(
    (acc, l) => {
      acc[l.lifecycle] += 1
      return acc
    },
    { active: 0, completed: 0, archived: 0, unknown: 0 }
  )

  return {
    handle,
    level: level?.level ?? null,
    levelName: level?.name ?? null,
    nextLevelName: level?.nextLevel?.name ?? null,
    xp:
      xpTotal != null && level
        ? {
            total: xpTotal,
            /*
             * ⚠ ABSOLUTE, NOT THE BAND SIZE. `xpForLevel` is the WIDTH of the
             * current level (13,000), while the handoff's "next 55,000" is the
             * total you must reach. Shipping the band size would have printed
             * "next 13,000" beside a 43,908 total — a next target below the
             * number next to it. Confirmed against the mock's own arithmetic:
             * 43,908 + 11,092 = 55,000.
             */
            nextThreshold:
              level.xpForLevel != null && level.xpIntoLevel != null
                ? xpTotal + Math.max(0, level.xpForLevel - level.xpIntoLevel)
                : null,
            toNext:
              level.xpForLevel != null && level.xpIntoLevel != null
                ? Math.max(0, level.xpForLevel - level.xpIntoLevel)
                : null,
            progressPct: level.progressPct ?? null,
          }
        : null,
    platforms: [...platformsSeen].sort(),
    platform: wanted,
    seasonsPlayed,
    leaguesPlayed,
    /*
     * ⚠ DERIVED FROM THE ROLLUP, NOT FROM A SEPARATE NAME SET. Counting names
     * independently produced 287 while the rollup produced 271, because the name
     * set was filled before the "does this league have an owner roster" check and
     * the rollup after it — 16 legacy leagues carry no roster row for this user.
     * Two different answers to "how many leagues" on the same screen is the kind
     * of thing that makes every other number look untrustworthy, so there is now
     * one source.
     */
    distinctLeagues: rolledLeagues.length,
    leagues: rolledLeagues,
    currentSeason: rolledCurrentSeason,
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
    titles,
    seasons,
    isEmpty,
  }
}
