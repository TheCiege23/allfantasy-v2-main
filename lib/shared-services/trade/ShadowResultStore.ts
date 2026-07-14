/**
 * Shadow evaluation log — parity/divergence data accumulated for later
 * analysis, before any consolidation decision is made. Same disclosed
 * in-memory-only pattern as the Knowledge Graph's SignalStore/SnapshotStore
 * (Phase 3): not durable, lost on process restart. Real persistence is a
 * schema decision for whoever picks up full Trade OS consolidation, not
 * decided unilaterally here.
 */

import type { TradeShadowEvaluation } from './types'

export interface ShadowResultStore {
  append(evaluation: TradeShadowEvaluation): Promise<void>
  all(): Promise<TradeShadowEvaluation[]>
  /** Evaluations whose divergence against any legacy grader exceeded the given fairness-score-delta threshold. */
  findDiverging(minAbsFairnessScoreDelta: number): Promise<TradeShadowEvaluation[]>
}

export class InMemoryShadowResultStore implements ShadowResultStore {
  private evaluations: TradeShadowEvaluation[] = []

  async append(evaluation: TradeShadowEvaluation): Promise<void> {
    this.evaluations.push(evaluation)
  }

  async all(): Promise<TradeShadowEvaluation[]> {
    return [...this.evaluations]
  }

  async findDiverging(minAbsFairnessScoreDelta: number): Promise<TradeShadowEvaluation[]> {
    return this.evaluations.filter((evalResult) =>
      evalResult.divergence.some(
        (d) => d.fairnessScoreDelta != null && Math.abs(d.fairnessScoreDelta) >= minAbsFairnessScoreDelta
      )
    )
  }

  /** Test-only escape hatch. */
  __reset(): void {
    this.evaluations = []
  }
}

export const defaultShadowResultStore: ShadowResultStore = new InMemoryShadowResultStore()
