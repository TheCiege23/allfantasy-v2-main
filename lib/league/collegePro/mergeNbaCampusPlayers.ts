import { canonicalName } from '@/lib/draft-room/player-canonical-identity'
import { proTeamCode } from '@/lib/player-identity/proFantraxIdentityPlan'
import type { LeaguePlayerMetric } from '@/lib/af-projections/leaguePlayerMetrics'
import type { DisplayPlayerRecord } from '@/lib/player-data/adapters/redraftDisplayPlayers'

type NbaCampusPlayer = DisplayPlayerRecord & { alternateIds?: string[] }
type BoardIdentity = Pick<LeaguePlayerMetric, 'playerId' | 'playerName' | 'position' | 'team' | 'rosterPlayerId' | 'availabilityId'>

function nameAndClub(name: string, team: string | null | undefined): string | null {
  const label = canonicalName(name)
  const club = proTeamCode('NBA', team)
  return label && club ? label + '|' + club : null
}

/** Show each AF player once, while keeping searchable profiles without a verified projection. */
export function mergeNbaCampusPlayers(
  board: readonly BoardIdentity[],
  profiles: readonly DisplayPlayerRecord[],
): NbaCampusPlayer[] {
  const byAlias = new Map<string, NbaCampusPlayer | null>()
  const byNameAndClub = new Map<string, NbaCampusPlayer | null>()
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))
  const players: NbaCampusPlayer[] = board.map((row) => {
    const id = row.availabilityId ?? row.rosterPlayerId ?? row.playerId
    const profile = profilesById.get(id)
    const player = {
      ...profile,
      id,
      name: row.playerName,
      position: profile?.position || row.position,
      team: row.team ?? profile?.team ?? 'FA',
      alternateIds: [] as string[],
    }
    const aliases = new Set([row.playerId, row.rosterPlayerId, row.availabilityId,
      row.availabilityId ? 'NBA:' + row.availabilityId : null])
    for (const alias of aliases) {
      if (alias) byAlias.set(alias, byAlias.has(alias) ? null : player)
    }
    const key = nameAndClub(row.playerName, row.team)
    if (key) byNameAndClub.set(key, byNameAndClub.has(key) ? null : player)
    return player
  })

  for (const profile of profiles) {
    // The global directory re-exports players under several provider IDs. An exact alias
    // wins. Only suppress other copies when the canonical name and NBA club match uniquely.
    const key = nameAndClub(profile.name, profile.team)
    const match = byAlias.get(profile.id) ?? (key ? byNameAndClub.get(key) : null)
    if (!match) players.push(profile)
    else if (profile.id !== match.id) match.alternateIds?.push(profile.id)
  }
  return players
}
