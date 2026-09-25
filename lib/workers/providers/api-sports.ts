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

function toSeason(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return getCurrentNFLSeasonForAPISports()
}

function toSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function namesEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? '').trim().toLowerCase() === (right ?? '').trim().toLowerCase()
}

/** Real API-Sports team ids are positive; `0` is the unresolved-fixture placeholder. */
const teamIdOf = (id: number | null | undefined): string | null =>
  typeof id === 'number' && Number.isFinite(id) && id > 0 ? String(id) : null

export const apiSportsProvider: ApiProvider = {
  name: 'api_sports',
  supports: ({ sport, dataType }: ApiFetchParams) =>
    ['nfl', 'ncaaf'].includes(toApiChainSport(sport as string) ?? '') &&
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
          // Same placeholder-`0` guard as the games path below. `player.team` being truthy says
          // nothing about its id: an unassigned club arrives as `{ id: 0, name: … }`, and
          // `String(0)` is `"0"`, which reads as a real team to every consumer.
          teamId: teamIdOf(player.team?.id),
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
        /*
         * ⚠ A FIXTURE WITH NO TEAM NAMED IS OMITTED, NOT EMITTED WITH NULLS. API-Sports ships
         * unresolved postseason slots and not-yet-set NCAAF opponents with the team object
         * present and its name empty — the same payload that rejected `sportsGame.upsert` in
         * `lib/api-sports.ts`. The provider type now says so, so this is a handled case rather
         * than a shape the compiler had been told could not occur.
         */
        return games.flatMap((game) => {
          const homeTeam = game.teams.home.name
            ? teamNameToAbbrev(game.teams.home.name) ?? game.teams.home.name
            : null
          const awayTeam = game.teams.away.name
            ? teamNameToAbbrev(game.teams.away.name) ?? game.teams.away.name
            : null
          if (!homeTeam || !awayTeam) return []
          return [{
          id: String(game.game.id),
          homeTeam,
          awayTeam,
          /*
           * 🛑 `0` IS NOT AN ID, AND `!= null` LETS IT THROUGH. API-Sports ships `id: 0` as a
           * placeholder on unresolved fixtures — sometimes with the NAMES resolved — and
           * `0 != null` is true, so this stringified it to `"0"`. `lib/workers/schedule-importer.ts`
           * accepts any string and writes it to `GameSchedule.homeTeamId`, giving a team id that
           * reads as real to anything joining on it. `writeApiSportsGames` in `lib/api-sports.ts`
           * guards this with `teamIdOf`; this parallel writer was named in that comment as
           * already handling it and did not.
           */
          homeTeamId: teamIdOf(game.teams.home.id),
          awayTeamId: teamIdOf(game.teams.away.id),
          date: game.game.date.date,
          status: game.game.status.long,
          season: game.league.season,
          venue: game.game.venue?.name ?? null,
          homeScore: game.scores.home.total ?? null,
          awayScore: game.scores.away.total ?? null,
          source: 'api_sports',
          }]
        })
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
        const players = await fetchAPISportsPlayerBySearch(search, season, { sport: sportTag })
        const matched = players.find((player) => {
          const sameName = namesEqual(player.name, search)
          const sameTeam = !teamCode || teamNameToAbbrev(player.team?.name ?? null) === teamCode
          return sameName && sameTeam
        }) ?? players[0]
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
