import { effectiveSample, weightedMedian } from './datedMarketLearner'

/**
 * WHAT A TEAM PAYS FOR A POSITION IT NEEDS (owner's call, 2026-11-22 — trade learning, step 6).
 *
 * A superflex team with two quarterbacks pays for a third; a team whose tight end just went down pays for a tight end;
 * a team with six receivers does not. The chart has one price for everyone. This measures the gap from the trades.
 *
 * NEED, at one position, from the buyer's own roster JUST BEFORE the trade (`tradeContextSnapshot.ts` /
 * `tradeContextBackfill.ts`) against the league's starting slots at that position — superflex counts toward QB, so the
 * third-quarterback case is exactly what it measures:
 *   short  = no spare: rostered at the position ≤ starters there
 *   deep   = three or more spare
 *   normal = between.
 * ⚠ FLEX is not counted toward RB/WR/TE: which position fills it is the manager's choice, not the league's. A team "short"
 * at WR with two flex spots is therefore measured honestly as short of DEDICATED receivers, nothing more.
 *
 * WHAT WAS BOUGHT is a package whose value is 60%+ players of ONE position (QB/RB/WR/TE), on the trade day's chart.
 *
 * THE PREMIUM is what a short (or deep) team pays for that position, as value given ÷ value received on the trade day's
 * chart, OVER what a normal team pays for the same position — so whatever the chart gets wrong about the position
 * itself cancels. Weighted median of log ratios with recency weights; published on an effective sample of
 * {@link NEED_MIN_EFFECTIVE_SAMPLE} in both groups; capped at ±{@link NEED_MAX_PREMIUM_PCT}%.
 * ⚠ SHADOW: stored and reported every run, read by no grade yet.
 *
 * PURE.
 */

export const NEED_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
export type NeedPosition = (typeof NEED_POSITIONS)[number]
export type NeedLevel = 'short' | 'normal' | 'deep'

export const NEED_MIN_EFFECTIVE_SAMPLE = 20
export const NEED_MAX_PREMIUM_PCT = 25
/** Spare players at a position from which a team is deep there. */
export const NEED_DEEP_SPARE = 3
const POSITION_MAJORITY = 0.6

/** Starters the league requires at a position: its own slots, plus superflex for quarterbacks. Null when unknown. */
export function startersRequired(slots: Record<string, number> | null | undefined, position: NeedPosition): number | null {
  if (!slots || typeof slots !== 'object') return null
  const n = (k: string) => {
    const v = Number((slots as Record<string, unknown>)[k])
    return Number.isFinite(v) && v > 0 ? v : 0
  }
  const own = n(position)
  const sf = position === 'QB' ? n('SUPER_FLEX') + n('SUPERFLEX') + n('SF') + n('OP') : 0
  const total = own + sf
  return total > 0 ? total : null
}

/** Slot counts from a roster_positions list (bench, reserve and taxi left out). */
export function slotsFromRosterPositions(positions: unknown): Record<string, number> | null {
  if (!Array.isArray(positions)) return null
  const out: Record<string, number> = {}
  for (const p of positions) {
    const k = String(p).toUpperCase()
    if (k === 'BN' || k === 'IR' || k === 'TAXI' || k === 'RES') continue
    out[k] = (out[k] ?? 0) + 1
  }
  return Object.keys(out).length ? out : null
}

/** The buyer's need at a position, or null when the roster or the slots cannot say. */
export function needAt(
  rosterBefore: ReadonlyArray<{ position?: string | null }> | null | undefined,
  slots: Record<string, number> | null | undefined,
  position: NeedPosition,
): NeedLevel | null {
  const required = startersRequired(slots, position)
  if (required == null || !Array.isArray(rosterBefore) || rosterBefore.length === 0) return null
  const level = (held: number): NeedLevel => {
    const spare = held - required
    return spare <= 0 ? 'short' : spare >= NEED_DEEP_SPARE ? 'deep' : 'normal'
  }
  // An unknown player is not an absent one: the level counts only if it is the same whether every player of unknown
  // position plays here or none does.
  const known = rosterBefore.filter((p) => String(p?.position ?? '').toUpperCase() === position).length
  const unknown = rosterBefore.filter((p) => !p?.position).length
  const low = level(known)
  return low === level(known + unknown) ? low : null
}

/** The one position a package is, by 60%+ of its value; null when mixed or not a player package. */
export function packagePosition(parts: ReadonlyArray<{ position: string | null; value: number }>): NeedPosition | null {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0)
  if (!(total > 0)) return null
  for (const pos of NEED_POSITIONS) {
    const v = parts.filter((p) => String(p.position ?? '').toUpperCase() === pos).reduce((s, p) => s + Math.max(0, p.value), 0)
    if (v / total >= POSITION_MAJORITY) return pos
  }
  return null
}

export type NeedObservation = {
  transactionId: string
  position: NeedPosition
  need: NeedLevel
  /** value given ÷ value received on the trade day's chart. */
  ratio: number
  weight: number
}

export type NeedPremium = {
  position: NeedPosition
  need: Exclude<NeedLevel, 'normal'>
  premiumPct: number | null
  effectiveSample: number
  baselineEffectiveSample: number
  trades: number
  published: boolean
  note: string
}

export type NeedMarket = { generatedAt: string; observations: number; premiums: NeedPremium[] }

const median = (obs: readonly NeedObservation[]) => weightedMedian(obs.map((o) => ({ value: Math.log(o.ratio), weight: o.weight })))

export function computeNeedMarket(observations: readonly NeedObservation[], now: Date): NeedMarket {
  const usable = observations.filter((o) => o.weight > 0 && Number.isFinite(o.ratio) && o.ratio > 0)
  const premiums: NeedPremium[] = []
  for (const position of NEED_POSITIONS) {
    const base = usable.filter((o) => o.position === position && o.need === 'normal')
    const baseEff = Math.round(effectiveSample(base.map((o) => o.weight)) * 10) / 10
    const b = median(base)
    for (const need of ['short', 'deep'] as const) {
      const group = usable.filter((o) => o.position === position && o.need === need)
      const eff = Math.round(effectiveSample(group.map((o) => o.weight)) * 10) / 10
      const g = median(group)
      const raw = g != null && b != null ? (Math.exp(g - b) - 1) * 100 : null
      const capped = raw == null ? null : Math.max(-NEED_MAX_PREMIUM_PCT, Math.min(NEED_MAX_PREMIUM_PCT, raw))
      const premiumPct = capped == null ? null : Math.round(capped * 10) / 10
      const enough = eff >= NEED_MIN_EFFECTIVE_SAMPLE && baseEff >= NEED_MIN_EFFECTIVE_SAMPLE
      premiums.push({
        position, need, premiumPct, effectiveSample: eff, baselineEffectiveSample: baseEff, trades: group.length,
        published: enough && premiumPct != null,
        note: !enough
          ? `not enough trades: ${eff} ${need} and ${baseEff} normal (need ${NEED_MIN_EFFECTIVE_SAMPLE} each)`
          : raw != null && Math.abs(raw) > NEED_MAX_PREMIUM_PCT
            ? `measured ${Math.round(raw)}%, held to ±${NEED_MAX_PREMIUM_PCT}%`
            : `measured from ${group.length} trades against ${base.length} normal-depth trades`,
      })
    }
  }
  return { generatedAt: now.toISOString(), observations: usable.length, premiums }
}

export function describeNeedMarket(label: string, m: NeedMarket): string {
  const pub = m.premiums.filter((p) => p.published)
  const parts = pub.map((p) => `${p.need} at ${p.position} ${p.premiumPct! > 0 ? '+' : ''}${p.premiumPct}%`)
  return `need market ${label}: ${m.observations} sides, ${pub.length}/${m.premiums.length} premiums measured${parts.length ? ` — ${parts.join(', ')}` : ''}`
}
