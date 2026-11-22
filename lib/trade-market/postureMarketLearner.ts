import { effectiveSample, weightedMedian } from './datedMarketLearner'

/**
 * WHAT A CONTENDER PAYS, AND WHAT A REBUILDER PAYS (owner's call, 2026-11-22 — trade learning, step 5).
 *
 * The same player is worth more to a team chasing a title this year than to one tearing down, and managers trade like
 * it: a contender pays up for the veteran who starts now, a rebuilder pays up for youth and picks. The chart has one
 * price for everyone. This measures the gap from the trades themselves.
 *
 * POSTURE comes from each side's own record in the trade's saved context (`tradeContextSnapshot.ts` /
 * `tradeContextBackfill.ts`), and only once the season has spoken — week 4 on, three games played:
 *   contend  = .600 or better   ·   rebuild = .400 or worse   ·   middle = everything between.
 * An offseason trade has no record yet and is not used.
 *
 * WHAT WAS BOUGHT is the kind of asset that makes up most (60%+) of the package's value on the day's chart:
 *   veteran = a player 27 or older at the trade · youth = 24 or younger · picks. A mixed package is not used.
 *
 * THE PREMIUM is what a contender (or rebuilder) pays for that kind, OVER what a middle team pays for the same kind —
 * both measured as (value given ÷ value received) on the chart of the trade's own day. Comparing with the middle takes
 * out whatever the chart gets wrong about the kind itself (if every manager pays 10% over the chart for veterans, that
 * is the chart, not posture). Weighted by recency, as a weighted median of log ratios so a few wild deals cannot move it.
 *
 * ⚠ PUBLISHED ONLY ON EVIDENCE: an effective sample of {@link POSTURE_MIN_EFFECTIVE_SAMPLE} trades in the group AND in
 * its middle baseline, and capped at ±{@link POSTURE_MAX_PREMIUM_PCT}%. Anything else is reported with its reason.
 * ⚠ SHADOW: stored and reported every run, read by no grade yet.
 *
 * PURE.
 */

export type Posture = 'contend' | 'rebuild' | 'middle'
export type AssetKind = 'veteran' | 'youth' | 'picks'

export const POSTURE_MIN_WEEK = 4
export const POSTURE_MIN_GAMES = 3
export const POSTURE_MIN_EFFECTIVE_SAMPLE = 20
export const POSTURE_MAX_PREMIUM_PCT = 25
export const VETERAN_MIN_AGE = 27
export const YOUTH_MAX_AGE = 24
/** A package is one kind when that kind is at least this share of its value. */
const KIND_MAJORITY = 0.6

/** A side's posture from its record before the trade; null when the season has not said yet. */
export function postureOf(record: { wins: number; losses: number; ties: number } | null | undefined, week: number): Posture | null {
  if (!record || !(week >= POSTURE_MIN_WEEK)) return null
  const games = record.wins + record.losses + record.ties
  if (!(games >= POSTURE_MIN_GAMES)) return null
  const pct = (record.wins + 0.5 * record.ties) / games
  return pct >= 0.6 ? 'contend' : pct <= 0.4 ? 'rebuild' : 'middle'
}

/** A player's age on the trade date, from his age today. Null when unknown. */
export function ageAtTrade(ageNow: number | null | undefined, tradeDate: Date, now: Date): number | null {
  if (ageNow == null || !Number.isFinite(ageNow)) return null
  const years = (now.getTime() - tradeDate.getTime()) / (365.25 * 24 * 3600 * 1000)
  return ageNow - Math.max(0, years)
}

export type PackagePart = { kind: AssetKind | 'other'; value: number }

/** The kind a package is, or null for a mixed or empty one. */
export function packageKind(parts: readonly PackagePart[]): AssetKind | null {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0)
  if (!(total > 0)) return null
  const by = new Map<string, number>()
  for (const p of parts) by.set(p.kind, (by.get(p.kind) ?? 0) + Math.max(0, p.value))
  for (const k of ['veteran', 'youth', 'picks'] as const) if ((by.get(k) ?? 0) / total >= KIND_MAJORITY) return k
  return null
}

/** One side of one trade: who bought, what they bought, and what they paid for it on that day's chart. */
export type PostureObservation = {
  transactionId: string
  buyer: Posture
  bought: AssetKind
  /** value given ÷ value received, on the trade day's chart. > 1 means the buyer paid over the chart. */
  ratio: number
  weight: number
}

export type PosturePremium = {
  buyer: Exclude<Posture, 'middle'>
  bought: AssetKind
  /** What this buyer pays over (or under) a middle team for the same kind, in percent. */
  premiumPct: number | null
  effectiveSample: number
  baselineEffectiveSample: number
  trades: number
  published: boolean
  note: string
}

export type PostureMarket = { generatedAt: string; observations: number; premiums: PosturePremium[] }

const median = (obs: readonly PostureObservation[]) =>
  weightedMedian(obs.map((o) => ({ value: Math.log(o.ratio), weight: o.weight })))

export function computePostureMarket(observations: readonly PostureObservation[], now: Date): PostureMarket {
  const usable = observations.filter((o) => o.weight > 0 && Number.isFinite(o.ratio) && o.ratio > 0)
  const premiums: PosturePremium[] = []
  for (const buyer of ['contend', 'rebuild'] as const) {
    for (const bought of ['veteran', 'youth', 'picks'] as const) {
      const group = usable.filter((o) => o.buyer === buyer && o.bought === bought)
      const base = usable.filter((o) => o.buyer === 'middle' && o.bought === bought)
      const eff = Math.round(effectiveSample(group.map((o) => o.weight)) * 10) / 10
      const baseEff = Math.round(effectiveSample(base.map((o) => o.weight)) * 10) / 10
      const g = median(group)
      const b = median(base)
      const raw = g != null && b != null ? (Math.exp(g - b) - 1) * 100 : null
      const capped = raw == null ? null : Math.max(-POSTURE_MAX_PREMIUM_PCT, Math.min(POSTURE_MAX_PREMIUM_PCT, raw))
      const premiumPct = capped == null ? null : Math.round(capped * 10) / 10
      const enough = eff >= POSTURE_MIN_EFFECTIVE_SAMPLE && baseEff >= POSTURE_MIN_EFFECTIVE_SAMPLE
      premiums.push({
        buyer, bought, premiumPct, effectiveSample: eff, baselineEffectiveSample: baseEff, trades: group.length,
        published: enough && premiumPct != null,
        note: !enough
          ? `not enough trades: ${eff} ${buyer} and ${baseEff} middle (need ${POSTURE_MIN_EFFECTIVE_SAMPLE} each)`
          : raw != null && Math.abs(raw) > POSTURE_MAX_PREMIUM_PCT
            ? `measured ${Math.round(raw)}%, held to ±${POSTURE_MAX_PREMIUM_PCT}%`
            : `measured from ${group.length} trades against ${base.length} middle-team trades`,
      })
    }
  }
  return { generatedAt: now.toISOString(), observations: usable.length, premiums }
}

/** One line for the cron's warnings. */
export function describePostureMarket(label: string, m: PostureMarket): string {
  const pub = m.premiums.filter((p) => p.published)
  const parts = pub.map((p) => `${p.buyer} buying ${p.bought} ${p.premiumPct! > 0 ? '+' : ''}${p.premiumPct}%`)
  return `posture market ${label}: ${m.observations} sides, ${pub.length}/${m.premiums.length} premiums measured${parts.length ? ` — ${parts.join(', ')}` : ''}`
}
