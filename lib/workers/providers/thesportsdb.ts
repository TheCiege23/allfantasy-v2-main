import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { apiChainSportToDbSport, toApiChainSport, type ApiFetchParams, type ApiProvider } from '@/lib/workers/api-config'
import { getTheSportsDbApiKeyOrFallback } from '@/lib/env/sports-media-keys'
import { pickHeadshotCandidate } from '@/lib/player-assets/headshotCandidateMatch'

const THESPORTSDB_LEAGUE_IDS = {
  NFL: '4391',
  NHL: '4380',
  NBA: '4387',
  MLB: '4424',
  NCAAB: process.env.THESPORTSDB_NCAAM_LEAGUE_ID || '4607',
  NCAAF: process.env.THESPORTSDB_NCAAF_LEAGUE_ID || '',
  SOCCER: process.env.THESPORTSDB_SOCCER_LEAGUE_ID || '',
} as const

function apiKey(): string {
  return getTheSportsDbApiKeyOrFallback('123')
}

function leagueIdForSport(sport: string): string {
  const chain = toApiChainSport(sport)
  if (chain === 'soccer_mls') {
    const mls = process.env.THESPORTSDB_MLS_LEAGUE_ID?.trim()
    if (mls) return mls
  }
  const key = chain ? apiChainSportToDbSport(chain) : sport.toUpperCase()
  return THESPORTSDB_LEAGUE_IDS[key as keyof typeof THESPORTSDB_LEAGUE_IDS] || ''
}

/**
 * TheSportsDB's `strSport` value for one of our sport codes. The values are the vendor's
 * documented sport enum (contracts/thesportsdb/ENDPOINTS.yaml, `strStatus_by_sport`);
 * "American Football" is also confirmed by the committed fixtures. NCAA codes share the pro
 * sport's value — searchplayers.php has no league field to separate them.
 */
export function theSportsDbSportName(sport: string): string | null {
  const chain = toApiChainSport(sport)
  if (!chain) return null
  switch (apiChainSportToDbSport(chain)) {
    case 'NFL':
    case 'NCAAF':
      return 'American Football'
    case 'NBA':
    case 'NCAAB':
      return 'Basketball'
    case 'MLB':
      return 'Baseball'
    case 'NHL':
      return 'Ice Hockey'
    case 'SOCCER':
      return 'Soccer'
    default:
      return null
  }
}

function toSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function namesEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? '').trim().toLowerCase() === (right ?? '').trim().toLowerCase()
}

async function fetchTheSportsDb(path: string, params?: Record<string, string>): Promise<Record<string, unknown> | null> {
  const url = new URL(`https://www.thesportsdb.com/api/v1/json/${apiKey()}/${path}`)
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value)
  })
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) return null
  return (await response.json()) as Record<string, unknown>
}

function asRows<T = Record<string, unknown>>(data: Record<string, unknown> | null, key: string): T[] {
  if (!data) return []
  const rows = data[key]
  return Array.isArray(rows) ? (rows as T[]) : []
}

function resolvePlayerImage(row: Record<string, unknown>): string | null {
  const options = [
    row.strCutout,
    row.strRender,
    row.strThumb,
    row.strFanart1,
  ]
  for (const candidate of options) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function resolveTeamLogo(row: Record<string, unknown>): string | null {
  const options = [
    row.strTeamBadge,
    row.strTeamLogo,
    row.strBadge,
    row.strLogo,
  ]
  for (const candidate of options) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function resolveTeamCode(row: Record<string, unknown>): string | null {
  return normalizeTeamAbbrev(String(row.strTeamShort ?? row.strTeamAlternate ?? '')) ?? null
}

export const theSportsDbProvider: ApiProvider = {
  name: 'thesportsdb',
  supports: ({ dataType }: ApiFetchParams) =>
    [
      'teams',
      'players',
      'games',
      'schedule',
      'player_headshots',
      'team_logos',
      'team_roster',
    ].includes(dataType),
  async fetch({ sport, dataType, query = {} }: ApiFetchParams) {
    const leagueId = leagueIdForSport(sport)
    const search = toSearch(query.search ?? query.playerName)
    const teamName = toSearch(query.teamName)
    const teamCode = normalizeTeamAbbrev(String(query.teamCode ?? query.team ?? ''))

    switch (dataType) {
      case 'teams': {
        if (!leagueId) return null
        // Use documented search_all_teams.php?l={leagueName} first, fall back to lookup by ID
        const leagueName = sport === 'NFL' ? 'NFL' : sport === 'NBA' ? 'NBA' : sport === 'NHL' ? 'NHL' : sport === 'MLB' ? 'MLB' : null
        const data = leagueName
          ? await fetchTheSportsDb('search_all_teams.php', { l: leagueName })
          : await fetchTheSportsDb('lookup_all_teams.php', { id: leagueId })
        const rows = asRows<Record<string, unknown>>(data, 'teams')
        return rows.map((team) => ({
          id: String(team.idTeam ?? ''),
          name: String(team.strTeam ?? ''),
          shortName: resolveTeamCode(team),
          city: String(team.strLocation ?? '').trim() || null,
          logo: resolveTeamLogo(team),
          source: 'thesportsdb',
        })).filter((team) => team.id && team.name)
      }
      case 'players': {
        if (!search) return null
        // Pass team filter when available — searchplayers.php supports ?p=name&t=team
        const playerSearchParams: Record<string, string> = { p: search }
        if (teamName) playerSearchParams.t = teamName
        else if (teamCode) playerSearchParams.t = teamCode
        const data = await fetchTheSportsDb('searchplayers.php', playerSearchParams)
        const rows = asRows<Record<string, unknown>>(data, 'player')
        return rows
          .filter((player) => namesEqual(String(player.strSport ?? sport), sport) || sport === 'SOCCER')
          .map((player) => ({
            id: String(player.idPlayer ?? ''),
            name: String(player.strPlayer ?? ''),
            position: String(player.strPosition ?? '').trim() || null,
            team: normalizeTeamAbbrev(String(player.strTeamShort ?? player.strTeam ?? '')) ?? null,
            teamId: player.idTeam ? String(player.idTeam) : null,
            height: String(player.strHeight ?? '').trim() || null,
            weight: String(player.strWeight ?? '').trim() || null,
            college: String(player.strCollege ?? '').trim() || null,
            imageUrl: resolvePlayerImage(player),
            source: 'thesportsdb',
          }))
          .filter((player) => player.id && player.name)
      }
      case 'team_roster': {
        // lookup_all_players.php?id={teamId} — bulk roster for a single team
        const teamId = toSearch(query.teamId ?? query.id)
        if (!teamId) return null
        const data = await fetchTheSportsDb('lookup_all_players.php', { id: teamId })
        const rows = asRows<Record<string, unknown>>(data, 'player')
        return rows.map((player) => ({
          id: String(player.idPlayer ?? ''),
          name: String(player.strPlayer ?? ''),
          position: String(player.strPosition ?? '').trim() || null,
          team: normalizeTeamAbbrev(String(player.strTeamShort ?? player.strTeam ?? '')) ?? null,
          teamId: player.idTeam ? String(player.idTeam) : null,
          height: String(player.strHeight ?? '').trim() || null,
          weight: String(player.strWeight ?? '').trim() || null,
          college: String(player.strCollege ?? '').trim() || null,
          imageUrl: resolvePlayerImage(player),
          source: 'thesportsdb',
        })).filter((player) => player.id && player.name)
      }
      case 'games':
      case 'schedule': {
        if (!leagueId) return null
        const data = await fetchTheSportsDb('eventsnextleague.php', { id: leagueId })
        const rows = asRows<Record<string, unknown>>(data, 'events')
        return rows.map((event) => ({
          id: String(event.idEvent ?? ''),
          homeTeam: normalizeTeamAbbrev(String(event.strHomeTeam ?? '')) ?? String(event.strHomeTeam ?? ''),
          awayTeam: normalizeTeamAbbrev(String(event.strAwayTeam ?? '')) ?? String(event.strAwayTeam ?? ''),
          date: String(event.dateEvent ?? event.strTimestamp ?? ''),
          status: String(event.strStatus ?? 'scheduled'),
          season: String(event.strSeason ?? ''),
          venue: String(event.strVenue ?? '').trim() || null,
          source: 'thesportsdb',
        })).filter((event) => event.id)
      }
      case 'player_headshots': {
        if (!search) return null
        // searchplayers.php spans every sport TheSportsDB covers, so a basketball player's
        // name search can return a footballer. Unknown sport → no pick rather than a guess.
        const wantedSport = theSportsDbSportName(sport)
        if (!wantedSport) return null
        const data = await fetchTheSportsDb('searchplayers.php', { p: search })
        const rows = asRows<Record<string, unknown>>(data, 'player').filter((player) =>
          namesEqual(String(player.strSport ?? ''), wantedSport),
        )
        // No `?? rows[0]`: when no row is this player, the answer is "no headshot", never the
        // first search result's photo. See lib/player-assets/headshotCandidateMatch.ts.
        const matched = pickHeadshotCandidate(rows, {
          search,
          nameOf: (player) => String(player.strPlayer ?? ''),
          teamCodeOf: (player) =>
            normalizeTeamAbbrev(String(player.strTeamShort ?? player.strTeam ?? '')),
          teamCode,
        })
        const imageUrl = matched ? resolvePlayerImage(matched) : null
        if (!imageUrl) return null
        return {
          playerId: String(matched?.idPlayer ?? ''),
          playerName: String(matched?.strPlayer ?? search),
          teamCode: normalizeTeamAbbrev(String(matched?.strTeamShort ?? matched?.strTeam ?? '')) ?? null,
          headshotUrl: imageUrl,
          headshotUrlSm: imageUrl,
          headshotUrlLg: imageUrl,
          headshotSource: 'thesportsdb',
        }
      }
      case 'team_logos': {
        const rows =
          teamName
            ? asRows<Record<string, unknown>>(
                await fetchTheSportsDb('searchteams.php', { t: teamName }),
                'teams'
              )
            : asRows<Record<string, unknown>>(
                leagueId ? await fetchTheSportsDb('lookup_all_teams.php', { id: leagueId }) : null,
                'teams'
              )
        const matched = rows.find((team) => {
          const shortName = resolveTeamCode(team)
          return (
            (!!teamCode && shortName === teamCode) ||
            (!!teamName && namesEqual(String(team.strTeam ?? ''), teamName))
          )
        }) ?? rows[0]
        const logoUrl = matched ? resolveTeamLogo(matched) : null
        if (!logoUrl) return null
        return {
          teamCode: resolveTeamCode(matched ?? {}) ?? teamCode,
          teamName: String(matched?.strTeam ?? teamName ?? ''),
          logoUrl,
          logoUrlSm: logoUrl,
          logoUrlLg: logoUrl,
          logoSource: 'thesportsdb',
        }
      }
      default:
        return null
    }
  },
}
