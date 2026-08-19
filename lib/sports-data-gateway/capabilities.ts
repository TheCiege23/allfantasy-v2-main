/**
 * Fantasy OS Phase 5 — provider capability registry.
 *
 * Providers do not all support every data type. Each adapter DECLARES its capabilities; the gateway rejects
 * unsupported provider/capability combinations explicitly instead of silently returning empty arrays.
 */
export type SportsDataCapability =
  | 'players'
  | 'teams'
  | 'rosters'
  | 'schedules'
  | 'games'
  | 'live_scores'
  | 'play_by_play'
  | 'statistics'
  | 'projections'
  | 'injuries'
  | 'news'
  | 'depth_charts'
  | 'transactions'
  | 'weather'
  | 'draft_data'
  | 'college_players'
  | 'player_headshots'
  | 'team_branding'

export type RefreshSupport = 'live' | 'scheduled' | 'static'

export type ProviderCapabilityDeclaration = {
  provider: string
  sports: string[]
  capabilities: SportsDataCapability[]
  refreshSupport: Partial<Record<SportsDataCapability, RefreshSupport>>
  limitations: string[]
}

export function providerSupports(
  decl: ProviderCapabilityDeclaration,
  sport: string,
  capability: SportsDataCapability,
): boolean {
  return decl.sports.includes(sport.toUpperCase()) && decl.capabilities.includes(capability)
}

/** A registry of capability declarations, keyed by provider. */
export class CapabilityRegistry {
  private byProvider = new Map<string, ProviderCapabilityDeclaration>()

  register(decl: ProviderCapabilityDeclaration): void {
    this.byProvider.set(decl.provider, decl)
  }

  get(provider: string): ProviderCapabilityDeclaration | undefined {
    return this.byProvider.get(provider)
  }

  all(): ProviderCapabilityDeclaration[] {
    return [...this.byProvider.values()]
  }

  /** Providers that support a (sport, capability) pair, in registration order. */
  providersFor(sport: string, capability: SportsDataCapability): string[] {
    return this.all()
      .filter((d) => providerSupports(d, sport, capability))
      .map((d) => d.provider)
  }

  supports(provider: string, sport: string, capability: SportsDataCapability): boolean {
    const decl = this.get(provider)
    return !!decl && providerSupports(decl, sport, capability)
  }
}
