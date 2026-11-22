import { listDramaEvents } from '@/lib/drama-engine/DramaQueryService'
import { normalizeOptionalSportForRelationship } from './SportRelationshipResolver'
import type { BehaviorDramaManagerContext } from './types'

export interface BehaviorDramaBridgeInput {
  leagueId: string
  sport?: string | null
  season?: number | null
  managerIds?: string[]
  limitPerManager?: number
}

function uniq(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))]
}

export async function buildBehaviorDramaContext(
  input: BehaviorDramaBridgeInput
): Promise<BehaviorDramaManagerContext[]> {
  const sport = normalizeOptionalSportForRelationship(input.sport)
  /*
   * Which drama involves each manager — facts only. Until 2026-11-19 this also read every manager's
   * personality profile and ranked them by a "behaviour heat" built from its trait scores; both went with the
   * profile engine (re-score build item 10). Without a list the profiles used to supply one; now the caller does.
   */
  const managers = uniq(input.managerIds ?? [])

  const rows = await Promise.all(
    managers.map(async (managerId) => {
      const dramaEvents = await listDramaEvents(input.leagueId, {
        sport: sport ?? undefined,
        season: input.season ?? undefined,
        relatedManagerId: managerId,
        limit: input.limitPerManager ?? 5,
      }).catch(() => [])
      return { managerId, dramaEvents }
    })
  )

  // Most drama first: the order the profile ranking used to impose, now from what happened.
  return rows.sort((a, b) => b.dramaEvents.length - a.dramaEvents.length)
}
