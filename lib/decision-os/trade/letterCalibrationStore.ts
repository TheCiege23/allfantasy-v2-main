import 'server-only'

import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { tradeLetterCalibrationFrom, type TradeLetterCalibration } from './letterCalibration'

/**
 * The trade grade's graded record by letter (`letterCalibration.ts`), from the advice-learning snapshot the maintenance
 * cron rebuilds every six hours (`ledger.tradeLetters`); `readAdviceLearningSnapshot` memoises it in process.
 *
 * `commissioner` reads the record over the trades commissioners reviewed (`ledger.commissionerTradeLetters`).
 * Never throws: a failed read is "no record", and the grade is then shown exactly as before.
 */
export async function loadTradeLetterCalibration(opts: { commissioner?: boolean } = {}): Promise<TradeLetterCalibration | null> {
  try {
    const ledger = (await readAdviceLearningSnapshot())?.ledger
    return tradeLetterCalibrationFrom(opts.commissioner ? ledger?.commissionerTradeLetters : ledger?.tradeLetters)
  } catch {
    return null
  }
}
