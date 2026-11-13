import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

export type AiPlayerComparisonBridgeParams = {
  sport?: string | null
  leagueId?: string | null
  teamId?: string | null
  week?: string | number | null
  playerA?: string | null
  playerB?: string | null
  strategyMode?: string | null
}

/**
 * Deep link into the premium Start A vs B decision tool (also used from Chimmy).
 */
export function buildAiPlayerCompareToolUrl(params: AiPlayerComparisonBridgeParams = {}): string {
  const sport = normalizeToSupportedSport(params.sport) ?? DEFAULT_SPORT
  const q = new URLSearchParams()
  q.set('sport', sport)
  if (params.leagueId) q.set('leagueId', params.leagueId)
  if (params.teamId) q.set('teamId', params.teamId)
  if (params.week != null && params.week !== '') q.set('week', String(params.week))
  if (params.playerA?.trim()) q.set('playerA', params.playerA.trim())
  if (params.playerB?.trim()) q.set('playerB', params.playerB.trim())
  if (params.strategyMode?.trim()) q.set('strategyMode', params.strategyMode.trim())
  return `/tools/player-decision?${q.toString()}`
}

