/**
 * Decision OS Core — ProviderAdapter registry (Phase 1).
 *
 * Pure in-memory registry, mirroring `../sport-adapter/registry.ts`. No I/O,
 * no default adapters registered at import time.
 */

import type { ProviderAdapter } from './types'
import { UnknownProviderAdapterError } from './types'

function normalizeKey(providerName: string): string {
  return providerName.trim().toLowerCase()
}

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()

  register(adapter: ProviderAdapter): void {
    this.adapters.set(normalizeKey(adapter.providerName), adapter)
  }

  has(providerName: string): boolean {
    return this.adapters.has(normalizeKey(providerName))
  }

  /** Throws UnknownProviderAdapterError for an unregistered provider — deterministic, no silent fallback. */
  resolve(providerName: string): ProviderAdapter {
    const adapter = this.adapters.get(normalizeKey(providerName))
    if (!adapter) throw new UnknownProviderAdapterError(providerName)
    return adapter
  }

  /** Returns null instead of throwing — for call sites that want to degrade honestly. */
  tryResolve(providerName: string): ProviderAdapter | null {
    return this.adapters.get(normalizeKey(providerName)) ?? null
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
export const providerAdapterRegistry = new ProviderAdapterRegistry()
