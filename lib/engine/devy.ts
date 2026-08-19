import type { TradePlayerAsset } from './trade-types'

/**
 * Devy scoring for the trade engine.
 *
 * Each helper below still returns a mid-range default when its input is absent —
 * they are exported and used elsewhere — but computeDraftProjectionScore no
 * longer BUILDS on those defaults. A player with no recruiting rating, no
 * projected round and no ADP used to score 33-50 out of nothing, and that number
 * then priced a real trade. It now returns null and the caller excludes him.
 */
export function breakoutAgeScore(age?: number | null) {
  if (age == null) return 50
  if (age <= 19.5) return 95
  if (age <= 20) return 90
  if (age <= 21) return 80
  if (age <= 22) return 65
  return 50
}

export function draftCapitalScore(round?: number | null) {
  if (!round) return 50
  if (round === 1) return 95
  if (round === 2) return 85
  if (round === 3) return 70
  if (round === 4) return 60
  return 45
}

export function adpScore(adp?: number | null) {
  if (!adp) return 50
  if (adp <= 3) return 95
  if (adp <= 6) return 85
  if (adp <= 12) return 75
  if (adp <= 24) return 60
  return 50
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Null when nothing substantive backs a projection.
 *
 * Substantive means a recruiting rating, a projected draft round, or a devy ADP
 * — what he was rated, where he is expected to go, or what the market pays.
 * Breakout age alone is a modifier, not an evaluation, and scoring off it would
 * anchor a number no scouting signal supports.
 *
 * Weights renormalise over the signals present, so an absent one neither drags
 * the player toward average nor quietly counts as evidence.
 */
export function computeDraftProjectionScore(player: TradePlayerAsset): number | null {
  const rawComposite = player.recruitingComposite
  const hasRecruiting = num(rawComposite) && rawComposite > 0
  const hasCapital = num(player.projectedDraftRound) && player.projectedDraftRound > 0
  const hasAdp = num(player.devyAdp) && player.devyAdp > 0
  const hasBreakout = num(player.breakoutAge) && player.breakoutAge > 0

  if (!hasRecruiting && !hasCapital && !hasAdp) return null

  const parts: { value: number; weight: number }[] = []
  if (hasRecruiting) {
    const raw = rawComposite as number
    parts.push({
      value: raw <= 1 ? Math.max(0, Math.min(100, raw * 100)) : Math.max(0, Math.min(100, raw)),
      weight: 0.25,
    })
  }
  if (hasBreakout) parts.push({ value: breakoutAgeScore(player.breakoutAge ?? null), weight: 0.2 })
  if (hasCapital) parts.push({ value: draftCapitalScore(player.projectedDraftRound ?? null), weight: 0.3 })
  if (hasAdp) parts.push({ value: adpScore(player.devyAdp ?? null), weight: 0.15 })

  const presentWeight = parts.reduce((a, p) => a + p.weight, 0)
  if (presentWeight === 0) return null
  let score = parts.reduce((a, p) => a + p.value * p.weight, 0) / presentWeight

  // Modifiers apply only when supplied; they are not evidence on their own.
  if (num(player.nilImpactScore)) score += Math.max(0, Math.min(100, player.nilImpactScore)) * 0.05
  if (num(player.injurySeverityScore)) score -= Math.max(0, Math.min(100, player.injurySeverityScore)) * 0.05

  return Math.max(0, Math.min(100, Math.round(score)))
}

export function enrichDevy(player: TradePlayerAsset) {
  if (player.league !== 'NCAA' || !player.devyEligible || player.graduatedToNFL) {
    return { ...player, draftProjectionScore: player.draftProjectionScore ?? undefined }
  }
  // undefined, not a number, when unscorable — callers must exclude rather than
  // substitute. See devySideValue in engine/trade.ts.
  const draftProjectionScore =
    player.draftProjectionScore ?? computeDraftProjectionScore(player) ?? undefined
  return { ...player, draftProjectionScore }
}

export function devyValueMultiplier(teamDirection?: string) {
  if (teamDirection === 'CONTEND' || teamDirection === 'FRAGILE_CONTEND') return 0.85
  if (teamDirection === 'REBUILD') return 1.1
  return 1.0
}
