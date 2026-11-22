import { effectiveSample, weightedMedian } from './datedMarketLearner'
import { postureOf, type Posture } from './postureMarketLearner'

/**
 * TRADE LEARNING FOR THE BOARD-VALUED SPORTS — NBA, MLB, NHL, NCAAB, soccer (owner's call, 2026-11-22: "do all").
 *
 * NFL trades are measured on a dated market chart. These sports have none: a player's value is the league's own board
 * (points or category score over replacement, for the games left). Since 2026-11-22 the live sync saves each traded
 * player's board price with the trade (`TradeContextSnapshot.boardValues`), and that is what this reads — so it learns
 * only from trades captured from that day on, and says how many it has.
 *
 * Two measurements, the same two questions the NFL learners ask, per sport:
 *
 *   POSTURE   what a team at .600 or better, or .400 or worse, pays over a middle team — value given ÷ value received
 *             on the trade day's board. (No veteran / youth / picks split: the board prices the games LEFT, so the one
 *             question it can answer is whether a team's record moves what it pays for rest-of-season value.)
 *   NEED      what a team with no spare at the position it bought pays over a team with depth there. Positions are the
 *             league's OWN dedicated starting slots (guards and bigs, pitchers, goalies — whatever it starts), never a
 *             fixed NFL list.
 *
 * A ratio of two sides in one league's unit is unit-free, so trades pool across leagues of a sport.
 * SHADOW: computed and stored; nothing reads it into a grade. Publication needs BOARD_MIN_EFFECTIVE_SAMPLE on both the
 * group and its baseline, and a premium is held to ±BOARD_MAX_PREMIUM_PCT. PURE.
 */

export const BOARD_MIN_EFFECTIVE_SAMPLE = 20
export const BOARD_MAX_PREMIUM_PCT = 25
/** A side whose total board value is below this share of the other's is not a trade this can read (a salary dump). */
const MIN_SIDE_SHARE = 0.05

export type BoardObservation =
  | { kind: 'posture'; transactionId: string; group: Posture; ratio: number; weight: number }
  | { kind: 'need'; transactionId: string; position: string; group: 'short' | 'normal'; ratio: number; weight: number }

export type BoardSkip = 'no_board_values' | 'no_context' | 'unpriced_player' | 'one_sided' | 'nothing_to_read'

type SnapSide = {
  rosterId?: unknown
  record?: { wins?: unknown; losses?: unknown; ties?: unknown } | null
  rosterBefore?: Array<{ id?: unknown; position?: string | null }>
}
export type BoardTradeRow = {
  transactionId: string
  week: number | null
  partnerRosterId: number | null
  playersGiven: unknown
  playersReceived: unknown
  contextSnapshot: unknown
}

const ids = (raw: unknown): string[] => (Array.isArray(raw) ? raw.map((x) => String(x)).filter(Boolean) : [])
/** Slot names that take several positions — never a position a team can be "short" at. */
const FLEX = /FLEX|UTIL|^G$|^F$|^BN$|^IR$|^IL$|^NA$|BENCH|RESERVE|TAXI|^P$|^W\/|\/|^DH$|^SKT$|^SUPER/i

/** The league's dedicated starting slots by position, from the snapshot. */
function dedicatedSlots(snap: { starterSlots?: unknown; league?: { roster_positions?: unknown } | null }): Map<string, number> {
  const out = new Map<string, number>()
  const add = (pos: unknown, n: number) => {
    const p = String(pos ?? '').trim().toUpperCase()
    if (!p || FLEX.test(p) || !(n > 0)) return
    out.set(p, (out.get(p) ?? 0) + n)
  }
  if (snap.starterSlots && typeof snap.starterSlots === 'object') for (const [p, n] of Object.entries(snap.starterSlots as Record<string, unknown>)) add(p, Number(n))
  else if (Array.isArray(snap.league?.roster_positions)) for (const p of snap.league!.roster_positions as unknown[]) add(p, 1)
  return out
}

/** One stored trade row → its observations (both sides), or why not. PURE. */
export function boardObservationsFor(row: BoardTradeRow, weight: number): BoardObservation[] | BoardSkip {
  const snap = row.contextSnapshot && typeof row.contextSnapshot === 'object'
    ? (row.contextSnapshot as { sides?: SnapSide[]; unavailable?: unknown; boardValues?: { byPlayer?: Record<string, unknown> }; starterSlots?: unknown; league?: { roster_positions?: unknown } | null })
    : null
  const values = snap?.boardValues?.byPlayer
  if (!snap || !values || typeof values !== 'object') return 'no_board_values'
  if (snap.unavailable || !Array.isArray(snap.sides) || snap.sides.length !== 2 || row.partnerRosterId == null) return 'no_context'
  const partner = snap.sides.find((s) => String(s.rosterId) === String(row.partnerRosterId))
  const own = snap.sides.find((s) => s !== partner)
  if (!partner || !own) return 'no_context'

  const given = ids(row.playersGiven)
  const received = ids(row.playersReceived)
  const price = (id: string) => {
    const v = values[id]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  if ([...given, ...received].some((id) => price(id) == null)) return 'unpriced_player'
  const total = (list: string[]) => list.reduce((n, id) => n + price(id)!, 0)
  const gave = total(given)
  const got = total(received)
  if (!(gave > 0) || !(got > 0) || Math.min(gave, got) / Math.max(gave, got) < MIN_SIDE_SHARE) return 'one_sided'

  const out: BoardObservation[] = []
  const week = Number(row.week ?? 0)
  const rec = (s: SnapSide) => (s.record ? { wins: Number(s.record.wins) || 0, losses: Number(s.record.losses) || 0, ties: Number(s.record.ties) || 0 } : null)
  // Each side bought what it received and paid what it gave.
  const sides = [
    { side: own, bought: received, ratio: gave / got },
    { side: partner, bought: given, ratio: got / gave },
  ]
  const slots = dedicatedSlots(snap)
  for (const { side, bought, ratio } of sides) {
    const posture = postureOf(rec(side), week)
    if (posture) out.push({ kind: 'posture', transactionId: row.transactionId, group: posture, ratio, weight })

    // Need: the one position most of what it bought plays, and its depth there BEFORE the trade.
    const roster = side.rosterBefore ?? []
    const posOf = new Map([...(own.rosterBefore ?? []), ...(partner.rosterBefore ?? [])].map((p) => [String(p.id), String(p.position ?? '').trim().toUpperCase()]))
    const byPos = new Map<string, number>()
    for (const id of bought) {
      const p = posOf.get(id)
      if (p) byPos.set(p, (byPos.get(p) ?? 0) + price(id)!)
    }
    const boughtTotal = bought.reduce((n, id) => n + price(id)!, 0)
    const [topPos, topValue] = [...byPos.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
    const need = topPos ? slots.get(topPos) : undefined
    if (topPos && need && boughtTotal > 0 && topValue / boughtTotal >= 0.6) {
      const have = roster.filter((p) => String(p.position ?? '').trim().toUpperCase() === topPos).length
      out.push({ kind: 'need', transactionId: row.transactionId, position: topPos, group: have <= need ? 'short' : 'normal', ratio, weight })
    }
  }
  return out.length ? out : 'nothing_to_read'
}

export type BoardPremium = {
  kind: 'posture' | 'need'
  /** `contend` / `rebuild` for posture; the position for need. */
  group: string
  premiumPct: number | null
  effectiveSample: number
  baselineEffectiveSample: number
  trades: number
  published: boolean
  note: string
}
export type BoardSportMarket = { sport: string; generatedAt: string; observations: number; tradesRead: number; premiums: BoardPremium[]; skipped: Record<string, number> }

const r1 = (n: number) => Math.round(n * 10) / 10

function premium(kind: 'posture' | 'need', group: string, obs: Array<{ ratio: number; weight: number }>, base: Array<{ ratio: number; weight: number }>, baseWord: string): BoardPremium {
  const med = (xs: typeof obs) => weightedMedian(xs.map((o) => ({ value: Math.log(o.ratio), weight: o.weight })))
  const eff = r1(effectiveSample(obs.map((o) => o.weight)))
  const baseEff = r1(effectiveSample(base.map((o) => o.weight)))
  const g = med(obs)
  const b = med(base)
  const raw = g != null && b != null ? (Math.exp(g - b) - 1) * 100 : null
  const capped = raw == null ? null : Math.max(-BOARD_MAX_PREMIUM_PCT, Math.min(BOARD_MAX_PREMIUM_PCT, raw))
  const enough = eff >= BOARD_MIN_EFFECTIVE_SAMPLE && baseEff >= BOARD_MIN_EFFECTIVE_SAMPLE
  return {
    kind, group, premiumPct: capped == null ? null : r1(capped), effectiveSample: eff, baselineEffectiveSample: baseEff, trades: obs.length,
    published: enough && capped != null,
    note: !enough
      ? `not enough trades: ${eff} here and ${baseEff} ${baseWord} (need ${BOARD_MIN_EFFECTIVE_SAMPLE} each)`
      : raw != null && Math.abs(raw) > BOARD_MAX_PREMIUM_PCT
        ? `measured ${Math.round(raw)}%, held to ±${BOARD_MAX_PREMIUM_PCT}%`
        : `measured from ${obs.length} trades against ${base.length} ${baseWord}`,
  }
}

/** One sport's premiums from its observations. PURE. */
export function computeBoardSportMarket(sport: string, observations: readonly BoardObservation[], now: Date, meta: { tradesRead: number; skipped: Record<string, number> }): BoardSportMarket {
  const usable = observations.filter((o) => o.weight > 0 && Number.isFinite(o.ratio) && o.ratio > 0)
  const posture = usable.filter((o): o is Extract<BoardObservation, { kind: 'posture' }> => o.kind === 'posture')
  const need = usable.filter((o): o is Extract<BoardObservation, { kind: 'need' }> => o.kind === 'need')
  const middle = posture.filter((o) => o.group === 'middle')
  const premiums: BoardPremium[] = [
    premium('posture', 'contend', posture.filter((o) => o.group === 'contend'), middle, 'middle-team trades'),
    premium('posture', 'rebuild', posture.filter((o) => o.group === 'rebuild'), middle, 'middle-team trades'),
    ...[...new Set(need.map((o) => o.position))].sort().map((pos) =>
      premium('need', pos, need.filter((o) => o.position === pos && o.group === 'short'), need.filter((o) => o.position === pos && o.group === 'normal'), 'normal-depth trades'),
    ),
  ]
  return { sport, generatedAt: now.toISOString(), observations: usable.length, tradesRead: meta.tradesRead, premiums, skipped: meta.skipped }
}

/** One line for the cron's warnings. */
export function describeBoardSportMarket(m: BoardSportMarket): string {
  const pub = m.premiums.filter((p) => p.published)
  return `${m.sport} trade learning (shadow): ${m.tradesRead} trades with board values, ${m.observations} observations, ${pub.length} of ${m.premiums.length} premiums published${pub.length ? ` (${pub.map((p) => `${p.kind} ${p.group} ${p.premiumPct! > 0 ? '+' : ''}${p.premiumPct}%`).join(', ')})` : ''}.`
}
