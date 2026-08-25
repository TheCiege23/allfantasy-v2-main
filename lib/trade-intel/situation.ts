import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Layer 3 — situation. What surrounds the player rather than what he is.
 *
 * ⚠ EVERY SIGNAL HERE RISKS DOUBLE-COUNTING AND EACH ONE IS SCOPED TO AVOID IT.
 * The projection feed already prices team context: a vendor projecting a receiver
 * on a pass-heavy team has priced the pass-heaviness. So these do NOT re-apply
 * team quality. They report what CHANGED — a new coordinator the market has not
 * digested, a schedule that is harder than average — because change is the part
 * a stale projection cannot contain.
 */

export type TeamTendency = {
  season: number
  proe: number | null
  secPerPlay: number | null
  /** True when the newest season we hold is older than the one being played. */
  stale: boolean
  basis: string
}

/**
 * How a team plays, from `TeamTendencySeason`.
 *
 * ⚠ THE SAMPLE SIZE IS STORED PER FIELD AND MUST BE HONOURED. Every rate has an
 * `N` beside it, and a rate computed over a handful of neutral plays is noise.
 * Reporting it identically to one built on five hundred would give a manager
 * false precision on the exact factor they cannot check.
 */
const MIN_NEUTRAL_PLAYS = 100

export async function loadTeamTendency(args: {
  teamId: string | null
  season: number
}): Promise<TeamTendency | null> {
  if (!args.teamId) return null

  const row = await prisma.teamTendencySeason
    .findFirst({
      where: { teamId: args.teamId, season: { lte: args.season } },
      orderBy: { season: 'desc' },
      select: { season: true, proe: true, proeN: true, secPerPlay: true, secPerPlayN: true, neutralPlays: true },
    })
    .catch(() => null)
  if (!row) return null

  const enough = (n: number | null) => n != null && n >= MIN_NEUTRAL_PLAYS
  const proe = enough(row.proeN) ? row.proe : null
  const secPerPlay = enough(row.secPerPlayN) ? row.secPerPlay : null
  const stale = row.season < args.season

  if (proe == null && secPerPlay == null) return null

  const parts: string[] = []
  if (proe != null) {
    parts.push(
      proe > 2
        ? `throws more than expected in neutral script (PROE ${proe.toFixed(1)})`
        : proe < -2
          ? `runs more than expected in neutral script (PROE ${proe.toFixed(1)})`
          : 'is neutral in pass/run tendency',
    )
  }
  if (secPerPlay != null) {
    parts.push(
      secPerPlay < 27
        ? `and plays fast (${secPerPlay.toFixed(1)}s per play), which means more snaps to go round`
        : `and plays slowly (${secPerPlay.toFixed(1)}s per play), which caps how much volume there is`,
    )
  }

  return {
    season: row.season,
    proe,
    secPerPlay,
    stale,
    basis: `His team ${parts.join(' ')}.${
      stale
        ? ` ⚠ That is ${row.season} data — we hold nothing newer, so it describes last season's team, not this one.`
        : ''
    }`,
  }
}

export type CoordinatorChange = {
  season: number
  previousSeason: number
  changed: boolean
  role: string
  basis: string
}

/**
 * Whether the offence is being run by somebody new.
 *
 * ⚠ THIS IS THE ONE SITUATION SIGNAL THAT CANNOT DOUBLE-COUNT, because it is
 * about what the market has NOT yet seen. A projection built on last season's
 * usage cannot know the coordinator changed; the price the market is quoting
 * frequently cannot either, especially early in a season.
 *
 * ⚠ `isPlayCaller` IS NULLABLE ON PURPOSE AND MUST NOT BE READ AS false. No
 * dataset reliably records who calls plays — some head coaches call their own
 * offence, some defer, some take it over mid-season. Treating null as "not the
 * play-caller" would assert something nobody knows.
 */
export async function loadCoordinatorChange(args: {
  teamId: string | null
  season: number
  /** OC by default; DC is the one that matters for IDP assets. */
  role?: string
}): Promise<CoordinatorChange | null> {
  if (!args.teamId) return null
  const role = args.role ?? 'OC'

  const stints = await prisma.coachStint
    .findMany({
      where: { teamId: args.teamId, role, season: { in: [args.season, args.season - 1] } },
      select: { coachId: true, season: true },
    })
    .catch(() => [])
  if (stints.length === 0) return null

  const now = stints.filter((s) => s.season === args.season).map((s) => s.coachId)
  const before = stints.filter((s) => s.season === args.season - 1).map((s) => s.coachId)

  /*
   * Both seasons must be present. A missing prior year is not evidence of a
   * change — it is evidence we did not ingest that year, and reporting "new
   * coordinator" from it would fire on every team in a gap season.
   */
  if (now.length === 0 || before.length === 0) return null

  const changed = !now.some((id) => before.includes(id))

  return {
    season: args.season,
    previousSeason: args.season - 1,
    changed,
    role,
    basis: changed
      ? `New ${role} this season. A projection built on last season's usage cannot know that, and neither can a market price set before the change had any evidence behind it — this is the situation factor most likely to be genuinely unpriced.`
      : `Same ${role} as last season, so usage patterns carry over and there is no hidden change here.`,
  }
}

export type StrengthOfSchedule = {
  gamesRemaining: number
  /** Mean opponent win rate over the remaining schedule. */
  opponentWinRate: number | null
  difficulty: 'easy' | 'average' | 'hard' | null
  basis: string
}

/**
 * Real NFL strength of schedule, from the actual schedule.
 *
 * ⚠ NOT THE EXISTING "SOS" IN THIS REPO, which is a fantasy opponent win-rate
 * proxy — a measure of the managers you play, not the defences your players
 * face. Those are different quantities and only one of them affects what a
 * player scores.
 *
 * ⚠ AND IT IS DELIBERATELY THIN. Opponent win rate is a crude proxy for defensive
 * quality; a team can be winning games with an offence. It is reported as a
 * coarse band rather than a number precise enough to trade on, because that is
 * the confidence the input supports.
 */
const EASY_THRESHOLD = 0.45
const HARD_THRESHOLD = 0.55

export async function loadStrengthOfSchedule(args: {
  team: string | null
  season: number
  fromWeek: number
  sport?: string
}): Promise<StrengthOfSchedule | null> {
  if (!args.team) return null
  const sport = args.sport ?? 'NFL'

  const upcoming = await prisma.sportsGame
    .findMany({
      where: {
        sport,
        season: args.season,
        seasonType: 'regular',
        week: { gte: args.fromWeek },
        OR: [{ homeTeam: args.team }, { awayTeam: args.team }],
      },
      select: { homeTeam: true, awayTeam: true, week: true },
      orderBy: { week: 'asc' },
    })
    .catch(() => [])
  if (upcoming.length === 0) return null

  const opponents = [
    ...new Set(
      upcoming
        .map((g) => (g.homeTeam === args.team ? g.awayTeam : g.homeTeam))
        .filter((t): t is string => Boolean(t)),
    ),
  ]
  if (opponents.length === 0) return null

  /*
   * Opponent form from completed games this season. Records are counted from
   * played results rather than assumed, so early in a season this returns null
   * rather than a rate built on two games.
   */
  const played = await prisma.sportsGame
    .findMany({
      where: {
        sport,
        season: args.season,
        seasonType: 'regular',
        week: { lt: args.fromWeek },
        OR: [{ homeTeam: { in: opponents } }, { awayTeam: { in: opponents } }],
      },
      select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true },
    })
    .catch(() => [])

  const record = new Map<string, { w: number; g: number }>()
  for (const g of played) {
    if (g.homeScore == null || g.awayScore == null) continue
    const homeWon = g.homeScore > g.awayScore
    for (const [team, won] of [
      [g.homeTeam, homeWon],
      [g.awayTeam, !homeWon],
    ] as const) {
      if (!team || !opponents.includes(team)) continue
      const r = record.get(team) ?? { w: 0, g: 0 }
      r.g += 1
      if (won) r.w += 1
      record.set(team, r)
    }
  }

  const rates = [...record.values()].filter((r) => r.g >= 3).map((r) => r.w / r.g)
  if (rates.length < Math.ceil(opponents.length / 2)) {
    return {
      gamesRemaining: upcoming.length,
      opponentWinRate: null,
      difficulty: null,
      basis: `${upcoming.length} games left, but too few opponent results are on file to judge the schedule yet.`,
    }
  }

  const opponentWinRate = rates.reduce((a, b) => a + b, 0) / rates.length
  const difficulty: StrengthOfSchedule['difficulty'] =
    opponentWinRate <= EASY_THRESHOLD ? 'easy' : opponentWinRate >= HARD_THRESHOLD ? 'hard' : 'average'

  return {
    gamesRemaining: upcoming.length,
    opponentWinRate,
    difficulty,
    basis: `His remaining ${upcoming.length} opponents are winning ${Math.round(
      opponentWinRate * 100,
    )}% of their games — a ${difficulty} run. ⚠ Opponent win rate is a coarse proxy for defensive quality, since a team can be winning on offence, so treat this as a lean rather than a number.`,
  }
}

/**
 * NFL free agency, which has no source here.
 *
 * ⚠ NAMED RATHER THAN APPROXIMATED. `PlayerContract` exists but models
 * SALARY-CAP LEAGUE contracts, not real NFL deals — using it would report a
 * fantasy league's cap sheet as though it were an NFL one. No feed in either
 * committed contract carries real contract status or free-agency year.
 */
export const FREE_AGENCY_GAP =
  'Real NFL contract status and free-agency year are not carried by any source we hold. PlayerContract models salary-cap LEAGUE deals, not NFL ones, so pending free agency cannot be factored in here.'
