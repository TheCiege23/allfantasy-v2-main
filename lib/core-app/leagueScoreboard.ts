import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'
import { lookupProjections } from './playerProjections'

/**
 * Every game in the league this week, not just yours.
 *
 * ⚠ THE LEAGUE HOME SHOWED ONE MATCHUP — THE VIEWER'S. On a screen whose entire
 * purpose is the league, the other five games were invisible. You could not see
 * who was blowing whom out, who was in a shootout, or whether the team you play
 * next week was in trouble.
 *
 * ⚠ AND BEFORE WEEK 1 IT SAID NOTHING AT ALL. `WeeklyMatchup` rows are
 * bootstrapped for all 18 weeks at 0-0, so an unplayed week is indistinguishable
 * from a 0-0 tie unless you look at whether ANY row has been scored. The old
 * copy — "week 1 is on file but nothing has been scored" — was true and useless.
 * A projected scoreboard is the honest thing to show in that window, as long as
 * it is labelled as projected rather than dressed up as a result.
 *
 * ⚠ `WeeklyMatchup.leagueId` HOLDS THE PLATFORM LEAGUE ID, NOT `League.id`.
 * Both are strings, so the wrong one returns an empty list rather than an error.
 */

export type ScoreboardTeam = {
  rosterId: number
  teamName: string | null
  managerName: string | null
  avatarUrl: string | null
  /** Real points, once the week has been scored. */
  points: number | null
  /** Projected total under the league's own scoring. */
  projected: number | null
  /** Starters the projection was built from, of how many. */
  projectedFrom: number
  starterCount: number
  /** True for the viewer's own team, so the row can be marked. */
  isYou: boolean
}

export type ScoreboardGame = {
  matchupId: number | null
  teams: ScoreboardTeam[]
  /** Neither side has a score yet. */
  unplayed: boolean
  /** Points between the two sides, once both are known. Null while unplayed. */
  margin: number | null
}

export type LeagueScoreboard = {
  seasonYear: number
  week: number
  games: ScoreboardGame[]
  /**
   * Nothing in this week has been scored, so every number shown is a
   * projection. The screen MUST say so — a projected scoreboard that looks like
   * a live one is the worst possible version of this panel.
   */
  allUnplayed: boolean
  /** Teams the league recorded with no matchupId — not paired into a game. */
  unpaired: ScoreboardTeam[]
}

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

/** Sleeper writes an unfilled starting slot as "0". A hole, not a player. */
const EMPTY_SLOT = '0'

export async function getLeagueScoreboard(args: {
  /** Internal `League.id`, for LeagueTeam and Roster. */
  leagueId: string
  /** `League.platformLeagueId`, for WeeklyMatchup. A DIFFERENT id. */
  platformLeagueId: string | null
  seasonYear: number
  week: number
  /** The viewer's roster id, so their row can be marked. Null is fine. */
  yourRosterId: number | null
  scoringSettings: Record<string, unknown> | null
  projectionWeek: { season: string; week: number } | null
}): Promise<LeagueScoreboard | null> {
  const { leagueId, platformLeagueId, seasonYear, week } = args
  if (!platformLeagueId) return null

  const rows = await prisma.weeklyMatchup
    .findMany({
      where: { leagueId: platformLeagueId, seasonYear, week },
      select: { rosterId: true, matchupId: true, pointsFor: true, win: true },
    })
    .catch(() => [])

  if (rows.length === 0) return null

  /*
   * ⚠ "SCORED" IS A PROPERTY OF THE WEEK, NOT OF A ROW. Sync bootstraps every
   * week at 0-0, so a single 0.0 tells you nothing. If no row anywhere in the
   * week carries points, the week has not been played — and every 0.0 is an
   * absence rather than a result.
   */
  const anyScored = rows.some((r) => r.pointsFor > 0)

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId },
      select: {
        externalId: true,
        teamName: true,
        ownerName: true,
        avatarUrl: true,
        platformUserId: true,
      },
    })
    .catch(() => [])

  const teamBy = new Map(teams.map((t) => [t.externalId, t]))

  const rosters = await prisma.roster
    .findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } })
    .catch(() => [])
  const rosterBy = new Map(rosters.map((r) => [r.platformUserId, r]))

  // Starters for every team, so the whole board can be projected in one read.
  const startersBy = new Map<number, string[]>()
  for (const r of rows) {
    const t = teamBy.get(String(r.rosterId))
    const roster = t?.platformUserId ? rosterBy.get(t.platformUserId) : null
    const pd = (roster?.playerData ?? {}) as Record<string, unknown>
    startersBy.set(
      r.rosterId,
      asIds(pd.starters).filter((s) => s !== EMPTY_SLOT),
    )
  }

  /*
   * Projections are only worth fetching while the week is unplayed. Once real
   * points exist they are the answer, and pricing twelve lineups to show a
   * number nobody will read is a lot of work for nothing.
   */
  const everyStarter = anyScored ? [] : [...new Set([...startersBy.values()].flat())]
  const projections = everyStarter.length
    ? await lookupProjections(everyStarter, args.projectionWeek).catch(() => new Map())
    : new Map()

  function build(rosterId: number, points: number | null): ScoreboardTeam {
    const t = teamBy.get(String(rosterId))
    const starters = startersBy.get(rosterId) ?? []

    let total = 0
    let from = 0
    if (!anyScored) {
      for (const pid of starters) {
        const p = projections.get(pid)
        if (!p) continue
        // Scored the league's own way where possible, so every team on the
        // board is measured identically.
        const league =
          args.scoringSettings && p.componentStats
            ? computeLeagueProjectedPoints(p.componentStats, args.scoringSettings)
            : null
        const v = league?.points ?? p.projectedPoints
        if (v == null) continue
        total += v
        from += 1
      }
    }

    return {
      rosterId,
      teamName: t?.teamName ?? null,
      managerName: t?.ownerName ?? null,
      avatarUrl: t?.avatarUrl ?? null,
      points,
      projected: !anyScored && from > 0 ? Math.round(total * 100) / 100 : null,
      projectedFrom: from,
      starterCount: starters.length,
      isYou: args.yourRosterId != null && rosterId === args.yourRosterId,
    }
  }

  /*
   * Typed off a row rather than `typeof rows`: `rows` comes back from a
   * `.catch(() => [])`, so its inferred type collapses to `never[]` on the
   * failure branch and every push into these becomes an error.
   */
  type Row = { rosterId: number; matchupId: number | null; pointsFor: number; win: number }
  const byMatchup = new Map<number, Row[]>()
  const unpairedRows: Row[] = []
  for (const r of rows) {
    if (r.matchupId == null) {
      unpairedRows.push(r)
      continue
    }
    const list = byMatchup.get(r.matchupId) ?? []
    list.push(r)
    byMatchup.set(r.matchupId, list)
  }

  const games: ScoreboardGame[] = [...byMatchup.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([matchupId, pair]) => {
      const built = pair.map((r) => build(r.rosterId, anyScored ? r.pointsFor : null))
      const [a, b] = built
      const bothReal = a?.points != null && b?.points != null
      const bothProjected = a?.projected != null && b?.projected != null
      /*
       * A margin is only honest when both sides were measured the same way. Two
       * projections built from different numbers of priced starters produce a
       * gap that is an artefact of coverage, not of the teams.
       */
      const comparable =
        bothReal ||
        (bothProjected &&
          a!.projectedFrom === a!.starterCount &&
          b!.projectedFrom === b!.starterCount)

      let margin: number | null = null
      if (comparable && built.length === 2) {
        const av = a!.points ?? a!.projected ?? 0
        const bv = b!.points ?? b!.projected ?? 0
        margin = Math.round(Math.abs(av - bv) * 100) / 100
      }

      // Your game first — it is still the one you came to see.
      return {
        matchupId,
        teams: built,
        unplayed: !anyScored,
        margin,
      }
    })
    .sort((x, y) => Number(y.teams.some((t) => t.isYou)) - Number(x.teams.some((t) => t.isYou)))

  return {
    seasonYear,
    week,
    games,
    allUnplayed: !anyScored,
    unpaired: unpairedRows.map((r) => build(r.rosterId, null)),
  }
}
