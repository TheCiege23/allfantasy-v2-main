/**
 * Rookie status for MLB, NBA and NHL dynasty drafts, from the season stats we already store.
 *
 * Why this exists (docs/DYNASTY_PROSPECT_DATA_PLAN.md §2.5 and §4.3): `SportsPlayer.yearsExp` is NULL
 * for every MLB/NBA/NHL row, nothing stores a draft or debut year for these sports, and the old
 * signal — a stored stats row with `gamesPlayed === 0` — fired for injured veterans and never for a
 * real first-year player, who has no stats row at all. This reads `player_season_stats` instead and
 * answers one of three things per player:
 *
 * - `not_rookie` — our stats PROVE prior appearances past the sport's limit.
 * - `rookie`     — our stats prove the player is under the limit (MLB only, see below).
 * - `unknown`    — anything else. Never a guess: an unknown player is shown and never refused.
 *
 * Only `source = 'rolling_insights'` rows are read, and only `seasonType = 'regular'`:
 *
 * - Their keys are known from code that reads the same rows on production, not guessed. The RI
 *   mirror (`lib/stats/rollingInsightsPlayerStats.ts`, `flattenRiSeasonStats`) writes the vendor's
 *   `regular_season` block flattened, with MLB's groups qualified: `batting.AB`, `pitching.IP`, and a
 *   top-level `games_played` (also copied to the `gamesPlayed` column). `lib/chimmy/tools/
 *   dailySportStats.ts` reads exactly `batting.AB` / `pitching.IP` / `games_played` off the same
 *   vendor blocks, and records that MLB `IP` is a provider STRING in baseball notation ("33.1" is
 *   33⅓ innings). The live-box vocabulary agrees: `ROLLING_INSIGHTS_FIELD_MAPS.MLB` and
 *   `contracts/rolling-insights/fixtures/live.MLB.json` carry `AB` and `IP`.
 * - RI is major-league only: its sport codes have no minor-league feed
 *   (`contracts/rolling-insights/ENDPOINTS.yaml` `sports.codes`).
 *
 * 🛑 TheSportsDB rows (the MLB 1999-2026 history) are NOT read. `ingestPlayerStats`
 * (`lib/sports-data/theSportsDbIngest.ts`) stores each `strStatistic` name verbatim and folds every
 * row of a season together, discarding `strLeague` / `idLeague`. There is no MLB, NBA or NHL
 * `lookupplayerstats` fixture, so the at-bat / innings / games names are unverified, and even with
 * the names a season could mix in a non-major league — a EuroLeague season would make an NBA rookie
 * a "veteran". See `contracts/thesportsdb/GAPS.md` G-15. ClearSports rows are current-season only
 * and provider-shaped with no committed contract, so they are not read either.
 */

export type RookieVerdict = 'rookie' | 'not_rookie' | 'unknown'

export type SeasonStatsRookieSport = 'MLB' | 'NBA' | 'NHL'

const SEASON_STATS_ROOKIE_SPORTS: ReadonlySet<string> = new Set<SeasonStatsRookieSport>(['MLB', 'NBA', 'NHL'])

export function isSeasonStatsRookieSport(sport: unknown): sport is SeasonStatsRookieSport {
  return SEASON_STATS_ROOKIE_SPORTS.has(String(sport ?? '').trim().toUpperCase())
}

/** The only `player_season_stats.source` this module reads (see the header). */
export const ROOKIE_STATS_SOURCE = 'rolling_insights'

/**
 * MLB's official rookie limits (owner's default rule): a player is a rookie for season S while,
 * across ALL major-league seasons before S, he has at most 130 at-bats AND at most 50 innings
 * pitched. ⚠ The third clause — 45 days on the active roster — is ignored: we store no roster-day
 * data, so a bench player with few at-bats can read as a rookie when MLB would not call him one.
 */
export const MLB_ROOKIE_MAX_AT_BATS = 130
export const MLB_ROOKIE_MAX_INNINGS = 50
/**
 * NHL, the official rookie rule: a player is NOT a rookie for season S if, in any single season
 * before S, he played more than 25 regular-season NHL games, or he played 6 or more in each of any
 * two preceding seasons. ⚠ The rule's third clause — 26 or older on September 15 of S — is ignored:
 * we have no reliable birth dates (pool ages come from a DOB the provider once mangled), so an older
 * player with little NHL time can read as a rookie-eligible `unknown` when the NHL would not.
 */
export const NHL_ROOKIE_MAX_GAMES_IN_ONE_SEASON = 25
export const NHL_ROOKIE_TWO_SEASON_GAMES = 6
/**
 * The youngest age at which we assume a player could have had major-league time. Pool ages come
 * from a DOB the provider once mangled (±1 year, `contracts/rolling-insights/GAPS.md`), so this sits
 * below the modern youngest debuts (18-19) on purpose: a wider window only makes `rookie` rarer.
 */
export const MLB_EARLIEST_CAREER_AGE = 16

export type StoredSeasonStatsRow = {
  season: string | number
  stats: unknown
  gamesPlayed?: number | null
}

function finite(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function seasonYear(value: unknown): number | null {
  const n = finite(value)
  return n != null && Number.isInteger(n) ? n : null
}

function statsRecord(stats: unknown): Record<string, unknown> | null {
  return stats && typeof stats === 'object' && !Array.isArray(stats) ? (stats as Record<string, unknown>) : null
}

/**
 * Baseball-notation innings ("33.1" = 33⅓, "33.2" = 33⅔) to a number of innings. A fractional
 * part other than .0/.1/.2 is not baseball notation, so it is unreadable rather than rounded.
 */
export function parseInningsPitched(value: unknown): number | null {
  if (value == null || value === '') return null
  const text = String(value).trim()
  const match = /^(\d+)(?:\.(\d))?$/.exec(text)
  if (!match) return null
  const outs = Number(match[2] ?? '0')
  if (outs > 2) return null
  return Number(match[1]) + outs / 3
}

function priorRows(rows: readonly StoredSeasonStatsRow[], season: number): StoredSeasonStatsRow[] {
  return rows.filter((row) => {
    const year = seasonYear(row.season)
    return year != null && year < season
  })
}

function gamesPlayedOf(row: StoredSeasonStatsRow): number | null {
  return finite(row.gamesPlayed) ?? finite(statsRecord(row.stats)?.games_played)
}

/**
 * NBA: any regular-season games in a season before S proves the player is not a rookie. Nothing
 * here can prove the opposite — two seasons of stored NBA history cannot show a player never played
 * before them — so everyone else is `unknown`. No draft year is inferred.
 */
export function nbaRookieVerdict(args: { rows: readonly StoredSeasonStatsRow[]; season: number }): RookieVerdict {
  for (const row of priorRows(args.rows, args.season)) {
    const games = gamesPlayedOf(row)
    if (games != null && games > 0) return 'not_rookie'
  }
  return 'unknown'
}

/**
 * NHL, by the official rule above. Either clause, met by the seasons we CAN read, is proof even when
 * other seasons are missing (more history can only add games); failing both proves nothing, so that
 * is `unknown` — never `rookie`, because stored NHL history is too short to show a clean career.
 */
export function nhlRookieVerdict(args: { rows: readonly StoredSeasonStatsRow[]; season: number }): RookieVerdict {
  const gamesBySeason = new Map<number, number>()
  for (const row of priorRows(args.rows, args.season)) {
    const year = seasonYear(row.season) as number
    gamesBySeason.set(year, (gamesBySeason.get(year) ?? 0) + Math.max(0, gamesPlayedOf(row) ?? 0))
  }
  const perSeason = [...gamesBySeason.values()]
  if (perSeason.some((games) => games > NHL_ROOKIE_MAX_GAMES_IN_ONE_SEASON)) return 'not_rookie'
  if (perSeason.filter((games) => games >= NHL_ROOKIE_TWO_SEASON_GAMES).length >= 2) return 'not_rookie'
  return 'unknown'
}

/**
 * MLB, by the rookie limits above.
 *
 * `not_rookie` needs only that the at-bats or innings we CAN read already pass a limit (a lower
 * bound, like NHL). `rookie` needs the whole career to be in view, so it requires all three:
 *
 * 1. every prior row is readable: a row with a `batting.*` group must carry a numeric `batting.AB`,
 *    a row with a `pitching.*` group a baseball-notation `pitching.IP`, and a row with neither group
 *    is unreadable. (A missing group counts as zero — a pure hitter has no pitching line.)
 * 2. the player's age is known, and
 * 3. our stored RI history (`coveredSeasons`: the seasons for which ANY RI MLB row exists — the
 *    vendor's `player-stats` returns a whole season at once, so a covered season with no row for
 *    this player means he had no MLB stats that year) covers every season from the year he turned
 *    `MLB_EARLIEST_CAREER_AGE` to S - 1.
 *
 * So "no stats rows before S" means rookie only when (3) shows those seasons were actually ingested;
 * the player being in the pool at all (he is evaluated only because the pool holds his RI id) is the
 * "known to the pool" half. Today RI history starts in 2026, so (3) fails for nearly everyone and
 * MLB answers `unknown` until older seasons are ingested — which is the honest answer.
 *
 * ⚠ A season whose mirror write partly failed (`mirrorToPlayerSeasonStats` writes in batches of 500
 * and reports, but does not record, a failed batch) still reads as covered.
 */
export function mlbRookieVerdict(args: {
  rows: readonly StoredSeasonStatsRow[]
  season: number
  coveredSeasons: ReadonlySet<number>
  age: number | null | undefined
}): RookieVerdict {
  let atBats = 0
  let innings = 0
  let complete = true
  for (const row of priorRows(args.rows, args.season)) {
    const stats = statsRecord(row.stats)
    const keys = stats ? Object.keys(stats) : []
    const batting = keys.some((k) => k.startsWith('batting.'))
    const pitching = keys.some((k) => k.startsWith('pitching.'))
    if (!stats || (!batting && !pitching)) {
      complete = false
      continue
    }
    if (batting) {
      const ab = finite(stats['batting.AB'])
      if (ab == null || ab < 0) complete = false
      else atBats += ab
    }
    if (pitching) {
      const ip = parseInningsPitched(stats['pitching.IP'])
      if (ip == null) complete = false
      else innings += ip
    }
  }
  if (atBats > MLB_ROOKIE_MAX_AT_BATS || innings > MLB_ROOKIE_MAX_INNINGS) return 'not_rookie'
  if (!complete) return 'unknown'

  const age = finite(args.age)
  if (age == null || age < MLB_EARLIEST_CAREER_AGE || age > 60) return 'unknown'
  const firstPossibleSeason = args.season - Math.floor(age - MLB_EARLIEST_CAREER_AGE)
  for (let year = firstPossibleSeason; year < args.season; year += 1) {
    if (!args.coveredSeasons.has(year)) return 'unknown'
  }
  return 'rookie'
}

export function rookieVerdictFromSeasonStats(
  sport: SeasonStatsRookieSport,
  args: {
    rows: readonly StoredSeasonStatsRow[]
    season: number
    coveredSeasons: ReadonlySet<number>
    age: number | null | undefined
  },
): RookieVerdict {
  if (sport === 'MLB') return mlbRookieVerdict(args)
  if (sport === 'NBA') return nbaRookieVerdict(args)
  return nhlRookieVerdict(args)
}

/**
 * The Rolling Insights id a draft-pool row can be looked up by in `player_season_stats`, or null.
 *
 * Only a row that came FROM Rolling Insights and carries no Sleeper id qualifies: the pool's
 * `external_source_id` is `sleeperId ?? externalId`, and a TheSportsDB or Sleeper id in that column
 * is a different numbering — reading it as an RI id would give the player a stranger's seasons
 * (`app/api/redraft/roster/route.ts` records 251 such joins on production). No match means `unknown`.
 */
export function rollingInsightsIdOfPoolRow(
  row: { external_source_id?: string | null; sleeper_id?: string | null; metadata?: Record<string, unknown> | null } | null | undefined,
): string | null {
  if (!row) return null
  if (String(row.metadata?.source ?? '').trim().toLowerCase() !== ROOKIE_STATS_SOURCE) return null
  if (String(row.sleeper_id ?? '').trim()) return null
  const id = String(row.external_source_id ?? '').trim()
  return /^\d+$/.test(id) ? id : null
}

type SeasonStatsDb = {
  playerSeasonStats: {
    findMany(args: unknown): Promise<unknown[]>
  }
}

const ID_CHUNK = 1000

/**
 * DB-first: one read of `player_season_stats` for the pool's RI ids (plus, for MLB, the list of
 * seasons the store holds), then a verdict per id. Ids absent from the result are `unknown`.
 */
export async function loadSeasonStatsRookieVerdicts(
  db: SeasonStatsDb,
  args: { sport: SeasonStatsRookieSport; season: number; players: ReadonlyArray<{ riId: string; age?: number | null }> },
): Promise<Map<string, RookieVerdict>> {
  const verdicts = new Map<string, RookieVerdict>()
  const ageById = new Map<string, number | null>()
  for (const p of args.players) if (p.riId && !ageById.has(p.riId)) ageById.set(p.riId, p.age ?? null)
  const ids = [...ageById.keys()]
  if (ids.length === 0) return verdicts

  const rowsById = new Map<string, StoredSeasonStatsRow[]>()
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const found = (await db.playerSeasonStats.findMany({
      where: {
        sport: args.sport,
        source: ROOKIE_STATS_SOURCE,
        seasonType: 'regular',
        playerId: { in: ids.slice(i, i + ID_CHUNK) },
      },
      select: { playerId: true, season: true, stats: true, gamesPlayed: true },
    })) as Array<StoredSeasonStatsRow & { playerId: string }>
    for (const row of found) rowsById.set(row.playerId, [...(rowsById.get(row.playerId) ?? []), row])
  }

  const coveredSeasons = new Set<number>()
  if (args.sport === 'MLB') {
    const seasons = (await db.playerSeasonStats.findMany({
      where: { sport: args.sport, source: ROOKIE_STATS_SOURCE, seasonType: 'regular' },
      distinct: ['season'],
      select: { season: true },
    })) as Array<{ season: string }>
    for (const row of seasons) {
      const year = seasonYear(row.season)
      if (year != null) coveredSeasons.add(year)
    }
  }

  for (const id of ids) {
    verdicts.set(
      id,
      rookieVerdictFromSeasonStats(args.sport, {
        rows: rowsById.get(id) ?? [],
        season: args.season,
        coveredSeasons,
        age: ageById.get(id),
      }),
    )
  }
  return verdicts
}
