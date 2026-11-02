/** Official NHL game-level skater stats used to complete observed fantasy game boxes. */
import { normalizeTeamAbbr } from '@/lib/player-identity/playerIdentityResolution'
export type OfficialNhlSkaterGame = {
  gameDate: string
  gameId: number
  playerId: number
  skaterFullName: string
  teamAbbrev: string
  opponentTeamAbbrev: string
  goals: number
  gameWinningGoals: number
}

export type NhlBoxIdentity = {
  date: string
  team: string
  opponent: string
  playerName: string
  goals: number
}

type ExistingNhlBox = {
  normalizedStatMap: unknown
  providerGameId: string | null
  gameDate: Date | null
  team: string | null
  opponent: string | null
}

/** Carry a verified official value through an RI refresh only while its game join remains valid. */
export function carryOfficialNhlGameWinningGoals(existing: ExistingNhlBox | undefined,
  next: Record<string, unknown>, nextIdentity: {
    providerGameId: string; gameDate: Date | null; team: string | null; opponent: string | null
  }): Record<string, unknown> {
  if (!existing || existing.providerGameId !== nextIdentity.providerGameId ||
    !existing.gameDate || !nextIdentity.gameDate ||
    existing.gameDate.toISOString().slice(0, 10) !== nextIdentity.gameDate.toISOString().slice(0, 10) ||
    normalizeTeamAbbr(existing.team, 'NHL') !== normalizeTeamAbbr(nextIdentity.team, 'NHL') ||
    normalizeTeamAbbr(existing.opponent, 'NHL') !== normalizeTeamAbbr(nextIdentity.opponent, 'NHL')) return next
  const prior = existing.normalizedStatMap && typeof existing.normalizedStatMap === 'object' &&
    !Array.isArray(existing.normalizedStatMap) ? existing.normalizedStatMap as Record<string, unknown> : null
  const priorStats = prior?.stats && typeof prior.stats === 'object' && !Array.isArray(prior.stats) ?
    prior.stats as Record<string, unknown> : null
  const nextStats = next.stats && typeof next.stats === 'object' && !Array.isArray(next.stats) ?
    next.stats as Record<string, unknown> : null
  const proof = prior?.officialGameWinningGoals && typeof prior.officialGameWinningGoals === 'object' &&
    !Array.isArray(prior.officialGameWinningGoals) ? prior.officialGameWinningGoals as Record<string, unknown> : null
  const goals = nextStats?.goals
  const winningGoals = priorStats?.game_winning_goals
  if (!nextStats || !priorStats || proof?.source !== 'nhl_stats_rest_game_summary_v1' ||
    proof.gameDate !== nextIdentity.gameDate.toISOString().slice(0, 10) ||
    !Number.isInteger(proof.gameId) || !Number.isInteger(proof.playerId) ||
    !Number.isInteger(goals) || goals !== priorStats.goals ||
    !Number.isInteger(winningGoals) || (winningGoals as number) < 0 ||
    (winningGoals as number) > 1 || (winningGoals as number) > (goals as number)) return next
  return { ...next, stats: { ...nextStats, game_winning_goals: winningGoals },
    officialGameWinningGoals: proof }
}

const nameKey = (value: string) => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '')

/** Reject ambiguous or conflicting identity/game joins; never infer a zero from no match. */
export function matchOfficialNhlSkaterGame(box: NhlBoxIdentity, rows: OfficialNhlSkaterGame[]):
  { row: OfficialNhlSkaterGame; reason: null } | { row: null; reason: string } {
  const matches = rows.filter((row) => row.gameDate === box.date &&
    normalizeTeamAbbr(row.teamAbbrev, 'NHL') === normalizeTeamAbbr(box.team, 'NHL') &&
    normalizeTeamAbbr(row.opponentTeamAbbrev, 'NHL') === normalizeTeamAbbr(box.opponent, 'NHL') &&
    nameKey(row.skaterFullName) === nameKey(box.playerName))
  if (matches.length !== 1) return { row: null, reason: matches.length ? 'ambiguous_official_player' : 'official_player_missing' }
  const row = matches[0]!
  if (!Number.isInteger(row.gameId) || row.gameId < 1 || !Number.isInteger(row.playerId) || row.playerId < 1 ||
    !Number.isInteger(row.goals) || row.goals < 0 || row.goals !== box.goals ||
    !Number.isInteger(row.gameWinningGoals) || row.gameWinningGoals < 0 || row.gameWinningGoals > 1 ||
    row.gameWinningGoals > row.goals)
    return { row: null, reason: 'official_game_stat_conflict' }
  return { row, reason: null }
}

type OfficialResponse = { data?: unknown; total?: unknown }

/** Paginate a single date from the NHL's public game-level skater summary. */
export async function fetchOfficialNhlSkaterDay(date: string, fetchImpl: typeof fetch = fetch,
  deadlineAt?: number):
  Promise<OfficialNhlSkaterGame[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_NHL_DATE')
  const limit = 100
  const rows: OfficialNhlSkaterGame[] = []
  let total: number | null = null
  while (total === null || rows.length < total) {
    const url = new URL('https://api.nhle.com/stats/rest/en/skater/summary')
    url.searchParams.set('isAggregate', 'false')
    url.searchParams.set('isGame', 'true')
    url.searchParams.set('cayenneExp', `gameDate="${date}"`)
    // Explicit ordering is required: the API's default order can overlap pages.
    url.searchParams.set('sort', JSON.stringify([
      { property: 'gameId', direction: 'ASC' },
      { property: 'playerId', direction: 'ASC' },
    ]))
    url.searchParams.set('limit', String(limit))
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
    if (!response) throw new Error('NHL_OFFICIAL_NO_RESPONSE')
    if (!response.ok) throw new Error(`NHL_OFFICIAL_HTTP_${response.status}`)
    const body = await response.json() as OfficialResponse
    if (!Array.isArray(body.data) || !Number.isInteger(body.total) ||
      (body.total as number) < 0 || (body.total as number) > 1000 ||
      (total !== null && body.total !== total) ||
      body.data.length > limit || (body.data.length === 0 && rows.length < (body.total as number)))
      throw new Error('NHL_OFFICIAL_PAGE_INCOMPLETE')
    total = body.total as number
    for (const item of body.data) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('NHL_OFFICIAL_ROW_INVALID')
      const row = item as Record<string, unknown>
      if (row.gameDate !== date || typeof row.skaterFullName !== 'string' ||
        typeof row.teamAbbrev !== 'string' || typeof row.opponentTeamAbbrev !== 'string' ||
        typeof row.gameId !== 'number' || typeof row.playerId !== 'number' ||
        typeof row.goals !== 'number' || typeof row.gameWinningGoals !== 'number')
        throw new Error('NHL_OFFICIAL_ROW_INVALID')
      rows.push(row as OfficialNhlSkaterGame)
    }
    if (rows.length > total) throw new Error('NHL_OFFICIAL_PAGE_OVERFLOW')
  }
  const unique = new Set(rows.map((row) => `${row.gameId}:${row.playerId}`))
  if (unique.size !== rows.length) throw new Error(`NHL_OFFICIAL_DUPLICATE_ROW:${date}`)
  return rows
}
