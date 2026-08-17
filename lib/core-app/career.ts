import 'server-only'

import { prisma } from '@/lib/prisma'

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
  /** Every platform the user has imported from — drives the dropdown. */
  platforms: CareerPlatform[]
  /** Active filter; null = all platforms. */
  platform: CareerPlatform | null

  seasonsPlayed: number
  leaguesPlayed: number
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
 * Dynasty: sustained success rather than one good year — the share of seasons
 * at or above a winning record, scaled by how many seasons there are to judge.
 * A single 1-0 season is not a dynasty, so tenure damps the result until there
 * is a real sample.
 */
function dynastyScore(seasons: CareerSeasonRow[]): number | null {
  const rated = seasons.filter((s) => s.winRate != null)
  if (rated.length === 0) return null
  const winning = rated.filter((s) => (s.winRate as number) >= 0.5).length
  const share = winning / rated.length
  const sample = Math.min(rated.length / 5, 1) // full credit at five seasons
  return Math.round(share * sample * 100)
}

export async function getCareerData(
  userId: string,
  platformFilter?: string | null
): Promise<CareerData> {
  const wanted = platformFilter?.trim().toLowerCase() || null

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
  }

  let importRows: ImportRow[] = []
  try {
    importRows = await prisma.$queryRaw<ImportRow[]>`
      SELECT season, platform, sport::text AS sport, name,
             import_wins, import_losses, import_ties,
             import_made_playoffs, import_won_championship, scoring
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
  let leaguesPlayed = 0

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

    const w = row.import_wins ?? 0
    const l = row.import_losses ?? 0
    const t = row.import_ties ?? 0
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

    const roster = league.rosters[0]
    if (!roster) continue

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
      dynasty: dynastyScore(seasons),
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

  return {
    platforms: [...platformsSeen].sort(),
    platform: wanted,
    seasonsPlayed,
    leaguesPlayed,
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
