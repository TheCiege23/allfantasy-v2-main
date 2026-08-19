import {
  buildSurfaceContextEvidencePacket,
  type NflRedraftEvidenceType,
  type NflRedraftProviderEvidencePacket,
} from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import {
  NFL_REDRAFT_PREMIUM_SERVICE_DEFINITIONS,
  type NflRedraftPremiumServiceId,
  type NflRedraftPremiumServiceVariant,
} from '@/lib/redraft-premium/nflRedraftPremiumServices'
import type { NflRedraftPremiumApiCanonicalIds } from '@/lib/redraft-premium/nflRedraftPremiumApiContracts'

export type NflRedraftPremiumEvidenceResolverStatus = {
  status: 'resolved' | 'empty' | 'partial'
  source: 'canonical_evidence_resolver'
  messages: string[]
}

export type NflRedraftPremiumEvidenceCounts = {
  totalAvailable: number
  selected: number
  stale: number
  fallback: number
  missing: number
  byType: Record<string, number>
}

export type NflRedraftPremiumEvidenceResolverResult = {
  evidencePackets: NflRedraftProviderEvidencePacket[]
  resolverStatus: NflRedraftPremiumEvidenceResolverStatus
  evidenceCounts: NflRedraftPremiumEvidenceCounts
}

export type NflRedraftPremiumEvidenceResolverInput = {
  serviceId: NflRedraftPremiumServiceId
  serviceVariant?: NflRedraftPremiumServiceVariant
  canonicalIds: NflRedraftPremiumApiCanonicalIds
  availableEvidencePackets?: NflRedraftProviderEvidencePacket[]
  ingestedAtIso?: string | null
}

const SURFACE_CONTEXT_BY_SERVICE: Record<NflRedraftPremiumServiceId, NflRedraftEvidenceType[]> = {
  basic_runtime_facts: ['roster_context', 'matchup_context'],
  war_room: ['roster_context', 'matchup_context'],
  commissioner_digest: ['roster_context', 'matchup_context', 'trade_context'],
  manager_brief: ['roster_context'],
  matchup_prep: ['matchup_context'],
  waiver_report: ['waiver_context'],
  trade_review: ['trade_context'],
  draft_prep: ['draft_context'],
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function uniquePackets(packets: NflRedraftProviderEvidencePacket[]): NflRedraftProviderEvidencePacket[] {
  const seen = new Set<string>()
  const unique: NflRedraftProviderEvidencePacket[] = []
  for (const packet of packets) {
    if (seen.has(packet.evidenceId)) continue
    seen.add(packet.evidenceId)
    unique.push(packet)
  }
  return unique
}

function packetMatchesId(packetValue: string | null, requestValue: string | null): boolean {
  if (!requestValue || !packetValue) return true
  return packetValue === requestValue
}

function packetMatchesCanonicalIds(
  packet: NflRedraftProviderEvidencePacket,
  canonicalIds: NflRedraftPremiumApiCanonicalIds,
): boolean {
  return (
    packetMatchesId(packet.canonicalLeagueId, canonicalIds.leagueId) &&
    packetMatchesId(packet.canonicalTeamId, canonicalIds.teamId) &&
    packetMatchesId(packet.canonicalPlayerId, canonicalIds.playerId) &&
    packetMatchesId(packet.canonicalMatchupId, canonicalIds.matchupId)
  )
}

function factsForContext(
  evidenceType: Extract<NflRedraftEvidenceType, 'roster_context' | 'matchup_context' | 'waiver_context' | 'trade_context' | 'draft_context'>,
  canonicalIds: NflRedraftPremiumApiCanonicalIds,
): Record<string, unknown> | null {
  if (evidenceType === 'roster_context' && !canonicalIds.teamId && !canonicalIds.playerId) return null
  if (evidenceType === 'matchup_context' && !canonicalIds.matchupId) return null
  if ((evidenceType === 'waiver_context' || evidenceType === 'trade_context' || evidenceType === 'draft_context') && !canonicalIds.playerId) {
    return null
  }

  return {
    leagueId: canonicalIds.leagueId,
    teamId: canonicalIds.teamId,
    managerId: canonicalIds.managerId,
    matchupId: canonicalIds.matchupId,
    playerId: canonicalIds.playerId,
    week: canonicalIds.week,
    season: canonicalIds.season,
    contextType: evidenceType,
  }
}

function buildRequestContextEvidence(input: NflRedraftPremiumEvidenceResolverInput): NflRedraftProviderEvidencePacket[] {
  const evidenceTypes = SURFACE_CONTEXT_BY_SERVICE[input.serviceId]
  const contextTypes = evidenceTypes.filter(
    (type): type is Extract<NflRedraftEvidenceType, 'roster_context' | 'matchup_context' | 'waiver_context' | 'trade_context' | 'draft_context'> =>
      type === 'roster_context' ||
      type === 'matchup_context' ||
      type === 'waiver_context' ||
      type === 'trade_context' ||
      type === 'draft_context',
  )

  return contextTypes.flatMap((evidenceType) => {
    const facts = factsForContext(evidenceType, input.canonicalIds)
    if (!facts) return []
    return [
      buildSurfaceContextEvidencePacket({
        evidenceType,
        leagueId: input.canonicalIds.leagueId,
        teamId: input.canonicalIds.teamId,
        playerId: input.canonicalIds.playerId,
        matchupId: input.canonicalIds.matchupId,
        sourceProvider: 'allfantasy',
        ingestedAtIso: input.ingestedAtIso,
        facts,
      }),
    ]
  })
}

function counts(
  totalAvailable: number,
  packets: NflRedraftProviderEvidencePacket[],
): NflRedraftPremiumEvidenceCounts {
  const byType: Record<string, number> = {}
  for (const packet of packets) {
    byType[packet.evidenceType] = (byType[packet.evidenceType] ?? 0) + 1
  }
  return {
    totalAvailable,
    selected: packets.length,
    stale: packets.filter((packet) => packet.stale).length,
    fallback: packets.filter((packet) => packet.fallback).length,
    missing: packets.filter((packet) => packet.missing).length,
    byType,
  }
}

function resolverStatus(args: {
  selected: number
  externalSelected: number
  requestContextSelected: number
  requestedTypes: NflRedraftEvidenceType[]
}): NflRedraftPremiumEvidenceResolverStatus {
  if (args.selected === 0) {
    return {
      status: 'empty',
      source: 'canonical_evidence_resolver',
      messages: ['no_matching_canonical_evidence'],
    }
  }
  if (args.externalSelected === 0 && args.requestContextSelected > 0) {
    return {
      status: 'partial',
      source: 'canonical_evidence_resolver',
      messages: ['request_context_only'],
    }
  }
  return {
    status: 'resolved',
    source: 'canonical_evidence_resolver',
    messages: [`selected_${args.selected}_canonical_evidence_packets`],
  }
}

export function resolveNflRedraftPremiumEvidence(
  input: NflRedraftPremiumEvidenceResolverInput,
): NflRedraftPremiumEvidenceResolverResult {
  const definition = NFL_REDRAFT_PREMIUM_SERVICE_DEFINITIONS[input.serviceId]
  const available = input.availableEvidencePackets ?? []
  const requestedTypes = definition.packetTypes
  const externalSelected = available.filter(
    (packet) => requestedTypes.includes(packet.evidenceType) && packetMatchesCanonicalIds(packet, input.canonicalIds),
  )
  const requestContext = buildRequestContextEvidence(input).filter((packet) => requestedTypes.includes(packet.evidenceType))
  const evidencePackets = uniquePackets([...externalSelected, ...requestContext])
  const evidenceCounts = counts(available.length + requestContext.length, evidencePackets)

  return {
    evidencePackets,
    evidenceCounts,
    resolverStatus: resolverStatus({
      selected: evidencePackets.length,
      externalSelected: externalSelected.length,
      requestContextSelected: requestContext.length,
      requestedTypes,
    }),
  }
}

export function evidenceResolverRequestHash(input: NflRedraftPremiumEvidenceResolverInput): string {
  return [
    input.serviceId,
    input.serviceVariant ?? 'basic',
    cleanString(input.canonicalIds.leagueId) ?? 'league-none',
    cleanString(input.canonicalIds.teamId) ?? 'team-none',
    cleanString(input.canonicalIds.managerId) ?? 'manager-none',
    cleanString(input.canonicalIds.matchupId) ?? 'matchup-none',
    cleanString(input.canonicalIds.playerId) ?? 'player-none',
    input.canonicalIds.week ?? 'week-none',
    input.canonicalIds.season ?? 'season-none',
  ].join(':')
}
