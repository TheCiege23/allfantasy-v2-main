import { bestLineup, EMPTY_SCENARIO, scenarioEffect, type ScenarioModel, type ScenarioPlayer, type ScenarioTeam } from './outlookScenario'
import type { SimAdjustment } from './outlookSim'
import { agingThreshold } from './dynastyAging'
import type { WarHorizon, WarPosture } from './warRoomFront'

/**
 * War Room phase 2 — trades that move YOUR odds, for one league.
 *
 * The Front (warRoomFront.ts) tells a team what kind of play it needs. This finds the trades: for a
 * team playing for this season, swaps that raise its playoff (or, once in, title) odds; for a
 * keeper/dynasty team out of the race, which of its veterans contenders would gain most from.
 *
 * ── 🛑 NOT THE TRADE CENTER'S FINDER, AND NOT A SECOND ONE OF IT ────────
 *
 * `lib/trade-intel/tradeFinderService.ts` answers "what is a FAIR deal" — market ADP, complementary
 * needs, a fairness band — and fetches Sleeper live, Sleeper only. This answers "what deal moves MY
 * season", priced in the playoff odds Season Outlook already simulates, from the DB-backed roster
 * model (`loadScenarioModel`) on every platform that model prices. Different question, different
 * currency; each idea links to the Trade Center to build the deal there.
 *
 * ── HOW AN IDEA IS PRICED — THE OUTLOOK'S OWN MACHINERY ────────────────
 *
 *  1. SCREEN, cheaply: every 1-for-1 swap with every other team, priced as this projection week's
 *     best-lineup change for BOTH sides (`bestLineup`, the scenario panel's own). A swap is kept only
 *     when it lifts your lineup by at least MIN_GAIN and does not weaken theirs — a trade that only
 *     helps you is a trade nobody accepts, and listing it would be advice about nothing.
 *  2. PRICE the best few with `scenarioEffect` — week by week, byes and injuries included, both
 *     rosters changed — and run each through the SAME seeded branch simulation Season Outlook uses for
 *     its waiver moves, against the same baseline. That is the number the card prints.
 *
 * ⚠ ONE PROJECTION WEEK STANDS IN FOR THE REST OF THE SEASON — the scenario model's own stated limit
 * (outlookScenario.ts). The card says so beside every number.
 *
 * ⚠ "DOES NOT WEAKEN THEIRS" IS LINEUP ARITHMETIC, NOT A PREDICTION THAT THEY ACCEPT. Rivals are
 * described only by facts the outlook already shows (their lineup change, their playoff odds), never
 * classified — Scout's contract (scout.ts, 2026-09-30).
 *
 * Pure. The odds runner is injected so the server can hand it the real simulation and a test can hand
 * it arithmetic.
 */

/** Smallest weekly lineup gain worth suggesting a trade for — below this a trade is noise. */
export const MIN_GAIN = 1
/** Ideas priced by simulation. The rest are discarded after the screen. */
const PRICE_TOP = 6
/** Ideas shown. */
export const MAX_IDEAS = 3
/** Sell mode: veterans listed, and partners named per veteran. */
const MAX_VETERANS = 3
const PARTNERS_PER_VETERAN = 2

export type TradePlayer = { id: string; name: string; position: string | null; team: string | null; age: number | null }

export type WinNowIdea = {
  partnerRosterId: string
  partnerName: string
  send: TradePlayer
  receive: TradePlayer
  /** Projection-week lineup points, per week. */
  youGainPerWeek: number
  partnerGainPerWeek: number
  /** Points of probability, from the branch run. Null when the run could not price it. */
  playoffDelta: number | null
  titleDelta: number | null
  /** The partner's own playoff odds from the outlook board — a fact, not a label. Null when not modelled. */
  partnerPlayoffPct: number | null
}

export type SellIdea = {
  player: TradePlayer
  /** The age at which this position usually declines (dynastyAging.ts) — printed beside the age. */
  agingFrom: number
  partners: Array<{ rosterId: string; name: string; gainPerWeek: number; playoffPct: number | null }>
}

export type WarTrades =
  | {
      mode: 'win_now'
      /** Which odds the ideas are ranked by: title once your playoff spot is all but settled. */
      rankedBy: 'playoff' | 'title'
      ideas: WinNowIdea[]
      basisWeek: { season: string; week: number } | null
      /** How many swaps were screened, so "no idea" is distinguishable from "nothing looked at". */
      screened: number
    }
  | { mode: 'sell'; ideas: SellIdea[]; basisWeek: { season: string; week: number } | null }
  | { mode: 'closed'; deadlineWeek: number }
  | {
      mode: 'none'
      why: 'redraft_out' | 'not_priced' | 'no_team' | 'unplaced'
      /** The scenario model's own refusal, when that is the reason. */
      reason: string | null
    }

export type OddsRunner = (adjustments: SimAdjustment[]) => { playoff: number; title: number } | null

/** What the page hands the screen for the league on display (warRoomTradesLoader.ts builds it). */
export type WarTradesView = {
  leagueId: string
  posture: WarPosture
  trades: WarTrades
  /** Where a deal is built. */
  tradeCenterHref: string
}

export type WarTradesInput = {
  model: ScenarioModel
  posture: WarPosture
  horizon: WarHorizon
  sport: string | null
  /** True while trades are open; false once the deadline passed; null when the league states none. */
  deadlineOpen: boolean | null
  deadlineWeek: number | null
  /** Playoff % by roster id, from the outlook board. */
  teamPlayoffPct: ReadonlyMap<string, number>
  odds: OddsRunner
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Players a team can trade: on the active roster or bench, priced. Reserve and taxi stay out. */
function tradable(team: ScenarioTeam): ScenarioPlayer[] {
  return team.players.filter((p) => (p.slot === 'S' || p.slot === 'B') && p.points != null)
}

function asTradePlayer(p: ScenarioPlayer): TradePlayer {
  return { id: p.id, name: p.name, position: p.position, team: p.team, age: p.age }
}

function lineupPoints(players: readonly ScenarioPlayer[], slots: readonly string[]): number | null {
  const r = bestLineup(players, slots)
  return r.unknown.length > 0 ? null : r.points
}

function swapped(players: readonly ScenarioPlayer[], outId: string, incoming: ScenarioPlayer): ScenarioPlayer[] {
  return [...players.filter((p) => p.id !== outId), { ...incoming, slot: 'B' }]
}

type Screened = { partner: ScenarioTeam; send: ScenarioPlayer; receive: ScenarioPlayer; youGain: number; partnerGain: number }

/** Step 1: every 1-for-1 swap, both lineups priced on the projection week. */
export function screenSwaps(model: ScenarioModel, you: ScenarioTeam): { kept: Screened[]; screened: number } {
  const slots = model.slots
  const mine = you.players
  const myBase = lineupPoints(mine, slots)
  if (myBase == null) return { kept: [], screened: 0 }
  const kept: Screened[] = []
  let screened = 0
  for (const partner of model.teams) {
    if (partner.rosterId === you.rosterId) continue
    const theirBase = lineupPoints(partner.players, slots)
    if (theirBase == null) continue
    for (const send of tradable(you)) {
      for (const receive of tradable(partner)) {
        screened += 1
        const youAfter = lineupPoints(swapped(mine, send.id, receive), slots)
        if (youAfter == null) continue
        const youGain = youAfter - myBase
        if (youGain < MIN_GAIN) continue
        const theirAfter = lineupPoints(swapped(partner.players, receive.id, send), slots)
        if (theirAfter == null) continue
        const partnerGain = theirAfter - theirBase
        if (partnerGain < 0) continue
        kept.push({ partner, send, receive, youGain, partnerGain })
      }
    }
  }
  return { kept, screened }
}

/**
 * The few worth pricing: biggest gain to you first, at most one per partner and one per player you
 * send, so three ideas are three different conversations rather than one deal three ways.
 */
function shortlist(kept: Screened[], n: number): Screened[] {
  const sorted = [...kept].sort(
    (a, b) => b.youGain - a.youGain || b.partnerGain - a.partnerGain || a.send.id.localeCompare(b.send.id) || a.receive.id.localeCompare(b.receive.id),
  )
  const out: Screened[] = []
  const partners = new Set<string>()
  const sends = new Set<string>()
  for (const s of sorted) {
    if (partners.has(s.partner.rosterId) || sends.has(s.send.id)) continue
    partners.add(s.partner.rosterId)
    sends.add(s.send.id)
    out.push(s)
    if (out.length >= n) break
  }
  return out
}

function winNow(input: WarTradesInput, you: ScenarioTeam): WarTrades {
  const { model } = input
  const { kept, screened } = screenSwaps(model, you)
  const rankedBy: 'playoff' | 'title' = input.posture === 'clinched' ? 'title' : 'playoff'
  const baseline = input.odds([])
  const ideas: WinNowIdea[] = shortlist(kept, PRICE_TOP).map((s) => {
    const effect = scenarioEffect(model, {
      ...EMPTY_SCENARIO,
      trades: [{ partnerRosterId: s.partner.rosterId, send: [s.send.id], receive: [s.receive.id] }],
    })
    const priced = effect.problems.length === 0 && baseline ? input.odds(effect.adjustments) : null
    return {
      partnerRosterId: s.partner.rosterId,
      partnerName: s.partner.name,
      send: asTradePlayer(s.send),
      receive: asTradePlayer(s.receive),
      youGainPerWeek: round1(s.youGain),
      partnerGainPerWeek: round1(s.partnerGain),
      playoffDelta: priced && baseline ? round1(priced.playoff - baseline.playoff) : null,
      titleDelta: priced && baseline ? round1(priced.title - baseline.title) : null,
      partnerPlayoffPct: input.teamPlayoffPct.get(s.partner.rosterId) ?? null,
    }
  })
  const key = (i: WinNowIdea) => (rankedBy === 'title' ? i.titleDelta : i.playoffDelta) ?? Number.NEGATIVE_INFINITY
  ideas.sort((a, b) => key(b) - key(a) || b.youGainPerWeek - a.youGainPerWeek)
  return {
    mode: 'win_now',
    rankedBy,
    // An idea the simulation says does not help is not an idea, whatever the lineup arithmetic said.
    ideas: ideas.filter((i) => i.playoffDelta == null || (rankedBy === 'title' ? (i.titleDelta ?? 0) > 0 : i.playoffDelta > 0)).slice(0, MAX_IDEAS),
    basisWeek: model.basisWeek,
    screened,
  }
}

/**
 * Sell mode, for a keeper/dynasty team playing for next season: your veterans past their position's
 * usual decline age, and the teams whose lineups they would lift most this week.
 *
 * ⚠ IT NAMES NO RETURN PACKAGE. Pricing what to ask for — young players, picks — needs a dynasty
 * value this model does not hold, and an invented one would be the worst kind of advice: specific
 * and wrong. The card says "ask for youth and picks" and leaves the price to the Trade Center.
 */
function sell(input: WarTradesInput, you: ScenarioTeam): WarTrades {
  const { model } = input
  const slots = model.slots
  const veterans = tradable(you)
    .map((p) => ({ p, from: p.position ? agingThreshold(input.sport, p.position) : undefined }))
    .filter((v): v is { p: ScenarioPlayer; from: number } => v.from != null && v.p.age != null && v.p.age >= v.from)

  const ideas: SellIdea[] = []
  for (const { p, from } of veterans) {
    const partners: SellIdea['partners'] = []
    for (const team of model.teams) {
      if (team.rosterId === you.rosterId) continue
      const base = lineupPoints(team.players, slots)
      const after = lineupPoints([...team.players, { ...p, slot: 'B' }], slots)
      if (base == null || after == null) continue
      const gain = after - base
      if (gain < MIN_GAIN) continue
      partners.push({ rosterId: team.rosterId, name: team.name, gainPerWeek: round1(gain), playoffPct: input.teamPlayoffPct.get(team.rosterId) ?? null })
    }
    if (partners.length === 0) continue
    partners.sort((a, b) => b.gainPerWeek - a.gainPerWeek || a.name.localeCompare(b.name))
    ideas.push({ player: asTradePlayer(p), agingFrom: from, partners: partners.slice(0, PARTNERS_PER_VETERAN) })
  }
  ideas.sort((a, b) => (b.partners[0]?.gainPerWeek ?? 0) - (a.partners[0]?.gainPerWeek ?? 0) || a.player.name.localeCompare(b.player.name))
  return { mode: 'sell', ideas: ideas.slice(0, MAX_VETERANS), basisWeek: model.basisWeek }
}

/**
 * The trades worth making in this league, for the posture the Front gave it.
 *
 * The order of the gates is the order a strategist would ask: is the league placed, are trades open,
 * can the rosters be priced, and only then what to do.
 */
export function buildWarTrades(input: WarTradesInput): WarTrades {
  const { model, posture, horizon } = input
  if (posture === 'unplaced') return { mode: 'none', why: 'unplaced', reason: null }
  if (input.deadlineOpen === false && input.deadlineWeek != null) return { mode: 'closed', deadlineWeek: input.deadlineWeek }
  // A redraft team out of the race has nothing to trade FOR: nothing carries over (warRoomFront.ts).
  // A redraft LONG SHOT is still alive, so it falls through to win-now: a swap that moves its odds counts.
  if (posture === 'eliminated' && horizon === 'this_season') return { mode: 'none', why: 'redraft_out', reason: null }
  if (model.refusal || model.slots.length === 0) return { mode: 'none', why: 'not_priced', reason: model.refusal }
  const you = model.youRosterId ? model.teams.find((t) => t.rosterId === model.youRosterId) ?? null : null
  if (!you) return { mode: 'none', why: 'no_team', reason: null }
  if ((posture === 'long_shot' || posture === 'eliminated') && horizon === 'carries_over') return sell(input, you)
  return winNow(input, you)
}
