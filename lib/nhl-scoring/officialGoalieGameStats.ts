/** Official NHL game-level goalie stats absent from the Rolling Insights goalie box. */
import { normalizeTeamAbbr } from '@/lib/player-identity/playerIdentityResolution'

export const OFFICIAL_GOALIE_SOURCE = 'nhl_stats_rest_goalie_summary_v1'

export type OfficialNhlGoalieGame = {
  gameDate: string; gameId: number; playerId: number; goalieFullName: string
  teamAbbrev: string; opponentTeamAbbrev: string; saves: number; goalsAgainst: number
  goals: number; assists: number; penaltyMinutes: number
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const key = (value: string) => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '')
const nonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

export function matchOfficialNhlGoalieGame(box: { date: string; team: string; opponent: string;
  playerName: string; saves: number; goalsAgainst: number }, rows: OfficialNhlGoalieGame[]):
  { row: OfficialNhlGoalieGame; reason: null } | { row: null; reason: string } {
  const matches = rows.filter((row) => row.gameDate === box.date &&
    normalizeTeamAbbr(row.teamAbbrev, 'NHL') === normalizeTeamAbbr(box.team, 'NHL') &&
    normalizeTeamAbbr(row.opponentTeamAbbrev, 'NHL') === normalizeTeamAbbr(box.opponent, 'NHL') &&
    key(row.goalieFullName) === key(box.playerName))
  if (matches.length !== 1) return { row: null,
    reason: matches.length ? 'ambiguous_official_player' : 'official_player_missing' }
  const row = matches[0]!
  if (!nonNegative(row.gameId) || row.gameId === 0 || !nonNegative(row.playerId) || row.playerId === 0 ||
    !nonNegative(row.saves) || !nonNegative(row.goalsAgainst) ||
    row.saves !== box.saves || row.goalsAgainst !== box.goalsAgainst ||
    !nonNegative(row.goals) || !nonNegative(row.assists) || !nonNegative(row.penaltyMinutes))
    return { row: null, reason: 'official_game_stat_conflict' }
  return { row, reason: null }
}

/** Retain a verified official trio only when the refreshed RI game identity and core box agree. */
export function carryOfficialNhlGoalieStats(existing: {
  normalizedStatMap: unknown; providerGameId: string | null; gameDate: Date | null;
  team: string | null; opponent: string | null
} | undefined, next: Record<string, unknown>, identity: {
  providerGameId: string; gameDate: Date | null; team: string | null; opponent: string | null
}): Record<string, unknown> {
  if (!existing || existing.providerGameId !== identity.providerGameId ||
    !existing.gameDate || !identity.gameDate ||
    existing.gameDate.toISOString().slice(0, 10) !== identity.gameDate.toISOString().slice(0, 10) ||
    normalizeTeamAbbr(existing.team, 'NHL') !== normalizeTeamAbbr(identity.team, 'NHL') ||
    normalizeTeamAbbr(existing.opponent, 'NHL') !== normalizeTeamAbbr(identity.opponent, 'NHL')) return next
  const old = record(existing.normalizedStatMap), oldStats = record(old?.stats), nextStats = record(next.stats)
  const proof = record(old?.officialGoalieGameStats)
  if (!oldStats || !nextStats || proof?.source !== OFFICIAL_GOALIE_SOURCE ||
    proof.gameDate !== identity.gameDate.toISOString().slice(0, 10) ||
    !nonNegative(proof.gameId) || !nonNegative(proof.playerId) ||
    nextStats.saves !== oldStats.saves || nextStats.goals_allowed !== oldStats.goals_allowed ||
    !nonNegative(oldStats.goalie_goals) || !nonNegative(oldStats.goalie_assists) ||
    !nonNegative(oldStats.goalie_penalty_minutes)) return next
  return { ...next, stats: { ...nextStats, goalie_goals: oldStats.goalie_goals,
    goalie_assists: oldStats.goalie_assists, goalie_penalty_minutes: oldStats.goalie_penalty_minutes },
  officialGoalieGameStats: proof }
}

/** Paginate one date with stable game/player order; refuse incomplete or duplicate responses. */
export async function fetchOfficialNhlGoalieDay(date: string, fetchImpl: typeof fetch = fetch,
  deadlineAt?: number): Promise<OfficialNhlGoalieGame[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_NHL_DATE')
  const rows: OfficialNhlGoalieGame[] = []
  let total: number | null = null
  while (total === null || rows.length < total) {
    const url = new URL('https://api.nhle.com/stats/rest/en/goalie/summary')
    url.searchParams.set('isAggregate', 'false')
    url.searchParams.set('isGame', 'true')
    url.searchParams.set('cayenneExp', `gameDate="${date}"`)
    url.searchParams.set('sort', JSON.stringify([
      { property: 'gameId', direction: 'ASC' }, { property: 'playerId', direction: 'ASC' },
    ]))
    url.searchParams.set('limit', '100')
    url.searchParams.set('start', String(rows.length))
    let response: Response | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const remaining = deadlineAt == null ? 15_000 : deadlineAt - Date.now()
      if (remaining <= 1000) throw new Error('NHL_OFFICIAL_DEADLINE')
      response = await fetchImpl(url, { headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(Math.min(15_000, remaining)) })
      if (response.status !== 429) break
      if (attempt === 4) throw new Error('NHL_OFFICIAL_HTTP_429')
      const retryAfter = Number(response.headers.get('retry-after'))
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000) : Math.min(2000 * 2 ** attempt, 30_000)
      if (deadlineAt != null && Date.now() + delay + 1000 >= deadlineAt)
        throw new Error('NHL_OFFICIAL_DEADLINE')
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (!response?.ok) throw new Error(`NHL_OFFICIAL_HTTP_${response?.status ?? 'NO_RESPONSE'}`)
    const body = await response.json() as { data?: unknown; total?: unknown }
    if (!Array.isArray(body.data) || !nonNegative(body.total) || body.total > 1000 ||
      (total !== null && body.total !== total) || body.data.length > 100 ||
      (body.data.length === 0 && rows.length < body.total)) throw new Error('NHL_OFFICIAL_PAGE_INCOMPLETE')
    total = body.total
    for (const item of body.data) {
      const row = record(item)
      if (!row || row.gameDate !== date || typeof row.goalieFullName !== 'string' ||
        typeof row.teamAbbrev !== 'string' || typeof row.opponentTeamAbbrev !== 'string' ||
        !nonNegative(row.gameId) || !nonNegative(row.playerId) || !nonNegative(row.saves) ||
        !nonNegative(row.goalsAgainst) || !nonNegative(row.goals) || !nonNegative(row.assists) ||
        !nonNegative(row.penaltyMinutes)) throw new Error('NHL_OFFICIAL_ROW_INVALID')
      rows.push(row as OfficialNhlGoalieGame)
    }
    if (rows.length > total) throw new Error('NHL_OFFICIAL_PAGE_OVERFLOW')
  }
  if (new Set(rows.map((row) => `${row.gameId}:${row.playerId}`)).size !== rows.length)
    throw new Error(`NHL_OFFICIAL_DUPLICATE_ROW:${date}`)
  return rows
}
