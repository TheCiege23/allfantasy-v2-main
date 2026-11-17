type LeagueEligibilityFields = {
  isDynasty: boolean
  leagueType: string | null
  leagueVariant: string | null
}

/** Explicit variants that may run dispersal draft when not flagged `isDynasty` (still blocked for standard redraft). */
const DISPERSAL_DRAFT_VARIANT_EXACT = new Set([
  'dynasty',
  'devy',
  'c2c',
  'salary_cap',
  'dynasty_bestball',
  'bestball',
])

/**
 * Dispersal draft is for dynasty-style leagues — never standard redraft-only leagues.
 */
export function isLeagueEligibleForDispersalDraft(league: LeagueEligibilityFields): boolean {
  if (league.isDynasty === true) return true
  const lt = (league.leagueType ?? '').toLowerCase()
  if (lt === 'redraft') return false
  const lv = (league.leagueVariant ?? '').trim().toLowerCase()
  if (!lv) return false
  if (DISPERSAL_DRAFT_VARIANT_EXACT.has(lv)) return true
  // Compound / legacy labels (e.g. merged_devy_c2c, devy_dynasty)
  if (
    lv.includes('devy') ||
    lv.includes('c2c') ||
    lv.includes('merged_devy') ||
    lv.includes('salary_cap') ||
    (lv.includes('salary') && lv.includes('cap')) ||
    (lv.includes('dynasty') && lv.includes('bestball')) ||
    lv.includes('dynasty')
  ) {
    return true
  }
  return false
}

