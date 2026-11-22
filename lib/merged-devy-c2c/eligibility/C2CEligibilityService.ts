/**
 * C2C eligibility: college asset and pro asset eligibility. PROMPT 2/6.
 * Deterministic only. NFL C2C: college = NCAA Football (QB,RB,WR,TE; K/DST toggle). NBA C2C: college = NCAA Basketball (G,F,C).
 */

import type { LeagueSport } from '@prisma/client'
import { getC2CAdapterForSport, type C2CEligibilityResult } from '../types'
import { NFL_C2C_COLLEGE_POSITIONS, NBA_C2C_COLLEGE_POSITIONS, NBA_POSITION_TO_C2C } from '../constants'

const NFL_COLLEGE_SET = new Set(NFL_C2C_COLLEGE_POSITIONS.map((p) => p.toUpperCase()))
const NBA_COLLEGE_SET = new Set(NBA_C2C_COLLEGE_POSITIONS.map((p) => p.toUpperCase()))

function isNFLCollegePosition(position: string, excludeKDST: boolean): boolean {
  const pos = (position ?? '').toUpperCase()
  if (excludeKDST && (pos === 'K' || pos === 'DST')) return false
  return NFL_COLLEGE_SET.has(pos)
}

function isNBACollegePosition(position: string): boolean {
  const pos = (position ?? '').toUpperCase()
  if (NBA_COLLEGE_SET.has(pos)) return true
  const mapped = NBA_POSITION_TO_C2C[pos]
  return mapped != null && NBA_COLLEGE_SET.has(mapped)
}

/**
 * Check if a player is eligible for the college pool (C2C).
 * position: player position. isCollegePlayer: from data (e.g. DevyPlayer, league=NCAA). graduated: e.g. graduatedToNFL.
 */
export function checkCollegeEligibility(args: {
  sport: LeagueSport | string
  position: string
  isCollegePlayer: boolean
  graduated: boolean
  excludeKDST?: boolean
}): C2CEligibilityResult {
  const { sport, position, isCollegePlayer, graduated, excludeKDST } = args
  const adapterId = getC2CAdapterForSport(sport)
  if (!adapterId) {
    return {
      eligible: false,
      reason: 'Sport does not support C2C college pool',
      isCollege: false,
      isPro: true,
      isGraduated: false,
      positionEligible: false,
      poolSource: 'pro',
    }
  }

  const positionEligible =
    adapterId === 'nfl_c2c'
      ? isNFLCollegePosition(position, excludeKDST ?? true)
      : isNBACollegePosition(position)

  if (graduated) {
    return {
      eligible: false,
      reason: 'Player has graduated to pro pool',
      isCollege: true,
      isPro: false,
      isGraduated: true,
      positionEligible,
      poolSource: 'pro',
    }
  }

  if (!isCollegePlayer) {
    return {
      eligible: false,
      reason: 'Not a college prospect',
      isCollege: false,
      isPro: true,
      isGraduated: false,
      positionEligible: false,
      poolSource: 'pro',
    }
  }

  if (!positionEligible) {
    return {
      eligible: false,
      reason: `Position ${position} not eligible for C2C college pool`,
      isCollege: true,
      isPro: false,
      isGraduated: false,
      positionEligible: false,
      poolSource: 'college',
    }
  }

  return {
    eligible: true,
    isCollege: true,
    isPro: false,
    isGraduated: false,
    positionEligible: true,
    poolSource: 'college',
  }
}

/**
 * Pro pool: NFL or NBA players (not college-only). College players that have graduated are pro.
 */
export function checkProEligibility(args: {
  sport: LeagueSport | string
  isCollegePlayer: boolean
  graduated: boolean
}): C2CEligibilityResult {
  const { isCollegePlayer, graduated } = args
  const adapterId = getC2CAdapterForSport(args.sport)
  if (!adapterId) {
    return {
      eligible: false,
      reason: 'Sport does not support C2C',
      isCollege: false,
      isPro: false,
      isGraduated: false,
      positionEligible: false,
      poolSource: 'pro',
    }
  }

  if (isCollegePlayer && !graduated) {
    return {
      eligible: false,
      reason: 'College-only players cannot be in pro pool until graduated',
      isCollege: true,
      isPro: false,
      isGraduated: false,
      positionEligible: true,
      poolSource: 'college',
    }
  }

  return {
    eligible: true,
    isCollege: isCollegePlayer,
    isPro: true,
    isGraduated: graduated,
    positionEligible: true,
    poolSource: 'pro',
  }
}

export function getC2CCollegePositions(sport: LeagueSport | string): readonly string[] {
  return getC2CAdapterForSport(sport) === 'nfl_c2c' ? NFL_C2C_COLLEGE_POSITIONS : NBA_C2C_COLLEGE_POSITIONS
}
