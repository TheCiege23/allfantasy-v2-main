import 'server-only'

/**
 * Standings section data.
 *
 * Sourced entirely from `RedraftRoster` — the same rows the redraft standings
 * engine maintains. Nothing here recomputes a record; it reads the stored one
 * and derives only presentation-level facts (rank order, playoff line, the
 * viewer's own row).
 *
 * Two derivations are genuinely computed rather than read, and both are exact
 * rather than estimated:
 *  - **All-play record**: how each team would have fared against every other
 *    team every week. Computed from real weekly matchup scores; omitted
 *    entirely when weekly scores are unavailable rather than approximated.
 *  - **Schedule luck**: head-to-head wins minus all-play expected wins.
 *
 * **Sample consistency matters here and is easy to get wrong.** A league's
 * stored `wins/losses` can cover more games than its `final` matchup rows do —
 * records get set directly by imports and seeds without a complete matchup
 * history behind them. Comparing a season record against an all-play sample
 * drawn from fewer weeks produces a large, entirely fictitious luck number (a
 * 5-1 team with one completed matchup scored "+5.0 wins of schedule luck"
 * during verification). So both sides of the subtraction are computed over the
 * *same* set of completed matchups, and the result is withheld below a minimum
 * sample rather than reported from noise.
 */
import { prisma } from '@/lib/prisma'

export interface StandingsRow {
  rosterId: string
  rank: number
  teamName: string
  ownerName: string
  avatarUrl: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  streak: string | null
  playoffSeed: number | null
  isEliminated: boolean
  isViewer: boolean
  /** Null when weekly scores are unavailable — never approximated. */
  allPlayWins: number | null
  allPlayLosses: number | null
  /** Actual wins minus all-play expected wins. Positive = luckier than results suggest. */
  scheduleLuck: number | null
}

export interface StandingsSectionData {
  available: boolean
  rows: StandingsRow[]
  /** Rank at or above which a team is currently in the playoff field. Null when unknown. */
  playoffLine: number | null
  viewerRow: StandingsRow | null
  warnings: string[]
}

const EMPTY: StandingsSectionData = {
  available: false,
  rows: [],
  playoffLine: null,
  viewerRow: null,
  warnings: [],
}

/**
 * Orders teams the way the league does: wins first, then points-for as the
 * standard tiebreak. Ties are counted as half a win, matching how the record is
 * displayed.
 */
function standingsSort(
  a: { wins: number; losses: number; ties: number; pointsFor: number },
  b: { wins: number; losses: number; ties: number; pointsFor: number },
): number {
  const aPoints = a.wins + a.ties * 0.5
  const bPoints = b.wins + b.ties * 0.5
  if (aPoints !== bPoints) return bPoints - aPoints
  return b.pointsFor - a.pointsFor
}

/**
 * Below this many completed weeks, schedule luck is noise rather than signal
 * and is reported as null.
 */
const MIN_LUCK_SAMPLE_WEEKS = 3

interface AllPlayRecord {
  wins: number
  losses: number
  /** Weeks this roster actually has a score for — the sample size. */
  weeksScored: number
  /** Real head-to-head wins within exactly those weeks. */
  headToHeadWins: number
}

/**
 * Exact all-play, plus the head-to-head result over the identical sample.
 *
 * Returning both from one pass is what keeps schedule luck honest: the caller
 * cannot accidentally difference an all-play figure against a season record
 * drawn from a different (larger) set of games.
 */
function computeAllPlay(
  completed: readonly {
    week: number
    homeRosterId: string
    awayRosterId: string | null
    homeScore: number
    awayScore: number
  }[],
  rosterIds: readonly string[],
): Map<string, AllPlayRecord> {
  const result = new Map<string, AllPlayRecord>()
  for (const id of rosterIds) {
    result.set(id, { wins: 0, losses: 0, weeksScored: 0, headToHeadWins: 0 })
  }

  const byWeek = new Map<number, { id: string; score: number }[]>()

  for (const matchup of completed) {
    const entries = byWeek.get(matchup.week) ?? []
    entries.push({ id: matchup.homeRosterId, score: matchup.homeScore })
    if (matchup.awayRosterId) {
      entries.push({ id: matchup.awayRosterId, score: matchup.awayScore })
    }
    byWeek.set(matchup.week, entries)

    // Head-to-head result for this same week. Byes and exact ties award no win.
    if (matchup.awayRosterId) {
      const winnerId =
        matchup.homeScore > matchup.awayScore
          ? matchup.homeRosterId
          : matchup.awayScore > matchup.homeScore
            ? matchup.awayRosterId
            : null
      if (winnerId) {
        const bucket = result.get(winnerId)
        if (bucket) bucket.headToHeadWins += 1
      }
    }
  }

  for (const entries of byWeek.values()) {
    for (const team of entries) {
      const bucket = result.get(team.id)
      if (!bucket) continue
      bucket.weeksScored += 1

      if (entries.length < 2) continue
      for (const other of entries) {
        if (team.id === other.id) continue
        if (team.score > other.score) bucket.wins += 1
        else if (team.score < other.score) bucket.losses += 1
      }
    }
  }

  return result
}

export async function loadStandingsSection(args: {
  leagueId: string
  userId: string
}): Promise<StandingsSectionData> {
  const warnings: string[] = []

  const season = await prisma.redraftSeason
    .findFirst({
      where: { leagueId: args.leagueId },
      orderBy: { season: 'desc' },
      select: { id: true, playoffStartWeek: true },
    })
    .catch((error) => {
      console.error('[command-center/standings] season lookup failed', { leagueId: args.leagueId, error })
      return null
    })

  if (!season) {
    return { ...EMPTY, warnings: ['No active season — standings are unavailable for this league.'] }
  }

  const [league, rosters, matchups] = await Promise.all([
    prisma.league
      .findUnique({
        where: { id: args.leagueId },
        select: { playoffTeams: true },
      })
      .catch(() => null),
    prisma.redraftRoster
      .findMany({
        where: { seasonId: season.id },
        select: {
          id: true,
          ownerId: true,
          ownerName: true,
          teamName: true,
          avatarUrl: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          pointsAgainst: true,
          streak: true,
          playoffSeed: true,
          isEliminated: true,
        },
      })
      .catch((error) => {
        console.error('[command-center/standings] roster load failed', { seasonId: season.id, error })
        return []
      }),
    prisma.redraftMatchup
      .findMany({
        where: { seasonId: season.id, status: 'final' },
        select: {
          week: true,
          homeRosterId: true,
          awayRosterId: true,
          homeScore: true,
          awayScore: true,
        },
      })
      .catch(() => []),
  ])

  if (rosters.length === 0) {
    return { ...EMPTY, warnings: ['No teams found for this season.'] }
  }

  // Resolve the viewer's roster through the shared identity seam rather than
  // comparing `ownerId` directly — that column can hold a userId, a provider
  // platformUserId, or a synthetic `roster:<id>` value depending on how the
  // league was created, and a naive === would silently fail to highlight the
  // viewer's own row on imported leagues.
  let viewerRosterId: string | null = null
  try {
    const { resolveRedraftRosterLookupReadOnly } = await import('@/lib/redraft/redraftRosterIdentity')
    const lookup = await resolveRedraftRosterLookupReadOnly({
      userId: args.userId,
      seasonId: season.id,
      leagueId: args.leagueId,
    })
    viewerRosterId = lookup.roster?.id ?? null
  } catch (error) {
    console.error('[command-center/standings] roster identity resolve failed', error)
    warnings.push('Could not identify your team in the standings.')
  }

  const hasWeeklyScores = matchups.length > 0
  if (!hasWeeklyScores) {
    warnings.push('No completed weeks yet — all-play and schedule luck are unavailable.')
  }

  const allPlay = hasWeeklyScores
    ? computeAllPlay(matchups, rosters.map((r) => r.id))
    : null

  // Completed matchups can cover fewer weeks than the stored records imply.
  // Say so once, rather than quietly differencing two different samples.
  const maxWeeksScored = allPlay
    ? Math.max(0, ...[...allPlay.values()].map((entry) => entry.weeksScored))
    : 0
  const maxGamesPlayed = Math.max(
    0,
    ...rosters.map((roster) => roster.wins + roster.losses + roster.ties),
  )
  if (hasWeeklyScores && maxWeeksScored < MIN_LUCK_SAMPLE_WEEKS) {
    warnings.push(
      `Only ${maxWeeksScored} completed week${maxWeeksScored === 1 ? '' : 's'} of scores ` +
        `${maxWeeksScored === 1 ? 'is' : 'are'} on record, so schedule luck is not shown yet.`,
    )
  } else if (hasWeeklyScores && maxGamesPlayed > maxWeeksScored) {
    warnings.push(
      `Records show up to ${maxGamesPlayed} games but only ${maxWeeksScored} weeks have stored ` +
        'scores — all-play figures cover the weeks with scores, not the full season.',
    )
  }

  const ordered = [...rosters].sort(standingsSort)

  const rows: StandingsRow[] = ordered.map((roster, index) => {
    const ap = allPlay?.get(roster.id) ?? null
    const apTotal = ap ? ap.wins + ap.losses : 0

    /*
     * Both sides of this subtraction come from the SAME weeks: expected wins
     * are the all-play rate scaled to the weeks actually scored, and they are
     * differenced against head-to-head wins from those same weeks — never
     * against the season record, which may cover more games.
     */
    const expectedWins =
      ap && apTotal > 0 && ap.weeksScored >= MIN_LUCK_SAMPLE_WEEKS
        ? (ap.wins / apTotal) * ap.weeksScored
        : null

    return {
      rosterId: roster.id,
      rank: index + 1,
      teamName: roster.teamName?.trim() || roster.ownerName?.trim() || 'Unnamed team',
      ownerName: roster.ownerName?.trim() || 'Unknown manager',
      avatarUrl: roster.avatarUrl?.trim() || null,
      wins: roster.wins,
      losses: roster.losses,
      ties: roster.ties,
      pointsFor: roster.pointsFor,
      pointsAgainst: roster.pointsAgainst,
      streak: roster.streak?.trim() || null,
      playoffSeed: roster.playoffSeed ?? null,
      isEliminated: roster.isEliminated,
      isViewer: viewerRosterId !== null && roster.id === viewerRosterId,
      allPlayWins: ap?.wins ?? null,
      allPlayLosses: ap?.losses ?? null,
      scheduleLuck:
        expectedWins === null || !ap
          ? null
          : Number((ap.headToHeadWins - expectedWins).toFixed(2)),
    }
  })

  /*
   * Playoff field size: prefer the league's configured `playoffTeams`, and fall
   * back to the count of really-assigned seeds. Never assume a conventional 6 —
   * drawing the cut line in the wrong place is exactly the kind of error a
   * manager would plan their season around.
   */
  const seededCount = rosters.filter((r) => typeof r.playoffSeed === 'number').length
  const playoffLine =
    typeof league?.playoffTeams === 'number' && league.playoffTeams > 0
      ? league.playoffTeams
      : seededCount > 0
        ? seededCount
        : null

  return {
    available: true,
    rows,
    playoffLine,
    viewerRow: rows.find((row) => row.isViewer) ?? null,
    warnings,
  }
}
