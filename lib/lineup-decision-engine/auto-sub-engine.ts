import type { EnrichedPlayer } from './types'

/** Statuses that mean the player cannot score — auto-sub allowed only for these. */
const AUTO_SUB_INELIGIBLE_STATUSES = [
  'OUT',
  'IR',
  'INJURED RESERVE',
  'INJUREDRESERVE',
  'SUSPENDED',
  'INACTIVE',
  'RULED OUT',
  'RULEDOUT',
  'DID NOT TRAVEL',
  'DIDNOTTRAVEL',
  'NOT IN SQUAD',
  'NOTINSQUAD',
  'NOT ACTIVE',
  'NOTACTIVE',
  'SCRATCHED',
  'DNP',
  'OFS',
  'RED CARD SUSPENSION',
] as const

const QUESTIONABLE = new Set(['QUESTIONABLE', 'Q', 'GAME TIME DECISION', 'GAMEDAY DECISION', 'GTD'])

function normalizeStatus(raw?: string | null): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strict injury-only gate: returns true only when status is confirmed as unable to participate.
 * Questionable / probable / limited never qualify.
 */
function isZeroParticipationStatus(status?: string | null): boolean {
  const s = normalizeStatus(status)
  if (!s) return false
  if (QUESTIONABLE.has(s) || s.includes('QUESTIONABLE') || s.includes('PROBABLE') || s.includes('LIMITED'))
    return false
  if (s.includes('GAME TIME') || s.includes('GAMEDAY')) return false

  for (const token of AUTO_SUB_INELIGIBLE_STATUSES) {
    const t = token.replace(/\s+/g, ' ')
    if (s === t || s.includes(t)) return true
  }

  if (s === 'OUT' || s.endsWith(' OUT') || s.startsWith('OUT ') || s.includes('RULED OUT')) return true

  return false
}

export function isZeroParticipationWithSignals(
  status: string | null | undefined,
  signals?: { willNotPlayConfirmed?: boolean }
): boolean {
  if (signals?.willNotPlayConfirmed) return true
  const s = normalizeStatus(status)
  if (s.includes('DOUBTFUL')) return Boolean(signals?.willNotPlayConfirmed)
  return isZeroParticipationStatus(status)
}

interface AutoSubCandidate {
  starter: EnrichedPlayer
  replacement: EnrichedPlayer
  replacementReason: string
  usedPreferenceTieBreaker: boolean
  confidence: number
}

export function findBestInjuryReplacement(input: {
  ineligibleStarter: EnrichedPlayer
  benchPool: EnrichedPlayer[]
  favored: boolean
  preferLowerVolatilityWhenFavored: boolean
  tieBreakPreference?: (a: EnrichedPlayer, b: EnrichedPlayer) => number
}): AutoSubCandidate | null {
  const { ineligibleStarter, benchPool } = input
  const eligible = benchPool.filter(
    (p) => !isZeroParticipationWithSignals(p.signals.injuryStatus, p.signals)
  )
  if (eligible.length === 0) return null

  const starterPositions = new Set(ineligibleStarter.positions)
  const samePos = eligible.filter((p) => p.positions.some((pos) => starterPositions.has(pos)))
  const pool = samePos.length > 0 ? samePos : eligible

  const scored = pool.map((p) => {
    const base = p.breakdown.effectiveObjectiveScore
    const vol = p.breakdown.volatilityScore
    let score = base
    if (input.favored && input.preferLowerVolatilityWhenFavored) score -= vol * 0.08
    if (!input.favored) score += vol * 0.05
    return { p, score }
  })

  scored.sort((a, b) => {
    const diff = b.score - a.score
    if (Math.abs(diff) > 0.25) return diff > 0 ? 1 : -1
    const pref = input.tieBreakPreference?.(a.p, b.p) ?? 0
    if (pref !== 0) return pref > 0 ? 1 : -1
    return b.p.breakdown.weeklyStartScore - a.p.breakdown.weeklyStartScore
  })

  const best = scored[0]
  if (!best) return null

  return {
    starter: ineligibleStarter,
    replacement: best.p,
    replacementReason: `Same-position emergency swap: ${ineligibleStarter.name} is inactive; ${best.p.name} is the best legal bench option by projected lineup value.`,
    usedPreferenceTieBreaker: false,
    confidence: Math.min(99, 55 + best.p.breakdown.startConfidence * 0.35),
  }
}
