import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type RedraftStarterHint = {
  position: string
  have: number
  target: number
  tone: 'thin' | 'ok' | 'heavy'
}

/** Soft starter targets for redraft guidance (not league-specific roster rules). */
const NFL_SKILL: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
}

function countPos(picks: Array<{ position: string }>, pos: string): number {
  const u = pos.toUpperCase()
  return picks.filter((p) => String(p.position ?? '').toUpperCase() === u).length
}

/**
 * Non-IDP offensive starter balance hints for NFL-like redrafts.
 */
export function computeRedraftStarterHints(
  sport: string,
  picks: Array<{ position: string }>,
  formatType?: string,
): RedraftStarterHint[] {
  const norm = normalizeToSupportedSport(sport)
  if (String(formatType ?? '').toUpperCase() === 'IDP') return []
  if (norm !== 'NFL' && norm !== 'NCAAF') return []

  const total = picks.length
  const roundApprox = total > 0 ? Math.ceil(total / 12) : 0

  const out: RedraftStarterHint[] = []
  for (const [pos, target] of Object.entries(NFL_SKILL)) {
    const have = countPos(picks, pos)
    let tone: RedraftStarterHint['tone'] = 'ok'
    if (have < target) {
      tone = roundApprox >= 8 && have === 0 ? 'thin' : roundApprox >= 10 && have < target ? 'thin' : 'ok'
    } else if (have > target + 1) {
      tone = 'heavy'
    }
    out.push({ position: pos, have, target, tone })
  }
  return out
}
