import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState } from './leagueHome'
import { leagueContextFor, type LeagueContext } from './leagueContext'
import {
  advanceWeek,
  buildStandingsBoard,
  chainStamps,
  isScoredRow,
  readStandingsRules,
  weekStamp,
  type RemainingGame,
  type StandingsBoard,
  type TeamMeta,
  type WeekRow,
  type WeekSnapshot,
} from './standingsModel'
import { readStandingsSnapshots, writeStandingsSnapshots } from './standingsSnapshots'
import { parseStandingsDivisions } from '@/lib/league-import/standingsDivisions'

/**
 * Standings — this league's table (38a·7), official and power.
 *
 * 2026-09-17 brief: the screen now carries the platform's table (record, tiebreaker, playoff line) beside
 * AllFantasy's power ranking, the week-by-week history, all-play and expected wins, divisions and
 * projected records. The maths is in `standingsModel.ts` (pure); this file reads and assembles, and
 * `standingsSnapshots.ts` stores each settled week so a visit folds only what is new.
 *
 * `teams` below is still the points-for list `/core/rankings` reads, now with records that come from
 * paired results rather than `WeeklyMatchup.win` (see the model's header for why that column lied).
 *
 * ⚠ THIS IS NOT `/core/rankings`. That screen is the cross-app AF ladder — XP,
 * levels, tiers, leaderboards — and measures a completely different thing that
 * happens to share the word. Two surfaces called "Rankings" would have been one
 * of them lying, so the XP ladder keeps the name and this ships as Standings.
 *
 * ⚠ NO NEW INGESTION. Every result here derives from `WeeklyMatchup`, the same
 * table Your Week and Season Outlook read, checked against `LeagueTeam`'s reported
 * records. The only thing written is the per-week snapshot, which is a cache of
 * this file's own arithmetic and can always be rebuilt.
 *
 * ── The gate that matters ────────────────────────────────────────────────
 *
 * The Sleeper sync writes the entire schedule as 0-0 rows before a single game
 * is played — 9,354 rows for season 2026 with none scored, measured on
 * production 2026-08-23. Ranking twelve teams on that produces twelve teams tied
 * at 0.0 in whatever order the sort happened to leave them, presented as a
 * standings table. `unavailable` below is that refusal, and it is the single
 * most important line in this file.
 */

export type StandingRow = {
  rosterId: string
  name: string | null
  avatarUrl: string | null
  isYou: boolean
  /** Rank by points for, 1 = most. */
  rank: number
  pointsFor: number
  /** Per completed week. Null when this roster has no scored week. */
  average: number | null
  /** Weeks this roster has actually been scored in. */
  weeksPlayed: number
  wins: number
  losses: number
  /**
   * Rank change against last completed week. Null when there is no prior week
   * to compare against — the first scored week has no movement, and rendering
   * "—" there is different from rendering "no change".
   */
  movement: number | null
}

export type RankTrendPoint = {
  week: number
  rank: number
  /** Cumulative points for through this week. */
  pointsFor: number
}

export type RecentWeek = {
  week: number
  pointsFor: number
  /** Against the roster's own average to that point. Null in week one. */
  delta: number | null
  rank: number
}

export type StandingsProjection = {
  /** Current pace × weeks remaining, added to what is banked. */
  mid: number
  low: number
  high: number
  weeksRemaining: number
  basis: string
}

export type LeagueStandingsData = {
  league: { id: string; name: string; platform: string }
  season: number
  /** The week the league is currently on, by the shared frontier rule. */
  week: number
  seasonComplete: boolean
  teams: StandingRow[]
  you: StandingRow | null
  /** Your own rank history, week by week. Empty when fewer than two weeks are scored. */
  trend: RankTrendPoint[]
  /** Your last few scored weeks, newest first. */
  recent: RecentWeek[]
  /** Withheld when the season has too little scored to project from. */
  projection: SectionState<StandingsProjection>
  /** Weeks with at least one scored row. */
  scoredWeeks: number
  /** Completed seasons from the import, newest first. Empty when none were imported. */
  history: SeasonHistoryRow[]
  /** Official and power tables, history, zones, projections — see `standingsModel.ts`. */
  board: StandingsBoard
}

/**
 * Returned instead of the board when nothing can honestly be ranked.
 *
 * A separate shape rather than an empty `teams` array: an empty table and a
 * table that must not be drawn look identical to a screen, and only one of them
 * should render a heading with nothing under it.
 */
/**
 * A completed season, as the import recorded it.
 *
 * ⚠ NOT A `StandingRow`, AND THAT IS THE POINT. `StandingRow.rosterId` is a NUMBER,
 * which is a Sleeper roster id, and an ESPN or MFL team key need not be numeric.
 * Forcing season history through that shape would coerce those to NaN and quietly
 * drop those leagues — so history carries the provider's own string key and is
 * ranked by what was recorded, not by the week-by-week maths this module does for
 * the live season.
 *
 * ⚠ FANTRAX USED TO BE THE HEADLINE EXAMPLE HERE and no longer is: its team keys
 * were `fantrax-team:ciege82` until `lib/league-import/fantrax/fantraxTeamIds.ts`
 * made them numeric, precisely because `NaN` was silently emptying the scoreboard.
 * The reasoning above still holds for the providers that remain, which is why this
 * shape is unchanged — but do not cite Fantrax for it.
 */
export type SeasonHistoryRow = {
  season: number
  /** The provider's team key — `LeagueTeam.externalId`, not a roster number. */
  teamKey: string
  name: string | null
  isYou: boolean
  /** As recorded at season end. Null when the provider did not report a finish. */
  rank: number | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
}

export type StandingsUnavailable = {
  available: false
  reason: string
  leagueName: string
  /*
   * Present even here, and deliberately. A league whose current season has no scored
   * weeks still has every completed season the import wrote — answering "nothing to
   * rank" while holding ten finished seasons is the failure this field exists to end.
   */
  history: SeasonHistoryRow[]
}

export type LeagueStandingsResult =
  | ({ available: true } & LeagueStandingsData)
  | StandingsUnavailable

/** Below this, a per-week average is noise rather than a pace. */
const MIN_WEEKS_TO_PROJECT = 3

/** One grouped row per season-week — the whole league's shape without reading a single matchup row. */
type WeekStat = { seasonYear: number; week: number; rows: number; scored: number; pointsFor: number; pointsAgainst: number }

/**
 * ⚠ RAW SQL BECAUSE PRISMA'S `groupBy` CANNOT COUNT A FILTERED SUBSET. The scored count per week is what
 * separates a finished week from a scheduled one, and the sums are the snapshot stamp. The table name is
 * the model name — `WeeklyMatchup` has no `@@map`.
 */
async function readWeekStats(platformLeagueId: string): Promise<WeekStat[]> {
  const rows = await prisma.$queryRaw<
    Array<{ seasonYear: number; week: number; rows: number; scored: number; pf: number; pa: number }>
  >`
    SELECT "seasonYear", "week",
           COUNT(*)::int AS "rows",
           COUNT(*) FILTER (WHERE "pointsFor" > 0 OR "pointsAgainst" > 0)::int AS "scored",
           COALESCE(SUM("pointsFor"), 0)::float8 AS "pf",
           COALESCE(SUM("pointsAgainst"), 0)::float8 AS "pa"
    FROM "WeeklyMatchup"
    WHERE "leagueId" = ${platformLeagueId}
    GROUP BY "seasonYear", "week"
  `
  return (rows ?? []).map((r) => ({
    seasonYear: Number(r.seasonYear),
    week: Number(r.week),
    rows: Number(r.rows),
    scored: Number(r.scored),
    pointsFor: Number(r.pf),
    pointsAgainst: Number(r.pa),
  }))
}

/** Unplayed pairings: both rows of a `matchupId` group still at zero. */
function unplayedPairs(rows: WeekRow[]): RemainingGame[] {
  const groups = new Map<string, WeekRow[]>()
  for (const r of rows) {
    if (r.matchupId == null) continue
    const key = `${r.week}:${r.matchupId}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  const out: RemainingGame[] = []
  for (const g of groups.values()) {
    if (g.length === 2 && !isScoredRow(g[0]) && !isScoredRow(g[1])) out.push({ week: g[0].week, a: g[0].rosterId, b: g[1].rosterId })
  }
  return out
}

/** Ties share the better rank. */
function pointsRankMap(snap: WeekSnapshot | undefined): Map<string, number> {
  const teams = [...(snap?.teams ?? [])].sort((a, b) => b.pf - a.pf)
  const out = new Map<string, number>()
  teams.forEach((t, i) => {
    const prev = teams[i - 1]
    out.set(t.r, prev && prev.pf === t.pf ? out.get(prev.r)! : i + 1)
  })
  return out
}

/**
 * Completed seasons for this league, from `SeasonStandingFact` — written by every
 * provider's historical backfill and, until now, read by nothing.
 *
 * Joined on `LeagueTeam.externalId`: the backfills write the provider's own team id
 * into `teamId`, and the roster mappers write that same value into `source_team_id`,
 * which is what `externalId` holds. Verified against the ESPN and Fantrax writers
 * rather than assumed — this repo has a long history of id spaces that look
 * interchangeable and are not.
 *
 * ⚠ Sleeper does NOT write this table. Its historical backfill persists standings
 * through `persistStandings`/dynasty seasons instead, so a Sleeper league returning
 * an empty history here is expected and not a fault to chase.
 */
async function loadSeasonHistory(lc: LeagueContext): Promise<SeasonHistoryRow[]> {
  const { leagueId } = lc
  const [facts, teams, mine] = await Promise.all([
    prisma.seasonStandingFact
      .findMany({
        where: { leagueId },
        orderBy: [{ season: 'desc' }, { rank: 'asc' }],
        select: {
          season: true,
          teamId: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          pointsAgainst: true,
          rank: true,
        },
      })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({ where: { leagueId }, select: { externalId: true, teamName: true, ownerName: true } })
      .catch(() => []),
    lc.claimedTeams().catch(() => []),
  ])

  if (facts.length === 0) return []

  /*
   * ⚠ AN UNPLAYED SEASON IS NOT A PAST SEASON. The ESPN backfill writes a
   * SeasonStandingFact for every team whether or not the season finished — its
   * `isFinished` gate gates `persistStandings`, and the fact upsert sits OUTSIDE it.
   * So a league that has not kicked off yields a full set of 0-0 rows, and this
   * screen printed the CURRENT season under "Past seasons" with every team ranked
   * first. Observed on a live ESPN league.
   *
   * Filtered on the data rather than on a flag, because the flag is on the writer and
   * the rows are already in the database: a season where no team has a win, a loss, a
   * tie or a point has not been played, whatever the provider said about it.
   */
  const playedSeasons = new Set<number>()
  for (const f of facts) {
    if (f.wins > 0 || f.losses > 0 || f.ties > 0 || f.pointsFor > 0) playedSeasons.add(f.season)
  }
  const played = facts.filter((f) => playedSeasons.has(f.season))
  if (played.length === 0) return []

  const nameByKey = new Map<string, string>()
  for (const t of teams) {
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (t.externalId && label) nameByKey.set(t.externalId, label)
  }
  const yours = new Set(mine.map((t) => t.externalId).filter(Boolean) as string[])

  return played.map((f) => ({
    season: f.season,
    teamKey: f.teamId,
    name: nameByKey.get(f.teamId) ?? null,
    isYou: yours.has(f.teamId),
    rank: f.rank ?? null,
    wins: f.wins,
    losses: f.losses,
    ties: f.ties,
    pointsFor: f.pointsFor,
    pointsAgainst: f.pointsAgainst,
  }))
}

export async function getLeagueStandings(
  leagueId: string,
  userId: string,
  /** The render's shared league context — see `leagueContext.ts`. */
  ctx?: LeagueContext | null,
): Promise<LeagueStandingsResult> {
  const lc = leagueContextFor(leagueId, userId, ctx)
  const league = await lc.league()

  const leagueName = leagueDisplayName(league?.name)

  /*
   * Fetched before any early return, because every one of them is a state where the
   * live board cannot be drawn and the imported seasons are exactly what the screen
   * should show instead.
   */
  const history = league ? await loadSeasonHistory(lc) : []

  if (!league?.platformLeagueId) {
    return {
      available: false,
      leagueName,
      history,
      reason:
        'this league has no platform id on file, and the weekly results this board is built from are stored against the provider’s id rather than ours',
    }
  }


  const pid = league.platformLeagueId

  const [weekStats, leagueTeams, mine] = await Promise.all([
    readWeekStats(pid).catch(() => [] as WeekStat[]),
    prisma.leagueTeam
      .findMany({
        where: { leagueId: league.id },
        select: {
          externalId: true,
          teamName: true,
          ownerName: true,
          avatarUrl: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          pointsAgainst: true,
          currentRank: true,
        },
      })
      .catch(() => []),
    // The same claimed-team read the season history used above, not a second one.
    lc.claimedTeams().catch(() => []),
  ])

  if (weekStats.length === 0) {
    return {
      available: false,
      leagueName,
      history,
      reason:
        'no weekly results have been synced for this league yet — the board is built from scored weeks, and there are none on file',
    }
  }

  const season = Math.max(...weekStats.map((w) => w.seasonYear))
  const seasonWeeks = weekStats.filter((w) => w.seasonYear === season).sort((a, b) => a.week - b.week)
  const scoredWeekCount = seasonWeeks.filter((w) => w.scored > 0).length
  /*
   * "This week" by the shared frontier rule (`currentWeek.ts`): the earliest week that still carries an
   * unscored row, or the last week once every row is scored.
   */
  const firstUnplayed = seasonWeeks.find((w) => w.scored < w.rows)
  const week = firstUnplayed?.week ?? seasonWeeks[seasonWeeks.length - 1].week
  const seasonComplete = firstUnplayed == null

  /*
   * ⚠ THE REFUSAL. Nothing scored means every roster sits on 0.0, and a ranking of twelve zeroes is an
   * arbitrary order wearing the clothes of a result. The schedule being on file is not the same as the
   * season having started.
   */
  if (scoredWeekCount === 0) {
    return {
      available: false,
      leagueName,
      history,
      reason: `nothing has been scored in ${season} yet. The full schedule is already on file, so there are rows for every week — but ranking them would order twelve teams that have all scored nothing.`,
    }
  }

  const teamCount = new Set(leagueTeams.map((t) => t.externalId)).size || seasonWeeks[0].rows
  const rules = readStandingsRules(league.settings, teamCount, league.platform)
  /*
   * Playoff weeks are not standings. If the league's regular season would exclude every scored week, the
   * setting is wrong for this data and is ignored rather than emptying the board.
   */
  const regularEnd =
    rules.regularSeasonEnd != null && seasonWeeks.some((w) => w.scored > 0 && w.week <= rules.regularSeasonEnd!)
      ? rules.regularSeasonEnd
      : null
  const regularWeeks = seasonWeeks.filter((w) => regularEnd == null || w.week <= regularEnd)
  const scored = regularWeeks.filter((w) => w.scored > 0)
  const stamps = chainStamps(scored.map(weekStamp))

  // Stored weeks, trusted for as long as the leading run of them still matches its stamp.
  const stored = await readStandingsSnapshots(
    pid,
    season,
    scored.map((w) => w.week),
  ).catch(() => new Map<number, WeekSnapshot>())
  let kept = 0
  while (kept < scored.length && stored.get(scored[kept].week)?.stamp === stamps[kept]) kept += 1
  const foldFrom = kept > 0 ? scored[kept - 1].week : null

  const weekFilter: { gt?: number; lte?: number } = {}
  if (foldFrom != null) weekFilter.gt = foldFrom
  if (regularEnd != null) weekFilter.lte = regularEnd
  const rows: WeekRow[] = await prisma.weeklyMatchup
    .findMany({
      where: {
        leagueId: pid,
        seasonYear: season,
        ...(Object.keys(weekFilter).length > 0 ? { week: weekFilter } : {}),
      },
      select: { week: true, rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true },
    })
    .catch(() => [] as WeekRow[])

  const rosterIds = [
    ...new Set([
      ...rows.map((r) => r.rosterId),
      ...(kept > 0 ? stored.get(scored[kept - 1].week)!.teams.map((t) => t.r) : []),
    ]),
  ]

  const snapshots: WeekSnapshot[] = scored.slice(0, kept).map((w) => stored.get(w.week)!)
  const rowsByWeek = new Map<number, WeekRow[]>()
  for (const r of rows) {
    const bucket = rowsByWeek.get(r.week)
    if (bucket) bucket.push(r)
    else rowsByWeek.set(r.week, [r])
  }
  for (let i = kept; i < scored.length; i += 1) {
    const w = scored[i].week
    snapshots.push(advanceWeek(snapshots[i - 1] ?? null, season, w, rowsByWeek.get(w) ?? [], rosterIds, stamps[i]))
  }

  const nameByRoster = new Map<string, string>()
  const divisions = parseStandingsDivisions(league.settings)
  const myRosters = new Set(mine.map((t) => t.externalId).filter(Boolean) as string[])
  const onBoard = new Set(rosterIds)
  const isSleeper = String(league.platform ?? '').toLowerCase() === 'sleeper'
  const teams: TeamMeta[] = leagueTeams
    .filter((t) => t.externalId && onBoard.has(t.externalId))
    .map((t) => {
      // teamName is what the platform's own UI shows; ownerName is the person.
      const name = t.teamName?.trim() || t.ownerName?.trim() || null
      if (name) nameByRoster.set(t.externalId, name)
      const divisionKey = divisions?.teams[t.externalId] ?? null
      return {
        rosterId: t.externalId,
        name,
        avatarUrl: t.avatarUrl?.trim() || null,
        isYou: myRosters.has(t.externalId),
        division: divisionKey ? { key: divisionKey, name: divisions!.names[divisionKey] ?? `Division ${divisionKey}` } : null,
        reported: {
          wins: t.wins,
          losses: t.losses,
          ties: t.ties,
          pointsFor: t.pointsFor,
          // Sleeper's sync never reads points against, and writes 0.
          pointsAgainst: isSleeper ? null : t.pointsAgainst,
          rank: rules.rankIsOfficial ? t.currentRank : null,
        },
      }
    })
  for (const id of rosterIds) {
    if (!teams.some((t) => t.rosterId === id)) {
      teams.push({ rosterId: id, name: null, avatarUrl: null, isYou: myRosters.has(id), division: null, reported: null })
    }
  }

  const board = buildStandingsBoard({ season, snapshots, unplayed: unplayedPairs(rows), teams, rules })

  /*
   * Store what is settled and new. Awaited so a serverless runtime cannot drop it, and bounded: at most
   * the weeks folded on this visit, normally zero or one.
   */
  const toStore = snapshots
    .slice(kept)
    .filter((s) => board.settledThrough != null && s.week <= board.settledThrough)
  if (toStore.length > 0) await writeStandingsSnapshots(pid, toStore).catch(() => 0)

  // ── The points-for list, your trend, recent weeks and pace — the screen's "your season" half ──

  const final = snapshots.filter((s) => s.week <= board.throughWeek)
  const latest = final[final.length - 1]
  const pfRanks = final.map((s) => pointsRankMap(s))
  const nowRanks = pfRanks[pfRanks.length - 1] ?? new Map<string, number>()
  const beforeRanks = pfRanks.length > 1 ? pfRanks[pfRanks.length - 2] : null

  const teamRows: StandingRow[] = board.teams
    .filter((t) => t.weeksPlayed > 0)
    .map((t) => {
      const before = beforeRanks?.get(t.rosterId)
      const rank = nowRanks.get(t.rosterId) ?? t.pfRank
      return {
        rosterId: t.rosterId,
        name: nameByRoster.get(t.rosterId) ?? null,
        avatarUrl: t.avatarUrl,
        isYou: t.isYou,
        rank,
        pointsFor: t.pointsFor,
        average: t.average,
        weeksPlayed: t.weeksPlayed,
        wins: t.record.wins,
        losses: t.record.losses,
        // Positive is an improvement: moving from 5th to 2nd is +3.
        movement: before != null ? before - rank : null,
      }
    })
    .sort((a, b) => a.rank - b.rank || b.pointsFor - a.pointsFor)

  const you = teamRows.find((t) => t.isYou) ?? null
  const youBoard = board.teams.find((t) => t.isYou) ?? null

  // Your place in the official table, week by week.
  const trend: RankTrendPoint[] =
    youBoard && final.length > 1
      ? (board.history[youBoard.rosterId] ?? []).map((p, i) => ({
          week: p.week,
          rank: p.seed,
          pointsFor: final[i]?.teams.find((x) => x.r === youBoard.rosterId)?.pf ?? 0,
        }))
      : []

  const recent: RecentWeek[] = youBoard
    ? final
        .map((snap, i) => {
          const mineNow = snap.teams.find((x) => x.r === youBoard.rosterId)
          if (!mineNow || mineNow.pts == null) return null
          const prev = i > 0 ? final[i - 1].teams.find((x) => x.r === youBoard.rosterId) : null
          /*
           * Measured against the roster's own average through the PRIOR week, so "+14.5" means "better
           * than your normal", not "better than last week".
           */
          const priorAvg = prev && prev.n > 0 ? prev.pf / prev.n : null
          return {
            week: snap.week,
            pointsFor: mineNow.pts,
            delta: priorAvg == null ? null : mineNow.pts - priorAvg,
            rank: pfRanks[i].get(youBoard.rosterId) ?? 0,
          }
        })
        .filter((r): r is RecentWeek => r != null)
        .reverse()
        .slice(0, 5)
    : []

  /*
   * Projected final points. Games remaining come from YOUR remaining regular-season schedule rather than
   * a league-length constant, so a 14-week league and a 17-week one are both right.
   */
  const weeksRemaining = youBoard?.gamesLeft ?? 0
  const projection: SectionState<StandingsProjection> =
    you == null || youBoard == null
      ? { available: false, reason: 'we cannot tell which team in this league is yours' }
      : youBoard.weeksPlayed < MIN_WEEKS_TO_PROJECT
        ? {
            available: false,
            reason: `a pace needs at least ${MIN_WEEKS_TO_PROJECT} scored weeks behind it — you have ${youBoard.weeksPlayed}`,
          }
        : weeksRemaining === 0
          ? { available: false, reason: 'the regular season is over — this is the final total' }
          : (() => {
              const values = final
                .map((s) => s.teams.find((x) => x.r === youBoard.rosterId)?.pts)
                .filter((v): v is number => v != null)
              const avg = youBoard.average ?? 0
              const variance = values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / Math.max(1, values.length - 1)
              /*
               * The band is the standard error of the remaining weeks' total, σ√n — n independent weeks of
               * variance add in quadrature. σ alone would be far too narrow for a four-week projection.
               */
              const band = Math.sqrt(Math.max(0, variance)) * Math.sqrt(weeksRemaining)
              const mid = youBoard.pointsFor + avg * weeksRemaining
              return {
                available: true,
                data: {
                  mid,
                  low: mid - band,
                  high: mid + band,
                  weeksRemaining,
                  basis: `Projects your ${avg.toFixed(1)} per week across the ${weeksRemaining} ${
                    weeksRemaining === 1 ? 'game' : 'games'
                  } left. The range is one standard deviation of your own weekly scoring over ${values.length} scored ${
                    values.length === 1 ? 'week' : 'weeks'
                  }.`,
                },
              }
            })()

  return {
    available: true,
    league: {
      id: league.id,
      name: leagueName,
      platform: String(league.platform ?? 'manual').toLowerCase(),
    },
    season,
    week,
    seasonComplete,
    teams: teamRows,
    you,
    trend,
    recent,
    projection,
    scoredWeeks: latest ? final.length : scoredWeekCount,
    history,
    board,
  }
}
