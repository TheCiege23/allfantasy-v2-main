import 'server-only'

import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { benchCalibrationFrom, type BenchCalibration } from './benchCalibration'

/**
 * The bench check's graded record (`benchCalibration.ts`), from the advice-learning snapshot the maintenance cron
 * rebuilds every six hours (`ledger.benchEdges`); `readAdviceLearningSnapshot` memoises it in process.
 *
 * NFL Sleeper leagues only: those are the calls the ledger records and grades (`benchCheckLedger.ts`). Anywhere else
 * this is null, and the bench check reads exactly as before. Never throws: a failed read is "no record".
 */
export async function loadBenchCalibration(league: { sport: string | null | undefined; platform: string | null | undefined }): Promise<BenchCalibration | null> {
  if (String(league.sport ?? '').trim().toUpperCase() !== 'NFL') return null
  if (String(league.platform ?? '').trim().toLowerCase() !== 'sleeper') return null
  try {
    const snapshot = await readAdviceLearningSnapshot()
    return benchCalibrationFrom(snapshot?.ledger?.benchEdges)
  } catch {
    return null
  }
}
