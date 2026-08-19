import {
  computeDraftRecommendation,
  type RecommendationPlayer,
} from '@/lib/draft-helper/RecommendationEngine'

export type RedraftWarRoomPlayer = RecommendationPlayer & {
  playerId?: string | null
  sport?: string | null
  projectedFantasyPoints?: number | null
  restOfSeasonProjection?: number | null
  projectionConfidence?: number | null
  injuryStatus?: string | null
  eligible?: boolean | null
}

export type RedraftWarRoomSuggestionInput = {
  availablePlayers: RedraftWarRoomPlayer[]
  draftedPlayerIds?: Iterable<string | null | undefined>
  draftedPlayerNames?: Iterable<string | null | undefined>
  teamRoster: Array<{ position: string; team?: string | null; byeWeek?: number | null }>
  rosterSlots?: string[]
  round: number
  pick: number
  totalTeams: number
  sport: string
  isSuperflex?: boolean
  scoringMode?: 'needs' | 'bpa'
}

export type RedraftWarRoomSuggestionOutput = {
  bestPick: RedraftWarRoomPlayer | null
  alternatives: RedraftWarRoomPlayer[]
  warnings: string[]
  missingDataLabels: string[]
  evidence: string[]
  excludedCount: number
  fallback: boolean
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function playerKey(player: Pick<RedraftWarRoomPlayer, 'name' | 'position' | 'team'>): string {
  return `${normalizeName(player.name)}|${String(player.position ?? '').toUpperCase()}|${String(player.team ?? '').toUpperCase()}`
}

function findOriginal(pool: RedraftWarRoomPlayer[], player: RecommendationPlayer): RedraftWarRoomPlayer | null {
  const key = playerKey(player)
  return pool.find((row) => playerKey(row) === key) ?? null
}

function toWarRoomPlayer(player: RecommendationPlayer): RedraftWarRoomPlayer {
  return { ...player }
}

function isOut(status: string | null | undefined): boolean {
  const value = String(status ?? '').toLowerCase()
  return value.includes('out') || value.includes('ir') || value.includes('suspend')
}

export function buildRedraftWarRoomSuggestions(input: RedraftWarRoomSuggestionInput): RedraftWarRoomSuggestionOutput {
  const draftedIds = new Set(Array.from(input.draftedPlayerIds ?? []).filter(Boolean).map(String))
  const draftedNames = new Set(Array.from(input.draftedPlayerNames ?? []).filter(Boolean).map((name) => normalizeName(String(name))))
  const sport = String(input.sport ?? '').toUpperCase()
  let excludedCount = 0

  const legalPool = input.availablePlayers.filter((player) => {
    if (player.playerId && draftedIds.has(player.playerId)) {
      excludedCount += 1
      return false
    }
    if (draftedNames.has(normalizeName(player.name))) {
      excludedCount += 1
      return false
    }
    if (player.eligible === false) {
      excludedCount += 1
      return false
    }
    if (player.sport && sport && String(player.sport).toUpperCase() !== sport) {
      excludedCount += 1
      return false
    }
    return true
  })

  const recommendation = computeDraftRecommendation({
    available: legalPool,
    teamRoster: input.teamRoster,
    rosterSlots: input.rosterSlots ?? [],
    round: input.round,
    pick: input.pick,
    totalTeams: input.totalTeams,
    sport: input.sport,
    isSF: Boolean(input.isSuperflex),
    mode: input.scoringMode === 'bpa' ? 'bpa' : 'needs',
  })

  const bestPick = recommendation.recommendation
    ? findOriginal(legalPool, recommendation.recommendation.player) ?? toWarRoomPlayer(recommendation.recommendation.player)
    : null
  const alternatives = recommendation.alternatives
    .map((alt) => findOriginal(legalPool, alt.player))
    .filter((row): row is RedraftWarRoomPlayer => Boolean(row))

  const warnings: string[] = []
  if (bestPick?.injuryStatus) warnings.push(`${bestPick.name} injury status: ${bestPick.injuryStatus}`)
  if (isOut(bestPick?.injuryStatus)) warnings.push('Recommended player is OUT or unavailable; use the next alternative.')
  if (bestPick?.byeWeek != null) warnings.push(`${bestPick.name} bye week: ${bestPick.byeWeek}`)

  const missingDataLabels: string[] = []
  if (legalPool.some((player) => player.adp == null)) missingDataLabels.push('ADP fallback used for part of the pool')
  if (legalPool.some((player) => player.projectedFantasyPoints == null)) missingDataLabels.push('Weekly projection missing for part of the pool')
  if (legalPool.some((player) => player.projectionConfidence == null)) missingDataLabels.push('Projection confidence missing for part of the pool')

  return {
    bestPick,
    alternatives,
    warnings,
    missingDataLabels,
    evidence: recommendation.evidence,
    excludedCount,
    fallback: recommendation.recommendation == null,
  }
}
