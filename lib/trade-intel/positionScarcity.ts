import 'server-only'

import { prisma } from '@/lib/prisma'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { replaceableThreshold } from './leagueScale'
import type { Scarcity } from './rosterNeed'

/**
 * How hard each position is to fill from the waiver wire in ONE league.
 *
 * ⚠ THIS IS THE HALF THAT MAKES A NEED EXPENSIVE. Two identical rosters,
 * identical scoring, identical slots, and one manager's kicker is on IR. Both
 * teams have the same roster; only one of them has a problem, and whether it is
 * a problem at all depends on what is sitting unrostered. Twelve kickers on
 * waivers and the "need" costs a claim. An empty wire and a trade is the only
 * way to fill the slot — the same kicker is worth far more to that manager than
 * to the one beside them whose kicker is healthy.
 *
 * ⚠ AVAILABLE MEANS STARTABLE, NOT MERELY UNROSTERED. The player table carries
 * every practice-squad body and every retired name it ever saw. Counting those
 * as available would report a healthy waiver wire for a position that has
 * nothing on it, which is the failure that would make this feature worse than
 * not having it — it would price the desperate manager as though they had
 * options.
 *
 * So a free agent counts only if he has a projection for the week in question
 * and is not ruled out. That is the same evidence the lineup screen uses to
 * decide someone is playing.
 */

export type ScarcityBoard = Map<string, NonNullable<Scarcity>>

export async function getPositionScarcity(args: {
  leagueId: string
  sport: string
  /** The week whose projections decide who counts as startable. */
  projectionWeek: { season: string; week: number } | null
  /** Only these positions are counted — the ones the trade actually involves. */
  positions: string[]
}): Promise<ScarcityBoard> {
  const { leagueId, sport, projectionWeek, positions } = args
  const out: ScarcityBoard = new Map()
  if (!projectionWeek || positions.length === 0) return out

  const wanted = new Set(positions.map((p) => p.toUpperCase().trim()).filter(Boolean))
  if (wanted.size === 0) return out

  const rosters = await prisma.roster
    .findMany({ where: { leagueId }, select: { playerData: true } })
    .catch(() => [])
  if (rosters.length === 0) return out

  const rostered = new Set<string>()
  for (const r of rosters) {
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    if (!Array.isArray(pd.players)) continue
    for (const raw of pd.players) {
      const id = String(raw)
      if (id && id !== '0') rostered.add(id)
    }
  }

  /*
   * Everyone at these positions the projection feed expects to play this week.
   * The feed is the startable-universe filter: a player with no projected line
   * is not someone a manager can plug into a lineup on Sunday.
   */
  const projected = await prisma.fantasyProjection
    .findMany({
      where: {
        sport,
        season: projectionWeek.season,
        week: projectionWeek.week,
        source: { not: 'allfantasy' },
      },
      select: { playerId: true },
    })
    .catch(() => [])

  const projectedIds = [...new Set(projected.map((p) => p.playerId).filter(Boolean))]
  if (projectedIds.length === 0) return out

  const players = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: projectedIds }, position: { in: [...wanted] } },
      select: { sleeperId: true, name: true, position: true },
    })
    .catch(() => [])

  const candidates = players.filter((p) => p.sleeperId && !rostered.has(p.sleeperId))
  if (candidates.length === 0) {
    /*
     * Nothing unrostered is projected at any requested position. That is a real
     * and strong finding, not a gap — record zero rather than returning empty,
     * which a caller would read as "we did not look".
     */
    for (const pos of wanted) out.set(pos, { position: pos, freeAgents: 0, scarcity: 1 })
    return out
  }

  /*
   * Ruled-out free agents are not available either. A kicker on IR sitting
   * unrostered does not solve anybody's kicker problem.
   */
  const injuries = await prisma.sportsInjury
    .findMany({
      where: { sport, playerName: { in: candidates.map((c) => c.name) } },
      orderBy: { fetchedAt: 'desc' },
      select: { playerName: true, status: true },
    })
    .catch(() => [])
  const statusByName = new Map<string, string | null>()
  for (const i of injuries) {
    const k = i.playerName.toLowerCase()
    if (!statusByName.has(k)) statusByName.set(k, i.status)
  }

  const counts = new Map<string, number>()
  for (const c of candidates) {
    if (isRuledOut(statusByName.get((c.name ?? '').toLowerCase()) ?? null)) continue
    const pos = (c.position ?? '').toUpperCase()
    if (!wanted.has(pos)) continue
    counts.set(pos, (counts.get(pos) ?? 0) + 1)
  }

  const threshold = replaceableThreshold(rosters.length)
  for (const pos of wanted) {
    const freeAgents = counts.get(pos) ?? 0
    out.set(pos, {
      position: pos,
      freeAgents,
      /* Linear from "nothing" to "one per team", then flat at replaceable. */
      scarcity: Math.max(0, Math.min(1, 1 - freeAgents / threshold)),
    })
  }
  return out
}
