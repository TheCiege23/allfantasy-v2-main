import 'server-only'

import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { loadSurvivorDecisionSignals } from './survivorDecisionSignals'
import { loadSurvivorFinaleSignals } from './survivorFinaleSignalsLoader'
import { loadSurvivorChallengeSignals } from './survivorChallengeSignalsLoader'

/**
 * The ONE Survivor argument the Manager Hub's command center takes (`formatSignals`, the 5th
 * argument of `resolveManagerCommandCenterSnapshot`). Every Survivor source is read in parallel and
 * concatenated:
 *
 * - the manager's own reward ledger (`survivorDecisionSignals.ts` → `survivorPrizeSignals.ts`);
 * - finale / Tribal deadlines (`survivorFinaleSignalsLoader.ts` → `survivorFinaleSignals.ts`);
 * - open challenges and won challenge prizes (`survivorChallengeSignalsLoader.ts` →
 *   `survivorChallengeSignals.ts`).
 *
 * Each source already fails closed to []; `allSettled` is a second belt so one source that throws
 * anyway costs only its own signals, never the others or the snapshot.
 */
export async function loadSurvivorFormatSignals(args: { userId: string; leagueIds: readonly string[]; now: Date }): Promise<DecisionOsAttentionSignal[]> {
  if (!args.leagueIds.length) return []
  const settled = await Promise.allSettled([
    loadSurvivorDecisionSignals(args),
    loadSurvivorFinaleSignals(args.userId, args.leagueIds, args.now),
    loadSurvivorChallengeSignals(args),
  ])
  const out: DecisionOsAttentionSignal[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') out.push(...result.value)
    else console.warn('[decision-os] a survivor signal source failed', result.reason instanceof Error ? result.reason.message : result.reason)
  }
  return out
}
