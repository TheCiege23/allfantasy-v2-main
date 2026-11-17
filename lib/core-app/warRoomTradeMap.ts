import { bestLineup, type ScenarioModel, type ScenarioPlayer } from './outlookScenario'
import type { ScarcityRow } from './warRoomFormat'

/**
 * The trade map — War Room phase 6, beside the trade ideas: which teams are deep where you are thin,
 * and thin where you are deep.
 *
 * Phase 2's ideas price specific one-for-one swaps against your odds. This is the wider view a manager
 * starts a negotiation from: for every rival, the bench players who would START for you (they project
 * above your weakest starter at that position), and the positions where their starters sit under the
 * league average while you have a bench player who would start for them.
 *
 * ⚠ SAME ROSTERS, SAME WEEK, SAME LINEUP RULE as the format brief and the trade ideas — Season Outlook's
 * roster model and `bestLineup` — so the three cannot describe different teams.
 *
 * ⚠ FACTS ABOUT RIVALS, NEVER LABELS. A row says "a bench WR projecting 14.2" and "their RBs start
 * 4.0 under the league average" — measurements. Nothing calls a team a buyer, a seller or desperate.
 *
 * Pure and client-safe.
 */

/** A bench player counts as a fit only when he beats the starter he would replace by at least this. */
const MIN_UPGRADE = 1
/** A position counts as thin for a team only this far under the league's average starter. */
const MIN_THIN = 1
export const MAX_PARTNERS = 5

type MapPlayer = { id: string; name: string; position: string; points: number }

type TradeMapPartner = {
  rosterId: string
  name: string
  /** Their bench players who would start for you, best upgrade first. */
  theyHave: Array<{ player: MapPlayer; /** Points over the starter of yours he would replace. */ upgrade: number }>
  /** Positions where their starters sit under the league average AND you have a bench player who would start there. */
  theyNeed: Array<{ position: string; /** Their starters' average minus the league's (negative). */ underLeague: number; yourPlayer: MapPlayer; upgrade: number }>
}

export type TradeMap = {
  partners: TradeMapPartner[]
  /** Rivals with at least one fit, before the cap. */
  matched: number
  basisWeek: { season: string; week: number } | null
}

type Shape = {
  rosterId: string
  name: string
  isYou: boolean
  /** Position → starters' points, ascending (weakest first). */
  starters: Map<string, number[]>
  /** Bench players with a position and a projection. */
  bench: MapPlayer[]
}

function shapeOf(team: ScenarioModel['teams'][number], slots: readonly string[]): Shape | null {
  const lineup = bestLineup(team.players, slots)
  if (lineup.unknown.length > 0) return null
  const starting = new Set(lineup.starterIds)
  const starters = new Map<string, number[]>()
  const bench: MapPlayer[] = []
  for (const p of team.players) {
    if (!p.position || p.points == null) continue
    const pos = p.position.toUpperCase()
    if (starting.has(p.id)) starters.set(pos, [...(starters.get(pos) ?? []), p.points])
    // Outside the best lineup is depth — whatever slot the manager set. Reserve and taxi players are not.
    else if (p.slot === 'B' || p.slot === 'S') bench.push(toMap(p, pos))
  }
  for (const list of starters.values()) list.sort((a, b) => a - b)
  return { rosterId: team.rosterId, name: team.name, isYou: team.isYou, starters, bench }
}

const toMap = (p: ScenarioPlayer, pos: string): MapPlayer => ({ id: p.id, name: p.name, position: pos, points: p.points as number })
const round1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

/** Bench players of `from` who would start for `to`: beat `to`'s weakest starter at their position. */
function fits(from: Shape, to: Shape): Array<{ player: MapPlayer; upgrade: number }> {
  const out: Array<{ player: MapPlayer; upgrade: number }> = []
  for (const p of from.bench) {
    const weakest = to.starters.get(p.position)?.[0]
    if (weakest == null) continue
    const upgrade = p.points - weakest
    if (upgrade >= MIN_UPGRADE) out.push({ player: p, upgrade: round1(upgrade) })
  }
  // Best upgrade first, one player per position — the strongest fit is the one worth naming.
  out.sort((a, b) => b.upgrade - a.upgrade || a.player.name.localeCompare(b.player.name))
  const seen = new Set<string>()
  return out.filter((f) => (seen.has(f.player.position) ? false : (seen.add(f.player.position), true)))
}

export function buildTradeMap(model: ScenarioModel, scarcity: readonly ScarcityRow[]): TradeMap | null {
  if (model.refusal || model.slots.length === 0 || !model.youRosterId) return null
  const shapes = model.teams.map((t) => shapeOf(t, model.slots)).filter((s): s is Shape => s != null)
  const you = shapes.find((s) => s.rosterId === model.youRosterId)
  if (!you) return null
  const leagueAvg = new Map(scarcity.map((r) => [r.position, r.avgStarter]))

  const partners: TradeMapPartner[] = []
  for (const them of shapes) {
    if (them.isYou || them.rosterId === you.rosterId) continue
    const theyHave = fits(them, you)
    const yours = fits(you, them)
    const theyNeed = yours.flatMap((f) => {
      const league = leagueAvg.get(f.player.position)
      const theirs = them.starters.get(f.player.position)
      if (league == null || !theirs || theirs.length === 0) return []
      const underLeague = round1(avg(theirs) - league)
      return underLeague <= -MIN_THIN ? [{ position: f.player.position, underLeague, yourPlayer: f.player, upgrade: f.upgrade }] : []
    })
    if (theyHave.length === 0 && theyNeed.length === 0) continue
    partners.push({ rosterId: them.rosterId, name: them.name, theyHave, theyNeed })
  }

  // Two-way fits first (a trade both sides want), then by the best upgrade on offer to you.
  const score = (p: TradeMapPartner) => [p.theyHave.length > 0 && p.theyNeed.length > 0 ? 1 : 0, p.theyHave[0]?.upgrade ?? 0, p.theyNeed[0]?.upgrade ?? 0] as const
  partners.sort((a, b) => {
    const [a0, a1, a2] = score(a)
    const [b0, b1, b2] = score(b)
    return b0 - a0 || b1 - a1 || b2 - a2 || a.name.localeCompare(b.name)
  })

  return { partners: partners.slice(0, MAX_PARTNERS), matched: partners.length, basisWeek: model.basisWeek }
}
