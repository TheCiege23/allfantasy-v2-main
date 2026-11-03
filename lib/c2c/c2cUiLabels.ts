/** Client-safe labels for C2C league UI (no server imports). */

export type C2CConfigClient = {
  sportPair: string
  scoringMode: string
  campusScoreWeight: number
  cantonScoreWeight: number
  devyScoringEnabled?: boolean
  futureDraftFormat?: string
  startupDraftFormat?: string
  createdByTheCiege?: boolean
  campusStarterSlots?: number
  cantonStarterSlots?: number
  benchSlots?: number
  taxiSlots?: number
  devySlots?: number
  irSlots?: number
  taxiRookieOnly?: boolean
  taxiMaxExperienceYears?: number
  /** ISO string from the API, or null. */
  taxiLockDeadline?: string | null
  taxiPointsVisible?: boolean
  basketballLineupFreq?: string
  footballCampusLockDay?: string
  footballCantonLockDay?: string
  /** From League.settings.c2cTaxiLockMode (GET /api/c2c adds it). */
  taxiLockMode?: 'preseason' | 'start_of_season' | 'no_limit'
}

export function c2cSportPairShort(pair: string): { left: string; right: string; label: string } {
  const p = pair.toUpperCase()
  if (p.includes('NBA') || p === 'NBA_CBB') {
    return { left: 'CBB', right: 'NBA', label: 'CBB ↔ NBA' }
  }
  return { left: 'CFB', right: 'NFL', label: 'CFB ↔ NFL' }
}

export function c2cScoreModeChip(cfg: Pick<C2CConfigClient, 'scoringMode' | 'campusScoreWeight' | 'cantonScoreWeight'>): string {
  const m = cfg.scoringMode
  if (m === 'combined_total') return 'COMBINED'
  if (m === 'split_display_combined') return 'SPLIT'
  if (m === 'dual_track') return 'DUAL TRACK'
  if (m === 'weighted_combined') {
    const cw = Math.round(cfg.campusScoreWeight * 100)
    const tw = Math.round(cfg.cantonScoreWeight * 100)
    return `WEIGHTED ${cw}/${tw}`
  }
  return 'COMBINED'
}

export function c2cScoreModeDescription(cfg: C2CConfigClient): string {
  const m = cfg.scoringMode
  if (m === 'combined_total') return 'Combined Total Score'
  if (m === 'split_display_combined') return 'Split Display — Combined Total Wins'
  if (m === 'dual_track') return 'Dual Track — Campus & Canton tracked separately'
  if (m === 'weighted_combined') {
    return `Weighted: Campus ${Math.round(cfg.campusScoreWeight * 100)}% · Canton ${Math.round(cfg.cantonScoreWeight * 100)}%`
  }
  return 'Combined Total Score'
}
