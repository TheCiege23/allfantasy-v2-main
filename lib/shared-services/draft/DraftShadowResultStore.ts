/**
 * Shadow evaluation log for the Draft Service — same disclosed in-memory-only
 * pattern as Trade OS's and Waiver OS's ShadowResultStores: not durable, lost
 * on process restart. Real persistence is a schema decision for whoever picks
 * up full Draft OS consolidation, not decided unilaterally here.
 */

import type { DraftEvaluation } from './types'

export interface DraftShadowResultStore {
  append(evaluation: DraftEvaluation): Promise<void>
  all(): Promise<DraftEvaluation[]>
  /** Evaluations whose divergence against any legacy grader disagreed on the top recommended player. */
  findDiverging(): Promise<DraftEvaluation[]>
}

export class InMemoryDraftShadowResultStore implements DraftShadowResultStore {
  private evaluations: DraftEvaluation[] = []

  async append(evaluation: DraftEvaluation): Promise<void> {
    this.evaluations.push(evaluation)
  }

  async all(): Promise<DraftEvaluation[]> {
    return [...this.evaluations]
  }

  async findDiverging(): Promise<DraftEvaluation[]> {
    return this.evaluations.filter((evalResult) => evalResult.divergence.some((d) => d.sameTopPlayer === false))
  }

  /** Test-only escape hatch. */
  __reset(): void {
    this.evaluations = []
  }
}

export const defaultDraftShadowResultStore: DraftShadowResultStore = new InMemoryDraftShadowResultStore()
