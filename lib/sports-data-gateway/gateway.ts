/**
 * Fantasy OS Phase 5 — the Sports Data Gateway facade (Part 1).
 *
 * The ONLY supported read path for normalized sports data. Subsystems consume ports backed by this — never
 * provider SDKs/HTTP directly. Responsibilities wired here: capability gating, deterministic provider
 * selection + capability-specific fallback, adapter dispatch, provenance, freshness context, deterministic
 * error classification, and fail-closed behavior (never fabricate data on failure).
 */
import type { SportsDataCapability, ProviderCapabilityDeclaration } from './capabilities'
import { CapabilityRegistry } from './capabilities'
import type { SportsProviderAdapter, ProviderHealth } from './adapter'
import type { ProviderResult } from './errors'
import { unsupported } from './errors'
import { selectProvider, type ProviderPriorityRule, type ProviderHealthState, type SelectionResult } from './selection'
import type { CanonicalPlayer } from './contracts'
import type { SportsDataContext, SportsDataFreshnessStatus } from './contracts'

export type GatewayOptions = {
  rules?: ProviderPriorityRule[]
  lastSuccessfulSyncAt?: string | null
  health?: Record<string, ProviderHealthState>
}

export type GatewayRead<T> = {
  result: ProviderResult<T>
  selection: SelectionResult
  context: SportsDataContext
}

export class SportsDataGateway {
  readonly registry = new CapabilityRegistry()
  private adapters = new Map<string, SportsProviderAdapter>()
  private rules: ProviderPriorityRule[]
  private health: Record<string, ProviderHealthState>
  private lastSuccessfulSyncAt: string | null

  constructor(adapters: SportsProviderAdapter[], opts: GatewayOptions = {}) {
    for (const a of adapters) {
      this.adapters.set(a.provider, a)
      this.registry.register(a.getCapabilities())
    }
    this.rules = opts.rules ?? []
    this.health = opts.health ?? {}
    this.lastSuccessfulSyncAt = opts.lastSuccessfulSyncAt ?? null
  }

  capabilities(): ProviderCapabilityDeclaration[] {
    return this.registry.all()
  }

  async healthChecks(): Promise<ProviderHealth[]> {
    return Promise.all([...this.adapters.values()].map((a) => a.healthCheck()))
  }

  /** Fetch players for a sport with deterministic selection + capability-specific fallback. Fails closed. */
  async getPlayers(input: { sport: string; limit?: number; sinceCheckpoint?: string | null }): Promise<GatewayRead<CanonicalPlayer[]>> {
    return this.dispatch<CanonicalPlayer[]>(input.sport, 'players', (adapter) =>
      adapter.fetchPlayers({ sport: input.sport, limit: input.limit, sinceCheckpoint: input.sinceCheckpoint }),
    )
  }

  /**
   * Generic capability dispatch: walk the selection order, calling each provider's adapter method until one
   * returns ok. `unsupported_capability` / provider failure ⇒ try the next fallback. Never fabricates.
   */
  private async dispatch<T>(
    sport: string,
    capability: SportsDataCapability,
    call: (adapter: SportsProviderAdapter) => Promise<ProviderResult<T>>,
  ): Promise<GatewayRead<T>> {
    const selection = selectProvider({ sport, capability, registry: this.registry, rules: this.rules, health: this.health })
    if (!selection.selected) {
      return {
        result: unsupported('gateway', selection.reason) as ProviderResult<T>,
        selection,
        context: this.buildContext([], 'unavailable', [selection.reason]),
      }
    }

    let last: ProviderResult<T> | null = null
    for (const provider of selection.order) {
      if (!this.registry.supports(provider, sport, capability)) continue
      const adapter = this.adapters.get(provider)
      if (!adapter) continue
      const r = await call(adapter)
      last = r
      if (r.ok) {
        const status: SportsDataFreshnessStatus = r.partial ? 'partial' : 'current'
        const limitations = r.partial ? ['Some provider records were rejected during normalization.'] : []
        return { result: r, selection, context: this.buildContext([provider], status, limitations, r.snapshotVersion) }
      }
      // Only fall through to the next provider for capability/availability failures.
      if (!['unsupported_capability', 'provider_unavailable', 'rate_limited', 'timeout'].includes(r.error.code)) break
    }

    return {
      result: (last ?? unsupported('gateway', 'no provider produced a result')) as ProviderResult<T>,
      selection,
      context: this.buildContext([], 'unavailable', [last && !last.ok ? last.error.message : 'no provider produced a result']),
    }
  }

  private buildContext(
    sourceProviders: string[],
    freshnessStatus: SportsDataFreshnessStatus,
    limitations: string[],
    snapshotVersion?: string,
  ): SportsDataContext {
    return {
      generatedAt: new Date().toISOString(),
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      sourceProviders,
      snapshotVersions: snapshotVersion ? [snapshotVersion] : [],
      freshnessStatus,
      limitations,
    }
  }
}
