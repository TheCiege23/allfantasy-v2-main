import 'server-only'

import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { loadSurvivorDecisionSignals } from './survivorDecisionSignals'
import { loadSurvivorAttentionSignals } from './survivorDecisionSignalInput'
import { loadSurvivorFinaleSignals } from './survivorFinaleSignalsLoader'
import { loadSurvivorChallengeSignals } from './survivorChallengeSignalsLoader'
import { loadSurvivorSideGameSignals } from './survivorSideGameSignalInput'
import { combineSurvivorSignalSources } from './survivorSignalSources'

/**
 * The ONE Survivor argument the Manager Hub's command center takes (`formatSignals`, the 5th
 * argument of `resolveManagerCommandCenterSnapshot`). Every Survivor source is started in parallel
 * and folded by `combineSurvivorSignalSources`:
 *
 * - the manager's own reward ledger — a choice to make, a free trade held, a prize won
 *   (`survivorDecisionSignals.ts` → `survivorPrizeSignals.ts`);
 * - governance — trade window closing, the viewer's strikes, a tribe swap this week
 *   (`survivorDecisionSignalInput.ts`);
 * - finale / Tribal deadlines — votes due, closing speech (`survivorFinaleSignalsLoader.ts`);
 * - open challenges and won challenge prizes (`survivorChallengeSignalsLoader.ts`);
 * - side games — a pool pick due, an auction closing, the shop open, Exile claims closing
 *   (`survivorSideGameSignalInput.ts`).
 *
 * Each source already fails closed to []; the combiner settles each one on its own as a second
 * belt, so a source that throws anyway (synchronously or not) costs only its own signals, never the
 * others or the snapshot. A signal id that two sources both describe is admitted once (first source
 * wins), so one condition never double-counts against the queue cap.
 */
export async function loadSurvivorFormatSignals(args: { userId: string; leagueIds: readonly string[]; now: Date }): Promise<DecisionOsAttentionSignal[]> {
  if (!args.leagueIds.length) return []
  const { userId, leagueIds, now } = args
  // Each start is deferred into a promise so even a synchronous throw lands in its own slot.
  const start = (fn: () => Promise<readonly DecisionOsAttentionSignal[]>) => Promise.resolve().then(fn)
  return combineSurvivorSignalSources(
    [
      start(() => loadSurvivorDecisionSignals(args)),
      start(() => loadSurvivorAttentionSignals(userId, leagueIds, now)),
      start(() => loadSurvivorFinaleSignals(userId, leagueIds, now)),
      start(() => loadSurvivorChallengeSignals(args)),
      start(() => loadSurvivorSideGameSignals(args)),
    ],
    (reason) => console.warn('[decision-os] a survivor signal source failed', reason instanceof Error ? reason.message : reason),
  )
}
