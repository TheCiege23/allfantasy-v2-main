/**
 * Game Day Snapshot Store — Phase 9. Same disclosed in-memory-only pattern
 * as Trade OS/Waiver OS/Draft OS's shadow result stores: not durable, lost on
 * process restart. Real persistence requires a schema proposal (see
 * README's "Persistence status" section) — not decided unilaterally here,
 * per this repository's established schema-approval convention.
 */

import type { GameDaySnapshot } from './types'

export interface GameDaySnapshotStore {
  append(snapshot: GameDaySnapshot): Promise<void>
  all(): Promise<GameDaySnapshot[]>
  latestForUser(userId: string): Promise<GameDaySnapshot | null>
}

export class InMemoryGameDaySnapshotStore implements GameDaySnapshotStore {
  private snapshots: GameDaySnapshot[] = []

  async append(snapshot: GameDaySnapshot): Promise<void> {
    this.snapshots.push(snapshot)
  }

  async all(): Promise<GameDaySnapshot[]> {
    return [...this.snapshots]
  }

  async latestForUser(userId: string): Promise<GameDaySnapshot | null> {
    const forUser = this.snapshots.filter((s) => s.userId === userId)
    if (forUser.length === 0) return null
    return forUser.reduce((latest, s) => (s.generatedAt > latest.generatedAt ? s : latest))
  }

  /** Test-only escape hatch. */
  __reset(): void {
    this.snapshots = []
  }
}

export const defaultGameDaySnapshotStore: GameDaySnapshotStore = new InMemoryGameDaySnapshotStore()
