import 'server-only'

import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { benchCalibrationFrom, benchEdgeScaleFor, type BenchCalibration } from './benchCalibration'

/**
 * The bench check's graded record (`benchCalibration.ts`), from the advice-learning snapshot the maintenance cron
 * rebuilds every six hours (`ledger.benchEdges`); `readAdviceLearningSnapshot` memoises it in process.
 *
 * Sleeper and native leagues, and ESPN NFL leagues: those are the calls the ledger records and grades (`benchCheckLedger.ts`). NFL from the
 * NFL record; NBA, NHL and MLB (2026-11-23) each from its own sport's line. Anywhere else this is null, and the bench
 * check reads exactly as before. Silent until a band has its minimum sample. Never throws: a failed read is "no record".
 */
export async function loadBenchCalibration(league: { sport: string | null | undefined; platform: string | null | undefined }): Promise<BenchCalibration | null> {
  const sport = String(league.sport ?? '').trim().toUpperCase()
  const scale = benchEdgeScaleFor(sport)
  if (!scale) return null
  const platform = String(league.platform ?? '').trim().toLowerCase()
  // ESPN, NFL only (2026-11-24): its calls are recorded and graded since the ESPN week-score writer, into the same NFL
  // record, so they read that record. An ESPN NBA/NHL/MLB league records nothing, so it stays null.
  const espnNfl = platform === 'espn' && sport === 'NFL'
  if (platform !== 'sleeper' && !espnNfl && !(platform !== '' && isNativePlatform(platform))) return null
  try {
    const snapshot = await readAdviceLearningSnapshot()
    /*
     * NBA / NHL / MLB (2026-11-23): that sport's own line, banded by share of the starter's projection — read with
     * `benchCallRecord(edge, cal, { scale: 'share', starterProjected })`. Never the NFL bands, never another sport's.
     */
    if (scale === 'share') return benchCalibrationFrom(snapshot?.ledger?.sportBench?.[sport as 'NBA' | 'NHL' | 'MLB']?.edges)
    return benchCalibrationFrom(snapshot?.ledger?.benchEdges)
  } catch {
    return null
  }
}
