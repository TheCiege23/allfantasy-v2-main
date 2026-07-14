/**
 * Versioned aggregate storage — every computed ManagerBehaviorProfile /
 * PlayerExposure is appended as a new version, never overwritten (Knowledge
 * Graph spec Part 7). Same in-memory-for-now caveat as SignalStore.ts.
 */

import type { ManagerKey, ManagerBehaviorProfile, PlayerExposure } from './types'

export interface SnapshotStore {
  appendManagerBehaviorProfile(managerKey: ManagerKey, profile: ManagerBehaviorProfile): Promise<void>
  /** Most recent version by `computedAt`, or null if none exist yet. */
  latestManagerBehaviorProfile(managerKey: ManagerKey): Promise<ManagerBehaviorProfile | null>

  appendPlayerExposure(managerKey: ManagerKey, exposure: PlayerExposure): Promise<void>
  latestPlayerExposure(managerKey: ManagerKey, playerId: string): Promise<PlayerExposure | null>
}

export class InMemorySnapshotStore implements SnapshotStore {
  private managerProfiles = new Map<ManagerKey, ManagerBehaviorProfile[]>()
  private playerExposures = new Map<string, PlayerExposure[]>()

  private static exposureKey(managerKey: ManagerKey, playerId: string): string {
    return `${managerKey}::${playerId}`
  }

  async appendManagerBehaviorProfile(managerKey: ManagerKey, profile: ManagerBehaviorProfile): Promise<void> {
    const list = this.managerProfiles.get(managerKey) ?? []
    list.push(profile)
    this.managerProfiles.set(managerKey, list)
  }

  async latestManagerBehaviorProfile(managerKey: ManagerKey): Promise<ManagerBehaviorProfile | null> {
    const list = this.managerProfiles.get(managerKey)
    if (!list || list.length === 0) return null
    return list.reduce((latest, current) => (current.computedAt > latest.computedAt ? current : latest))
  }

  async appendPlayerExposure(managerKey: ManagerKey, exposure: PlayerExposure): Promise<void> {
    const key = InMemorySnapshotStore.exposureKey(managerKey, exposure.value.playerId)
    const list = this.playerExposures.get(key) ?? []
    list.push(exposure)
    this.playerExposures.set(key, list)
  }

  async latestPlayerExposure(managerKey: ManagerKey, playerId: string): Promise<PlayerExposure | null> {
    const key = InMemorySnapshotStore.exposureKey(managerKey, playerId)
    const list = this.playerExposures.get(key)
    if (!list || list.length === 0) return null
    return list.reduce((latest, current) => (current.computedAt > latest.computedAt ? current : latest))
  }

  /** Test-only escape hatch. */
  __reset(): void {
    this.managerProfiles.clear()
    this.playerExposures.clear()
  }
}

export const defaultSnapshotStore: SnapshotStore = new InMemorySnapshotStore()
