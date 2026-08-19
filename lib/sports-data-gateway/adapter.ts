/**
 * Fantasy OS Phase 5 — the uniform provider adapter interface (Part 5).
 *
 * Every provider adapter exposes the SAME interface. Provider-specific request/response shapes are transformed
 * INSIDE the adapter and never leak to OS consumers. Unsupported methods return a structured
 * unsupported-capability error (never throw, never silently return []).
 */
import type {
  CanonicalGame,
  CanonicalPlayer,
  CanonicalPlayerAvailability,
  CanonicalProjection,
  CanonicalStatLine,
  CanonicalTeam,
} from './contracts'
import type { ProviderCapabilityDeclaration } from './capabilities'
import type { ProviderResult } from './errors'
import { unsupported } from './errors'
import type { ProviderHealthState } from './selection'

export type ProviderHealth = { provider: string; state: ProviderHealthState; checkedAt: string; latencyMs: number | null; detail?: string }

export type FetchPlayersInput = { sport: string; limit?: number; sinceCheckpoint?: string | null }
export type FetchTeamsInput = { sport: string }
export type FetchGamesInput = { sport: string; season: string; weekOrRound?: string | null }
export type FetchAvailabilityInput = { sport: string; playerIds?: string[] }
export type FetchStatsInput = { sport: string; season: string; period?: string }
export type FetchProjectionsInput = { sport: string; scoringContextId?: string | null }

export interface SportsProviderAdapter {
  provider: string
  getCapabilities(): ProviderCapabilityDeclaration
  healthCheck(): Promise<ProviderHealth>
  fetchPlayers(input: FetchPlayersInput): Promise<ProviderResult<CanonicalPlayer[]>>
  fetchTeams(input: FetchTeamsInput): Promise<ProviderResult<CanonicalTeam[]>>
  fetchGames(input: FetchGamesInput): Promise<ProviderResult<CanonicalGame[]>>
  fetchAvailability(input: FetchAvailabilityInput): Promise<ProviderResult<CanonicalPlayerAvailability[]>>
  fetchStats(input: FetchStatsInput): Promise<ProviderResult<CanonicalStatLine[]>>
  fetchProjections(input: FetchProjectionsInput): Promise<ProviderResult<CanonicalProjection[]>>
}

/** Base adapter: all fetch methods default to a structured unsupported-capability error. Adapters override
 * only what they actually support (declared via getCapabilities). */
export abstract class BaseProviderAdapter implements SportsProviderAdapter {
  abstract provider: string
  abstract getCapabilities(): ProviderCapabilityDeclaration
  abstract healthCheck(): Promise<ProviderHealth>

  async fetchPlayers(_i: FetchPlayersInput): Promise<ProviderResult<CanonicalPlayer[]>> {
    return unsupported(this.provider, `${this.provider} does not support players`)
  }
  async fetchTeams(_i: FetchTeamsInput): Promise<ProviderResult<CanonicalTeam[]>> {
    return unsupported(this.provider, `${this.provider} does not support teams`)
  }
  async fetchGames(_i: FetchGamesInput): Promise<ProviderResult<CanonicalGame[]>> {
    return unsupported(this.provider, `${this.provider} does not support games`)
  }
  async fetchAvailability(_i: FetchAvailabilityInput): Promise<ProviderResult<CanonicalPlayerAvailability[]>> {
    return unsupported(this.provider, `${this.provider} does not support availability`)
  }
  async fetchStats(_i: FetchStatsInput): Promise<ProviderResult<CanonicalStatLine[]>> {
    return unsupported(this.provider, `${this.provider} does not support statistics`)
  }
  async fetchProjections(_i: FetchProjectionsInput): Promise<ProviderResult<CanonicalProjection[]>> {
    return unsupported(this.provider, `${this.provider} does not support projections`)
  }
}
