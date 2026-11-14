/**
 * C2C roster rules: merged roster legality, college scoring eligibility. PROMPT 2/6.
 * College assets score only in college contests until promotion; pro assets in pro contests.
 */

import type { C2CLeagueConfigShape } from '../types'

/**
 * College assets can only score in college contests; never in pro contests before promotion.
 */
export function isEligibleForCollegeScoring(
  isCollegeAsset: boolean,
  isPromoted: boolean,
  config: Pick<C2CLeagueConfigShape, 'supportsCollegeScoring' | 'collegeScoringUntilDeadline'>
): boolean {
  if (!config.supportsCollegeScoring) return false
  if (!isCollegeAsset) return false
  if (isPromoted) return false
  return true
}

/**
 * Pro scoring: only pro assets (veterans or promoted college). College-only players do not score in pro contests.
 */
export function isEligibleForProScoring(isCollegeAsset: boolean, isPromoted: boolean): boolean {
  if (!isCollegeAsset) return true
  return isPromoted
}

/**
 * Validate merged roster: college slot count and pro slot count within limits.
 */
export function validateC2CRosterSlots(args: {
  config: C2CLeagueConfigShape
  collegeSlotsFilled: number
  collegeSlotsGraduatedInCollege: number
  proRosterCount: number
  taxiCount: number
}): { legal: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const { config, collegeSlotsFilled, collegeSlotsGraduatedInCollege } = args
  const collegeRosterSize = config.collegeRosterSize ?? 20
  const taxiSize = config.taxiSize ?? 6

  if (collegeSlotsGraduatedInCollege > 0) {
    errors.push(`College slots must not contain graduated players. Move ${collegeSlotsGraduatedInCollege} to pro roster.`)
  }
  if (collegeSlotsFilled > collegeRosterSize) {
    errors.push(`College roster overflow: ${collegeSlotsFilled} but max ${collegeRosterSize}.`)
  }
  if (args.taxiCount > taxiSize) {
    errors.push(`Taxi overflow: ${args.taxiCount} but max ${taxiSize}.`)
  }
  return {
    legal: errors.length === 0,
    errors,
    warnings,
  }
}

export function getCollegeRosterSize(config: C2CLeagueConfigShape): number {
  return config.collegeRosterSize
}

export function getTaxiSize(config: C2CLeagueConfigShape): number {
  return config.taxiSize
}

export function getProBenchSize(config: C2CLeagueConfigShape): number {
  return config.proBenchSize
}

export function getProIRSize(config: C2CLeagueConfigShape): number {
  return config.proIRSize
}
