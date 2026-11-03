import 'server-only'
import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, extractScoringSettings, hasScoringRules } from '@/lib/projections/leagueScoring'
import { bestBallProjectedFinal } from './bestBallForecast'
import { readPlayerAvailability, type BestBallCandidate } from './matchupProjections'
import { starterGameStates } from './matchupGameState'
import { composePlayerIdentities, type ComposedPlayerIdentity } from './playerIdentityCompose'
import { displayPosition } from './positionLabels'
import { crosswalkToSleeperIds, sleeperLookupId } from './rosterIdCrosswalk'
import { startingSlotTemplate } from './rosterSlots'

/**
 * A best-ball elimination league's field, valued the way the league will actually score it: each live
 * roster's PROJECTED FINAL — the points already banked plus the best legal lineup its remaining players can
 * still make (`bestBallProjectedFinal`, the matchup screen's model, applied to every roster instead of two).
 *
 * ⚠ WHY THE LIST NEEDS THIS (owner's report, 2026-10-30). In best ball the lineup is chosen after the games,
 * from the whole roster, so a live score is only a floor until the last game is final. Ranking the field on
 * it put a team with Sunday-night players "in the cut zone" every Sunday afternoon, and the provider
 * projection the list used priced the listed starters only — never the bench that best ball also counts.
 *
 * All-or-nothing: a field rank needs every roster, so one roster that cannot be valued makes the whole field
 * unavailable, with the reason, rather than a rank built on a guess.
 */
export type BestBallFieldRoster = {
  rosterId: string
  /** Every player on the roster, in the roster's own id space. */
  players: string[]
  /** Reserve and taxi: on the roster but not eligible to score. */
  inactive: string[]
  /** The platform's current live total for the roster — a floor the projected final never goes under. */
  scoreboard: number
}

export type BestBallField =
  | { available: true; finals: Map<string, number>; provisional: boolean }
  | { available: false; reason: string }

export async function loadBestBallField(args: {
  league: { platform: string | null; sport: string | null; settings: unknown }
  platformLeagueId: string
  season: number
  week: number
  rosters: BestBallFieldRoster[]
}): Promise<BestBallField> {
  const { league, season, week, rosters } = args
  const scoring = extractScoringSettings(league.settings)
  if (!hasScoringRules(scoring)) return { available: false, reason: 'the league has no scoring rules on file' }
  const slots = startingSlotTemplate(league.settings)
  if (!slots?.length) return { available: false, reason: 'the league has no verified starting-slot template' }
  if (rosters.length < 2) return { available: false, reason: 'the field is not on file' }

  const platform = String(league.platform ?? '')
  const sport = String(league.sport ?? 'NFL')
  const ids = [...new Set(rosters.flatMap((r) => r.players))].filter((id) => id.length > 0 && !id.startsWith('name:'))
  const sleeperIdByRosterId = await crosswalkToSleeperIds(platform, sport, ids).catch(() => new Map<string, string>())
  const lookupOf = (id: string) => sleeperLookupId(platform, id, sleeperIdByRosterId, sport)
  const lookupIds = [...new Set(ids.map(lookupOf).filter((x): x is string => x != null))]

  const [projections, identityRows, scoreRows, games, availability] = await Promise.all([
    prisma.fantasyProjection.findMany({
      // The same read as the matchup screen: the component stat line, rescored under this league's rules.
      where: { playerId: { in: lookupIds }, season: String(season), week, source: { not: 'allfantasy' } },
      select: { playerId: true, stats: true },
    }),
    prisma.sportsPlayer.findMany({
      where: { sport: sport.toUpperCase(), sleeperId: { in: lookupIds } },
      select: { sleeperId: true, name: true, position: true, team: true, sport: true, source: true, fetchedAt: true },
    }),
    prisma.leaguePlayerWeeklyScore.findMany({
      // Written with the platform's own ids, so the roster ids join directly.
      where: { leagueId: args.platformLeagueId, seasonYear: season, week, playerId: { in: ids } },
      select: { playerId: true, points: true },
    }),
    prisma.sportsGame.findMany({
      where: { sport, season, week, OR: [{ seasonType: 'regular' }, { seasonType: null }] },
      select: { homeTeam: true, awayTeam: true, status: true, startTime: true, fetchedAt: true, seasonType: true },
      take: 400,
    }),
    readPlayerAvailability({ sport, season, week, sleeperIds: lookupIds }),
  ])

  const statsBySleeperId = new Map(projections.map((p) => [p.playerId, p.stats as Record<string, unknown> | null]))
  const bySleeperId = composePlayerIdentities(identityRows)
  const identityBy = new Map<string, ComposedPlayerIdentity>()
  for (const id of ids) {
    const row = bySleeperId.get(lookupOf(id) ?? '')
    if (row) identityBy.set(id, row)
  }
  const actualBy = new Map(scoreRows.map((r) => [r.playerId, r.points]))
  const states = starterGameStates(identityBy, games)

  const finals = new Map<string, number>()
  let provisional = false
  for (const roster of rosters) {
    const inactive = new Set(roster.inactive)
    const candidates: BestBallCandidate[] = roster.players.map((id) => {
      const sleeperId = lookupOf(id) ?? ''
      const unavailable = availability.unavailableBySleeperId.get(sleeperId) ?? null
      const stats = statsBySleeperId.get(sleeperId) ?? null
      const scored = computeLeagueProjectedPoints((stats?.stats ?? null) as Record<string, unknown> | null, scoring)
      return {
        playerId: id,
        position: displayPosition(identityBy.get(id)?.position),
        projected: unavailable ? 0 : scored?.points ?? null,
        unavailable,
        inactive: inactive.has(id),
      }
    })
    const final = bestBallProjectedFinal({
      slots,
      candidates,
      actualBy: scoreRows.length ? actualBy : null,
      stateBy: states,
      scoreboard: roster.scoreboard,
    })
    if (!final.available) return { available: false, reason: `roster ${roster.rosterId}: ${final.reason}` }
    finals.set(roster.rosterId, final.total)
    // Provisional while any player who can still score has a game that is not final.
    if (candidates.some((c) => !c.inactive && !c.unavailable && states.get(c.playerId) !== 'final')) provisional = true
  }
  return { available: true, finals, provisional }
}
