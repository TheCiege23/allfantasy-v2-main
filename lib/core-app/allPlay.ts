import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * All-play records and power rankings, from the weeks that were actually
 * played.
 *
 * ⚠ ALL-PLAY IS THE ANSWER TO "AM I UNLUCKY OR AM I BAD", and a head-to-head
 * record cannot answer it. A 12-team league plays one opponent a week, so a
 * team can score the second-most points in the league and lose. All-play asks
 * what the record would be if you played EVERYONE every week, which removes the
 * schedule entirely — and the gap between the two is luck, measured rather than
 * felt.
 *
 * ⚠ SCORED WEEKS ONLY, AND "SCORED" IS A PROPERTY OF THE WEEK. Sync bootstraps
 * every week at 0-0, so a week where nobody has points is not a week of ties —
 * it has not been played. Counting those would hand every team a pile of
 * all-play ties and drag every record toward .500, which is exactly the signal
 * this exists to measure.
 *
 * ⚠ `WeeklyMatchup.leagueId` HOLDS THE PLATFORM LEAGUE ID, NOT `League.id`.
 */

export type AllPlayRow = {
  rosterId: number
  teamName: string | null
  managerName: string | null
  avatarUrl: string | null
  /** Real head-to-head record over the scored weeks. */
  wins: number
  losses: number
  ties: number
  /** What the record would be against the whole league, every week. */
  allPlayWins: number
  allPlayLosses: number
  allPlayTies: number
  pointsFor: number
  /**
   * Actual win rate minus all-play win rate, in wins.
   *
   * Positive means the schedule has been kind. This is the number people
   * actually want: "you are two wins luckier than you have played".
   */
  luckWins: number
  /** 1 is the strongest by all-play. */
  powerRank: number
  /**
   * Power-rank change since last week, or null in the first scored week.
   *
   * ⚠ NULL IS NOT ZERO. No movement and no previous week to move from are
   * different facts, and an arrow that says "unchanged" for a team that has
   * never been ranked is an invented history.
   */
  powerRankChange: number | null
}

export type AllPlayBoard = {
  rows: AllPlayRow[]
  weeksCounted: number
  seasonYear: number
}

/** Rank teams by all-play win rate, then by points. Returns rosterId -> rank. */
function rankBy(
  scores: Map<number, { apw: number; apl: number; pf: number }>,
): Map<number, number> {
  const ordered = [...scores.entries()].sort((a, b) => {
    const aRate = a[1].apw + a[1].apl > 0 ? a[1].apw / (a[1].apw + a[1].apl) : 0
    const bRate = b[1].apw + b[1].apl > 0 ? b[1].apw / (b[1].apw + b[1].apl) : 0
    if (aRate !== bRate) return bRate - aRate
    return b[1].pf - a[1].pf
  })
  return new Map(ordered.map(([id], i) => [id, i + 1]))
}

export async function getAllPlayBoard(args: {
  leagueId: string
  platformLeagueId: string | null
  seasonYear: number
}): Promise<AllPlayBoard | null> {
  if (!args.platformLeagueId) return null

  const rows = await prisma.weeklyMatchup
    .findMany({
      where: { leagueId: args.platformLeagueId, seasonYear: args.seasonYear },
      select: { rosterId: true, week: true, pointsFor: true, pointsAgainst: true, win: true },
      orderBy: { week: 'asc' },
    })
    .catch(() => [])

  if (rows.length === 0) return null

  const byWeek = new Map<number, typeof rows>()
  for (const r of rows) {
    const list = byWeek.get(r.week) ?? []
    list.push(r)
    byWeek.set(r.week, list)
  }

  type Acc = {
    wins: number
    losses: number
    ties: number
    apw: number
    apl: number
    apt: number
    pf: number
  }
  const acc = new Map<number, Acc>()
  const blank = (): Acc => ({ wins: 0, losses: 0, ties: 0, apw: 0, apl: 0, apt: 0, pf: 0 })

  /** Power rank after each scored week, so movement is real history. */
  const rankHistory: Array<Map<number, number>> = []
  let weeksCounted = 0

  for (const week of [...byWeek.keys()].sort((a, b) => a - b)) {
    const weekRows = byWeek.get(week)!
    // The week gate: nobody scored means nobody played.
    if (!weekRows.some((r) => r.pointsFor > 0)) continue
    weeksCounted += 1

    for (const r of weekRows) {
      const a = acc.get(r.rosterId) ?? blank()
      a.pf += r.pointsFor

      // Head-to-head, from the row the platform already decided.
      if (r.win === 1) a.wins += 1
      else if (r.win === 0 && r.pointsAgainst !== r.pointsFor) a.losses += 1
      else a.ties += 1

      /*
       * All-play: this score against every OTHER score in the same week. The
       * team itself is excluded, which is why this is n-1 comparisons and not
       * n — a team cannot beat itself, and including it would add a guaranteed
       * tie to everyone equally and flatten the spread.
       */
      for (const other of weekRows) {
        if (other.rosterId === r.rosterId) continue
        if (r.pointsFor > other.pointsFor) a.apw += 1
        else if (r.pointsFor < other.pointsFor) a.apl += 1
        else a.apt += 1
      }
      acc.set(r.rosterId, a)
    }

    rankHistory.push(
      rankBy(new Map([...acc].map(([id, a]) => [id, { apw: a.apw, apl: a.apl, pf: a.pf }]))),
    )
  }

  if (weeksCounted === 0) return null

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: args.leagueId },
      select: { externalId: true, teamName: true, ownerName: true, avatarUrl: true },
    })
    .catch(() => [])
  const teamBy = new Map(teams.map((t) => [t.externalId, t]))

  const current = rankHistory[rankHistory.length - 1]
  const previous = rankHistory.length > 1 ? rankHistory[rankHistory.length - 2] : null

  const out: AllPlayRow[] = [...acc.entries()].map(([rosterId, a]) => {
    const t = teamBy.get(String(rosterId))
    const played = a.wins + a.losses + a.ties
    const apPlayed = a.apw + a.apl + a.apt
    /*
     * Luck expressed in WINS, not in a rate, because that is the unit people
     * argue in. All-play win rate scaled to the games actually played is what
     * the record "should" be; the difference is the schedule's contribution.
     */
    const expectedWins = apPlayed > 0 ? (a.apw / apPlayed) * played : 0
    const prevRank = previous?.get(rosterId) ?? null
    const curRank = current.get(rosterId) ?? 0

    return {
      rosterId,
      teamName: t?.teamName ?? null,
      managerName: t?.ownerName ?? null,
      avatarUrl: t?.avatarUrl ?? null,
      wins: a.wins,
      losses: a.losses,
      ties: a.ties,
      allPlayWins: a.apw,
      allPlayLosses: a.apl,
      allPlayTies: a.apt,
      pointsFor: Math.round(a.pf * 100) / 100,
      luckWins: Math.round((a.wins - expectedWins) * 10) / 10,
      powerRank: curRank,
      // Null, not zero: never ranked before is not the same as did not move.
      powerRankChange: prevRank == null ? null : prevRank - curRank,
    }
  })

  out.sort((x, y) => x.powerRank - y.powerRank)
  return { rows: out, weeksCounted, seasonYear: args.seasonYear }
}
