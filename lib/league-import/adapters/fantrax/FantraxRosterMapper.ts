import type { IExternalRosterMapper } from '../../mappers/ExternalRosterMapper'
import type { NormalizedRoster } from '../../types'
import type { FantraxImportPayload } from './types'

export const FantraxRosterMapper: IExternalRosterMapper<FantraxImportPayload> = {
  map(source) {
    return source.teams.map((team) => {
      return {
        source_team_id: team.teamId,
        source_manager_id: team.managerId,
        owner_name: team.managerName,
        team_name: team.teamName,
        avatar_url: team.logoUrl,
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        points_for: team.pointsFor,
        points_against: team.pointsAgainst ?? undefined,
        player_ids: team.rosterPlayerIds,
        starter_ids: team.starterPlayerIds,
        reserve_ids: team.reservePlayerIds,
        taxi_ids: team.taxiPlayerIds ?? [],
        faab_remaining: team.faabRemaining,
        waiver_priority: team.waiverPriority,
      } satisfies NormalizedRoster
    })
  },
}
