import type { ExternalIdentityMapping, ImportProvider, NormalizedRoster } from '../types'
import type { IExternalIdentityMapper } from './ExternalIdentityMapper'

function dedupeMappings(mappings: ExternalIdentityMapping[]): ExternalIdentityMapping[] {
  const seen = new Set<string>()
  const result: ExternalIdentityMapping[] = []
  for (const mapping of mappings) {
    const key = `${mapping.source_provider}:${mapping.entity_type}:${mapping.source_id}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(mapping)
  }
  return result
}

function toStableKey(provider: ImportProvider, entityType: ExternalIdentityMapping['entity_type'], sourceId: string): string {
  return `${provider}:${entityType}:${sourceId}`
}

function buildTeamAndManagerMappings(
  provider: ImportProvider,
  rosters: NormalizedRoster[]
): ExternalIdentityMapping[] {
  const mappings: ExternalIdentityMapping[] = []
  for (const roster of rosters) {
    if (roster.source_team_id) {
      mappings.push({
        source_provider: provider,
        entity_type: 'team',
        source_id: roster.source_team_id,
        stable_key: toStableKey(provider, 'team', roster.source_team_id),
      })
    }
    if (roster.source_manager_id) {
      mappings.push({
        source_provider: provider,
        entity_type: 'manager',
        source_id: roster.source_manager_id,
        stable_key: toStableKey(provider, 'manager', roster.source_manager_id),
      })
    }
  }
  return mappings
}

function buildPlayerMappings(
  provider: ImportProvider,
  playerMap: Record<
    string,
    { name: string; position: string; team: string; external_ids?: ExternalIdentityMapping['external_ids'] }
  >
): ExternalIdentityMapping[] {
  return Object.entries(playerMap).map(([sourcePlayerId, entry]) => ({
    source_provider: provider,
    entity_type: 'player',
    source_id: sourcePlayerId,
    stable_key: toStableKey(provider, 'player', sourcePlayerId),
    /*
     * Copied through, never synthesised: a mapping carries `external_ids` only when the
     * provider's own `player_map` entry did. Providers that expose no foreign id space get
     * exactly the mapping they got before this field existed.
     */
    ...(entry?.external_ids ? { external_ids: entry.external_ids } : {}),
  }))
}

export const DefaultExternalIdentityMapper: IExternalIdentityMapper = {
  buildMappings(provider, normalized) {
    const leagueId = normalized.source.source_league_id
    const rosterMappings = buildTeamAndManagerMappings(provider, normalized.rosters)
    const playerMappings = buildPlayerMappings(provider, normalized.player_map ?? {})
    const leagueMapping: ExternalIdentityMapping[] = leagueId
      ? [
          {
            source_provider: provider,
            entity_type: 'league',
            source_id: leagueId,
            stable_key: toStableKey(provider, 'league', leagueId),
          },
        ]
      : []

    return dedupeMappings([...leagueMapping, ...rosterMappings, ...playerMappings])
  },
}
