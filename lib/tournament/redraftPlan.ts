/**
 * Who goes into which league for the redraft.
 *
 * 🛑 THE EXISTING `executeAdvancement` CANNOT ANSWER THIS FOR THIS TOURNAMENT,
 * and not only because it is random. Three things about it are wrong here:
 *
 *   1. IT SHUFFLES (`shuffleInPlace`, Math.random). A commissioner running
 *      imported leagues has to REBUILD the result by hand on the host platform,
 *      so an assignment they cannot see beforehand and cannot reproduce is not
 *      an assignment they can use. It also means a preview and the commit would
 *      disagree.
 *   2. IT MIXES THE CONFERENCES. It buckets every advancer round-robin across
 *      all leagues and only then hands each bucket to a conference — so Black
 *      and Gold managers land in the same league. This tournament runs the two
 *      brackets separately, all the way to the final.
 *   3. IT CAPS LEAGUES AT EIGHT SLOTS (`POST_OPENING_LEAGUE_SLOT_TARGET`), so 64
 *      advancers become eight leagues of eight rather than four of sixteen.
 *
 * So this plans the redraft itself: deterministic, conference-respecting, and
 * sized from the tournament's own settings.
 *
 * ⚠ IT WRITES NOTHING. It is a proposal — the same read the export renders and
 * the same one a native execution would apply. Advancement already happened and
 * is recorded; this decides where those people go next, and that decision should
 * be looked at before it is acted on.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Default league names, in the order this tournament has always used them.
 *
 * ⚠ NOT AI-GENERATED, unlike `namingEngine`. A commissioner who has run
 * NORTH/SOUTH/EAST/WEST for five years should not find their bracket renamed to
 * something inventive by a tool meant to save them time.
 */
const DEFAULT_LEAGUE_NAMES = ['NORTH', 'SOUTH', 'EAST', 'WEST']

export type PlannedManager = {
  participantId: string
  displayName: string
  /** Their seed within the conference, 1-based — what the snake is built on. */
  seed: number
  /** The league they are coming FROM, so the sheet reads as a move. */
  fromLeague: string
  wins: number
  losses: number
  pointsFor: number
}

export type PlannedLeague = {
  name: string
  managers: PlannedManager[]
}

export type PlannedConference = {
  conferenceId: string
  conferenceName: string
  advancerCount: number
  leagues: PlannedLeague[]
}

export type PlanBlocker = { code: string; message: string; severity: 'blocker' | 'warning' }

export type RedraftPlan = {
  tournamentId: string
  fromRoundNumber: number
  teamsPerLeague: number
  conferences: PlannedConference[]
  totalAdvancers: number
  blockers: PlanBlocker[]
}

/**
 * Spread seeds across leagues in a snake, the way a draft order is balanced.
 *
 * Seeds 1..L go to leagues 1..L, then L+1..2L come back the other way — so the
 * top seed's league also gets the weakest of the next band, and no league
 * collects a whole tier. Purely a function of the ordering, so it is stable
 * across a preview, a commit, and a commissioner rebuilding it by hand three
 * hours later.
 *
 * ⚠ DETERMINISTIC ON PURPOSE. A random draw is defensible in the abstract and
 * useless here: the sheet has to match what the app says, and both have to match
 * whatever the commissioner types into the host platform.
 */
export function snakeAssign<T>(ordered: T[], leagueCount: number): T[][] {
  const count = Math.max(1, Math.trunc(leagueCount))
  const buckets: T[][] = Array.from({ length: count }, () => [])
  ordered.forEach((item, index) => {
    const row = Math.floor(index / count)
    const slot = index % count
    /* Odd rows run right-to-left — that is the snake. */
    const target = row % 2 === 0 ? slot : count - 1 - slot
    buckets[target]!.push(item)
  })
  return buckets
}

/** `NORTH`, `SOUTH`, … then `NORTH 2` once the compass runs out. */
export function leagueNameFor(index: number, conferenceName: string): string {
  const base = DEFAULT_LEAGUE_NAMES[index % DEFAULT_LEAGUE_NAMES.length]!
  const cycle = Math.floor(index / DEFAULT_LEAGUE_NAMES.length)
  const suffix = cycle > 0 ? ` ${cycle + 1}` : ''
  return `${conferenceName} ${base}${suffix}`.trim()
}

export async function buildRedraftPlan(
  tournamentId: string,
  commissionerUserId: string,
): Promise<RedraftPlan | null> {
  const shell = await prisma.tournamentShell.findFirst({
    where: { id: tournamentId, commissionerId: commissionerUserId },
    select: { id: true, currentRoundNumber: true, teamsPerLeague: true },
  })
  /* Same answer for "not found" and "not yours". */
  if (!shell) return null

  const fromRoundNumber = shell.currentRoundNumber || 1
  const round = await prisma.tournamentRound.findFirst({
    where: { tournamentId, roundNumber: fromRoundNumber },
    select: { id: true },
  })
  if (!round) return null

  const conferences = await prisma.tournamentConference.findMany({
    where: { tournamentId },
    orderBy: { conferenceNumber: 'asc' },
    select: { id: true, name: true },
  })

  const leagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, roundId: round.id },
    select: { id: true, name: true, conferenceId: true },
  })
  const leagueById = new Map(leagues.map((l) => [l.id, l]))

  /*
   * ⚠ `qualified` AND `wildcard_eligible` BOTH ADVANCE. The engine writes the
   * first for a league winner and the second for a conference-wide cut — this
   * tournament's whole 64 are the second kind, so reading only `qualified`
   * would plan a redraft for nobody.
   */
  const advancers = await prisma.tournamentLeagueParticipant.findMany({
    where: {
      tournamentLeagueId: { in: leagues.map((l) => l.id) },
      advancementStatus: { in: ['qualified', 'wildcard_eligible'] },
    },
    select: {
      participantId: true,
      tournamentLeagueId: true,
      conferenceRank: true,
      leagueRank: true,
      wins: true,
      losses: true,
      pointsFor: true,
      participant: { select: { displayName: true } },
    },
  })

  const blockers: PlanBlocker[] = []
  const teamsPerLeague = Math.max(2, shell.teamsPerLeague || 12)

  if (advancers.length === 0) {
    blockers.push({
      code: 'not_advanced',
      severity: 'blocker',
      message:
        'Nobody is marked as advancing yet — run the cut first, then come back and this fills in.',
    })
  }

  const outConferences: PlannedConference[] = []

  for (const conf of conferences) {
    const mine = advancers.filter(
      (a) => leagueById.get(a.tournamentLeagueId)?.conferenceId === conf.id,
    )
    if (mine.length === 0) {
      outConferences.push({
        conferenceId: conf.id,
        conferenceName: conf.name,
        advancerCount: 0,
        leagues: [],
      })
      continue
    }

    /*
     * ⚠ ORDERED BY CONFERENCE RANK, WITH A DEFINED FALLBACK. `conferenceRank` is
     * stamped by `calculateConferenceStandings`; if it is missing the sort would
     * otherwise depend on row order, which is not stable — so an unranked row
     * sorts last on a large sentinel rather than silently landing at the top and
     * taking the first seed.
     */
    const ordered = [...mine].sort(
      (a, b) => (a.conferenceRank ?? Number.MAX_SAFE_INTEGER) - (b.conferenceRank ?? Number.MAX_SAFE_INTEGER),
    )

    const leagueCount = Math.max(1, Math.ceil(ordered.length / teamsPerLeague))
    const buckets = snakeAssign(ordered, leagueCount)

    if (ordered.length % teamsPerLeague !== 0) {
      /*
       * ⚠ A WARNING, NOT A BLOCKER, AND IT SAYS THE SHAPE. Uneven leagues are a
       * real decision a commissioner may accept — but discovering it after
       * building them by hand on another platform is expensive.
       */
      blockers.push({
        code: 'uneven',
        severity: 'warning',
        message: `${conf.name}: ${ordered.length} advancing does not divide into leagues of ${teamsPerLeague} — you get ${buckets
          .map((b) => b.length)
          .join(', ')}.`,
      })
    }

    outConferences.push({
      conferenceId: conf.id,
      conferenceName: conf.name,
      advancerCount: ordered.length,
      leagues: buckets.map((bucket, i) => ({
        name: leagueNameFor(i, conf.name),
        managers: bucket.map((m) => ({
          participantId: m.participantId,
          displayName: m.participant?.displayName?.trim() || 'Unknown manager',
          seed: m.conferenceRank ?? 0,
          fromLeague: leagueById.get(m.tournamentLeagueId)?.name ?? 'League',
          wins: m.wins,
          losses: m.losses,
          pointsFor: m.pointsFor,
        })),
      })),
    })
  }

  return {
    tournamentId,
    fromRoundNumber,
    teamsPerLeague,
    conferences: outConferences,
    totalAdvancers: advancers.length,
    blockers,
  }
}
