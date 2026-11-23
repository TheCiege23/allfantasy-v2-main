import 'server-only'

import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { benchCalibrationFrom, type BenchCalibration } from './benchCalibration'

/**
 * The bench check's graded record (`benchCalibration.ts`), from the advice-learning snapshot the maintenance cron
 * rebuilds every six hours (`ledger.benchEdges`); `readAdviceLearningSnapshot` memoises it in process.
 *
 * NFL Sleeper and native leagues only: those are the calls the ledger records and grades (`benchCheckLedger.ts`;
 * native since 2026-11-23, graded on our own engine's weekly scores). Anywhere else this is null, and the bench check
 * reads exactly as before. Never throws: a failed read is "no record".
 */
export async function loadBenchCalibration(league: { sport: string | null | undefined; platform: string | null | undefined }): Promise<BenchCalibration | null> {
  if (String(league.sport ?? '').trim().toUpperCase() !== 'NFL') return null
  const platform = String(league.platform ?? '').trim().toLowerCase()
  if (platform !== 'sleeper' && !(platform !== '' && isNativePlatform(platform))) return null
  try {
    const snapshot = await readAdviceLearningSnapshot()
    return benchCalibrationFrom(snapshot?.ledger?.benchEdges)
  } catch {
    return null
  }
}
