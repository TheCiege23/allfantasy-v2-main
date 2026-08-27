import type { ApiFetchParams, ApiProvider } from '@/lib/workers/api-config'
import { CFBD_BASE_URL } from '@/lib/cfbd-fetch'
import { toApiChainSport } from '@/lib/workers/api-config'
import { getCfbdApiKey } from '@/lib/cfbd-env'


function currentSeason(): string {
  return String(new Date().getFullYear())
}

function apiKey(): string {
  return getCfbdApiKey()
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

/** Positions the NCAAF fantasy pool cares about; everything else is dropped. */
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'K', 'PK', 'ATH'])

export interface CfbdPlayerSeed {
  id: string
  name: string
  team: string
  position: string
  jersey: number | null
  classYear: number | null
  source: 'cfbd'
}

/**
 * CFBD `/roster` rows → player seeds for the importer.
 *
 * Accepts BOTH field spellings on purpose: the current API returns camelCase
 * (`firstName`), older captures are snake_case (`first_name`), and a mapper
 * that knows only one silently produces a roster of empty names.
 *
 * NOT shared with `scripts/import-ncaaf-players-cfbd.ts`, which has its own
 * near-identical mapper. That script keys `SportsPlayerRecord` upserts on an
 * `NCAAF:{id}`-prefixed id, and unifying the two would change the primary key
 * of every row it has already written — orphaning them and re-inserting
 * duplicates. The duplication is deliberate until that id format is migrated.
 */
export function mapCfbdRosterToPlayerSeeds(
  rows: Array<Record<string, unknown>> | null | undefined,
): CfbdPlayerSeed[] {
  if (!Array.isArray(rows)) return []

  const seeds: CfbdPlayerSeed[] = []
  for (const row of rows) {
    const first = String(row.firstName ?? row.first_name ?? '').trim()
    const last = String(row.lastName ?? row.last_name ?? '').trim()
    const name = `${first} ${last}`.trim()
    const position = String(row.position ?? '').trim().toUpperCase()
    if (!name || !FANTASY_POSITIONS.has(position)) continue

    const team = String(row.team ?? '').trim()
    if (!team) continue

    const externalId = String(row.id ?? '').trim()
    const jersey = Number(row.jersey)
    const classYear = Number(row.year ?? row.classYear)

    seeds.push({
      // A roster row without an id still has to be addressable, and name+team
      // is stable across refreshes for the same player at the same school.
      id: externalId || `${name}-${team}`,
      name,
      team,
      position,
      jersey: Number.isFinite(jersey) ? jersey : null,
      classYear: Number.isFinite(classYear) ? classYear : null,
      source: 'cfbd',
    })
  }

  // De-dupe by id — CFBD can list a player twice across roster snapshots.
  const byId = new Map<string, CfbdPlayerSeed>()
  for (const seed of seeds) byId.set(seed.id, seed)
  return [...byId.values()]
}

export const cfbdProvider: ApiProvider = {
  name: 'cfbd',
  supports: ({ sport, dataType }: ApiFetchParams) =>
    toApiChainSport(sport as string) === 'ncaaf' &&
    ['teams', 'games', 'schedule', 'players'].includes(dataType),
  async fetch({ dataType, query = {} }: ApiFetchParams) {
    const season = typeof query.season === 'string' && query.season.trim()
      ? query.season.trim()
      : currentSeason()

    switch (dataType) {
      case 'teams': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/teams/fbs', { year: season })
        return (rows ?? []).map((team) => ({
          id: String(team.id ?? team.school ?? ''),
          name: String(team.school ?? ''),
          shortName: String(team.abbreviation ?? '').trim() || null,
          conference: String(team.conference ?? '').trim() || null,
          source: 'cfbd',
        })).filter((team) => team.id && team.name)
      }
      case 'players': {
        // `classification=fbs` matches what scripts/import-ncaaf-players-cfbd.ts
        // asks for, so the chain and the hand-run import cover the same schools
        // rather than disagreeing about what "the NCAAF pool" means.
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/roster', {
          year: season,
          classification: 'fbs',
        })
        // `cfbdFetch` answers null for a missing key or a non-ok response, which
        // the mapper reports as an empty roster. That is the same conflation
        // being unpicked in lib/cfb-player-data.ts; leaving the note here so the
        // next person fixing it knows this call site shares the problem.
        return mapCfbdRosterToPlayerSeeds(rows)
      }
      case 'games':
      case 'schedule': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/games', { year: season })
        return (rows ?? []).map((game) => ({
          id: String(game.id ?? `${game.home_team ?? ''}-${game.away_team ?? ''}-${game.start_date ?? ''}`),
          homeTeam: String(game.home_team ?? ''),
          awayTeam: String(game.away_team ?? ''),
          date: String(game.start_date ?? ''),
          status: String(game.completed ? 'final' : 'scheduled'),
          season,
          venue: String(game.venue ?? '').trim() || null,
          homeScore: typeof game.home_points === 'number' ? game.home_points : null,
          awayScore: typeof game.away_points === 'number' ? game.away_points : null,
          source: 'cfbd',
        })).filter((game) => game.id)
      }
      default:
        return null
    }
  },
}
