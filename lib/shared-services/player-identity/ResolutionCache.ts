/**
 * In-memory resolution cache — matches the established in-memory-store
 * pattern used across every prior shared-service phase (e.g.
 * `WaiverShadowResultStore.ts`). Per-process only; not persisted, not
 * distributed. A restart clears it — this is documented as an accepted
 * limitation, not a hidden one.
 */

import type { ResolutionResult } from './types'

interface CacheEntry {
  result: ResolutionResult
  expiresAt: number
}

export interface ResolutionCacheStats {
  size: number
  hits: number
  misses: number
}

export class InMemoryResolutionCache {
  private readonly store = new Map<string, CacheEntry>()
  private hits = 0
  private misses = 0

  constructor(private readonly ttlMs: number = 5 * 60 * 1000) {}

  private key(provider: string, sourceId: string): string {
    return `${provider}:${sourceId}`
  }

  get(provider: string, sourceId: string): ResolutionResult | null {
    const entry = this.store.get(this.key(provider, sourceId))
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) this.store.delete(this.key(provider, sourceId))
      this.misses += 1
      return null
    }
    this.hits += 1
    return entry.result
  }

  set(provider: string, sourceId: string, result: ResolutionResult): void {
    this.store.set(this.key(provider, sourceId), { result, expiresAt: Date.now() + this.ttlMs })
  }

  clear(): void {
    this.store.clear()
    this.hits = 0
    this.misses = 0
  }

  stats(): ResolutionCacheStats {
    return { size: this.store.size, hits: this.hits, misses: this.misses }
  }
}

export const defaultResolutionCache = new InMemoryResolutionCache()
