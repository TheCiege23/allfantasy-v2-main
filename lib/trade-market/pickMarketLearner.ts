import { FIRST_ROUND_IN_MARKET_UNITS, pickRoundShare, REFERENCE_TEAMS } from '@/lib/pick-curve'
import { effectiveSample } from './datedMarketLearner'

/**
 * DRAFT PICK VALUES, LEARNED FROM THE TRADES THEMSELVES (owner's call, 2026-11-22 — trade learning, step 3).
 *
 * Every dynasty trade with a pick in it prices that pick on one fixed curve (`lib/pick-curve.ts`): a first is 950
 * chart units, a second 48% of that, a third 24%, and a 2028 first is worth exactly a 2027 first. That curve was fitted
 * once, to 771 trades, before any of the ~30,000 stored now — and it has no idea how far away a pick's draft is.
 *
 * Here the trades answer it. In a completed trade both sides' players are priced on the chart OF THE TRADE'S DAY
 * (`datedMarketLearner.ts`), so whatever the players and FAAB do not balance is what the picks were worth:
 *
 *     Σ (picks given − picks received)·value  ≈  players received − players given  (+ FAAB received − given)
 *
 * one equation per trade, solved for one value per CLASS of pick:
 *   - ROUND, as the 12-team round it equals (a 4-team league's 3rd is a 12-team 1st — `lib/pick-curve.ts`), 1/2/3/4+;
 *   - HORIZON, how many drafts away it is: 0 = the next rookie draft, 1 = the one after, 2 = two or more after.
 *
 * ⚠ HOW: weighted least squares, each equation divided by the trade's size (so a blockbuster does not drown ten small
 * trades), each trade weighted by recency (halving every 90 days), Huber-reweighted (a lopsided trade cannot drag a class
 * on its own), and pulled toward the current curve by a prior worth {@link PICK_PRIOR_TRADES} trades — so a class with
 * little evidence stays where it was rather than swinging on a handful of deals.
 * ⚠ A CLASS IS PUBLISHED ONLY ON ENOUGH EVIDENCE: an effective sample of at least {@link PICK_MIN_EFFECTIVE_SAMPLE}
 * trades, and a value within [⅓×, 3×] of the curve. Anything else keeps the curve, and the reason is recorded.
 * ⚠ SHADOW FIRST, like the dated market: computed and stored every run, read by nothing yet. Using it is a later,
 * separate switch made on what these runs show.
 *
 * PURE.
 */

export const PICK_ROUND_BUCKETS = [1, 2, 3, 4] as const
export const PICK_HORIZONS = [0, 1, 2] as const
export type PickRoundBucket = (typeof PICK_ROUND_BUCKETS)[number]
export type PickHorizon = (typeof PICK_HORIZONS)[number]
export type PickClassKey = `${PickRoundBucket}:${PickHorizon}`

/** The prior holds each class with the weight of this many average trades. */
export const PICK_PRIOR_TRADES = 20
/** Below this effective sample a class keeps the curve. */
export const PICK_MIN_EFFECTIVE_SAMPLE = 30
/** Huber threshold on a trade's size-normalized residual. */
const HUBER_DELTA = 0.25
const IRLS_ROUNDS = 8
/** A learned value outside [prior / this, prior × this] is not published. */
const PICK_PLAUSIBLE_FACTOR = 3

export const PICK_CLASSES: readonly PickClassKey[] = PICK_ROUND_BUCKETS.flatMap((r) => PICK_HORIZONS.map((h) => `${r}:${h}` as PickClassKey))

/** The curve's value for a class: no horizon discount — that is exactly what the curve does today. */
export function priorPickValue(key: PickClassKey): number {
  const round = Number(key.split(':')[0])
  return FIRST_ROUND_IN_MARKET_UNITS * pickRoundShare(round)
}

/**
 * The rookie draft a trade on this date is waiting for. Rookie drafts are held May–August, so a trade from January to
 * July is waiting for this year's and one from August on for next year's. ⚠ Approximate at the August edge; a pick of
 * an earlier season than this is already drafted and the trade is not used.
 */
export function nextDraftYear(tradeDate: Date): number {
  const y = tradeDate.getUTCFullYear()
  return tradeDate.getUTCMonth() <= 6 ? y : y + 1
}

/** The 12-team round a pick equals, from its own league's size (mid-slot when the slot is unknown). */
export function equivalentRoundBucket(round: number, teams: number | null): PickRoundBucket {
  const t = teams != null && Number.isFinite(teams) && teams >= 2 ? teams : REFERENCE_TEAMS
  const overall = (Math.max(1, Math.round(round)) - 1) * t + (t + 1) / 2
  const rEquiv = (overall - (REFERENCE_TEAMS + 1) / 2) / REFERENCE_TEAMS + 1
  return Math.min(4, Math.max(1, Math.round(rEquiv))) as PickRoundBucket
}

export type ParsedPick = { season: number; round: number }

/** `{ season, round }` entries out of a stored pick column; null when any entry cannot be read. */
export function parsePicks(raw: unknown): ParsedPick[] | null {
  if (!Array.isArray(raw)) return []
  const out: ParsedPick[] = []
  for (const e of raw) {
    if (!e || typeof e !== 'object') return null
    const o = e as Record<string, unknown>
    const season = Number(o.season)
    const round = Number(o.round)
    if (!Number.isFinite(season) || season < 2000 || !Number.isFinite(round) || round < 1) return null
    out.push({ season, round })
  }
  return out
}

/** One trade's equation. `net[k]` = picks of class k this side GAVE minus RECEIVED; `y` = what the picks had to make up. */
export type PickObservation = {
  transactionId: string
  net: Partial<Record<PickClassKey, number>>
  y: number
  /** The trade's size in chart units (all players both ways plus the curve's value of every pick), for normalizing. */
  size: number
  weight: number
}

export type PickSkip = 'no_picks' | 'unparseable_pick' | 'pick_already_drafted' | 'unpriced_player' | 'picks_cancel'

/**
 * One trade → its pick equation, from the row's own side. PURE.
 * `given`/`received` are the side's players' values on the trade's day; `faab*` its FAAB in the same units.
 */
export function pickObservationFor(input: {
  transactionId: string
  tradeDate: Date
  teams: number | null
  picksGiven: unknown
  picksReceived: unknown
  playersGivenValue: number
  playersReceivedValue: number
  faabGivenValue?: number
  faabReceivedValue?: number
  weight: number
}): PickObservation | PickSkip {
  const g = parsePicks(input.picksGiven)
  const r = parsePicks(input.picksReceived)
  if (g == null || r == null) return 'unparseable_pick'
  if (g.length === 0 && r.length === 0) return 'no_picks'
  const draft = nextDraftYear(input.tradeDate)
  const classOf = (p: ParsedPick): PickClassKey | null => {
    const h = p.season - draft
    if (h < 0) return null
    return `${equivalentRoundBucket(p.round, input.teams)}:${Math.min(2, h) as PickHorizon}` as PickClassKey
  }
  const net: Partial<Record<PickClassKey, number>> = {}
  let pickSize = 0
  for (const [list, sign] of [[g, 1], [r, -1]] as const) {
    for (const p of list) {
      const k = classOf(p)
      if (k == null) return 'pick_already_drafted'
      net[k] = (net[k] ?? 0) + sign
      pickSize += priorPickValue(k)
    }
  }
  for (const k of Object.keys(net) as PickClassKey[]) if (net[k] === 0) delete net[k]
  if (Object.keys(net).length === 0) return 'picks_cancel'
  const faabNet = (input.faabReceivedValue ?? 0) - (input.faabGivenValue ?? 0)
  const y = input.playersReceivedValue - input.playersGivenValue + faabNet
  const size = input.playersGivenValue + input.playersReceivedValue + pickSize
  if (!(size > 0)) return 'unpriced_player'
  return { transactionId: input.transactionId, net, y, size, weight: input.weight }
}

/** Solve A·x = b for a small dense symmetric system (Gaussian elimination, partial pivoting). Null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]!])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r
    if (Math.abs(M[p]![c]!) < 1e-12) return null
    ;[M[c], M[p]] = [M[p]!, M[c]!]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r]![c]! / M[c]![c]!
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!
    }
  }
  return M.map((row, i) => row[n]! / row[i]!)
}

export type PickClassValue = {
  key: PickClassKey
  round: PickRoundBucket
  horizon: PickHorizon
  prior: number
  learned: number
  /** learned / prior. */
  ratio: number
  /** Effective number of trades that moved a pick of this class. */
  effectiveSample: number
  trades: number
  published: boolean
  /** The value to use: learned when published, the curve otherwise. */
  value: number
  note: string
}

export type PickMarket = {
  generatedAt: string
  tradesUsed: number
  classes: PickClassValue[]
  /** Within each horizon, does a better round cost more? Reported, never forced. */
  roundsOrdered: boolean
  /** Within each round, is a nearer draft worth at least a farther one? Reported, never forced. */
  horizonsOrdered: boolean
}

/** The learned pick values from one book's equations. PURE. */
export function computePickMarket(observations: readonly PickObservation[], now: Date): PickMarket {
  const keys = PICK_CLASSES
  const n = keys.length
  const idx = new Map(keys.map((k, i) => [k, i]))
  const prior = keys.map(priorPickValue)
  const usable = observations.filter((o) => o.weight > 0 && o.size > 0)

  // The prior's strength: PICK_PRIOR_TRADES trades of average weight.
  const meanW = usable.length ? usable.reduce((s, o) => s + o.weight, 0) / usable.length : 1
  const lambda = PICK_PRIOR_TRADES * meanW

  const globalTau = usable.length
    ? usable.reduce((s, o) => s + Object.values(o.net).reduce((t, c) => t + ((c as number) / o.size) ** 2, 0), 0) / usable.length
    : 1 / (FIRST_ROUND_IN_MARKET_UNITS * FIRST_ROUND_IN_MARKET_UNITS)
  const tau = keys.map((k) => {
    const touching = usable.filter((o) => (o.net[k] ?? 0) !== 0)
    return touching.length ? touching.reduce((s, o) => s + ((o.net[k] as number) / o.size) ** 2, 0) / touching.length : globalTau
  })

  let x = [...prior]
  const robust = usable.map(() => 1)
  for (let it = 0; it < IRLS_ROUNDS; it++) {
    const A = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    const b = new Array<number>(n).fill(0)
    usable.forEach((o, j) => {
      const w = o.weight * robust[j]!
      const row = new Array<number>(n).fill(0)
      for (const [k, c] of Object.entries(o.net) as Array<[PickClassKey, number]>) row[idx.get(k)!] = c / o.size
      const yy = o.y / o.size
      for (let a = 0; a < n; a++) {
        if (row[a] === 0) continue
        b[a]! += w * row[a]! * yy
        for (let c = 0; c < n; c++) if (row[c] !== 0) A[a]![c]! += w * row[a]! * row[c]!
      }
    })
    // Ridge toward the curve: + λ·τ_k·(x_k − p_k)², where τ_k is the coefficient² of a typical trade that moved a pick of
    // class k — so the pull on each class weighs exactly PICK_PRIOR_TRADES of ITS OWN trades. (One global τ held a first
    // more firmly than a third: trades with firsts in them are bigger, so their normalized coefficients are smaller.)
    for (let a = 0; a < n; a++) {
      A[a]![a]! += lambda * tau[a]!
      b[a]! += lambda * tau[a]! * prior[a]!
    }
    const next = solve(A, b)
    if (!next) break
    x = next
    // Huber reweight on each trade's normalized residual.
    usable.forEach((o, j) => {
      let pred = 0
      for (const [k, c] of Object.entries(o.net) as Array<[PickClassKey, number]>) pred += c * x[idx.get(k)!]!
      const resid = Math.abs((pred - o.y) / o.size)
      robust[j] = resid <= HUBER_DELTA ? 1 : HUBER_DELTA / resid
    })
  }

  const classes: PickClassValue[] = keys.map((key, i) => {
    const touching = usable.filter((o) => (o.net[key] ?? 0) !== 0)
    const eff = Math.round(effectiveSample(touching.map((o) => o.weight)) * 10) / 10
    const learned = Math.round(x[i]!)
    const p = prior[i]!
    const ratio = Math.round((learned / p) * 1000) / 1000
    const plausible = learned > 0 && learned >= p / PICK_PLAUSIBLE_FACTOR && learned <= p * PICK_PLAUSIBLE_FACTOR
    const enough = eff >= PICK_MIN_EFFECTIVE_SAMPLE
    const published = plausible && enough
    const [round, horizon] = key.split(':').map(Number) as [PickRoundBucket, PickHorizon]
    return {
      key, round, horizon, prior: Math.round(p), learned, ratio, effectiveSample: eff, trades: touching.length, published,
      value: published ? learned : Math.round(p),
      note: !enough
        ? `kept the curve: effective sample ${eff} < ${PICK_MIN_EFFECTIVE_SAMPLE}`
        : !plausible
          ? `kept the curve: learned ${learned} is outside ⅓×–3× of ${Math.round(p)}`
          : `learned from ${touching.length} trades (effective ${eff})`,
    }
  })

  const v = (r: number, h: number) => classes.find((c) => c.round === r && c.horizon === h)!.value
  const roundsOrdered = PICK_HORIZONS.every((h) => PICK_ROUND_BUCKETS.slice(1).every((r) => v(r - 1, h) >= v(r, h)))
  const horizonsOrdered = PICK_ROUND_BUCKETS.every((r) => PICK_HORIZONS.slice(1).every((h) => v(r, h - 1) >= v(r, h)))
  return { generatedAt: now.toISOString(), tradesUsed: usable.length, classes, roundsOrdered, horizonsOrdered }
}

/** One line per published class, for the cron's warnings. */
export function describePickMarket(label: string, m: PickMarket): string {
  const pub = m.classes.filter((c) => c.published)
  const parts = pub.map((c) => `${c.round}${['st', 'nd', 'rd', 'th'][c.round - 1]}+${c.horizon}y ${c.learned} (${c.ratio}×)`)
  return `pick market ${label}: ${m.tradesUsed} trades, ${pub.length}/${m.classes.length} classes learned${parts.length ? ` — ${parts.join(', ')}` : ''}${m.roundsOrdered ? '' : '; ⚠ rounds out of order'}${m.horizonsOrdered ? '' : '; ⚠ a farther draft priced above a nearer one'}`
}
