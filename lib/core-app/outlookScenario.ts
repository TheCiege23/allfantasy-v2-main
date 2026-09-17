/**
 * Season Outlook — what a roster change is worth, in points per week, so the simulation can price it.
 *
 * PURE and CLIENT-SAFE. The scenario panel runs this in the browser; the server runs the same
 * functions to quantify its recommended moves. One implementation, so "the move we suggested" and
 * "the move you modelled yourself" cannot disagree about the same swap.
 *
 * ── THE MODEL, STATED ONCE ─────────────────────────────────────────────────────────────────────
 *
 * Each player carries ONE number: this projection week's points, scored under this league's own
 * rules (`priceLeagueWeek`). A roster's strength is its best legal lineup from those numbers.
 *
 *   - Injury, trade, waiver: the change is `best lineup after − best lineup before`, per week. It is
 *     a DIFFERENCE, never an absolute — the simulation already carries each team's real scoring
 *     history as its baseline, and a projection-week lineup total would be a second, competing
 *     baseline on a different scale.
 *   - Lineup call: `your pick − the player it replaces`, for that one week, relative to the lineup
 *     you actually have set.
 *
 * ⚠ ONE PROJECTION WEEK STANDS IN FOR EVERY REMAINING WEEK. There is no rest-of-season weekly feed
 * in league scoring (`AFProjectionSnapshot.rosProjection` is full-PPR only, and this repo refuses a
 * generic number under a "your league" label). The assumptions panel says so beside every number.
 *
 * ⚠ UNPRICED IS NOT ZERO. A player with no projection is not a lineup candidate — the same rule
 * `fillLineup` enforces — and a change that moves an unpriced player is reported, not guessed.
 */

import { canFillSlot } from './slotEligibility'
import type { ForcedResult, SimAdjustment, SimInput } from './outlookSim'

export type ScenarioInjury = { status: string; kind: 'out' | 'risk' }

export type ScenarioPlayer = {
  id: string
  name: string
  position: string | null
  team: string | null
  /** This projection week, league-scored. Null when it cannot be priced. */
  points: number | null
  /** S starter · B bench · I reserve · T taxi · F free agent. */
  slot: 'S' | 'B' | 'I' | 'T' | 'F'
  injury: ScenarioInjury | null
  /** Regular-season bye week (NFL). */
  byeWeek: number | null
  age: number | null
}

export type ScenarioTeam = {
  rosterId: string
  name: string
  isYou: boolean
  players: ScenarioPlayer[]
}

export type ScenarioModel = {
  leagueId: string
  /** The projection week every player is priced from. */
  basisWeek: { season: string; week: number } | null
  /** Why rosters could not be priced; the schedule controls still work without them. */
  refusal: string | null
  slots: string[]
  teams: ScenarioTeam[]
  /** Best unrostered players at each position, for the waiver control. */
  freeAgents: ScenarioPlayer[]
  sim: SimInput
  seed: number
  /** Remaining regular-season weeks, ascending. */
  weeks: number[]
  youRosterId: string | null
}

export type Scenario = {
  /** Your player, out for `weeks` weeks from the next one (null = rest of season). */
  injuries: Array<{ playerId: string; weeks: number | null }>
  /** Start `startId` instead of the current starter `sitId`, for one week. */
  lineup: Array<{ startId: string; sitId: string; week: number }>
  trades: Array<{ partnerRosterId: string; send: string[]; receive: string[] }>
  waivers: Array<{ addId: string; dropId: string | null }>
  /** Fixed results. `winner` is a roster id. */
  results: ForcedResult[]
}

/** How many seasons the browser plays per scenario. Enough to be stable, quick enough to feel live. */
export const CLIENT_ITERATIONS = 3_000

export const EMPTY_SCENARIO: Scenario = { injuries: [], lineup: [], trades: [], waivers: [], results: [] }

export function scenarioIsEmpty(s: Scenario): boolean {
  return s.injuries.length + s.lineup.length + s.trades.length + s.waivers.length + s.results.length === 0
}

// ── Lineups ────────────────────────────────────────────────────────────

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB']

const breadth = new Map<string, number>()
function slotBreadth(slot: string): number {
  const key = slot.toUpperCase()
  let n = breadth.get(key)
  if (n == null) {
    n = POSITIONS.filter((p) => canFillSlot(key, p)).length
    breadth.set(key, n)
  }
  return n
}

export type LineupResult = {
  points: number
  starterIds: string[]
  unfilled: string[]
  /** Slots this app does not recognise; a caller must not trust `points` when this is non-empty. */
  unknown: string[]
}

/**
 * The best legal lineup. Most restrictive slot first, best eligible player in each — optimal here
 * because slot eligibility is nested (see `fillLineup` in `lib/decision-os/trade/rosterImpact.ts`,
 * which this mirrors; that one uses a narrower position table than `canFillSlot`, which is the
 * table the rest of /core agrees on).
 *
 * Players ruled out, on reserve, or on bye in the week asked about are not candidates.
 */
export function bestLineup(
  players: readonly ScenarioPlayer[],
  slots: readonly string[],
  week: number | null = null,
): LineupResult {
  const pool = players
    .filter(
      (p) =>
        p.points != null &&
        p.slot !== 'I' &&
        p.injury?.kind !== 'out' &&
        !(week != null && p.byeWeek === week),
    )
    .sort((a, b) => (b.points as number) - (a.points as number) || a.id.localeCompare(b.id))

  const ordered = slots
    .map((slot, index) => ({ slot: slot.toUpperCase(), index, size: slotBreadth(slot) }))
    .sort((a, b) => a.size - b.size || a.index - b.index)

  const taken = new Set<string>()
  const starterIds: string[] = []
  const unfilled: string[] = []
  const unknown: string[] = []
  let points = 0
  for (const { slot, size } of ordered) {
    if (size === 0) {
      unknown.push(slot)
      continue
    }
    const pick = pool.find((p) => !taken.has(p.id) && canFillSlot(slot, p.position))
    if (!pick) {
      unfilled.push(slot)
      continue
    }
    taken.add(pick.id)
    starterIds.push(pick.id)
    points += pick.points as number
  }
  return { points, starterIds, unfilled, unknown }
}

/** The lineup the manager has actually set, priced. Null when any starter is unpriced. */
export function setLineupPoints(players: readonly ScenarioPlayer[]): number | null {
  const starters = players.filter((p) => p.slot === 'S')
  if (starters.length === 0) return null
  let sum = 0
  for (const p of starters) {
    if (p.points == null) return null
    /* A starter who is ruled out scores nothing this week — that is the point of flagging it. */
    sum += p.injury?.kind === 'out' ? 0 : p.points
  }
  return sum
}

const round1 = (n: number) => Math.round(n * 10) / 10

// ── Scenario → simulation ──────────────────────────────────────────────

export type ScenarioEffect = {
  adjustments: SimAdjustment[]
  forced: ForcedResult[]
  /** Plain-language lines, one per change, with the points it is worth. */
  lines: string[]
  /** Changes that could not be priced, and why. */
  problems: string[]
}

type Roster = Map<string, ScenarioPlayer>

function rosterOf(team: ScenarioTeam): Roster {
  return new Map(team.players.map((p) => [p.id, p]))
}

/**
 * Turn a scenario into simulation inputs.
 *
 * Roster changes are applied WEEK BY WEEK, because they compose: a trade is permanent, an injury is
 * not, and "trade for a back while mine is hurt" is only priced right if week 6 sees both and week
 * 9 sees only the trade. Each affected team gets one adjustment per remaining week plus one for the
 * playoffs, each the lineup difference for that week's roster.
 */
export function scenarioEffect(model: ScenarioModel, scenario: Scenario): ScenarioEffect {
  const lines: string[] = []
  const problems: string[] = []
  const adjustments: SimAdjustment[] = []
  const teams = new Map(model.teams.map((t) => [t.rosterId, t]))
  const you = model.youRosterId ? teams.get(model.youRosterId) ?? null : null
  const nameOf = (id: string) =>
    model.teams.flatMap((t) => t.players).find((p) => p.id === id)?.name ??
    model.freeAgents.find((p) => p.id === id)?.name ??
    'that player'

  const rosterChanges = scenario.injuries.length + scenario.trades.length + scenario.waivers.length
  if (rosterChanges > 0 && (model.refusal || !you)) {
    problems.push(model.refusal ?? 'Your roster is not matched in this league, so roster changes cannot be priced.')
  }

  const canPrice = !model.refusal && model.slots.length > 0
  const weeks = model.weeks
  const firstWeek = weeks[0] ?? null

  /* Permanent roster edits per team. */
  const permanent = new Map<string, Roster>()
  const edit = (rosterId: string): Roster | null => {
    const team = teams.get(rosterId)
    if (!team) return null
    let r = permanent.get(rosterId)
    if (!r) {
      r = rosterOf(team)
      permanent.set(rosterId, r)
    }
    return r
  }

  if (canPrice && you) {
    for (const trade of scenario.trades) {
      const mine = edit(you.rosterId)
      const theirs = edit(trade.partnerRosterId)
      const partner = teams.get(trade.partnerRosterId)
      if (!mine || !theirs || !partner) {
        problems.push('That trade partner is not in this league’s rosters.')
        continue
      }
      const moved = [...trade.send.map((id) => mine.get(id)), ...trade.receive.map((id) => theirs.get(id))]
      if (moved.some((p) => !p)) {
        problems.push('A player in that trade is no longer on the roster we read.')
        continue
      }
      if (moved.some((p) => p!.points == null)) {
        problems.push(
          `The trade includes ${moved.filter((p) => p!.points == null).map((p) => p!.name).join(', ')}, who has no projection this week, so it was not priced.`,
        )
        continue
      }
      for (const id of trade.send) {
        const p = mine.get(id)!
        mine.delete(id)
        theirs.set(id, { ...p, slot: 'B' })
      }
      for (const id of trade.receive) {
        const p = theirs.get(id)!
        theirs.delete(id)
        mine.set(id, { ...p, slot: 'B' })
      }
      lines.push(
        `Trade with ${partner.name}: send ${trade.send.map(nameOf).join(', ') || 'nothing'}, get ${trade.receive.map(nameOf).join(', ') || 'nothing'}.`,
      )
    }

    for (const w of scenario.waivers) {
      const mine = edit(you.rosterId)!
      const add = model.freeAgents.find((p) => p.id === w.addId)
      if (!add) {
        problems.push('That free agent is not in the list we priced.')
        continue
      }
      if (add.points == null) {
        problems.push(`${add.name} has no projection this week, so the add was not priced.`)
        continue
      }
      if (w.dropId) {
        if (!mine.has(w.dropId)) {
          problems.push(`${nameOf(w.dropId)} is no longer on your roster.`)
          continue
        }
        mine.delete(w.dropId)
      }
      mine.set(add.id, { ...add, slot: 'B' })
      lines.push(`Add ${add.name}${w.dropId ? `, drop ${nameOf(w.dropId)}` : ''}.`)
    }
  }

  /* Which of your players are out in which week. */
  const outIn = (week: number): Set<string> => {
    const out = new Set<string>()
    if (firstWeek == null) return out
    for (const inj of scenario.injuries) {
      const idx = weeks.indexOf(week)
      if (inj.weeks == null || (idx >= 0 && idx < inj.weeks)) out.add(inj.playerId)
    }
    return out
  }
  if (canPrice && you) {
    for (const inj of scenario.injuries) {
      const p = you.players.find((x) => x.id === inj.playerId)
      if (!p) {
        problems.push(`${nameOf(inj.playerId)} is not on your roster.`)
        continue
      }
      lines.push(
        `${p.name} out ${inj.weeks == null ? 'for the rest of the season' : `for ${inj.weeks} week${inj.weeks === 1 ? '' : 's'}`}.`,
      )
    }
  }

  if (canPrice) {
    const affected = new Set<string>([...permanent.keys()])
    if (you && scenario.injuries.length > 0) affected.add(you.rosterId)
    for (const rosterId of affected) {
      const team = teams.get(rosterId)!
      const base = [...team.players]
      const after = [...(permanent.get(rosterId) ?? rosterOf(team)).values()]
      for (const week of weeks) {
        const out = rosterId === you?.rosterId ? outIn(week) : new Set<string>()
        const now = after.filter((p) => !out.has(p.id))
        const delta = bestLineup(now, model.slots, week).points - bestLineup(base, model.slots, week).points
        if (Math.abs(delta) >= 0.05) adjustments.push({ rosterId, fromWeek: week, toWeek: week, points: delta })
      }
      /* Playoffs: permanent changes, plus injuries marked for the rest of the season. */
      const lastWeek = weeks[weeks.length - 1] ?? 0
      const seasonOut =
        rosterId === you?.rosterId
          ? new Set(scenario.injuries.filter((i) => i.weeks == null).map((i) => i.playerId))
          : new Set<string>()
      const playoffDelta =
        bestLineup(after.filter((p) => !seasonOut.has(p.id)), model.slots).points - bestLineup(base, model.slots).points
      if (Math.abs(playoffDelta) >= 0.05) {
        adjustments.push({ rosterId, fromWeek: lastWeek + 1, toWeek: null, points: playoffDelta })
      }
    }
  }

  /* Lineup calls: relative to the lineup you have set, for one week. */
  if (you) {
    for (const call of scenario.lineup) {
      const start = you.players.find((p) => p.id === call.startId)
      const sit = you.players.find((p) => p.id === call.sitId)
      if (!start || !sit) {
        problems.push('One of those players is no longer on your roster.')
        continue
      }
      if (start.points == null || sit.points == null) {
        problems.push(`${start.points == null ? start.name : sit.name} has no projection this week, so the swap was not priced.`)
        continue
      }
      const sitPoints = sit.injury?.kind === 'out' ? 0 : sit.points
      const delta = start.points - sitPoints
      adjustments.push({ rosterId: you.rosterId, fromWeek: call.week, toWeek: call.week, points: delta })
      lines.push(`Week ${call.week}: start ${start.name} over ${sit.name} (${delta >= 0 ? '+' : ''}${round1(delta)} pts).`)
    }
  }

  const nameOfTeam = (id: string) => teams.get(id)?.name ?? 'Unnamed team'
  for (const r of scenario.results) {
    const loser = r.winner === r.a ? r.b : r.a
    lines.push(`Week ${r.week}: ${nameOfTeam(r.winner)} beat ${nameOfTeam(loser)}.`)
  }

  return { adjustments, forced: [...scenario.results], lines, problems }
}

/** Points per remaining week an effect adds to one team, averaged — for "worth about +4 a week". */
export function averageWeeklyDelta(effect: ScenarioEffect, rosterId: string, weeks: readonly number[]): number {
  if (weeks.length === 0) return 0
  let sum = 0
  for (const w of weeks) {
    for (const a of effect.adjustments) {
      if (a.rosterId !== rosterId) continue
      if ((a.fromWeek == null || w >= a.fromWeek) && (a.toWeek == null || w <= a.toWeek)) sum += a.points
    }
  }
  return sum / weeks.length
}
