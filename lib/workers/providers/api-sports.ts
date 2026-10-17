import {
  fetchAPISportsGames,
  fetchAPISportsInjuries,
  fetchAPISportsPlayerBySearch,
  fetchAPISportsPlayers,
  fetchAPISportsTeams,
  getCurrentNFLSeasonForAPISports,
  teamNameToAbbrev,
} from '@/lib/api-sports'
import { toApiChainSport, type ApiFetchParams, type ApiProvider } from '@/lib/workers/api-config'
import { pickHeadshotCandidate } from '@/lib/player-assets/headshotCandidateMatch'

function toSeason(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return getCurrentNFLSeasonForAPISports()
}

function toSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isFootballSport(sport: unknown): boolean {
  return ['nfl', 'ncaaf'].includes(toApiChainSport(String(sport ?? '')) ?? '')
}

export const apiSportsProvider: ApiProvider = {
  name: 'api_sports',
  supports: ({ sport, dataType }: ApiFetchParams) =>
    isFootballSport(sport) &&
    [
      'teams',
      'players',
      'games',
      'schedule',
      'injuries',
      'player_headshots',
      'team_logos',
    ].includes(dataType),
  async fetch({ sport, dataType, query = {} }: ApiFetchParams) {
    const chainSport = toApiChainSport(String(sport ?? 'nfl')) ?? 'nfl'
    const sportTag = chainSport === 'ncaaf' ? 'NCAAF' : 'NFL'
    const season = toSeason(query.season)
    const search = toSearch(query.search ?? query.playerName)
    const teamId = typeof query.teamId === 'string' ? query.teamId.trim() : ''
    const teamCode = typeof query.teamCode === 'string' ? query.teamCode.trim().toUpperCase() : ''

    switch (dataType) {
      case 'teams': {
        const teams = await fetchAPISportsTeams(season, { sport: sportTag })
        return teams.map((team) => ({
          id: String(team.id),
          name: team.name,
          shortName: teamNameToAbbrev(team.name) ?? team.name,
          city: team.city ?? null,
          logo: team.logo ?? null,
          source: 'api_sports',
        }))
      }
      case 'players': {
        const players = search
          ? await fetchAPISportsPlayerBySearch(search, season, { sport: sportTag })
          : teamId
            ? await fetchAPISportsPlayers(teamId, season)
            : []
        return players.map((player) => ({
          id: String(player.id),
          name: player.name,
          position: player.position ?? player.group ?? null,
          team: teamNameToAbbrev(player.team?.name ?? null),
          teamId: player.team ? String(player.team.id) : null,
          number: player.number ?? null,
          height: player.height ?? null,
          weight: player.weight ? Number.parseInt(player.weight, 10) || null : null,
          college: player.college ?? null,
          status: null,
          imageUrl: player.image ?? null,
          source: 'api_sports',
        }))
      }
      case 'games':
      case 'schedule': {
        const games = await fetchAPISportsGames(season, { sport: sportTag })
        return games.map((game) => ({
          id: String(game.game.id),
          homeTeam: teamNameToAbbrev(game.teams.home.name) ?? game.teams.home.name,
          awayTeam: teamNameToAbbrev(game.teams.away.name) ?? game.teams.away.name,
          homeTeamId: String(game.teams.home.id),
          awayTeamId: String(game.teams.away.id),
          date: game.game.date.date,
          status: game.game.status.long,
          season: game.league.season,
          venue: game.game.venue?.name ?? null,
          homeScore: game.scores.home.total ?? null,
          awayScore: game.scores.away.total ?? null,
          source: 'api_sports',
        }))
      }
      case 'injuries': {
        const injuries = await fetchAPISportsInjuries(season, { sport: sportTag })
        return injuries.map((injury) => ({
          externalId: String(injury.id),
          playerId: String(injury.player?.id ?? injury.id),
          playerName: injury.player?.name ?? 'Unknown Player',
          team: teamNameToAbbrev(injury.team?.name ?? null) ?? injury.team?.name ?? 'FA',
          status: injury.status ?? 'questionable',
          bodyPart: injury.type ?? null,
          notes: injury.description ?? null,
          reportDate: injury.date ?? null,
          source: 'api_sports',
        }))
      }
      case 'player_headshots': {
        if (!search) return null
        // This client only knows American football. `chainSport` above falls back to 'nfl' for
        // any other sport, so without this an NBA name search ran against the NFL player list
        // and its photo was stored as the NBA player's headshot.
        if (!isFootballSport(sport)) return null
        const players = await fetchAPISportsPlayerBySearch(search, season, { sport: sportTag })
        // No `?? players[0]`: see lib/player-assets/headshotCandidateMatch.ts.
        const matched = pickHeadshotCandidate(players, {
          search,
          nameOf: (player) => player.name,
          teamCodeOf: (player) => teamNameToAbbrev(player.team?.name ?? null),
          teamCode,
        })
        if (!matched?.image) return null
        return {
          playerId: String(matched.id),
          playerName: matched.name,
          teamCode: teamNameToAbbrev(matched.team?.name ?? null),
          headshotUrl: matched.image,
          headshotUrlSm: matched.image,
          headshotUrlLg: matched.image,
          headshotSource: 'api_sports',
        }
      }
      case 'team_logos': {
        const teams = await fetchAPISportsTeams()
        const matched = teams.find((team) => teamNameToAbbrev(team.name) === teamCode) ?? teams[0]
        if (!matched?.logo) return null
        return {
          teamCode: teamNameToAbbrev(matched.name) ?? matched.name,
          teamName: matched.name,
          logoUrl: matched.logo,
          logoUrlSm: matched.logo,
          logoUrlLg: matched.logo,
          logoSource: 'api_sports',
        }
      }
      default:
        return null
    }
  },
}
