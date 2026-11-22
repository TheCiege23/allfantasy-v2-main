import 'server-only'

import { prisma } from '@/lib/prisma'
import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { isWaiverCalibrationScope, waiverCalibrationFrom, type WaiverCalibration } from './calibration'

/**
 * The waiver engine's graded record, for ONE league (see `calibration.ts`).
 *
 * `inScope` says whether this league is one the ledger can measure — a redraft, full-PPR NFL league.
 * Outside that scope `calibration` is always null, so the engine's confidence is shown unchanged, and
 * the ledger is given no score to grade (the panel records its pick with no confidence).
 *
 * The record comes from the advice-learning snapshot the maintenance cron rebuilds every six hours
 * (`ledger.waiverEngine`); `readAdviceLearningSnapshot` memoises it in process. Never throws: a read
 * that fails is "no record", which is exactly the behaviour before this existed.
 */
export type LeagueWaiverCalibration = { inScope: boolean; calibration: WaiverCalibration | null }

export const NO_WAIVER_CALIBRATION: LeagueWaiverCalibration = { inScope: false, calibration: null }

export async function loadWaiverCalibrationForLeague(leagueId: string | null | undefined): Promise<LeagueWaiverCalibration> {
  if (!leagueId) return NO_WAIVER_CALIBRATION
  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true, isDynasty: true, leagueType: true, scoring: true, settings: true, starters: true },
    })
    if (!isWaiverCalibrationScope(league ? { ...league, sport: String(league.sport) } : null)) return NO_WAIVER_CALIBRATION
    const snapshot = await readAdviceLearningSnapshot().catch(() => null)
    return { inScope: true, calibration: waiverCalibrationFrom(snapshot?.ledger?.waiverEngine) }
  } catch {
    return NO_WAIVER_CALIBRATION
  }
}
