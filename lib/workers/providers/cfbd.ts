import type { ApiFetchParams, ApiProvider } from '@/lib/workers/api-config'
import { toApiChainSport } from '@/lib/workers/api-config'
import { getCfbdApiKey } from '@/lib/cfbd-env'

/**
 * CollegeFootballData (CFBD) provider — NCAAF fallback in the api-chain.
 *
 * Field names verified against the live CFBD API on 2026-07-17 (Alabama / year 2024).
 * NOTE: the CFBD API returns **camelCase** JSON (homeTeam, startDate, homePoints, firstName…).
 * The prior implementation read snake_case game fields (home_team, start_date, home_points),
 * which silently produced blank team names / null scores for NCAAF schedule+scores — fixed here.
 *
 * Endpoints used:
 *   /teams/fbs            → teams
 *   /games                → games / schedule
 *   /roster               → roster            (NCAAF player pool)
 *   /stats/player/season  → season_stats      (long rows pivoted per player)
 *   /games/players        → weekly_stats      (nested game→team→category→type→athlete, flattened)
 *   /records              → standings
 *   /rankings             → rankings          (AP Top 25 / Coaches poll)
 */

const CFBD_BASE_URL = 'https://api.collegefootballdata.com'

const SUPPORTED_DATA_TYPES = [
  'teams',
  'games',
  'schedule',
  'roster',
  'season_stats',
  'weekly_stats',
  'standings',
  'rankings',
] as const

function currentSeason(): string {
  return String(new Date().getFullYear())
}

function apiKey(): string {
  return getCfbdApiKey()
}

/** Coerce an unknown to a finite number, else null. Accepts numeric strings ("2.5"). */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Coerce an unknown to a non-empty trimmed string, else null. */
function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const s = value.trim()
    return s === '' ? null : s
  }
  if (value == null) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

/** A single stat cell: numeric when parseable ("16" → 16), else the raw string ("7/9"). */
function statValue(value: unknown): number | string | null {
  const n = num(value)
  if (n != null) return n
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

async function cfbdFetch<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const key = apiKey()
  if (!key) return null

  const url = new URL(`${CFBD_BASE_URL}${path}`)
  Object.entries(params ?? {}).forEach(([param, value]) => {
    if (value) url.searchParams.set(param, value)
  })

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) return null
  return (await response.json()) as T
}

type StatMap = Record<string, Record<string, number | string | null>>

interface SeasonStatRow {
  playerId: string
  player: string | null
  position: string | null
  team: string | null
  conference: string | null
  season: number
  stats: StatMap
  source: 'cfbd'
}

interface WeeklyStatRow {
  gameId: string | null
  week: number | null
  season: number
  team: string | null
  conference: string | null
  homeAway: string | null
  playerId: string
  player: string | null
  stats: StatMap
  source: 'cfbd'
}

/** Read season/year from a loosely-typed query, falling back to the current season. */
function resolveSeason(query: Record<string, unknown>): string {
  return str(query.season) ?? str(query.year) ?? currentSeason()
}

export const cfbdProvider: ApiProvider = {
  name: 'cfbd',
  supports: ({ sport, dataType }: ApiFetchParams) =>
    toApiChainSport(sport as string) === 'ncaaf' &&
    (SUPPORTED_DATA_TYPES as readonly string[]).includes(dataType),
  async fetch({ dataType, query = {} }: ApiFetchParams) {
    const season = resolveSeason(query)
    const team = str(query.team)
    const week = num(query.week)
    const seasonType = str(query.seasonType)
    const pollQuery = str(query.poll)

    switch (dataType) {
      case 'teams': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/teams/fbs', { year: season })
        return (rows ?? [])
          .map((team) => ({
            id: str(team.id) ?? str(team.school) ?? '',
            name: str(team.school) ?? '',
            shortName: str(team.abbreviation),
            conference: str(team.conference),
            classification: str(team.classification),
            source: 'cfbd',
          }))
          .filter((team) => team.id && team.name)
      }

      case 'games':
      case 'schedule': {
        const params: Record<string, string> = { year: season }
        if (week != null) params.week = String(week)
        if (seasonType) params.seasonType = seasonType
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/games', params)
        return (rows ?? [])
          .map((game) => ({
            id: str(game.id) ?? `${str(game.homeTeam) ?? ''}-${str(game.awayTeam) ?? ''}-${str(game.startDate) ?? ''}`,
            homeTeam: str(game.homeTeam) ?? '',
            awayTeam: str(game.awayTeam) ?? '',
            date: str(game.startDate) ?? '',
            status: game.completed ? 'final' : 'scheduled',
            season: str(game.season) ?? season,
            week: num(game.week),
            seasonType: str(game.seasonType),
            venue: str(game.venue),
            homeScore: num(game.homePoints),
            awayScore: num(game.awayPoints),
            source: 'cfbd',
          }))
          .filter((game) => game.id)
      }

      case 'roster': {
        const params: Record<string, string> = { year: season }
        if (team) params.team = team
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/roster', params)
        return (rows ?? [])
          .map((player) => {
            const first = str(player.firstName) ?? ''
            const last = str(player.lastName) ?? ''
            const name = `${first} ${last}`.trim()
            const city = str(player.homeCity)
            const state = str(player.homeState)
            return {
              id: str(player.id),
              name,
              firstName: first || null,
              lastName: last || null,
              position: str(player.position),
              number: num(player.jersey),
              team: str(player.team),
              classYear: num(player.year), // eligibility class (1=FR … 5)
              heightInches: num(player.height),
              weightPounds: num(player.weight),
              hometown: [city, state].filter(Boolean).join(', ') || null,
              source: 'cfbd',
            }
          })
          .filter((player) => player.id && player.name)
      }

      case 'season_stats': {
        const params: Record<string, string> = { year: season }
        if (team) params.team = team
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/stats/player/season', params)
        const byPlayer = new Map<string, SeasonStatRow>()
        for (const row of rows ?? []) {
          const playerId = str(row.playerId)
          if (!playerId) continue
          let rec = byPlayer.get(playerId)
          if (!rec) {
            rec = {
              playerId,
              player: str(row.player),
              position: str(row.position),
              team: str(row.team),
              conference: str(row.conference),
              season: num(row.season) ?? Number(season),
              stats: {},
              source: 'cfbd',
            }
            byPlayer.set(playerId, rec)
          }
          const category = str(row.category)
          const statType = str(row.statType)
          if (category && statType) {
            ;(rec.stats[category] ??= {})[statType] = statValue(row.stat)
          }
        }
        return Array.from(byPlayer.values())
      }

      case 'weekly_stats': {
        const params: Record<string, string> = { year: season }
        if (week != null) params.week = String(week)
        if (team) params.team = team
        if (seasonType) params.seasonType = seasonType
        const games = await cfbdFetch<Array<Record<string, unknown>>>('/games/players', params)
        const out: WeeklyStatRow[] = []
        for (const game of games ?? []) {
          const gameId = str(game.id)
          const teams = Array.isArray(game.teams) ? game.teams : []
          for (const rawTeam of teams) {
            if (!isRecord(rawTeam)) continue
            const teamName = str(rawTeam.team)
            const conference = str(rawTeam.conference)
            const homeAway = str(rawTeam.homeAway)
            const categories = Array.isArray(rawTeam.categories) ? rawTeam.categories : []
            const perAthlete = new Map<string, WeeklyStatRow>()
            for (const rawCat of categories) {
              if (!isRecord(rawCat)) continue
              const categoryName = str(rawCat.name)
              const types = Array.isArray(rawCat.types) ? rawCat.types : []
              for (const rawType of types) {
                if (!isRecord(rawType)) continue
                const typeName = str(rawType.name)
                const athletes = Array.isArray(rawType.athletes) ? rawType.athletes : []
                for (const rawAthlete of athletes) {
                  if (!isRecord(rawAthlete)) continue
                  const playerId = str(rawAthlete.id)
                  if (!playerId || !categoryName || !typeName) continue
                  let rec = perAthlete.get(playerId)
                  if (!rec) {
                    rec = {
                      gameId,
                      week,
                      season: Number(season),
                      team: teamName,
                      conference,
                      homeAway,
                      playerId,
                      player: str(rawAthlete.name),
                      stats: {},
                      source: 'cfbd',
                    }
                    perAthlete.set(playerId, rec)
                  }
                  ;(rec.stats[categoryName] ??= {})[typeName] = statValue(rawAthlete.stat)
                }
              }
            }
            out.push(...perAthlete.values())
          }
        }
        return out
      }

      case 'standings': {
        const params: Record<string, string> = { year: season }
        if (team) params.team = team
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/records', params)
        return (rows ?? [])
          // /records with no team filter returns every division — keep FBS for an NCAAF table.
          .filter((row) => (team ? true : str(row.classification) === 'fbs'))
          .map((row) => {
            const total = isRecord(row.total) ? row.total : {}
            const conf = isRecord(row.conferenceGames) ? row.conferenceGames : {}
            return {
              id: str(row.teamId),
              team: str(row.team),
              conference: str(row.conference),
              division: str(row.division),
              classification: str(row.classification),
              games: num(total.games),
              wins: num(total.wins),
              losses: num(total.losses),
              ties: num(total.ties),
              conferenceWins: num(conf.wins),
              conferenceLosses: num(conf.losses),
              conferenceTies: num(conf.ties),
              expectedWins: num(row.expectedWins),
              season: Number(season),
              source: 'cfbd',
            }
          })
          .filter((row) => row.id && row.team)
      }

      case 'rankings': {
        const params: Record<string, string> = { year: season, seasonType: seasonType ?? 'regular' }
        if (week != null) params.week = String(week)
        const weeks = await cfbdFetch<Array<Record<string, unknown>>>('/rankings', params)
        if (!weeks || weeks.length === 0) return []

        // Pick the requested week, else the most recent week returned.
        const weekObj =
          (week != null ? weeks.find((w) => num(w.week) === week) : undefined) ?? weeks[weeks.length - 1]
        const polls = Array.isArray(weekObj.polls) ? weekObj.polls.filter(isRecord) : []
        if (polls.length === 0) return []

        // Prefer the FBS-facing polls; never blindly take polls[0] (can be a DII poll).
        const preferences = pollQuery ? [pollQuery] : ['AP Top 25', 'Coaches Poll', 'Playoff Committee Rankings']
        let chosen: Record<string, unknown> | undefined
        for (const name of preferences) {
          chosen = polls.find((p) => (str(p.poll) ?? '').toLowerCase().includes(name.toLowerCase()))
          if (chosen) break
        }
        if (!chosen) {
          chosen = polls.find((p) => /\b(ap|coaches|playoff)\b/i.test(str(p.poll) ?? '')) ?? polls[0]
        }
        if (!chosen) return []

        const ranks = Array.isArray(chosen.ranks) ? chosen.ranks.filter(isRecord) : []
        const pollName = str(chosen.poll)
        const weekNum = num(weekObj.week)
        const seasonNum = num(weekObj.season) ?? Number(season)
        return ranks
          .map((rank) => ({
            rank: num(rank.rank),
            team: str(rank.school),
            teamId: str(rank.teamId),
            conference: str(rank.conference),
            firstPlaceVotes: num(rank.firstPlaceVotes),
            points: num(rank.points),
            poll: pollName,
            week: weekNum,
            season: seasonNum,
            source: 'cfbd',
          }))
          .filter((rank) => rank.team)
      }

      default:
        return null
    }
  },
}
