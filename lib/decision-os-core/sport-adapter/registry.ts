/**
 * Decision OS Core — SportAdapter registry (Phase 1).
 *
 * Pure in-memory registry. No I/O, no default adapters registered at import time —
 * callers explicitly register adapters (see `./adapters/index.ts` for the thin
 * wrappers around existing per-sport code). This keeps the module side-effect-free
 * and safe to import without registering anything.
 */

import type { SportAdapter } from './types'
import { UnknownSportAdapterError } from './types'

function normalizeKey(sport: string): string {
  return sport.trim().toUpperCase()
}

export class SportAdapterRegistry {
  private readonly adapters = new Map<string, SportAdapter>()

  register(adapter: SportAdapter): void {
    this.adapters.set(normalizeKey(adapter.sport), adapter)
  }

  has(sport: string): boolean {
    return this.adapters.has(normalizeKey(sport))
  }

  /** Throws UnknownSportAdapterError for an unregistered sport — deterministic, no silent fallback. */
  resolve(sport: string): SportAdapter {
    const adapter = this.adapters.get(normalizeKey(sport))
    if (!adapter) throw new UnknownSportAdapterError(sport)
    return adapter
  }

  /** Returns null instead of throwing — for call sites that want to degrade honestly. */
  tryResolve(sport: string): SportAdapter | null {
    return this.adapters.get(normalizeKey(sport)) ?? null
  }

  list(): string[] {
    return Array.from(this.adapters.keys())
  }

  clear(): void {
    this.adapters.clear()
  }
}

/**
 * Shared singleton registry. Nothing populates this at import time and nothing
 * outside `lib/decision-os-core/` imports it yet (Phase 1 is unwired by design).
 */
export const sportAdapterRegistry = new SportAdapterRegistry()
