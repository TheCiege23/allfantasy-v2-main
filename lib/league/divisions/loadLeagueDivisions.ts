import { prisma } from '@/lib/prisma'
import {
  parseActiveLeagueDivisions,
  resolveRosterDivisions,
  type DivisionPlayoffRule,
  type LeagueDivision,
  type LeagueTeamIdentity,
} from './leagueDivisions'

export type SeasonRosterDivisions = {
  playoffRule: DivisionPlayoffRule
  /** Schedule each division rival a second time after the full round robin. */
  rivalsTwice: boolean
  divisions: LeagueDivision[]
  /** `RedraftRoster.id` → its division. Rosters with none are absent. */
  byRoster: Map<string, LeagueDivision>
}

/**
 * The commissioner's divisions for a season's rosters (`RedraftRoster`), or null when the league has
 * none. A season roster reaches its `LeagueTeam` through its generic `Roster` (`redraftRosterId`, or
 * `platformUserId === ownerId`) and that roster's id being the team's `externalId`.
 *
 * ⚠ BEST-EFFORT, LIKE THE HEAD-TO-HEAD READ BESIDE IT. A failed read means "no divisions", which seeds
 * by record exactly as before divisions existed. It never blocks a standings or playoff read.
 */
export async function loadSeasonRosterDivisions(
  leagueId: string,
  rosters: ReadonlyArray<{ id: string; ownerId: string }>,
): Promise<SeasonRosterDivisions | null> {
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const active = parseActiveLeagueDivisions(league?.settings)
    if (!active) return null
    const [teams, generic] = await Promise.all([
      prisma.leagueTeam.findMany({
        where: { leagueId },
        select: { id: true, externalId: true, claimedByUserId: true, platformUserId: true },
      }) as Promise<LeagueTeamIdentity[]>,
      prisma.roster.findMany({
        where: { leagueId },
        select: { id: true, platformUserId: true, redraftRosterId: true },
      }) as Promise<Array<{ id: string; platformUserId: string | null; redraftRosterId: string | null }>>,
    ])
    const byRoster = resolveRosterDivisions(
      active,
      teams,
      rosters.map((r) => {
        const link = generic.find((g) => g.redraftRosterId === r.id) ?? generic.find((g) => g.platformUserId === r.ownerId)
        return { rosterId: r.id, ids: [r.ownerId, link?.id, link?.platformUserId] }
      }),
    )
    return { playoffRule: active.playoffRule, rivalsTwice: active.rivalsTwice, divisions: active.divisions, byRoster }
  } catch {
    return null
  }
}
