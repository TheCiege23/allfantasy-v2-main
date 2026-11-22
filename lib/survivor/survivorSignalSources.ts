import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'

type SignalSource = readonly DecisionOsAttentionSignal[] | Promise<readonly DecisionOsAttentionSignal[]> | null | undefined

/**
 * Pure combiner behind `loadSurvivorFormatSignals` (`survivorFormatSignals.ts`, the ONE Survivor
 * loader the command center calls). Folds every Survivor signal source into the single
 * `formatSignals` argument `resolveManagerCommandCenterSnapshot` takes. Each source settles on its
 * own: a source that throws or rejects contributes nothing (reported through `onRejected`) and never
 * hides the others. Signals with the same id appear once (the first source wins), so two readers
 * describing one condition cannot double-count it against the queue cap.
 */
export async function combineSurvivorSignalSources(
  sources: readonly SignalSource[],
  onRejected?: (reason: unknown) => void,
): Promise<DecisionOsAttentionSignal[]> {
  const settled = await Promise.allSettled(sources.map((source) => Promise.resolve(source ?? [])))
  const seen = new Set<string>()
  const out: DecisionOsAttentionSignal[] = []
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      onRejected?.(result.reason)
      continue
    }
    if (!Array.isArray(result.value)) continue
    for (const signal of result.value) {
      if (!signal || seen.has(signal.id)) continue
      seen.add(signal.id)
      out.push(signal)
    }
  }
  return out
}
