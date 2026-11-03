/**
 * Dynasty League home extras — pure shaping for the championship rafters, the pick capital module
 * and the pipeline module. No I/O; the `dynasty-hub` handler reads the rows and these decide what
 * is shown.
 *
 * Real data only. Every number here is a count of stored rows; nothing is estimated, and a module
 * whose source is empty returns null so the surface hides it.
 */

// ---------------------------------------------------------------- championship rafters

/** One stored champion row from `league_seasons` (imported history and native rollover). */
export type SeasonChampionRow = {
  season: number
  championName: string | null
  /** The champion LeagueTeam's owner ids, when `championTeamId` resolved to a team. */
  championTeamUserIds: Array<string | null>
  championTeamName: string | null
}

/** One stored row from `league_championships` (native playoff runtime, Guilly, Survivor). */
export type ChampionshipRow = {
  season: number
  championUserId: string
  teamName: string | null
}

export type ChampionPennant = {
  season: number
  /** Manager or team name as stored; null only when the row names nobody. */
  label: string | null
  /** True when the stored champion is the viewer. */
  mine: boolean
}

export type ChampionRafters = {
  pennants: ChampionPennant[]
  /** The current season, shown as an open pennant, when it has no champion yet. */
  openSeason: number | null
  myTitles: number
}

/**
 * Past champions, oldest first. `league_championships` carries the champion's user id, so it wins
 * for its season; a `league_seasons` row is "mine" when its champion team is owned by the viewer.
 * Returns null when no season has a recorded champion — the rafters hide rather than show only an
 * empty pennant.
 */
export function buildChampionRafters(input: {
  seasons: SeasonChampionRow[]
  championships: ChampionshipRow[]
  viewerUserId: string | null
  currentSeason: number | null
}): ChampionRafters | null {
  const bySeason = new Map<number, ChampionPennant>()
  const viewer = input.viewerUserId
  for (const row of input.seasons) {
    if (!Number.isInteger(row.season)) continue
    const label = clean(row.championName) ?? clean(row.championTeamName)
    const resolved = row.championTeamUserIds.some((id) => !!id)
    if (!label && !resolved) continue
    bySeason.set(row.season, {
      season: row.season,
      label,
      mine: !!viewer && row.championTeamUserIds.some((id) => id === viewer),
    })
  }
  for (const row of input.championships) {
    if (!Number.isInteger(row.season) || !row.championUserId) continue
    const prior = bySeason.get(row.season)
    bySeason.set(row.season, {
      season: row.season,
      label: clean(row.teamName) ?? prior?.label ?? null,
      mine: !!viewer && row.championUserId === viewer,
    })
  }
  if (bySeason.size === 0) return null
  const pennants = [...bySeason.values()].sort((a, b) => a.season - b.season)
  const current = input.currentSeason
  const openSeason =
    current != null && Number.isInteger(current) && !bySeason.has(current) && current > pennants[pennants.length - 1]!.season
      ? current
      : null
  return { pennants, openSeason, myTitles: pennants.filter((p) => p.mine).length }
}

function clean(value: string | null | undefined): string | null {
  const v = typeof value === 'string' ? value.trim() : ''
  return v ? v : null
}

// ---------------------------------------------------------------- pick capital

export type HubPick = {
  id: string
  year: number
  round: number
  fromTeam: string | null
  type: 'own' | 'traded_away' | 'incoming'
}

export type PickCapitalSummary = {
  total: number
  /** Distinct draft years the picks span. */
  years: number
  chips: HubPick[]
  more: number
}

/** The viewer's held picks (not traded away), soonest first, first-rounders ahead within a year. */
export function summarizePickCapital(picks: HubPick[], maxChips = 5): PickCapitalSummary | null {
  const held = picks
    .filter((p) => p.type !== 'traded_away' && Number.isInteger(p.year) && Number.isInteger(p.round))
    .slice()
    .sort((a, b) => a.year - b.year || a.round - b.round)
  if (held.length === 0) return null
  const chips = held.slice(0, Math.max(0, maxChips))
  return { total: held.length, years: new Set(held.map((p) => p.year)).size, chips, more: held.length - chips.length }
}

// ---------------------------------------------------------------- pipeline

export type PipelinePlayer = {
  playerId: string
  lineupSection?: 'starters' | 'bench' | 'ir' | 'taxi' | 'devy'
}

export type PipelineSummary = {
  taxi: { count: number; slots: number } | null
  devy: { count: number } | null
  /**
   * Rookies are players with known `SportsPlayer.yearsExp === 0`. `unknown` counts rostered pros
   * whose experience is not on file — an unknown is never counted as a rookie. Null when no rostered
   * pro has known experience, so the row says "not on file" instead of a confident zero.
   */
  rookies: { count: number; unknown: number } | null
  rookiesUnknownOnly: number
}

/**
 * Counts from the viewer's own roster. Taxi shows when the league has taxi slots or the roster has
 * taxi players; devy shows when the league runs devy or the roster holds devy players. Returns null
 * when nothing would show — a card that could only say "experience not on file" is hidden.
 */
export function summarizePipeline(input: {
  players: PipelinePlayer[]
  taxiSlots: number
  leagueHasDevy: boolean
  yearsExpByPlayerId: Map<string, number>
}): PipelineSummary | null {
  const taxiCount = input.players.filter((p) => p.lineupSection === 'taxi').length
  const devyCount = input.players.filter((p) => p.lineupSection === 'devy').length
  const pros = input.players.filter((p) => p.lineupSection !== 'devy')
  let rookies = 0
  let unknown = 0
  for (const p of pros) {
    const years = input.yearsExpByPlayerId.get(p.playerId)
    if (years == null) unknown += 1
    else if (years === 0) rookies += 1
  }
  const known = pros.length - unknown
  const slots = Number.isFinite(input.taxiSlots) && input.taxiSlots > 0 ? Math.floor(input.taxiSlots) : 0
  const summary: PipelineSummary = {
    taxi: slots > 0 || taxiCount > 0 ? { count: taxiCount, slots } : null,
    devy: input.leagueHasDevy || devyCount > 0 ? { count: devyCount } : null,
    rookies: known > 0 ? { count: rookies, unknown } : null,
    rookiesUnknownOnly: known > 0 ? 0 : unknown,
  }
  if (!summary.taxi && !summary.devy && !summary.rookies) return null
  return summary
}

/** Devy runs in these league variants/types (the same set the War Room treats as dynasty-devy). */
export function leagueRunsDevy(league: { leagueVariant?: string | null; leagueType?: string | null }): boolean {
  const variant = String(league.leagueVariant ?? '').toLowerCase()
  const type = String(league.leagueType ?? '').toLowerCase()
  return ['devy_dynasty', 'merged_devy_c2c', 'devy', 'c2c'].includes(variant) || ['devy', 'c2c'].includes(type)
}
