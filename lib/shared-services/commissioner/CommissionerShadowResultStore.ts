/**
 * Commissioner Shadow Result Store — Phase 10. Same disclosed in-memory-only
 * pattern as every prior phase's shadow store: not durable, lost on process
 * restart. Real persistence requires a schema proposal (see README's
 * "Persistence status" section) — not decided unilaterally here.
 */

import type { CommissionerShadowEvaluation } from './types'

export interface CommissionerShadowResultStore {
  append(evaluation: CommissionerShadowEvaluation): Promise<void>
  all(): Promise<CommissionerShadowEvaluation[]>
  latestForLeague(leagueId: string): Promise<CommissionerShadowEvaluation | null>
}

export class InMemoryCommissionerShadowResultStore implements CommissionerShadowResultStore {
  private evaluations: CommissionerShadowEvaluation[] = []

  async append(evaluation: CommissionerShadowEvaluation): Promise<void> {
    this.evaluations.push(evaluation)
  }

  async all(): Promise<CommissionerShadowEvaluation[]> {
    return [...this.evaluations]
  }

  async latestForLeague(leagueId: string): Promise<CommissionerShadowEvaluation | null> {
    const forLeague = this.evaluations.filter((e) => e.leagueId === leagueId)
    if (forLeague.length === 0) return null
    return forLeague.reduce((latest, e) => (e.generatedAt > latest.generatedAt ? e : latest))
  }

  /** Test-only escape hatch. */
  __reset(): void {
    this.evaluations = []
  }
}

export const defaultCommissionerShadowResultStore: CommissionerShadowResultStore = new InMemoryCommissionerShadowResultStore()
