/**
 * Devy draft-projection scoring.
 *
 * Previously every missing input silently defaulted to 50 ("average"), so a
 * player we knew NOTHING about scored 33/100 — a confident number manufactured
 * from absent data, and the same failure as a trade grading C off zero points.
 * Worse, the phantom 50s diluted real signal: a 5-star with a 0.99 composite and
 * no other data scored 57, dragged toward average by three inputs that did not
 * exist.
 *
 * Now the weights are renormalised over the signals actually present, so a
 * player is scored on what we know about him rather than against filler, and a
 * player with no signals at all scores null instead of 33.
 */

export type DraftProjectionConfidence = 'high' | 'moderate' | 'low'

export type DraftProjection = {
  /** 0-100, or null when not one signal was available. */
  score: number | null
  /** How much of the model's weight was actually backed by data. */
  confidence: DraftProjectionConfidence | null
  /** Signals that contributed. */
  present: string[]
  /** Signals we had no value for — named, not silently defaulted. */
  missing: string[]
}

type Signal = {
  key: string
  weight: number
  /** Null means the input is absent; it is then excluded, never defaulted. */
  score: (player: any) => number | null
}

/** Composite arrives either 0-1 (247 style) or already 0-100. */
function recruitingScore(player: any): number | null {
  const raw = player?.recruitingComposite
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null
  return Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw))
}

function breakoutAgeScore(player: any): number | null {
  const age = player?.breakoutAge
  if (!age || !Number.isFinite(age)) return null
  if (age <= 19.5) return 95
  if (age <= 20) return 90
  if (age <= 21) return 80
  if (age <= 22) return 65
  return 50
}

function draftCapitalScore(player: any): number | null {
  const round = player?.projectedDraftRound
  if (!round || !Number.isFinite(round)) return null
  if (round === 1) return 95
  if (round === 2) return 85
  if (round === 3) return 70
  if (round === 4) return 60
  return 45
}

function adpScore(player: any): number | null {
  const adp = player?.devyAdp
  if (!adp || !Number.isFinite(adp)) return null
  if (adp <= 3) return 95
  if (adp <= 6) return 85
  if (adp <= 12) return 75
  if (adp <= 24) return 60
  return 50
}

const SIGNALS: Signal[] = [
  { key: 'recruitingComposite', weight: 0.25, score: recruitingScore },
  { key: 'breakoutAge', weight: 0.2, score: breakoutAgeScore },
  { key: 'projectedDraftRound', weight: 0.3, score: draftCapitalScore },
  { key: 'devyAdp', weight: 0.15, score: adpScore },
]

const TOTAL_WEIGHT = SIGNALS.reduce((a, s) => a + s.weight, 0)

export function computeDraftProjection(player: any): DraftProjection {
  let weighted = 0
  let presentWeight = 0
  const present: string[] = []
  const missing: string[] = []

  for (const signal of SIGNALS) {
    const value = signal.score(player)
    if (value == null) {
      missing.push(signal.key)
      continue
    }
    weighted += value * signal.weight
    presentWeight += signal.weight
    present.push(signal.key)
  }

  // Nothing known. Saying so beats inventing 33.
  if (presentWeight === 0) {
    return { score: null, confidence: null, present, missing }
  }

  // Renormalise over what we actually have, so absent signals neither drag the
  // score toward average nor quietly count as evidence.
  let score = weighted / presentWeight

  // Modifiers, applied only when supplied. These adjust a score; they are not
  // signals in their own right, so they do not affect confidence.
  const nil = player?.nilImpactScore
  const injury = player?.injurySeverityScore
  if (Number.isFinite(nil)) score += Number(nil) * 0.05
  if (Number.isFinite(injury)) score -= Number(injury) * 0.05

  const coverage = presentWeight / TOTAL_WEIGHT
  const confidence: DraftProjectionConfidence =
    coverage >= 0.75 ? 'high' : coverage >= 0.45 ? 'moderate' : 'low'

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    confidence,
    present,
    missing,
  }
}

/**
 * Score alone. Null when no signal was available — callers must handle it
 * rather than receive a fabricated number.
 */
export function computeDraftProjectionScore(player: any): number | null {
  return computeDraftProjection(player).score
}

export function devyAcceptanceAdjustment(player: any, partnerProfile: any) {
  let delta = 0

  // An unscored player is not a high-projection player; require a real score.
  if (typeof player.draftProjectionScore === 'number' && player.draftProjectionScore >= 85)
    delta += 0.06

  if (player.breakoutAge && player.breakoutAge <= 20)
    delta += 0.03

  if (partnerProfile?.futureFocused)
    delta += 0.08

  if (player.injurySeverityScore && player.injurySeverityScore > 70)
    delta -= 0.07

  return delta
}

export function applyTeamDirectionAdjustment(adjustedValue: number, teamDirection: string): number {
  if (teamDirection === 'CONTEND') {
    return adjustedValue * 0.85
  }
  if (teamDirection === 'REBUILD') {
    return adjustedValue * 1.1
  }
  return adjustedValue
}
