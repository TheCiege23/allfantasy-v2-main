import { listDramaEvents } from '@/lib/drama-engine/DramaQueryService'
import { listRivalries } from '@/lib/rivalry-engine/RivalryQueryService'
import { buildBehaviorDramaContext } from './BehaviorDramaBridge'
import { normalizeOptionalSportForRelationship } from './SportRelationshipResolver'
import type { UnifiedStorylineRecord } from './types'

export interface UnifiedStorylineResolverInput {
  leagueId: string
  sport?: string | null
  season?: number | null
  limit?: number
}

function clamp0to100(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function overlapsAny(values: string[], targets: string[]): boolean {
  if (values.length === 0 || targets.length === 0) return false
  const set = new Set(values)
  return targets.some((t) => set.has(t))
}

function pairOverlapCount(values: string[], a: string, b: string): number {
  const set = new Set(values)
  let count = 0
  if (set.has(a)) count += 1
  if (set.has(b)) count += 1
  return count
}

export async function resolveUnifiedStorylines(
  input: UnifiedStorylineResolverInput
): Promise<UnifiedStorylineRecord[]> {
  const sport = normalizeOptionalSportForRelationship(input.sport)
  const [rivalries, dramaEvents] = await Promise.all([
    listRivalries(input.leagueId, {
      sport: sport ?? undefined,
      season: input.season ?? undefined,
      limit: 60,
    }),
    listDramaEvents(input.leagueId, {
      sport: sport ?? undefined,
      season: input.season ?? undefined,
      limit: 120,
    }),
  ])

  const managerIds = new Set<string>()
  rivalries.forEach((r) => {
    managerIds.add(r.managerAId)
    managerIds.add(r.managerBId)
  })
  dramaEvents.forEach((e) => e.relatedManagerIds.forEach((m) => managerIds.add(m)))

  const behaviorContext = await buildBehaviorDramaContext({
    leagueId: input.leagueId,
    sport: sport ?? undefined,
    season: input.season,
    managerIds: [...managerIds],
    limitPerManager: 3,
  })
  // Behaviour heat is built from profile trait scores, so it may rank storylines
  // but is never printed as a reason (Milestone 32: no characterisation reaches users).
  const behaviorHeatByManager = new Map(behaviorContext.map((row) => [row.managerId, row.behaviorHeat]))

  const storylines: UnifiedStorylineRecord[] = []
  const seenDrama = new Set<string>()

  for (const rivalry of rivalries) {
    const linkedDrama = dramaEvents
      .filter((event) => {
        const managerOverlap = pairOverlapCount(
          event.relatedManagerIds,
          rivalry.managerAId,
          rivalry.managerBId
        )
        if (managerOverlap >= 2) return true
        const teamOverlap = pairOverlapCount(
          event.relatedTeamIds,
          rivalry.managerAId,
          rivalry.managerBId
        )
        return teamOverlap >= 2
      })
      .sort((a, b) => b.dramaScore - a.dramaScore)

    const topDrama = linkedDrama[0] ?? null
    if (topDrama) seenDrama.add(topDrama.id)

    const behaviorHeat =
      ((behaviorHeatByManager.get(rivalry.managerAId) ?? 0) +
        (behaviorHeatByManager.get(rivalry.managerBId) ?? 0)) /
      2
    const score = clamp0to100(
      rivalry.rivalryScore * 0.62 +
        (topDrama?.dramaScore ?? 0) * 0.28 +
        Math.min(10, behaviorHeat * 0.1)
    )

    storylines.push({
      id: `rivalry:${rivalry.id}:${topDrama?.id ?? 'none'}`,
      headline: topDrama
        ? `${rivalry.managerAId} vs ${rivalry.managerBId}: ${topDrama.headline}`
        : `${rivalry.managerAId} vs ${rivalry.managerBId}: rivalry pressure rising`,
      sport: rivalry.sport,
      season: input.season ?? null,
      storylineScore: score,
      rivalryId: rivalry.id,
      rivalryTier: rivalry.rivalryTier,
      dramaEventId: topDrama?.id ?? null,
      dramaType: topDrama?.dramaType ?? null,
      managerAId: rivalry.managerAId,
      managerBId: rivalry.managerBId,
      relatedManagerIds: [rivalry.managerAId, rivalry.managerBId],
      relatedTeamIds: topDrama?.relatedTeamIds ?? [],
      reasons: [
        `Rivalry score ${Math.round(rivalry.rivalryScore)}`,
        ...(topDrama ? [`Linked drama ${topDrama.dramaType}`] : []),
      ],
    })
  }

  for (const event of dramaEvents) {
    if (seenDrama.has(event.id)) continue
    const hasRivalryOverlap = rivalries.some((r) => {
      return (
        overlapsAny(event.relatedManagerIds, [r.managerAId, r.managerBId]) ||
        overlapsAny(event.relatedTeamIds, [r.managerAId, r.managerBId])
      )
    })
    if (!hasRivalryOverlap) continue

    const behaviorHeat = event.relatedManagerIds.length
      ? event.relatedManagerIds.reduce((sum, id) => sum + (behaviorHeatByManager.get(id) ?? 0), 0) /
        event.relatedManagerIds.length
      : 0

    storylines.push({
      id: `drama:${event.id}`,
      headline: event.headline,
      sport: event.sport,
      season: event.season,
      storylineScore: clamp0to100(event.dramaScore * 0.9 + Math.min(10, behaviorHeat * 0.1)),
      rivalryId: null,
      rivalryTier: null,
      dramaEventId: event.id,
      dramaType: event.dramaType,
      managerAId: event.relatedManagerIds[0] ?? null,
      managerBId: event.relatedManagerIds[1] ?? null,
      relatedManagerIds: event.relatedManagerIds,
      relatedTeamIds: event.relatedTeamIds,
      reasons: [
        `Drama score ${Math.round(event.dramaScore)}`,
      ],
    })
  }

  storylines.sort((a, b) => b.storylineScore - a.storylineScore)
  return storylines.slice(0, input.limit ?? 25)
}
