/**
 * Signal storage — the append-only side of the Knowledge Graph Query Service
 * spec's "exactly two service boundaries" (Signal Ingestion Service / Query
 * Service). This phase ships an in-memory implementation only — see the
 * module README for why, and docs/os/FANTASY_KNOWLEDGE_GRAPH_SCHEMA_PROPOSAL.md
 * for the real Prisma model this will migrate to once schema-approved.
 *
 * The interface is the durable contract; swapping the implementation later
 * (in-memory → Prisma-backed) requires no change to any caller.
 */

import type { ManagerKey, Signal, SignalType } from './types'

export interface SignalStore {
  append(signal: Signal): Promise<void>
  /** All signals for a manager, optionally filtered by type — the raw evidence pool ManagerBehaviorProfileEngine reads from. */
  findByManager(managerKey: ManagerKey, signalTypes?: SignalType[]): Promise<Signal[]>
  /** Distinct league count across ALL signals currently stored — the platform-wide cohort-size input to the privacy gate. */
  distinctLeagueCount(): Promise<number>
}

/**
 * In-memory implementation. NOT durable — state is lost on process restart,
 * which in this app's deployment model means essentially every request in
 * production. This is a disclosed, deliberate placeholder (see README), not
 * an oversight: it lets the entity model, signal capture, and aggregate
 * computation be built and genuinely tested now, without unilaterally adding
 * production schema/migrations ahead of the approval gate this codebase's
 * own history already established for exactly this kind of change (see
 * project memory `sleeper-import-hardening`).
 */
export class InMemorySignalStore implements SignalStore {
  private signals: Signal[] = []

  async append(signal: Signal): Promise<void> {
    this.signals.push(signal)
  }

  async findByManager(managerKey: ManagerKey, signalTypes?: SignalType[]): Promise<Signal[]> {
    return this.signals.filter(
      (s) => s.managerKey === managerKey && (!signalTypes || signalTypes.includes(s.signalType))
    )
  }

  async distinctLeagueCount(): Promise<number> {
    return new Set(this.signals.map((s) => s.leagueId)).size
  }

  /** Test-only escape hatch — never used by production code paths. */
  __reset(): void {
    this.signals = []
  }
}

/** Process-wide singleton so every real hook (tradeService.ts, process-engine.ts) and the Query Service share the same signal pool. */
export const defaultSignalStore: SignalStore = new InMemorySignalStore()
