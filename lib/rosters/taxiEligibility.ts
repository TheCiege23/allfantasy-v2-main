/**
 * Default taxi slot eligibility from resolved experience + optional league settings JSON.
 * Does not read DB — pass settings from league.settings or commissioner UI.
 */

import type { PlayerExperienceResult } from '@/lib/player-data/playerExperience'

export type TaxiSettingsLike = {
  taxiEnabled?: boolean
  taxiMaxProYears?: number
  taxiAllowRookiesOnly?: boolean
  taxiAllowCollegePlayers?: boolean
}

export function isPlayerTaxiEligible(
  exp: PlayerExperienceResult,
  settings: TaxiSettingsLike | null | undefined,
): boolean {
  const s = settings ?? {}
  if (!s.taxiEnabled) return false
  if (exp.status === 'college' || exp.collegeClassBucket) {
    return Boolean(s.taxiAllowCollegePlayers)
  }
  const py = exp.proYears
  if (s.taxiAllowRookiesOnly) {
    return exp.rookie === true || py === 0
  }
  if (py == null) return false
  const max = s.taxiMaxProYears ?? 2
  return py <= max
}

export function getTaxiEligibilityReason(
  exp: PlayerExperienceResult,
  settings: TaxiSettingsLike | null | undefined,
): string {
  if (!settings?.taxiEnabled) return 'Taxi not enabled for this league.'
  if (!isPlayerTaxiEligible(exp, settings)) {
    if (exp.status === 'college' && !settings.taxiAllowCollegePlayers) {
      return 'College players are not allowed on taxi in this league.'
    }
    if (settings.taxiAllowRookiesOnly && (exp.proYears ?? 0) > 0) {
      return 'Taxi only allows rookies in this league.'
    }
    if (exp.proYears != null && exp.proYears > (settings.taxiMaxProYears ?? 2)) {
      return `Not taxi eligible: ${exp.proYears} pro years (max ${settings.taxiMaxProYears ?? 2}).`
    }
    return 'Not taxi eligible: experience unknown or above taxi window.'
  }
  return 'Eligible for taxi.'
}

export function getDefaultTaxiSettingsForLeagueType(
  leagueType: 'redraft' | 'dynasty' | 'keeper' | 'other',
  _sport: string,
): TaxiSettingsLike {
  if (leagueType === 'redraft') {
    return { taxiEnabled: false, taxiMaxProYears: 2, taxiAllowRookiesOnly: false, taxiAllowCollegePlayers: false }
  }
  return { taxiEnabled: true, taxiMaxProYears: 2, taxiAllowRookiesOnly: false, taxiAllowCollegePlayers: false }
}
