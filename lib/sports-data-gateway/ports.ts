/**
 * Fantasy OS Phase 5 — OS subsystem ports (Part 11).
 *
 * Subsystem-facing interfaces so the rest of the OS depends on a narrow port, not gateway internals or any
 * provider client. Each port exposes only what its subsystem needs, and every response carries a
 * SportsDataContext (freshness/provenance) so freshness propagates. Truth labels stay separate from freshness.
 */
import type { SportsDataGateway } from './gateway'
import type { SportsDataContext } from './contracts'
import { resolveIdentity, type MappingSource } from './resolution'

// ── Player contexts (narrow, subsystem-shaped) ─────────────────────────────────
export type DraftPlayerContext = {
  canonicalPlayerId: string | null
  resolutionStatus: string
  displayName: string
  position: string | null
  teamId: string | null
  active: boolean
  injuryStatus: string | null
  providerIds: Record<string, string>
}
export type WithContext<T> = { data: T; context: SportsDataContext }

export type DraftPoolInput = { sport: string; limit?: number }
export interface DraftSportsDataPort {
  getDraftablePlayers(input: DraftPoolInput): Promise<WithContext<DraftPlayerContext[]>>
}

export type TradePlayerContext = { canonicalPlayerId: string | null; displayName: string; position: string | null; teamId: string | null; injuryStatus: string | null; active: boolean }
export interface TradeSportsDataPort {
  getTradePlayerContext(playerIds: string[]): Promise<WithContext<TradePlayerContext[]>>
}

export type WaiverPlayerContext = { canonicalPlayerId: string | null; displayName: string; position: string | null; teamId: string | null; active: boolean; injuryStatus: string | null }
export type WaiverCandidateInput = { sport: string; limit?: number }
export interface WaiverSportsDataPort {
  getWaiverCandidates(input: WaiverCandidateInput): Promise<WithContext<WaiverPlayerContext[]>>
}

export type LineupPlayerAvailability = { canonicalPlayerId: string | null; displayName: string; injuryStatus: string | null; active: boolean }
export type LineupAvailabilityInput = { sport: string; playerIds?: string[] }
export interface LineupSportsDataPort {
  getLineupAvailability(input: LineupAvailabilityInput): Promise<WithContext<LineupPlayerAvailability[]>>
}

/**
 * Gateway-backed Draft port. Proves a subsystem consumes the provider-NEUTRAL gateway + canonical identity
 * resolution — never a raw provider client. Fails closed: an unavailable gateway yields an empty list with an
 * `unavailable` freshness context, never fabricated players.
 */
export class GatewayDraftPort implements DraftSportsDataPort {
  constructor(
    private gateway: SportsDataGateway,
    private mappingSource: MappingSource,
  ) {}

  async getDraftablePlayers(input: DraftPoolInput): Promise<WithContext<DraftPlayerContext[]>> {
    const read = await this.gateway.getPlayers({ sport: input.sport, limit: input.limit })
    if (!read.result.ok) {
      return { data: [], context: read.context }
    }
    const data: DraftPlayerContext[] = read.result.data.map((p) => {
      const resolution = resolveIdentity(
        {
          provider: p.source.primaryProvider,
          providerId: p.providerIds[p.source.primaryProvider] ?? p.source.providerRecordId,
          sport: p.sport,
          team: p.teamId,
          position: p.position,
          displayName: p.displayName,
          birthDate: (p.metadata?.birthDate as string | null) ?? null,
        },
        this.mappingSource,
      )
      return {
        canonicalPlayerId: resolution.canonicalPlayerId,
        resolutionStatus: resolution.status,
        displayName: p.displayName,
        position: p.position,
        teamId: p.teamId,
        active: p.active,
        injuryStatus: p.injuryStatus,
        providerIds: p.providerIds,
      }
    })
    return { data, context: read.context }
  }
}
