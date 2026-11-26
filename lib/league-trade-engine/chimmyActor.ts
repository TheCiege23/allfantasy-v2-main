/**
 * WHEN CHIMMY MAY ACT FOR A TEAM IN THE LEAGUE TRADE ENGINE.
 *
 * Every accept, decline and offer in ./tradeService.ts checks that a real account runs the team. A
 * team Chimmy runs on autopilot (lib/inactive-manager) has no such account — an empty seat's owner is
 * an `orphan-…` placeholder — so without this the engine could never answer an offer made to it, and
 * the league page hid such teams as trade partners.
 *
 * This is the one place that says yes. It answers only for a team that Chimmy is PLAYING right now
 * (the league owner's plan covers it, see lib/inactive-manager/chimmyPlayable.ts), for its CURRENT
 * owner (a team that has changed hands is its new owner's), and whose commissioner has not switched
 * its trades off. The acting account is the commissioner who handed the team to Chimmy: the engine
 * needs a real user on every row it writes, and that is who answers for the team.
 *
 * ⚠ SERVER-ONLY BY CONSTRUCTION. The trade routes build the engine's input field by field and never
 * pass `chimmyForRosterId`; only the hourly Chimmy run does. Keep it that way: a route that forwarded
 * it would let a commissioner trade for a Chimmy team by hand.
 */
import { prisma } from '@/lib/prisma'
import { autopilotTradeMode, managedForOwner, type AutopilotTradeMode } from '@/lib/inactive-manager/inactiveManagerMode'

export type ChimmyActor = { rosterId: string; actorUserId: string; trades: AutopilotTradeMode }

/** Chimmy's standing in this league for each team it plays and takes trades for, by `Roster.id`. */
export async function chimmyTradeTeams(leagueId: string): Promise<Map<string, ChimmyActor>> {
  const out = new Map<string, ChimmyActor>()
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, userId: true, settings: true } })
  if (!league) return out
  const { readPlayableChimmyLineups } = await import('@/lib/inactive-manager/chimmyPlayable')
  const playable = await readPlayableChimmyLineups(league)
  const ids = Object.keys(playable).filter((id) => playable[id]?.autopilot && autopilotTradeMode(playable[id]) !== 'off')
  if (ids.length === 0) return out
  const rosters = await prisma.roster.findMany({ where: { leagueId, id: { in: ids } }, select: { id: true, platformUserId: true } })
  for (const r of rosters) {
    const entry = playable[r.id]!
    if (managedForOwner(entry, r.platformUserId) === 'new_owner') continue
    out.set(r.id, { rosterId: r.id, actorUserId: entry.autopilot!.byUserId, trades: autopilotTradeMode(entry) })
  }
  return out
}

/**
 * Every team Chimmy runs on autopilot in this league, whatever its trade setting and whether or not it
 * is playing — the teams an offer must never reach as part of a multi-team trade.
 */
export async function chimmyRunTeams(leagueId: string): Promise<Map<string, AutopilotTradeMode>> {
  const out = new Map<string, AutopilotTradeMode>()
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, userId: true, settings: true } })
  if (!league) return out
  const { readManagedLineups } = await import('@/lib/inactive-manager/inactiveManagerMode')
  const { readPlayableChimmyLineups } = await import('@/lib/inactive-manager/chimmyPlayable')
  const managed = readManagedLineups(league.settings)
  const ids = Object.keys(managed).filter((id) => managed[id]?.autopilot)
  if (ids.length === 0) return out
  const playable = await readPlayableChimmyLineups(league)
  const rosters = await prisma.roster.findMany({ where: { leagueId, id: { in: ids } }, select: { id: true, platformUserId: true } })
  for (const r of rosters) {
    if (managedForOwner(managed[r.id]!, r.platformUserId) === 'new_owner') continue
    // A team Chimmy runs but does not PLAY (the plan lapsed) takes no offers: nobody would answer them.
    out.set(r.id, playable[r.id]?.autopilot ? autopilotTradeMode(playable[r.id]) : 'off')
  }
  return out
}

/** Chimmy may act for `rosterId` as `actorUserId` — or null, and the caller must refuse. */
export async function resolveChimmyActor(leagueId: string, rosterId: string, actorUserId: string): Promise<ChimmyActor | null> {
  const team = (await chimmyTradeTeams(leagueId)).get(rosterId)
  return team && team.actorUserId === actorUserId ? team : null
}

export const CHIMMY_TRADES_OFF_MESSAGE = 'Chimmy is running this team while its manager is away, and it is not taking trade offers.'
export const CHIMMY_TWO_TEAM_MESSAGE = 'Chimmy is running one of these teams, and it only takes two-team trade offers.'
