import { listDramaEvents } from '@/lib/drama-engine/DramaQueryService'
import { listRivalries } from '@/lib/rivalry-engine/RivalryQueryService'
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

  /*
   * Storylines rank on what happened — rivalry and drama scores. A "behaviour heat" boost built from the
   * managers' personality-profile trait scores was removed 2026-11-19 with the profile engine (re-score build
   * item 10): a label about a person, under the owner's facts-not-labels rule, even when it only ranked.
   */

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

    const score = clamp0to100(rivalry.rivalryScore * 0.62 + (topDrama?.dramaScore ?? 0) * 0.28)

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

    storylines.push({
      id: `drama:${event.id}`,
      headline: event.headline,
      sport: event.sport,
      season: event.season,
      storylineScore: clamp0to100(event.dramaScore * 0.9),
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
