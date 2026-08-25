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
  /**
   * Chance the FIRST team listed wins, 0–1. Null when either side could not be
   * measured the same way as the other.
   *
   * ⚠ NOT A POINTS RATIO. Dividing one projection by the sum of both produces a
   * number that looks like a probability and is not one: two teams projected
   * 100 and 90 are nowhere near 53/47 in reality, because a fantasy week has
   * enormous variance. This is a normal model on the MARGIN — see winProb().
   */
  winProbability: number | null
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

/**
 * Weekly scoring standard deviation for one fantasy lineup, in points.
 *
 * ⚠ AN ASSUMPTION, STATED RATHER THAN HIDDEN. Weekly fantasy totals scatter
 * enormously around their projection — a starting lineup routinely lands 25
 * points either side of it. This is the value the win probability rests on, and
 * changing it changes every percentage on the board, so it lives here with a
 * name instead of inline in a formula.
 *
 * A larger sigma pulls every game toward 50/50, which is the honest direction
 * to be wrong in: fantasy weeks really are closer to coin flips than point
 * projections suggest.
 */
const WEEKLY_SIGMA = 26

/** Normal CDF, Abramowitz & Stegun 7.1.26 — accurate to ~1e-7, no dependency. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2)
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z >= 0 ? 1 - p : p
}

/**
 * Probability the first score beats the second.
 *
 * Both lineups are modelled as normal around their projection with the same
 * spread, so the margin is normal with sigma·sqrt(2). Clamped away from 0 and 1
 * because no fantasy matchup is ever actually certain, and a rendered "100%"
 * is a promise the model cannot keep.
 */
function winProb(a: number, b: number): number {
  const p = normalCdf((a - b) / (WEEKLY_SIGMA * Math.SQRT2))
  return Math.min(0.97, Math.max(0.03, p))
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
        // Needed for the roster join below — see the note there.
        claimedByUserId: true,
      },
    })
    .catch(() => [])

  const teamBy = new Map(teams.map((t) => [t.externalId, t]))

  const rosters = await prisma.roster
    .findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } })
    .catch(() => [])
  const rosterBy = new Map(rosters.map((r) => [r.platformUserId, r]))

  /**
   * Find a team's roster across the three id spellings it can be stored under.
   *
   * ⚠ THIS IS WHY YOUR OWN TEAM WAS THE ONE SHOWING "—". The join used
   * `LeagueTeam.platformUserId` alone, and that column is NULLABLE — it is most
   * often null on the CLAIMED team, which is yours. Every other team in the
   * league resolved and priced; the viewer's own did not, which is the worst
   * possible row to lose.
   *
   * `myTeam.ts` already solved this and recorded the measurement: with only
   * the first two candidates, 38 of 106 claimed teams joined to a roster and
   * just 11 had a lineup. `Roster.platformUserId` sometimes holds OUR user
   * uuid rather than the platform's id, which is what the third candidate is
   * for.
   */
  function rosterFor(team: { platformUserId: string | null; claimedByUserId: string | null; externalId: string }) {
    for (const key of [team.platformUserId, team.claimedByUserId, team.externalId]) {
      if (!key) continue
      const hit = rosterBy.get(key)
      if (hit) return hit
    }
    return null
  }

  // Starters for every team, so the whole board can be projected in one read.
  const startersBy = new Map<number, string[]>()
  for (const r of rows) {
    const t = teamBy.get(String(r.rosterId))
    const roster = t ? rosterFor(t) : null
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
      let winProbability: number | null = null
      if (comparable && built.length === 2) {
        const av = a!.points ?? a!.projected ?? 0
        const bv = b!.points ?? b!.projected ?? 0
        margin = Math.round(Math.abs(av - bv) * 100) / 100
        /*
         * Only while the week is unplayed. Once real points exist the game is
         * being decided in front of you and a pre-game probability is noise —
         * worse, it reads as a live win chance it is not.
         */
        if (!anyScored) winProbability = winProb(av, bv)
      }

      // Your game first — it is still the one you came to see.
      return {
        matchupId,
        teams: built,
        unplayed: !anyScored,
        margin,
        winProbability,
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
