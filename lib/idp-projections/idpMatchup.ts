import type { PrismaClient } from '@prisma/client'

import { findMyRoster, rosterPlayerIds } from '@/lib/core-app/myRoster'
import { hasIdpScoring, isIdpPosition } from '@/lib/core-app/scoringNotes'

import { loadActualWeeklyPoints, type ActualWeekOutcome } from './actualWeeklyPoints'

/**
 * A real IDP matchup: who you played, what they scored, and which players produced it.
 *
 * ⚠ WHAT THIS REPLACES WAS INVENTED AT EVERY LEVEL. `IDPMatchupView` summed
 * `mockIdpPoints(id, week)` — a hash of the player id — across both rosters to produce a
 * scoreboard, multiplied the offensive side by 0.85 for no stated reason, and its parent handed
 * it the literal ids `['4040','4041','4042']` against `['4043','4044','4045']` with the team
 * names "Your team" and "Opponent". It rendered on the Scores tab of live IDP leagues.
 *
 * ⚠ TWO SCORES, AND THEY ARE NOT THE SAME CLAIM. `MatchupFact.scoreA/scoreB` is what the
 * PLATFORM recorded — authoritative, and the number the manager already saw on Sleeper. The
 * per-player points here are OURS, recomputed from stat lines under the league's settings, and
 * they are only as complete as our ingest. They will not always add up to the official total,
 * and the honest move is to show the official score as the score, use ours for the breakdown,
 * and say so when the two disagree rather than quietly presenting a recomputation as the result.
 */

export type IdpMatchupState =
  | 'ok'
  | 'not_idp_league'
  | 'no_team_claimed'
  | 'no_matchup'
  | 'no_scoring_settings'

export interface IdpMatchupPlayer {
  sleeperId: string
  name: string
  position: string | null
  team: string | null
  side: 'offense' | 'defense' | 'unknown'
  points: ActualWeekOutcome
}

export interface IdpMatchupSide {
  rosterId: string
  teamName: string
  /** The platform's own score for the week. Null when the matchup carries none. */
  officialScore: number | null
  /**
   * Every rostered player's points added up — NOT a score, and not comparable to one.
   *
   * ⚠ IT WILL EXCEED THE OFFICIAL SCORE AND THAT IS EXPECTED. A real score counts the STARTERS
   * that week; this counts everyone on the roster, bench included. Measured on production it ran
   * 161.35 against an official 132.9. We cannot fix it by filtering to starters either: the
   * roster's `starters` array is TODAY's lineup, and using it to recompute a week-17 score would
   * silently assume the manager never changed his lineup all season. We do not hold historical
   * lineups, so the official score stays the only score and this is a coverage figure.
   */
  ourRosterTotal: number
  /** How many of their players we could price — the honest denominator for `ourTotal`. */
  scoredPlayers: number
  totalPlayers: number
  players: IdpMatchupPlayer[]
}

export interface IdpMatchupPayload {
  state: IdpMatchupState
  season: number | null
  week: number | null
  you: IdpMatchupSide | null
  opponent: IdpMatchupSide | null
  notes: string[]
}

const EMPTY = (state: IdpMatchupState, notes: string[] = []): IdpMatchupPayload => ({
  state,
  season: null,
  week: null,
  you: null,
  opponent: null,
  notes,
})

export interface LoadIdpMatchupArgs {
  prisma: PrismaClient
  /** Either id space. */
  leagueId: string
  userId: string
  /** Defaults to the newest week that has BOTH a matchup and stat lines. */
  season?: number
  week?: number
}

export async function loadIdpMatchup(args: LoadIdpMatchupArgs): Promise<IdpMatchupPayload> {
  const league =
    (await args.prisma.league
      .findUnique({ where: { id: args.leagueId }, select: { id: true, settings: true } })
      .catch(() => null)) ??
    (await args.prisma.league
      .findFirst({
        where: { platformLeagueId: args.leagueId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, settings: true },
      })
      .catch(() => null))
  if (!league) return EMPTY('no_scoring_settings')

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const scoring = (settings.scoring_settings ?? settings.scoringSettings ?? null) as
    | Record<string, unknown>
    | null
  if (!scoring) return EMPTY('no_scoring_settings')
  // The strict predicate — the loose one calls 64 of 110 leagues IDP; this one calls 10.
  if (!hasIdpScoring(scoring)) return EMPTY('not_idp_league')

  const myTeam = await args.prisma.leagueTeam
    .findFirst({
      where: { leagueId: league.id, claimedByUserId: args.userId },
      select: { externalId: true, teamName: true, platformUserId: true },
    })
    .catch(() => null)
  if (!myTeam?.externalId) return EMPTY('no_team_claimed')

  /*
   * The week to show is the newest one we can actually SCORE — the newest matchup that is not
   * ahead of the newest stat line. Taking the newest matchup alone lands on an unplayed fixture
   * during the offseason and every player comes back `no_game`, which reads as broken rather
   * than as "the season has not started".
   */
  let season = args.season ?? null
  let week = args.week ?? null
  if (season == null || week == null) {
    const newest = await args.prisma.playerGameStat
      .aggregate({ where: { sportType: 'NFL' }, _max: { season: true } })
      .catch(() => null)
    const statSeason = newest?._max.season ?? null
    const statWeek = statSeason
      ? (
          await args.prisma.playerGameStat
            .aggregate({ where: { sportType: 'NFL', season: statSeason }, _max: { weekOrRound: true } })
            .catch(() => null)
        )?._max.weekOrRound ?? null
      : null

    const candidate = await args.prisma.matchupFact
      .findFirst({
        where: {
          leagueId: league.id,
          ...(statSeason ? { season: { lte: statSeason } } : {}),
          OR: [{ teamA: myTeam.externalId }, { teamB: myTeam.externalId }],
        },
        orderBy: [{ season: 'desc' }, { weekOrPeriod: 'desc' }],
        select: { season: true, weekOrPeriod: true },
      })
      .catch(() => null)
    if (!candidate) return EMPTY('no_matchup')

    season = candidate.season
    week =
      statSeason === candidate.season && statWeek != null
        ? Math.min(candidate.weekOrPeriod, statWeek)
        : candidate.weekOrPeriod
  }

  const matchup = await args.prisma.matchupFact
    .findFirst({
      where: {
        leagueId: league.id,
        season,
        weekOrPeriod: week,
        OR: [{ teamA: myTeam.externalId }, { teamB: myTeam.externalId }],
      },
      select: { teamA: true, teamB: true, scoreA: true, scoreB: true },
    })
    .catch(() => null)
  if (!matchup) return EMPTY('no_matchup')

  const iAmA = matchup.teamA === myTeam.externalId
  const oppRosterId = iAmA ? matchup.teamB : matchup.teamA

  const teams = await args.prisma.leagueTeam
    .findMany({
      where: { leagueId: league.id, externalId: { in: [myTeam.externalId, oppRosterId] } },
      select: { externalId: true, teamName: true, platformUserId: true },
    })
    .catch(() => [])
  const teamByExternal = new Map(teams.map((t) => [t.externalId ?? '', t]))

  const rosters = await args.prisma.roster
    .findMany({ where: { leagueId: league.id }, select: { platformUserId: true, playerData: true } })
    .catch(() => [] as Array<{ platformUserId: string | null; playerData: unknown }>)
  const rosterByOwner = new Map(rosters.map((r) => [r.platformUserId ?? '', r.playerData]))

  /*
   * Roster lookup for the OPPONENT cannot use the claimed-user candidate — that id belongs to
   * the caller. Their roster joins on the platform user id or the roster id, both of which the
   * team row carries.
   */
  const idsFor = (rosterId: string): string[] => {
    const t = teamByExternal.get(rosterId)
    for (const key of [t?.platformUserId, rosterId]) {
      if (!key) continue
      const data = rosterByOwner.get(key)
      if (data) return rosterPlayerIds(data)
    }
    return []
  }

  /*
   * ⚠ MY OWN ROSTER DOES NOT JOIN THE SAME WAY THEIRS DOES, AND USING ONE PATH FOR BOTH LEFT MY
   * SIDE OF THE SCOREBOARD EMPTY. `Roster.platformUserId` sometimes holds our own User uuid
   * rather than the platform's id, so the caller's roster needs the claimed-team candidate chain
   * in `myRoster.ts`; the opponent's cannot use it, because that uuid is the caller's. Measured:
   * the opponent resolved 44 players while my side resolved 0.
   */
  const mine = await findMyRoster(args.prisma, league.id, args.userId)
  const myIds = mine.found ? rosterPlayerIds(mine.playerData) : idsFor(myTeam.externalId)
  const oppIds = idsFor(oppRosterId)
  const allIds = [...new Set([...myIds, ...oppIds])]
  if (allIds.length === 0) return EMPTY('no_matchup', ['No rosters imported for this matchup.'])

  const [playerRows, actual] = await Promise.all([
    args.prisma.sportsPlayer
      .findMany({
        where: { sleeperId: { in: allIds } },
        select: { sleeperId: true, name: true, position: true, team: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      })
      .catch(() => []),
    loadActualWeeklyPoints({
      prisma: args.prisma,
      season: season!,
      week: week!,
      playerIds: allIds,
      scoring,
    }),
  ])

  const meta = new Map<string, { name: string; position: string | null; team: string | null }>()
  for (const r of playerRows) {
    if (!r.sleeperId) continue
    const cur = meta.get(r.sleeperId)
    if (!cur || (!cur.position && r.position) || (!cur.team && r.team)) {
      meta.set(r.sleeperId, { name: r.name, team: r.team, position: r.position })
    }
  }

  const buildSide = (rosterId: string, ids: string[], officialScore: number | null): IdpMatchupSide => {
    const players: IdpMatchupPlayer[] = []
    let ourRosterTotal = 0
    let scored = 0
    for (const id of ids) {
      const m = meta.get(id)
      if (!m) continue // an id we cannot resolve to a player is not a scoreboard entry
      const points = actual.get(id) ?? { scored: false as const, reason: 'no_game' as const }
      if (points.scored) {
        ourRosterTotal += points.points
        scored++
      }
      players.push({
        sleeperId: id,
        name: m.name,
        position: m.position,
        team: m.team,
        /*
         * ⚠ AN UNKNOWN POSITION IS NOT AN OFFENSIVE ONE. Defaulting the else-branch to 'offense'
         * put Foye Oluokun and Jessie Bates on the offensive side of an IDP scoreboard, because
         * the cache spells their positions out in full and the predicate only knew abbreviations.
         * `isIdpPosition` reads both now, and anything still unrecognised is labelled as such
         * rather than being assigned to whichever side happens to be the fallback.
         */
        side: isIdpPosition(m.position) ? 'defense' : m.position ? 'offense' : 'unknown',
        points,
      })
    }
    players.sort((a, b) => (b.points.scored ? b.points.points : -1) - (a.points.scored ? a.points.points : -1))
    return {
      rosterId,
      teamName: teamByExternal.get(rosterId)?.teamName || `Team ${rosterId}`,
      officialScore,
      ourRosterTotal: Math.round(ourRosterTotal * 100) / 100,
      scoredPlayers: scored,
      totalPlayers: players.length,
      players,
    }
  }

  const you = buildSide(myTeam.externalId, myIds, iAmA ? matchup.scoreA ?? null : matchup.scoreB ?? null)
  const opponent = buildSide(oppRosterId, oppIds, iAmA ? matchup.scoreB ?? null : matchup.scoreA ?? null)

  /*
   * One note, stated once, rather than a per-side repetition of the same caveat.
   */
  const notes: string[] = [
    'The score is the platform’s own. The per-player points are ours, recomputed from stat ' +
      'lines under this league’s scoring — they cover every rostered player rather than that ' +
      'week’s starters, and we do not hold historical lineups, so they will not add up to the ' +
      'score.',
  ]
  for (const side of [you, opponent]) {
    if (side.scoredPlayers < side.totalPlayers) {
      notes.push(
        `${side.teamName}: priced ${side.scoredPlayers} of ${side.totalPlayers} rostered players ` +
          'from the stat lines we hold.',
      )
    }
  }

  return { state: 'ok', season, week, you, opponent, notes }
}
