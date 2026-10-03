import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveCurrentWeekFrom } from './currentWeek'
import { readLeagueWeekMetadata } from './leagueWeekMetadata'
import { leagueWeekFromSettings } from './seasonTimeline'
import { managerArtUrl } from './leagueArt'
import { afEngineForLeague, latestProjectionWeek, lookupAfEngineProjections, lookupProjections } from './playerProjections'
import { computeLeagueProjectedPoints, extractScoringSettings, hasScoringRules } from '@/lib/projections/leagueScoring'
import { eliminationFormat, resolveRailMatchupMode } from './railMatchupMode'
import { loadUnavailableBySport } from './unavailableStarters'
import { isForeignIdSpace } from './rosterIdSpace'

/**
 * This week's head-to-head for every league, for the expanded league rail.
 *
 * 2026-09-07 handoff (`AF League List.dc.html`): the desktop rail expands from a
 * column of crests into a matchup rail — your team and score against the
 * opponent's, with the league's name and crest between them.
 *
 * ── Cost, because this runs inside a shell on EVERY /core page ──────────────
 *
 * Six set-based core queries, no matter how many leagues: newest season per
 * league, schedule rows for those seasons, every LeagueTeam so both sides can be
 * named, then — for the projection lines — the scoring rulebook of the leagues
 * in play, starters of the rosters in play, and one projection read over the
 * union of those starters. A seventh MatchupFact read runs only for leagues with
 * no WeeklyMatchup cache, preserving older importer coverage without replacing
 * a live-cache answer.
 * Current availability adds one identity read plus injury and schedule reads per
 * sport, shared across every lineup. It never adds queries per league.
 *
 * ⚠ THE LAST THREE READ JSON SUBPATHS, NOT WHOLE COLUMNS, AND THAT IS THE WHOLE
 * REASON THEY ARE AFFORDABLE. Measured against production (94 claimed teams, 93
 * leagues, 1,341 rosters) on 2026-09-08:
 *
 *     League.settings           whole column   4,221,741 bytes
 *     the three scoring keys    subpaths          183,164 bytes
 *     Roster.playerData         whole column    1,506,035 bytes
 *     playerData->'starters'    subpath             91,332 bytes
 *     the projection read       613 rows          276,472 bytes
 *     all three                                     ~836 ms cold
 *
 * Selecting `settings` and `playerData` whole — the obvious Prisma spelling —
 * moves ~5.7 MB per render of shell chrome. `extractScoringSettings` only ever
 * reads `scoring_settings`, `scoringSettings` and `yahoo_settings`, so handing it
 * an object of exactly those three is not an approximation of the blob; it is
 * every input it has.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 *
 * ⚠ THE PROJECTIONS ARE THE VENDOR FEED RE-SCORED, NOT `getWeekBoard`. This file
 * used to carry a "NO PROJECTIONS" note pointing at that module, which fits a
 * per-team distribution over completed weeks — genuinely expensive, and requiring
 * a stated basis ("projected from N completed roster-weeks") that does not fit a
 * 300px rail. What is drawn here is the cheaper and better-founded pair the rest
 * of /core already renders: the feed's own weekly number, and the SAME component
 * line re-scored under this league's `scoring_settings`. Both are per-player
 * arithmetic over one ingested row, and they are labelled PROJ / AF rather than
 * left to be mistaken for a score.
 *
 * ⚠ NO IDP ENRICHMENT, AND AN IDP LEAGUE IS THEREFORE UNDERSTATED. `lookupProjections`
 * can fill in a defensive component line, but only per league — it needs that
 * league's own rulebook — which is a query per league and the one thing this
 * loader cannot afford. `pricedFrom` / `starterCount` ride along on every side so
 * a partial total is visible as partial instead of passing for a complete one;
 * `/core/matchup` is where the defenders get priced.
 *
 * ⚠ NO ID CROSSWALK AND NO COLLEGE FEED EITHER, FOR THE SAME REASON, AND THE
 * COST IS MEASURED RATHER THAN GUESSED. The projection feed is keyed on Sleeper
 * ids; an ESPN roster carries ESPN athlete ids (`crosswalkToSleeperIds` bridges
 * them, at a query) and an NCAAF roster is not in this table at all
 * (`lookupNcaafProjections` serves it, at a per-sport call). Of this account's 55
 * rail rows on 2026-09-08, exactly two priced nothing — one ESPN league and one
 * Fantrax NCAAF league — and both render `PROJ —` / `AF —`, which is the true
 * statement. Two rows is not worth two queries on every page in the app.
 *
 * ⚠ THE JOIN IS `League.platformLeagueId`, NOT `League.id`. WeeklyMatchup is
 * written by the Sleeper sync against Sleeper's own ids, and its `rosterId`
 * holds Sleeper's numeric roster_id. Joining on our id returns nothing, silently.
 *
 * ⚠ AN UNPLAYED FIXTURE IS KEPT, NOT SKIPPED, AND IT IS MARKED. `getWeekAll`
 * drops those rows because it reports RESULTS, and a 0-0 row there became a
 * fabricated loss. The rail is a "what is on this week" list, so a scheduled
 * game belongs on it — it just carries `scored: false`, and the rail draws a
 * dash rather than 0.00.
 */

/**
 * One side's two projected totals.
 *
 * ⚠ `projected` AND `afProjected` ARE THE SAME STARTERS UNDER TWO RULEBOOKS, and
 * the pair is the point. `projected` is the vendor's `projectedPoints`, already
 * collapsed under generic PPR — a league nobody is in. `afProjected` re-scores
 * that row's component line under THIS league's `scoring_settings`. In a
 * standard league they land close together; in a TE-premium, 6-point-passing-TD
 * or IDP league they do not, and showing only the first would be showing someone
 * else's league.
 *
 * Both are null rather than 0 when nothing priced — a zero here is a real
 * projection of nothing, which is a different and much stronger claim.
 */
export type RailSideProjection = {
  /** Generic PPR baseline with known absences zeroed. Null when no starter priced. */
  projected: number | null
  /**
   * The same starters under this league's rules. Null when the league's scoring
   * is unknown, or when no starter's component line matched a scoring key —
   * `computeLeagueProjectedPoints` returns null in that case and this must not
   * turn it into a confident 0.00.
   */
  afProjected: number | null
  /**
   * The AF ENGINE's total for the same starters — AllFantasy's own projection, not the provider's —
   * carried into this league's rules by `afEngineForLeague`. Null when no starter has an AF row.
   *
   * ⚠ DESPITE THE NAME, `afProjected` ABOVE IS THE PROVIDER LINE RE-SCORED. That name predates the
   * engine's weekly output reaching /core; this field is the one that is actually AllFantasy's.
   */
  afEngine?: number | null
  /** Starters the AF engine priced, of `starterCount`. */
  afEngineFrom?: number
  /** Starters we could price, of starters in the lineup. Never hidden. */
  pricedFrom: number
  starterCount: number
}

/**
 * Where you sit in a league that has no opponent to show.
 *
 * ⚠ THIS EXISTS BECAUSE "v opponent not named" WAS THE HONEST RENDERING OF THE
 * WRONG QUESTION. An elimination league has no head-to-head by design: measured
 * on production 2026-09-08, all five Guillotine leagues plus `Elimination
 * Station 2` and `KBI Commish Chopped` write one matchupId per roster, so the
 * pairing finds nobody and there is nobody to find. What the manager of such a
 * league wants is not an opponent, it is the distance between them and the cut.
 */
export type RailStanding = {
  /** 1 is top of the league this week. */
  rank: number
  outOf: number
  /**
   * Points between you and the LOWEST team in the league — the margin the cut
   * has to travel to reach you. Null when you ARE the lowest, which the UI says
   * in words instead of as a zero.
   */
  overCut: number | null
  /**
   * What the rank was computed from. Before a snap has been played every real
   * score is 0, so ranking on points would order the league arbitrarily — the
   * projection is the only thing that separates the teams, and the UI must say
   * which one it drew.
   */
  basis: 'points' | 'projected'
  /** Number of ranking places between this team and the weekly cut position. */
  placesAboveCut: number
  /** The score/projection currently defining the cut line. */
  cutLine: number
  /**
   * The league is an elimination format, so the bottom of this table goes home.
   *
   * ⚠ A GUESS DRESSED AS A FLAG, AND DELIBERATELY SO. `League.guillotineMode` is
   * false on all 94 of this account's teams; `leagueType` says 'guillotine' on
   * 11, and `leagueTypeConfirmation` in settings is the only value a human has
   * confirmed. This reads the confirmation first and falls back to the column —
   * which `lib/career/leagueTypeConfirmation.ts` correctly forbids for RANKING,
   * because those labels were set from league names. It changes one word of copy
   * here, and `Dynasty Gridiron Guillotine` is exactly why the name itself is
   * never consulted: it is a dynasty league with an axe in its title.
   */
  elimination: boolean
}

export type RailMatchup = {
  leagueId: string
  /** Your team's name in this league, when the platform published one. */
  yourTeam: string | null
  yourAvatarUrl: string | null
  yourScore: number
  yourProjection: RailSideProjection | null
  opponentTeam: string | null
  opponentAvatarUrl: string | null
  opponentScore: number
  opponentProjection: RailSideProjection | null
  /**
   * No other roster shares this week's matchupId, so there is no opponent to
   * name — an elimination format, or a schedule the sync has not paired. The UI
   * draws `standing` instead of a `v`.
   */
  unpaired: boolean
  /** Present only when `unpaired`, and only when the league could be ranked. */
  standing: RailStanding | null
  /**
   * Elimination leagues: YOUR team has been chopped (see `choppedBefore`). The standing is null then —
   * you are not in the live field — and a surface says "you were chopped", not "no head-to-head".
   * Optional so the many callers that build a RailMatchup by hand need not carry it.
   */
  eliminated?: boolean
  /** False when the fixture exists but has not been played. */
  scored: boolean
  /** Newest provider-written row used by this card. Drives the visible freshness label. */
  freshAt: string | null
  /** Live cache rows can refresh; history fallback rows are labelled LAST in the UI. */
  source: 'live_cache' | 'history_fallback'
  season: number
  week: number
}

export type RailMatchups = {
  byLeague: Record<string, RailMatchup>
  season: number | null
  week: number | null
  /**
   * WHICH WEEK THE PROJECTIONS CAME FROM, which is not always `week`.
   *
   * ⚠ THE FEED HOLDS THE WEEK OR TWO AHEAD AND NOTHING ELSE. Ask it for a week it
   * has not written and it returns nothing; `leagueScoreboard.ts` carries the
   * same note. When this differs from `week` the numbers are a real projection of
   * the right players in the wrong week, and the UI must say so rather than
   * quietly relabel them.
   */
  projectionWeek: { season: string; week: number } | null
}

const EMPTY: RailMatchups = { byLeague: {}, season: null, week: null, projectionWeek: null }

export async function getRailMatchups(
  userId: string,
  leagues: Array<{
    id: string
    platformLeagueId?: string | null
    /** Explicitly resolved by the caller from league type, variant and settings. */
    elimination?: boolean
  }>,
): Promise<RailMatchups> {
  const platformIds = leagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (platformIds.length === 0) return EMPTY

  const leagueByPlatformId = new Map(
    leagues.flatMap((league) =>
      league.platformLeagueId
        ? [[league.platformLeagueId, league] as const]
        : [],
    ),
  )

  /*
   * ⚠ BOTH ROW TYPES ARE NAMED, BECAUSE `.catch(() => [])` WIDENS TO A UNION.
   * The empty literal infers `never[]`, so `typeof matchups` becomes
   * `Row[] | never[]` and every downstream `.filter`/`.find` resolves against
   * the `never[]` overload. Naming the type collapses the union at the
   * declaration instead of at each use site — the same fix `myTeamPulse.ts`
   * carries a note about.
   */
  type MatchupRow = {
    leagueId: string
    seasonYear: number
    week: number
    rosterId: string
    matchupId: number | null
    pointsFor: number
    pointsAgainst: number
    updatedAt: Date
    source: 'live_cache' | 'history_fallback'
  }
  type TeamRow = {
    externalId: string | null
    teamName: string | null
    ownerName: string | null
    avatarUrl: string | null
    claimedByUserId: string | null
    platformUserId: string | null
    league: { id: string; platform: string | null; platformLeagueId: string | null } | null
  }

  type SeasonRow = { leagueId: string; _max: { seasonYear: number | null } }

  /* Resolve the active week PER LEAGUE. A single earliest-unplayed week across
     the whole portfolio lets one stale provider hold every other card back. */
  const [seasonRows, teams]: [SeasonRow[], TeamRow[]] = await Promise.all([
    prisma.weeklyMatchup
      .groupBy({
        by: ['leagueId'],
        where: { leagueId: { in: platformIds } },
        _max: { seasonYear: true },
      })
      .catch((): SeasonRow[] => []),
    prisma.leagueTeam
      .findMany({
        where: { league: { platformLeagueId: { in: platformIds } } },
        select: {
          externalId: true,
          teamName: true,
          ownerName: true,
          avatarUrl: true,
          claimedByUserId: true,
          platformUserId: true,
          league: {
            select: { id: true, platform: true, platformLeagueId: true },
          },
        },
      })
      .catch((): TeamRow[] => []),
  ])

  const seasonByLeague = new Map(
    seasonRows.flatMap((row) => row._max.seasonYear == null ? [] : [[row.leagueId, row._max.seasonYear] as const]),
  )
  const seasons = [...new Set(seasonByLeague.values())]
  const seasonCandidates: MatchupRow[] = await prisma.weeklyMatchup
    .findMany({
      where: { leagueId: { in: platformIds }, seasonYear: { in: seasons } },
      select: {
        leagueId: true,
        seasonYear: true,
        week: true,
        rosterId: true,
        matchupId: true,
        pointsFor: true,
        pointsAgainst: true,
        updatedAt: true,
      },
    })
    .then((rows) => rows.map((row) => ({ ...row, source: 'live_cache' as const })))
    .catch((): MatchupRow[] => [])

  const rowsByCandidateLeague = new Map<string, MatchupRow[]>()
  for (const row of seasonCandidates) {
    if (seasonByLeague.get(row.leagueId) !== row.seasonYear) continue
    const list = rowsByCandidateLeague.get(row.leagueId)
    if (list) list.push(row)
    else rowsByCandidateLeague.set(row.leagueId, [row])
  }

  /*
   * 🛑 A GUILLOTINE LEAGUE NEVER LEAVES WEEK 2 UNDER THE ROW RULE. `resolveCurrentWeekFrom` takes the
   * earliest week that still has a 0–0 row — and a chopped team keeps a 0–0 row in every week after
   * its chop. Measured 2026-10-03 on all six of one account's guillotine leagues: week 2 holds the
   * week-1 casualty at 0–0, so the rail sat on week 2 while the provider was on week 4. Scout, Your
   * Week's cut line and the War Room strip all drew last-but-one week's race.
   *
   * 🛑 AND THE ROW RULE FAILS HEAD-TO-HEAD LEAGUES TOO, MID-WEEK — EVERY ONE OF THEM, BY SUNDAY. Once
   * every matchup in a week has any points on the board (Thursday's game, the early slate), no 0–0 row
   * is left and the rule calls the week finished: it jumps to NEXT week's empty, unstarted fixture
   * while this week's games are still being played. Measured the next morning (Saturday, week 4): four
   * small leagues already on "week 5" with all week-4 rows scored and the provider saying 4. Larger
   * leagues reach the same state by Sunday afternoon and stay there until the provider rolls over.
   * (The guillotine-only first version of this fix — #1915 — said head-to-head was "right for them".
   * It is not; that was an assumption, and the measurement disproved it.)
   *
   * So EVERY league takes the provider's own stated period first — the rule `resolveCurrentWeek`
   * has always applied ("Prefer the saved provider period") and the rail did not — when the
   * season's rows carry that week. Measured before widening it, 2026-10-03: 493 of 494 in-season
   * Sleeper NFL leagues and 8 of 8 ESPN state week 4, synced within the hour; leagues with no stated
   * week, or one their rows do not carry, keep the row rule exactly as before.
   */
  const eliminationIds = [...new Set(leagues.filter((l) => l.elimination && l.platformLeagueId).map((l) => l.platformLeagueId!))]
  const statedByLeague = new Map<string, { seasonYear: number; week: number }>()
  if (platformIds.length > 0) {
    const meta = await readLeagueWeekMetadata([...new Set(platformIds)], 'platform').catch(() => [])
    for (const m of meta) {
      const week = leagueWeekFromSettings(m.settings)
      if (!m.platformLeagueId || m.season == null || week == null) continue
      /*
       * ⚠ ONE SLEEPER LEAGUE CAN BE SEVERAL `leagues` ROWS (one per importer), and an importer whose row
       * has not synced lately still carries an older period. The furthest-along statement wins — the
       * provider never moves backwards, so the newest season and highest week is the current one.
       */
      const held = statedByLeague.get(m.platformLeagueId)
      if (!held || m.season > held.seasonYear || (m.season === held.seasonYear && week > held.week)) {
        statedByLeague.set(m.platformLeagueId, { seasonYear: m.season, week })
      }
    }
  }

  const currentByLeague = new Map<string, { seasonYear: number; week: number }>()
  for (const [leagueId, rows] of rowsByCandidateLeague) {
    const stated = statedByLeague.get(leagueId)
    if (stated && rows.some((r) => r.seasonYear === stated.seasonYear && r.week === stated.week)) {
      currentByLeague.set(leagueId, stated)
      continue
    }
    const current = resolveCurrentWeekFrom(rows)
    if (current) currentByLeague.set(leagueId, { seasonYear: current.season, week: current.week })
  }

  /*
   * And the teams already out, so the standing ranks the LIVE field. Without this a chopped team's 0
   * was the field's lowest score — the cut line — so "95.7 over the cut" measured you against a team
   * that was already gone, and "#13 of 18" counted three of them.
   */
  const outByLeague = new Map<string, Set<string>>()
  for (const leagueId of eliminationIds) {
    const rows = rowsByCandidateLeague.get(leagueId)
    const current = currentByLeague.get(leagueId)
    if (rows && current) outByLeague.set(leagueId, choppedBefore(rows, current.week))
  }
  let matchups = seasonCandidates.filter((row) => {
    const current = currentByLeague.get(row.leagueId)
    return current?.seasonYear === row.seasonYear && current.week === row.week
  })

  /* Some importers historically materialized their schedule in MatchupFact
     before WeeklyMatchup parity existed. Use that canonical history only when
     the live cache has no row at all, so those leagues get their real opponent
     and score instead of a generic missing-schedule sentence. */
  const missingLeagues = leagues.filter((league) =>
    league.platformLeagueId && !currentByLeague.has(league.platformLeagueId),
  )
  if (missingLeagues.length > 0) {
    type FactRow = {
      matchupId: string
      leagueId: string
      weekOrPeriod: number
      teamA: string
      teamB: string
      scoreA: number
      scoreB: number
      season: number | null
      createdAt: Date
    }
    const facts: FactRow[] = await prisma.matchupFact.findMany({
      where: { leagueId: { in: missingLeagues.map((league) => league.id) } },
      select: {
        matchupId: true,
        leagueId: true,
        weekOrPeriod: true,
        teamA: true,
        teamB: true,
        scoreA: true,
        scoreB: true,
        season: true,
        createdAt: true,
      },
    }).catch((): FactRow[] => [])
    const factRowsByLeague = new Map<string, FactRow[]>()
    for (const fact of facts) {
      const list = factRowsByLeague.get(fact.leagueId)
      if (list) list.push(fact)
      else factRowsByLeague.set(fact.leagueId, [fact])
    }
    const missingById = new Map(missingLeagues.map((league) => [league.id, league]))
    const fallbackRows: MatchupRow[] = []
    for (const [dbLeagueId, leagueFacts] of factRowsByLeague) {
      const league = missingById.get(dbLeagueId)
      if (!league?.platformLeagueId) continue
      const inferredSeason = Math.max(...leagueFacts.map((fact) => fact.season ?? 0))
      const current = resolveCurrentWeekFrom(leagueFacts.map((fact) => ({
        seasonYear: fact.season ?? inferredSeason,
        week: fact.weekOrPeriod,
        pointsFor: fact.scoreA,
        pointsAgainst: fact.scoreB,
      })))
      if (!current) continue
      currentByLeague.set(league.platformLeagueId, { seasonYear: current.season, week: current.week })
      leagueFacts
        .filter((fact) => (fact.season ?? inferredSeason) === current.season && fact.weekOrPeriod === current.week)
        .forEach((fact, index) => {
          const common = {
            leagueId: league.platformLeagueId!,
            seasonYear: current.season,
            week: current.week,
            matchupId: index + 1,
            updatedAt: fact.createdAt,
            source: 'history_fallback' as const,
          }
          fallbackRows.push({ ...common, rosterId: fact.teamA, pointsFor: fact.scoreA, pointsAgainst: fact.scoreB })
          fallbackRows.push({ ...common, rosterId: fact.teamB, pointsFor: fact.scoreB, pointsAgainst: fact.scoreA })
        })
    }
    matchups = [...matchups, ...fallbackRows]
  }

  const resolved = [...currentByLeague.values()]
  if (resolved.length === 0) return EMPTY
  const latestSeason = Math.max(...resolved.map((row) => row.seasonYear))
  const weeksInLatest = resolved.filter((row) => row.seasonYear === latestSeason).map((row) => row.week)
  const weekCounts = new Map<number, number>()
  for (const week of weeksInLatest) weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1)
  const projectionWeek = [...weekCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1
  const sharedWeek = new Set(resolved.map((row) => `${row.seasonYear}:${row.week}`)).size === 1
    ? resolved[0]!.week
    : null
  const latest = { seasonYear: latestSeason, week: projectionWeek }

  type TeamMeta = {
    leagueId: string
    externalId: string
    platform: string | null
    name: string | null
    avatarUrl: string | null
    isYours: boolean
    /**
     * Every id this team might be filed under in `rosters`, in the order
     * `leagueScoreboard.ts` measured. `Roster.platformUserId` sometimes holds OUR
     * user uuid rather than the platform's, which is what the second candidate is
     * for; the third is the bare roster id.
     */
    rosterKeys: string[]
  }

  /** "platformLeagueId:externalId" → that team. */
  const teamByKey = new Map<string, TeamMeta>()
  /** Which roster is yours, per platform league. */
  const yourRosterByLeague = new Map<string, string>()

  for (const t of teams) {
    const pid = t.league?.platformLeagueId
    if (!pid || !t.externalId) continue
    const meta: TeamMeta = {
      leagueId: t.league!.id,
      externalId: String(t.externalId),
      platform: t.league?.platform ?? null,
      rosterKeys: [t.platformUserId, t.claimedByUserId, String(t.externalId)].filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      ),
      /*
       * ⚠ THE TEAM NAME, THEN THE OWNER'S — never the league's own name as a
       * stand-in. A roster the platform never named stays unnamed; borrowing the
       * league name would put "Dynasty Dragons vs Dynasty Dragons" in the rail.
       */
      name: t.teamName?.trim() || t.ownerName?.trim() || null,
      avatarUrl: managerArtUrl({ avatarUrl: t.avatarUrl, platform: t.league?.platform ?? null }),
      isYours: t.claimedByUserId === userId,
    }
    teamByKey.set(`${pid}:${t.externalId}`, meta)
    if (meta.isYours) yourRosterByLeague.set(pid, String(t.externalId))
  }

  /* Pair the week's rows by (league, matchupId) so an opponent can be named. */
  const pairs = new Map<string, typeof matchups>()
  for (const m of matchups) {
    if (m.matchupId == null) continue
    const key = `${m.leagueId}:${m.matchupId}`
    const list = pairs.get(key)
    if (list) list.push(m)
    else pairs.set(key, [m])
  }

  /*
   * ── Pass one: which fixture is yours, and is there anybody on the other side ──
   *
   * Resolved BEFORE any projection query runs, because it decides what those
   * queries have to cover. A paired league needs two lineups priced; an unpaired
   * one needs the whole league, or there is nothing to rank you against.
   */
  type Fixture = {
    you: TeamMeta
    opponent: TeamMeta | null
    row: MatchupRow
    unpaired: boolean
    elimination: boolean
    /** Every roster in this league's week, for the standing. Only filled when unpaired. */
    field: MatchupRow[]
  }
  const fixtures: Fixture[] = []
  /** Every row in the week, per platform league — the field an unpaired league ranks in. */
  const rowsByLeague = new Map<string, MatchupRow[]>()
  for (const m of matchups) {
    const list = rowsByLeague.get(m.leagueId)
    if (list) list.push(m)
    else rowsByLeague.set(m.leagueId, [m])
  }

  for (const m of matchups) {
    const yourRoster = yourRosterByLeague.get(m.leagueId)
    if (yourRoster == null || String(m.rosterId) !== yourRoster) continue

    const you = teamByKey.get(`${m.leagueId}:${m.rosterId}`)
    if (!you) continue

    /*
     * The opponent, from the pairing when the schedule carries a matchup id.
     *
     * ⚠ `pointsAgainst` IS THE FALLBACK, NOT THE SOURCE. It is always correct as
     * a number and never carries a name, so an unpaired row still shows a real
     * scoreline with the opponent left unnamed — which is honest — rather than
     * being dropped from the rail entirely.
     */
    const elimination = leagueByPlatformId.get(m.leagueId)?.elimination === true
    let opponent: TeamMeta | null = null
    if (!elimination && m.matchupId != null) {
      const pair = pairs.get(`${m.leagueId}:${m.matchupId}`) ?? []
      const other = pair.find((r) => String(r.rosterId) !== String(m.rosterId))
      if (other) opponent = teamByKey.get(`${m.leagueId}:${other.rosterId}`) ?? null
    }

    /*
     * ⚠ UNPAIRED IS A STRUCTURAL TEST, NOT A LABEL LOOKUP, AND THAT IS WHY IT
     * CATCHES THE LEAGUES A LABEL MISSES. Measured on production: of the seven of
     * this account's leagues whose week-1 rows pair with nobody, only five carry
     * `leagueType: 'guillotine'` — `Elimination Station 2` and `KBI Commish
     * Chopped` are both filed as 'redraft' and both write one matchupId per
     * roster. Asking the schedule "is there another team in this fixture" is the
     * question the rail actually has, and it answers it for all seven.
     */
    /* Guillotine is a field race even when a provider happens to assign paired
       matchup ids. A synthetic opponent must never replace the user's survival
       rank or distance from the weekly cut. */
    const mode = resolveRailMatchupMode(elimination, opponent != null)
    const unpaired = mode !== 'head_to_head'
    fixtures.push({
      you,
      opponent: unpaired ? null : opponent,
      row: m,
      unpaired,
      elimination,
      // The live field only: a chopped team's 0 is not a cut line (see `choppedBefore`).
      field: unpaired ? (rowsByLeague.get(m.leagueId) ?? []).filter((r) => !outByLeague.get(m.leagueId)?.has(String(r.rosterId))) : [],
    })
  }

  if (fixtures.length === 0) {
    return { byLeague: {}, season: latest.seasonYear, week: sharedWeek, projectionWeek: null }
  }

  const projections = await loadRailProjections({
    fixtures: fixtures.map((f) => ({
      dbLeagueId: f.you.leagueId,
      platformLeagueId: f.row.leagueId,
      /*
       * A paired league prices two lineups; an unpaired one prices its whole
       * field, because a rank without the field is not a rank.
       */
      rosterIds: f.unpaired
        ? f.field.map((r) => String(r.rosterId))
        : [String(f.row.rosterId), ...(f.opponent ? [f.opponent.externalId] : [])],
    })),
    teamByKey,
    season: latest.seasonYear,
    week: latest.week,
  })

  const byLeague: Record<string, RailMatchup> = {}

  for (const f of fixtures) {
    const { you, opponent, row } = f
    const scored = row.pointsFor !== 0 || row.pointsAgainst !== 0 || f.field.some(team => team.pointsFor !== 0)
    const priced = projections.byLeague.get(you.leagueId)

    byLeague[you.leagueId] = {
      leagueId: you.leagueId,
      yourTeam: you.name,
      yourAvatarUrl: you.avatarUrl,
      yourScore: row.pointsFor,
      yourProjection: priced?.sides.get(you.externalId) ?? null,
      opponentTeam: opponent?.name ?? null,
      opponentAvatarUrl: opponent?.avatarUrl ?? null,
      opponentScore: row.pointsAgainst,
      opponentProjection: opponent ? (priced?.sides.get(opponent.externalId) ?? null) : null,
      unpaired: f.unpaired,
      standing: f.unpaired
        ? standingIn({
            field: f.field,
            yourRosterId: String(row.rosterId),
            sides: priced?.sides ?? new Map(),
            scored,
            elimination: f.elimination || priced?.elimination === true,
          })
        : null,
      eliminated: outByLeague.get(row.leagueId)?.has(String(row.rosterId)) === true,
      scored,
      freshAt: row.updatedAt?.toISOString?.() ?? null,
      source: row.source,
      season: row.seasonYear,
      week: row.week,
    }
  }

  /*
   * 🛑 ONE SLEEPER LEAGUE IS SEVERAL AF LEAGUE ROWS, AND THE RAIL ASKS BY THE ROW IT DREW.
   * `teamByKey` is keyed on the PLATFORM league, so when three importers each wrote their own
   * `leagues` row for the same Sleeper league, `you.leagueId` is whichever of the three was read
   * last — and the rail, which looks each card up by its own `l.id`, found nothing for the other
   * two. With a live score overlaid the card still drew `0.0`, so the only visible symptom was
   * `PROJ —` on every duplicated league. Measured 2026-09-29 on `🪓 Guillotine League 26`: three
   * AF rows, one Sleeper id, projections present for all ten starters in both feeds.
   *
   * Every row the caller asked about now gets the fixture of the Sleeper league it belongs to.
   */
  const fixtureLeagueByPlatformId = new Map(fixtures.map((f) => [f.row.leagueId, f.you.leagueId]))
  for (const league of leagues) {
    if (!league.platformLeagueId || byLeague[league.id]) continue
    const source = fixtureLeagueByPlatformId.get(league.platformLeagueId)
    const entry = source ? byLeague[source] : undefined
    if (entry) byLeague[league.id] = { ...entry, leagueId: league.id }
  }

  return {
    byLeague,
    season: latest.seasonYear,
    week: sharedWeek,
    projectionWeek: projections.projectionWeek,
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * The projection half.
 * ─────────────────────────────────────────────────────────────────────────── */

type SidesForLeague = {
  sides: Map<string, RailSideProjection>
  elimination: boolean
}

type RailProjections = {
  byLeague: Map<string, SidesForLeague>
  projectionWeek: { season: string; week: number } | null
}

const NO_PROJECTIONS: RailProjections = { byLeague: new Map(), projectionWeek: null }

type LeagueMetaRow = {
  id: string
  sport: string | null
  platform: string | null
  scoring_settings: unknown
  scoringSettings: unknown
  yahoo_settings: unknown
  confirmedType: string | null
  leagueType: string | null
  guillotineMode: boolean | null
}

type StarterRow = {
  leagueId: string
  platformUserId: string | null
  starters: unknown
}

/**
 * A slot with nobody in it. Sleeper writes `"0"`; the importer writes a
 * `name:`-prefixed descriptor when it could not resolve a player, and those can
 * never join to a projection — both count against `starterCount` and neither is
 * priced, so a lineup half-full of them reports as half-priced rather than as a
 * small projection.
 */
function isPriceableId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw !== '0' && !raw.startsWith('name:')
}

function startersOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String) : []
}

export async function loadRailProjections(args: {
  fixtures: Array<{ dbLeagueId: string; platformLeagueId: string; rosterIds: string[] }>
  /* ReadonlyMap, not Map: `Map` is invariant in its value type, so the caller's
     richer `TeamMeta` would not assign to a narrower one. */
  teamByKey: ReadonlyMap<string, { externalId: string; rosterKeys: string[] }>
  season: number
  week: number
}): Promise<RailProjections> {
  const dbLeagueIds = [...new Set(args.fixtures.map((f) => f.dbLeagueId))]
  if (dbLeagueIds.length === 0) return NO_PROJECTIONS

  /*
   * ⚠ `$queryRawUnsafe` WITH A CONSTANT STATEMENT AND BOUND PARAMETERS, WHICH IS
   * NOT THE THING THE NAME WARNS ABOUT. Nothing is interpolated into either
   * string; the array arrives as `$1` and Postgres casts it. The reason for raw
   * SQL at all is the subpath: Prisma cannot select `settings->'scoring_settings'`,
   * and selecting `settings` whole moves 4.2 MB per render on this account.
   *
   * ⚠ AND THE THREE SCORING KEYS ARE THE COMPLETE INPUT, NOT A SAMPLE.
   * `extractScoringSettings` reads `scoring_settings`, `scoringSettings` (for the
   * ESPN/Yahoo rulebook bridge) and `yahoo_settings`, and nothing else. Adding a
   * fourth reader there without adding it here would silently downgrade every
   * league on this surface to the generic number.
   */
  const [leagueMeta, starterRows]: [LeagueMetaRow[], StarterRow[]] = await Promise.all([
    prisma
      .$queryRawUnsafe<LeagueMetaRow[]>(
        `SELECT id,
                "sport",
                "platform",
                settings->'scoring_settings' AS "scoring_settings",
                settings->'scoringSettings'  AS "scoringSettings",
                settings->'yahoo_settings'   AS "yahoo_settings",
                settings->'leagueTypeConfirmation'->>'type' AS "confirmedType",
                "leagueType",
                "guillotineMode"
           FROM leagues
          WHERE id = ANY($1::text[])`,
        dbLeagueIds,
      )
      .catch((): LeagueMetaRow[] => []),
    prisma
      .$queryRawUnsafe<StarterRow[]>(
        `SELECT "leagueId", "platformUserId", "playerData"->'starters' AS starters
           FROM rosters
          WHERE "leagueId" = ANY($1::text[])`,
        dbLeagueIds,
      )
      .catch((): StarterRow[] => []),
  ])

  /** "dbLeagueId:rosterKey" → that roster's starters. */
  const startersByKey = new Map<string, string[]>()
  /*
   * 🛑 A FOREIGN-ID LEAGUE PRICES NOTHING, NOT THE WRONG PLAYERS. This loader skips the crosswalk
   * on purpose (the header), which is harmless for ESPN — long ids collide with nobody, the side
   * prices nothing and renders `PROJ —`. A Fleaflicker/MFL/Fantrax/Yahoo starter id is a short
   * number in Sleeper's range (44 of 248 on the one production Fleaflicker league ARE Sleeper ids),
   * so it priced a stranger into the side's total and rank. Its starters are emptied: the side still
   * renders, as `PROJ —`, which is the true statement (isForeignIdSpace, rosterIdSpace.ts).
   */
  const foreignLeagues = new Set(leagueMeta.filter((m) => isForeignIdSpace(m.platform)).map((m) => m.id))
  for (const r of starterRows) {
    if (!r.platformUserId) continue
    startersByKey.set(`${r.leagueId}:${r.platformUserId}`, foreignLeagues.has(r.leagueId) ? [] : startersOf(r.starters))
  }

  /* Which lineup belongs to which side, resolved once so it is not re-derived per pass. */
  type Side = { dbLeagueId: string; externalId: string; starters: string[] }
  const sides: Side[] = []
  for (const f of args.fixtures) {
    for (const rosterId of new Set(f.rosterIds)) {
      const team = args.teamByKey.get(`${f.platformLeagueId}:${rosterId}`)
      const keys = team?.rosterKeys ?? [rosterId]
      let starters: string[] | null = null
      for (const k of keys) {
        const hit = startersByKey.get(`${f.dbLeagueId}:${k}`)
        if (hit) {
          starters = hit
          break
        }
      }
      if (!starters) continue
      sides.push({ dbLeagueId: f.dbLeagueId, externalId: rosterId, starters })
    }
  }
  if (sides.length === 0) return NO_PROJECTIONS

  const wanted = [...new Set(sides.flatMap((s) => s.starters).filter(isPriceableId))]
  if (wanted.length === 0) return NO_PROJECTIONS

  /*
   * ⚠ THE FEED HOLDS THE WEEK AHEAD AND OFTEN NOT THE ONE ON SCREEN, so an empty
   * result is asked about before it is believed. Measured 2026-09-08: the rail's
   * current week resolved to 2026 wk 1 and the feed held both wk 1 (1,008 rows)
   * and wk 2 (948) — but that is a coincidence of timing, not a guarantee, and
   * `leagueScoreboard.ts` already carries the same note. When the fallback fires,
   * `projectionWeek` says so and the UI labels it rather than passing a wrong-week
   * number off as this week's.
   */
  const asked = { season: String(args.season), week: args.week }
  let projectionWeek: { season: string; week: number } | null = asked
  /* Named, because `.catch(() => new Map())` otherwise widens this to a union
     with `Map<any, any>` and every `.get` below resolves against that half. */
  const empty = (): Awaited<ReturnType<typeof lookupProjections>> => new Map()
  let feed = await lookupProjections(wanted, asked).catch(empty)
  if (feed.size === 0) {
    const fallback = await latestProjectionWeek().catch(() => null)
    if (!fallback || (fallback.season === asked.season && fallback.week === asked.week)) {
      return NO_PROJECTIONS
    }
    feed = await lookupProjections(wanted, fallback).catch(empty)
    if (feed.size === 0) return NO_PROJECTIONS
    projectionWeek = fallback
  }
  /* The AF engine's week is the week the provider numbers came from, so the two columns never
     describe different weeks. A failed read leaves the provider columns exactly as they were. */
  const afEngineRows = await lookupAfEngineProjections(wanted, projectionWeek).catch(
    (): Awaited<ReturnType<typeof lookupAfEngineProjections>> => new Map(),
  )

  // A current injury cannot be applied to a fallback projection from another week.
  // All roster ids share one identity read and one availability read per sport.
  // `loadUnavailableBySport` is shared with the all-leagues matchup board.
  let unavailableBySport = new Map<string, Set<string>>()
  if (projectionWeek?.season === asked.season && projectionWeek.week === asked.week) {
    unavailableBySport = await loadUnavailableBySport({
      sleeperIds: wanted,
      sports: leagueMeta.map((l) => String(l.sport ?? 'NFL')),
      season: args.season,
      week: args.week,
    })
  }
  const sportByLeague = new Map(leagueMeta.map((l) => [l.id, String(l.sport ?? 'NFL').toUpperCase()]))
  const scoringByLeague = new Map<string, Record<string, unknown> | null>()
  const eliminationByLeague = new Map<string, boolean>()
  for (const l of leagueMeta) {
    scoringByLeague.set(
      l.id,
      extractScoringSettings({
        scoring_settings: l.scoring_settings,
        scoringSettings: l.scoringSettings,
        yahoo_settings: l.yahoo_settings,
      }),
    )
    /*
     * ⚠ `survivor_guillotine` IS AN ELIMINATION FORMAT TOO. The confirmation is read
     * first, and a confirmed Survivor Guillotine league's confirmation says
     * `survivor_guillotine` (only its column says `guillotine`), so matching the
     * one word alone would drop its elimination flag. The rule lives in
     * `eliminationFormat` so the matchup screens cannot read it differently.
     */
    eliminationByLeague.set(
      l.id,
      eliminationFormat({
        confirmedType: l.confirmedType,
        leagueType: l.leagueType,
        guillotineMode: l.guillotineMode,
      }) != null,
    )
  }

  const byLeague = new Map<string, SidesForLeague>()
  for (const side of sides) {
    const scoring = scoringByLeague.get(side.dbLeagueId) ?? null

    let vendor = 0
    let af = 0
    let vendorFrom = 0
    let afFrom = 0
    let engine = 0
    let engineFrom = 0
    /* Starters the engine actually wrote a row for. Known absences add a priced zero to
       `engineFrom`, but a side whose only "AF" figures are those zeros has no AF projection at
       all — it must render `—`, not a confident 0.0. */
    let engineRows = 0
    for (const id of side.starters) {
      if (!isPriceableId(id)) continue
      if (unavailableBySport.get(sportByLeague.get(side.dbLeagueId) ?? 'NFL')?.has(id)) {
        // Known absence is a priced zero, even when that player has no feed projection.
        vendorFrom += 1
        if (hasScoringRules(scoring)) afFrom += 1
        engineFrom += 1
        continue
      }
      const p = feed.get(id)
      const engineRow = afEngineRows.get(id)
      if (!p) {
        // No provider row, so no ratio to carry the AF number into this league: it stands as PPR.
        const raw = afEngineForLeague(engineRow?.projectedPoints, null, null)
        if (raw != null) {
          engine += raw
          engineFrom += 1
          engineRows += 1
        }
        continue
      }
      if (Number.isFinite(p.projectedPoints)) {
        vendor += p.projectedPoints
        vendorFrom += 1
      }
      /*
       * ⚠ NULL FROM `computeLeagueProjectedPoints` MEANS "NO SCORING KEY MATCHED",
       * NOT ZERO, and it must not be added as one. A production league matched
       * none and got a confident 0.00 the last time that distinction was lost.
       */
      const league = scoring && p.componentStats ? computeLeagueProjectedPoints(p.componentStats, scoring) : null
      if (league?.points != null && Number.isFinite(league.points)) {
        af += league.points
        afFrom += 1
      }
      const engineHere = afEngineForLeague(engineRow, p.projectedPoints, league?.points ?? null)
      if (engineHere != null) {
        engine += engineHere
        engineFrom += 1
        engineRows += 1
      }
    }

    const entry = byLeague.get(side.dbLeagueId) ?? {
      sides: new Map<string, RailSideProjection>(),
      elimination: eliminationByLeague.get(side.dbLeagueId) ?? false,
    }
    entry.sides.set(side.externalId, {
      projected: vendorFrom > 0 ? Math.round(vendor * 100) / 100 : null,
      afProjected: afFrom > 0 ? Math.round(af * 100) / 100 : null,
      afEngine: engineRows > 0 ? Math.round(engine * 100) / 100 : null,
      afEngineFrom: engineFrom,
      /*
       * The VENDOR count, because it is the one that gates whether a number is
       * shown at all. The AF count can be lower in an IDP league — the defenders
       * arrive without a defensive component line — which is exactly the
       * understatement the header records rather than hides.
       */
      pricedFrom: vendorFrom,
      starterCount: side.starters.filter(isPriceableId).length,
    })
    byLeague.set(side.dbLeagueId, entry)
  }

  return { byLeague, projectionWeek }
}

/**
 * Where you sit in a league with no head-to-head.
 *
 * ⚠ THE BASIS SWITCHES ON WHETHER ANYTHING HAS BEEN PLAYED, AND IT HAS TO.
 * Before kickoff every `pointsFor` in the league is 0, so ranking on points
 * would sort eighteen identical numbers into whatever order the rows arrived in
 * and print a confident "14th of 18". The projection is the only thing that
 * separates the teams in that window; once a point is scored, the score is the
 * answer and the projection stops being consulted.
 *
 * ⚠ AND IT REFUSES RATHER THAN RANKS A HALF-MEASURED FIELD. A league where only
 * some lineups priced would rank the priced ones above the rest by construction,
 * which is an artefact of coverage and not of the teams — the same stance
 * `leagueScoreboard.ts` takes before it draws a margin. Null here renders as no
 * rank at all, which is the honest rendering of "we cannot say".
 */
function standingIn(args: {
  field: Array<{ rosterId: string; pointsFor: number }>
  yourRosterId: string
  sides: Map<string, RailSideProjection>
  scored: boolean
  elimination: boolean
}): RailStanding | null {
  const { field, yourRosterId } = args
  if (field.length < 2) return null

  const basis: 'points' | 'projected' = args.scored ? 'points' : 'projected'

  const valued: Array<{ rosterId: string; value: number }> = []
  for (const r of field) {
    const id = String(r.rosterId)
    if (basis === 'points') {
      valued.push({ rosterId: id, value: r.pointsFor })
      continue
    }
    const side = args.sides.get(id)
    /* Prefer this league's own rules; the vendor number is the fallback, and a
       side with neither is not measured and cannot be placed. */
    const value = side?.afProjected ?? side?.projected ?? null
    if (value == null) return null
    valued.push({ rosterId: id, value })
  }
  if (valued.length !== field.length) return null

  valued.sort((a, b) => b.value - a.value)
  const index = valued.findIndex((v) => v.rosterId === yourRosterId)
  if (index < 0) return null

  const lowest = valued[valued.length - 1]!
  const yours = valued[index]!
  const isLowest = yours.value === lowest.value

  return {
    rank: 1 + valued.filter(team => team.value > yours.value).length,
    outOf: valued.length,
    overCut: isLowest ? null : Math.round((yours.value - lowest.value) * 100) / 100,
    basis,
    placesAboveCut: valued.filter(team => team.value < yours.value).length,
    cutLine: Math.round(lowest.value * 100) / 100,
    elimination: args.elimination,
  }
}

/**
 * The rosters a guillotine league has already chopped before `currentWeek`, from its own score rows.
 *
 * Two facts, applied week by week in order over the teams still alive:
 *   - a team at 0–0 in a week the rest of the field played is out (a chopped team keeps scoring 0);
 *   - the single lowest scorer of each COMPLETED week is chopped after it — the guillotine rule.
 *     Verified on production 2026-10-03 before it was written: across six leagues and three completed
 *     weeks each, every week's lowest scorer was 0–0 the following week, 18 of 18, no ties.
 *
 * ⚠ A TIE AT THE BOTTOM CHOPS NOBODY HERE. The provider's tiebreak is not on file, so guessing would
 * remove a live team; leaving both in costs one extra row in the field until the next week's 0–0
 * says which one went.
 *
 * Pure; exported for the test.
 */
export function choppedBefore(
  rows: ReadonlyArray<{ week: number; rosterId: string | number; pointsFor: number }>,
  currentWeek: number,
): Set<string> {
  const out = new Set<string>()
  const weeks = [...new Set(rows.map((r) => r.week))].filter((w) => w < currentWeek).sort((a, b) => a - b)
  for (const week of weeks) {
    const live = rows.filter((r) => r.week === week && !out.has(String(r.rosterId)))
    const scored = live.filter((r) => r.pointsFor > 0)
    // A week nobody scored in says nothing about who is out.
    if (scored.length === 0) continue
    for (const r of live) if (r.pointsFor <= 0) out.add(String(r.rosterId))
    const low = Math.min(...scored.map((r) => r.pointsFor))
    const lowest = scored.filter((r) => r.pointsFor === low)
    if (lowest.length === 1) out.add(String(lowest[0]!.rosterId))
  }
  return out
}
