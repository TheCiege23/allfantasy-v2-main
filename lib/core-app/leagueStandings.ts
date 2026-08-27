import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState } from './leagueHome'
import { isScored, resolveCurrentWeekFrom, type WeekScoreRow } from './currentWeek'

/**
 * Standings — this league's points-for board (38a·7).
 *
 * ⚠ THIS IS NOT `/core/rankings`. That screen is the cross-app AF ladder — XP,
 * levels, tiers, leaderboards — and measures a completely different thing that
 * happens to share the word. Two surfaces called "Rankings" would have been one
 * of them lying, so the XP ladder keeps the name and this ships as Standings.
 *
 * ⚠ NO NEW INGESTION. Every figure here derives from `WeeklyMatchup.pointsFor`,
 * the same table Your Week and Season Outlook read. Nothing new is fetched or
 * stored to build it.
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
  rosterId: number
  name: string | null
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
}

/**
 * Returned instead of the board when nothing can honestly be ranked.
 *
 * A separate shape rather than an empty `teams` array: an empty table and a
 * table that must not be drawn look identical to a screen, and only one of them
 * should render a heading with nothing under it.
 */
export type StandingsUnavailable = { available: false; reason: string; leagueName: string }

export type LeagueStandingsResult =
  | ({ available: true } & LeagueStandingsData)
  | StandingsUnavailable

/** Below this, a per-week average is noise rather than a pace. */
const MIN_WEEKS_TO_PROJECT = 3

type Row = WeekScoreRow & { rosterId: number; win: number }

/** Rank a set of point totals, highest first. Ties share the better rank. */
function rankBy(totals: Map<number, number>): Map<number, number> {
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const ranks = new Map<number, number>()
  let lastValue: number | null = null
  let lastRank = 0
  ordered.forEach(([rosterId, value], i) => {
    /*
     * Ties share a rank rather than being split by map insertion order, which is
     * arbitrary and would make two identical totals render as 4th and 5th with
     * nothing to justify the difference.
     */
    const rank = lastValue != null && value === lastValue ? lastRank : i + 1
    ranks.set(rosterId, rank)
    lastValue = value
    lastRank = rank
  })
  return ranks
}

export async function getLeagueStandings(
  leagueId: string,
  userId: string,
): Promise<LeagueStandingsResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, platformLeagueId: true },
  })

  const leagueName = leagueDisplayName(league?.name)

  if (!league?.platformLeagueId) {
    return {
      available: false,
      leagueName,
      reason:
        'this league has no platform id on file, and the weekly results this board is built from are stored against the provider’s id rather than ours',
    }
  }

  const pid = league.platformLeagueId

  const [rows, teams, mine] = await Promise.all([
    prisma.weeklyMatchup
      .findMany({
        where: { leagueId: pid },
        select: {
          seasonYear: true,
          week: true,
          rosterId: true,
          pointsFor: true,
          pointsAgainst: true,
          win: true,
        },
      })
      .catch(() => [] as Row[]),
    prisma.leagueTeam
      .findMany({
        where: { leagueId: league.id },
        select: { externalId: true, teamName: true, ownerName: true },
      })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: { leagueId: league.id, claimedByUserId: userId },
        select: { externalId: true },
      })
      .catch(() => []),
  ])

  if (rows.length === 0) {
    return {
      available: false,
      leagueName,
      reason:
        'no weekly results have been synced for this league yet — the board is built from scored weeks, and there are none on file',
    }
  }

  const resolved = resolveCurrentWeekFrom(rows)
  if (!resolved) {
    return { available: false, leagueName, reason: 'we could not work out which week this league is on' }
  }

  /*
   * ⚠ THE REFUSAL. Nothing scored means every roster sits on 0.0, and a ranking
   * of twelve zeroes is an arbitrary order wearing the clothes of a result. The
   * schedule being on file is not the same as the season having started.
   */
  if (resolved.scoredWeeks === 0) {
    return {
      available: false,
      leagueName,
      reason: `nothing has been scored in ${resolved.season} yet. The full schedule is already on file, so there are rows for every week — but ranking them would order twelve teams that have all scored nothing.`,
    }
  }

  const seasonRows = rows.filter((r) => r.seasonYear === resolved.season)

  const nameByRoster = new Map<number, string>()
  for (const t of teams) {
    const roster = Number(t.externalId)
    if (!Number.isFinite(roster)) continue
    // teamName is what the platform's own UI shows; ownerName is the person.
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (label) nameByRoster.set(roster, label)
  }

  const myRosters = new Set<number>()
  for (const t of mine) {
    const roster = Number(t.externalId)
    if (Number.isFinite(roster)) myRosters.add(roster)
  }

  /*
   * Cumulative points per roster, per week — the shape both the table and the
   * trend line need. Only scored rows contribute: an unplayed week must not
   * flatten an average or invent a rank change.
   */
  const scoredWeeks = [...new Set(seasonRows.filter(isScored).map((r) => r.week))].sort((a, b) => a - b)
  const cumulative = new Map<number, number>()
  const weeksPlayed = new Map<number, number>()
  const record = new Map<number, { wins: number; losses: number }>()
  const perWeekPoints = new Map<number, Map<number, number>>()
  const ranksByWeek = new Map<number, Map<number, number>>()

  for (const week of scoredWeeks) {
    const weekRows = seasonRows.filter((r) => r.week === week && isScored(r))
    const thisWeek = new Map<number, number>()
    for (const r of weekRows) {
      cumulative.set(r.rosterId, (cumulative.get(r.rosterId) ?? 0) + r.pointsFor)
      weeksPlayed.set(r.rosterId, (weeksPlayed.get(r.rosterId) ?? 0) + 1)
      thisWeek.set(r.rosterId, r.pointsFor)
      const rec = record.get(r.rosterId) ?? { wins: 0, losses: 0 }
      if (r.win > 0) rec.wins += 1
      else rec.losses += 1
      record.set(r.rosterId, rec)
    }
    perWeekPoints.set(week, thisWeek)
    ranksByWeek.set(week, rankBy(new Map(cumulative)))
  }

  const latestWeek = scoredWeeks[scoredWeeks.length - 1]
  const priorWeek = scoredWeeks.length > 1 ? scoredWeeks[scoredWeeks.length - 2] : null
  const finalRanks = ranksByWeek.get(latestWeek) ?? new Map<number, number>()
  const priorRanks = priorWeek != null ? ranksByWeek.get(priorWeek) ?? null : null

  const teamRows: StandingRow[] = [...cumulative.entries()]
    .map(([rosterId, pointsFor]) => {
      const played = weeksPlayed.get(rosterId) ?? 0
      const rank = finalRanks.get(rosterId) ?? 0
      const before = priorRanks?.get(rosterId)
      const rec = record.get(rosterId) ?? { wins: 0, losses: 0 }
      return {
        rosterId,
        name: nameByRoster.get(rosterId) ?? null,
        isYou: myRosters.has(rosterId),
        rank,
        pointsFor,
        average: played > 0 ? pointsFor / played : null,
        weeksPlayed: played,
        wins: rec.wins,
        losses: rec.losses,
        // Positive is an improvement: moving from 5th to 2nd is +3.
        movement: before != null ? before - rank : null,
      }
    })
    .sort((a, b) => a.rank - b.rank || b.pointsFor - a.pointsFor)

  const you = teamRows.find((t) => t.isYou) ?? null

  const trend: RankTrendPoint[] =
    you && scoredWeeks.length > 1
      ? scoredWeeks.flatMap((week) => {
          const rank = ranksByWeek.get(week)?.get(you.rosterId)
          if (rank == null) return []
          let running = 0
          for (const w of scoredWeeks) {
            if (w > week) break
            running += perWeekPoints.get(w)?.get(you.rosterId) ?? 0
          }
          return [{ week, rank, pointsFor: running }]
        })
      : []

  const recent: RecentWeek[] = you
    ? [...scoredWeeks]
        .reverse()
        .slice(0, 5)
        .flatMap((week) => {
          const pf = perWeekPoints.get(week)?.get(you.rosterId)
          if (pf == null) return []
          const rank = ranksByWeek.get(week)?.get(you.rosterId) ?? 0
          /*
           * Measured against the roster's own average through the PRIOR week,
           * so "+14.5" means "better than your normal", not "better than last
           * week" — one good week does not make the next one a disappointment.
           */
          const earlier = scoredWeeks.filter((w) => w < week)
          const priorTotal = earlier.reduce(
            (acc, w) => acc + (perWeekPoints.get(w)?.get(you.rosterId) ?? 0),
            0,
          )
          const priorAvg = earlier.length > 0 ? priorTotal / earlier.length : null
          return [{ week, pointsFor: pf, delta: priorAvg == null ? null : pf - priorAvg, rank }]
        })
    : []

  /*
   * Projection. Weeks remaining comes from the schedule already on file rather
   * than a league-length constant — a league with a 17-week regular season and
   * one with 14 are both normal, and assuming either is how a projection ends
   * up quietly wrong.
   */
  const allWeeks = [...new Set(seasonRows.map((r) => r.week))]
  const scheduleLength = allWeeks.length > 0 ? Math.max(...allWeeks) : 0
  const weeksRemaining = Math.max(0, scheduleLength - latestWeek)

  const projection: SectionState<StandingsProjection> =
    you == null
      ? { available: false, reason: 'we cannot tell which team in this league is yours' }
      : you.weeksPlayed < MIN_WEEKS_TO_PROJECT
        ? {
            available: false,
            reason: `a pace needs at least ${MIN_WEEKS_TO_PROJECT} scored weeks behind it — you have ${you.weeksPlayed}`,
          }
        : weeksRemaining === 0
          ? { available: false, reason: 'the regular season is over — this is the final total' }
          : (() => {
              const avg = you.average ?? 0
              const played = scoredWeeks.filter((w) => perWeekPoints.get(w)?.has(you.rosterId))
              const values = played.map((w) => perWeekPoints.get(w)!.get(you.rosterId)!)
              const variance =
                values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / Math.max(1, values.length - 1)
              const sigma = Math.sqrt(Math.max(0, variance))
              /*
               * The band is the standard error of the remaining weeks' total,
               * not one week's spread — σ√n, because n independent weeks of
               * variance add in quadrature. Using σ alone would give a band far
               * too narrow to be honest about a four-week projection.
               */
              const band = sigma * Math.sqrt(weeksRemaining)
              const mid = you.pointsFor + avg * weeksRemaining
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
    season: resolved.season,
    week: resolved.week,
    seasonComplete: resolved.seasonComplete,
    teams: teamRows,
    you,
    trend,
    recent,
    projection,
    scoredWeeks: resolved.scoredWeeks,
  }
}
