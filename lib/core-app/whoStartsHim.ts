import { DEFAULT_SLOT_ELIGIBILITY, fillLineup, type ImpactPlayer } from '@/lib/decision-os/trade/rosterImpact'

/**
 * "Who'd start him" — the sell side of a player you own. For each league where he is yours: which
 * of the other teams he would crack the best lineup of, ranked by how much he would add, and whom he
 * would bump. A shopping list for a trade pitch, not a verdict on who says yes.
 *
 * Pure, client-safe. The loader is whoStartsHimLoader.ts.
 *
 * ⚠ "START" IS DECIDED BY `fillLineup`, THE ONE LINEUP ENGINE — the league's own slots, a proper
 * assignment over overlapping flex groups — run on each roster with and without him. Players are
 * ranked by market value in this league's format, the proxy the partner ranking already uses
 * (partnerRanking.ts), and named as a proxy. An unpriced player is not a candidate, never a zero.
 *
 * ⚠ A HALF-READ ROSTER MAKES HIM START EVERYWHERE. An empty or mostly-unpriced roster has weak
 * "starters", so he tops every lineup and the answer reads as a hot market. Two guards, both in the
 * loader's inputs: only leagues whose rosters are in Sleeper's id space are read at all, and a league
 * is ranked only when most of its skill players are priced (`PRICED_SHARE_MIN`).
 */

/** Leagues read per view — each is a full-league roster read. */
export const SELL_LEAGUE_CAP = 6
/** Teams named per league; the rest are counted. */
export const SELL_TEAMS_SHOWN = 3
/** Share of the other rosters' skill players that must carry a market value before a league is ranked. */
export const PRICED_SHARE_MIN = 0.8
export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

export type SellPlayer = { id: string; name: string; position: string; value: number | null }
export type SellRoster = { key: string; teamName: string; players: SellPlayer[] }

export type SellTeam = {
  key: string
  teamName: string
  /** The lineup slot he would take. */
  slot: string
  /** The starter he would push out, or null when he fills a slot they could not. */
  bumps: { name: string; position: string } | null
  /** Starting-lineup value he adds, in market-value points — used to rank, not shown. */
  gain: number
}

export type SellLeague = {
  leagueId: string
  leagueName: string
  /** ranked: measured (teams may be empty — no one would start him). unread / unmeasured: see note. */
  state: 'ranked' | 'unread' | 'unmeasured'
  note: string | null
  teams: SellTeam[]
  /** Other teams in the league that were measured. */
  otherTeams: number
}

export type WhoStartsHim = { leagues: SellLeague[]; locked: boolean }

const isSkill = (p: string) => (SKILL_POSITIONS as readonly string[]).includes(p)

const SLOT_NAMES: Record<string, string> = {
  FLEX: 'flex',
  WRRB_FLEX: 'RB/WR flex',
  REC_FLEX: 'WR/TE flex',
  SUPER_FLEX: 'superflex',
  SUPERFLEX: 'superflex',
}

/** Sleeper's slot key as a manager says it: `SUPER_FLEX` → "superflex", `RB` stays "RB". */
export function slotName(slot: string): string {
  return SLOT_NAMES[slot.toUpperCase()] ?? slot.toUpperCase()
}

/** Share of skill-position players across the rosters that carry a market value. */
export function pricedShare(rosters: readonly SellRoster[]): number {
  let skill = 0
  let priced = 0
  for (const r of rosters)
    for (const p of r.players) {
      if (!isSkill(p.position)) continue
      skill += 1
      if (p.value != null && Number.isFinite(p.value)) priced += 1
    }
  return skill === 0 ? 0 : priced / skill
}

/**
 * Every other roster he would start for, best fit first. Returns the lineup's unmodelled slots so the
 * caller can refuse to rank a league whose lineup the engine cannot fill.
 */
export function rankWhoStartsHim(args: {
  him: { id: string; position: string; value: number }
  others: readonly SellRoster[]
  slots: readonly string[]
}): { teams: SellTeam[]; unknownSlots: string[] } {
  const himImpact: ImpactPlayer = { playerId: args.him.id, position: args.him.position, projectedPoints: args.him.value }
  const unknown = new Set<string>()
  const teams: SellTeam[] = []
  for (const r of args.others) {
    // He is on YOUR roster; an id that also shows up here is a stale copy, not a second him.
    const players = r.players.filter((p) => p.id !== args.him.id)
    const impact: ImpactPlayer[] = players.map((p) => ({ playerId: p.id, position: p.position, projectedPoints: p.value }))
    const without = fillLineup(impact, args.slots, DEFAULT_SLOT_ELIGIBILITY)
    const withHim = fillLineup([...impact, himImpact], args.slots, DEFAULT_SLOT_ELIGIBILITY)
    for (const s of [...without.unknownSlots, ...withHim.unknownSlots]) unknown.add(s)
    const gain = withHim.points - without.points
    const seat = withHim.assignments.find((a) => a.playerId === args.him.id)
    if (!seat || !(gain > 0)) continue
    const kept = new Set(withHim.starterIds)
    const bumpedId = without.starterIds.find((id) => !kept.has(id)) ?? null
    const bumped = bumpedId ? players.find((p) => p.id === bumpedId) ?? null : null
    teams.push({
      key: r.key,
      teamName: r.teamName,
      slot: seat.slot,
      bumps: bumped ? { name: bumped.name, position: bumped.position } : null,
      gain,
    })
  }
  teams.sort((a, b) => b.gain - a.gain || a.teamName.localeCompare(b.teamName))
  return { teams, unknownSlots: [...unknown] }
}
