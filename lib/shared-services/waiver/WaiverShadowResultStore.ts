/**
 * Shadow evaluation log for the Waiver Service — same disclosed in-memory-only
 * pattern as Trade OS's ShadowResultStore.ts (and the Knowledge Graph's
 * SignalStore/SnapshotStore before it): not durable, lost on process restart.
 * Real persistence is a schema decision for whoever picks up full Waiver OS
 * consolidation, not decided unilaterally here.
 */

import type { WaiverEvaluation } from './types'

export interface WaiverShadowResultStore {
  append(evaluation: WaiverEvaluation): Promise<void>
  all(): Promise<WaiverEvaluation[]>
  /** Evaluations whose divergence against any legacy grader disagreed on the top recommended add. */
  findDiverging(): Promise<WaiverEvaluation[]>
}

export class InMemoryWaiverShadowResultStore implements WaiverShadowResultStore {
  private evaluations: WaiverEvaluation[] = []

  async append(evaluation: WaiverEvaluation): Promise<void> {
    this.evaluations.push(evaluation)
  }

  async all(): Promise<WaiverEvaluation[]> {
    return [...this.evaluations]
  }

  async findDiverging(): Promise<WaiverEvaluation[]> {
    return this.evaluations.filter((evalResult) => evalResult.divergence.some((d) => d.sameTopAdd === false))
  }

  /** Test-only escape hatch. */
  __reset(): void {
    this.evaluations = []
  }
}

export const defaultWaiverShadowResultStore: WaiverShadowResultStore = new InMemoryWaiverShadowResultStore()
