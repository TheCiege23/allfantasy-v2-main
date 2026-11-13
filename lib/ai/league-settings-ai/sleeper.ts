const SLEEPER = 'https://api.sleeper.app/v1' // db-first-exception: temporary provider wrapper; migrate consumers to DB-backed settings snapshots

type SleeperUserRow = {
  user_id: string
  display_name?: string
  username?: string
  metadata?: { team_name?: string } | null
}

type SleeperRosterRow = {
  roster_id: number
  owner_id: string | null
  players?: string[]
  starters?: string[]
  reserve?: string[]
  taxi?: string[]
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
  }
}

async function fetchSleeperJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { next: { revalidate: 0 } })
  if (!res.ok) {
    throw new Error(`Sleeper request failed (${res.status}): ${url}`)
  }
  return res.json() as Promise<T>
}

export function readSleeperStateWeek(state: Record<string, unknown>): number | undefined {
  const w = state.week
  if (typeof w === 'number' && Number.isFinite(w)) return w
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export async function fetchSleeperLeagueBundle(platformLeagueId: string) {
  const league = await fetchSleeperJson<Record<string, unknown>>(`${SLEEPER}/league/${platformLeagueId}`)
  const sport = String(league.sport ?? 'nfl').toLowerCase()
  const [users, rosters, state] = await Promise.all([
    fetchSleeperJson<SleeperUserRow[]>(`${SLEEPER}/league/${platformLeagueId}/users`),
    fetchSleeperJson<SleeperRosterRow[]>(`${SLEEPER}/league/${platformLeagueId}/rosters`),
    fetchSleeperJson<Record<string, unknown>>(`${SLEEPER}/state/${sport}`).catch(() => ({} as Record<string, unknown>)),
  ])
  const stateRec = state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  return {
    league,
    sport,
    users: Array.isArray(users) ? users : [],
    rosters: Array.isArray(rosters) ? rosters : [],
    state: stateRec as Record<string, unknown>,
  }
}

export async function fetchPlayersMap(sport: string): Promise<Record<string, { full_name?: string; position?: string }>> {
  const s = sport.toLowerCase()
  const data = await fetchSleeperJson<Record<string, { full_name?: string; position?: string }>>(
    `${SLEEPER}/players/${s}`
  )
  return data && typeof data === 'object' ? data : {}
}

export function nameForPlayer(
  playersMap: Record<string, { full_name?: string }>,
  playerId: string
): string {
  const p = playersMap[playerId]
  return p?.full_name?.trim() || playerId
}

export async function fetchMatchups(platformLeagueId: string, week: number) {
  return fetchSleeperJson<
    { matchup_id: number; roster_id: number; points: number; starters?: string[] }[]
  >(`${SLEEPER}/league/${platformLeagueId}/matchups/${week}`)
}

export async function fetchTrendingAdds(sport: string, limit = 12) {
  const s = sport.toLowerCase()
  const rows = await fetchSleeperJson<{ player_id?: string; count?: number }[]>(
    `${SLEEPER}/players/${s}/trending/add?limit=${limit}`
  )
  return Array.isArray(rows) ? rows : []
}

export function rosterForOwner(rosters: SleeperRosterRow[], ownerId: string | null): SleeperRosterRow | undefined {
  if (!ownerId) return undefined
  return rosters.find((r) => r.owner_id === ownerId)
}
