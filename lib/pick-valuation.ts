import { pickRoundValue } from '@/lib/pick-curve'

/**
 * ⚠ SHAPE NOW SHARED. This curve paid 0.65 of a first for a second where the canonical shape
 * pays 0.48, so it was the second-flattest of the five and over-priced mid-round picks. The
 * 100-point first-round anchor is this module's own scale and is unchanged; only the decay
 * below it is now sourced from one place. See lib/pick-curve.ts for how the shape was chosen.
 */
const BASE_PICK_VALUE: Record<string, number> = {
  "1st": pickRoundValue(1, 100),
  "2nd": pickRoundValue(2, 100),
  "3rd": pickRoundValue(3, 100),
  "4th": pickRoundValue(4, 100),
  "5th+": pickRoundValue(5, 100)
}

const TIME_MULTIPLIER_BY_YEARS_OUT: Record<number, number> = {
  0: 1.00,
  1: 0.92,
  2: 0.85,
  3: 0.80
}

const TIME_FLOOR = 0.75

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

function roundToKey(round: number): string {
  if (round === 1) return "1st"
  if (round === 2) return "2nd"
  if (round === 3) return "3rd"
  if (round === 4) return "4th"
  return "5th+"
}

function rookieFeverMultiplier(daysToDraft: number | null): number {
  if (daysToDraft === null) return 1.00
  if (daysToDraft <= 30) return 1.06
  if (daysToDraft <= 90) return 1.03
  return 1.00
}

export function pickValue(
  pickRound: number, 
  pickYear: number, 
  currentYear: number, 
  daysToDraftForPickYear: number | null = null,
  classStrength: number | null = null,
): number {
  const base = BASE_PICK_VALUE[roundToKey(pickRound)] || 10
  const yearsOut = pickYear - currentYear

  let timeMult = TIME_MULTIPLIER_BY_YEARS_OUT[yearsOut] ?? TIME_FLOOR
  timeMult = clamp(timeMult, TIME_FLOOR, 1.00)

  const feverMult = rookieFeverMultiplier(daysToDraftForPickYear)

  let value = base * timeMult * feverMult

  if (classStrength !== null && classStrength > 0) {
    value *= (classStrength / 80)
  }

  return value
}

export function computeClassStrength(players: any[]): number {
  // Unscored prospects are EXCLUDED, not counted as 50. Defaulting them to
  // average let a class of players we know nothing about report "average
  // strength", which is a claim; averaging only the scored ones at least
  // describes the players we can actually see.
  const topProspects = players
    .filter((p: any) => p.projectedDraftRound === 1)
    .map((p: any) => p.draftProjectionScore)
    .filter((s: unknown): s is number => typeof s === 'number' && Number.isFinite(s))

  if (topProspects.length === 0) return 50

  const avg = topProspects.reduce((a: number, b: number) => a + b, 0) / topProspects.length

  return Math.round(avg)
}

export function computeClassDepthByPosition(players: any[]): { qbDepth: number; rbDepth: number; wrDepth: number; teDepth: number } {
  const byPos = { QB: [] as number[], RB: [] as number[], WR: [] as number[], TE: [] as number[] }

  for (const p of players) {
    const pos = (p.position || '').toUpperCase()
    const score = p.draftProjectionScore
    // Same rule as computeClassStrength: an unscored player contributes
    // nothing rather than contributing a phantom average.
    if (byPos[pos as keyof typeof byPos] && typeof score === 'number' && Number.isFinite(score)) {
      byPos[pos as keyof typeof byPos].push(score)
    }
  }

  const depthScore = (scores: number[]) => {
    if (scores.length === 0) return 40
    const top = scores.sort((a, b) => b - a).slice(0, 5)
    return Math.round(top.reduce((a, b) => a + b, 0) / top.length)
  }

  return {
    qbDepth: depthScore(byPos.QB),
    rbDepth: depthScore(byPos.RB),
    wrDepth: depthScore(byPos.WR),
    teDepth: depthScore(byPos.TE),
  }
}

