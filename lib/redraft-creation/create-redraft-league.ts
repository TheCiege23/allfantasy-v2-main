/**
 * Only export left in this file. `createRedraftLeagueInTransaction` (the
 * standalone "create a redraft league up front" pipeline this file used to
 * hold) was removed 2026-09-06: it backed `lib/redraft-creation/post-redraft-create.ts`
 * and two routes (`/api/leagues/redraft/create`, `/api/league/create/redraft`)
 * with zero frontend callers — `RedraftSeason`/`RedraftRoster` are actually
 * materialized post-draft, via `syncCompletedDraftToRedraftSeason`, not at
 * league-creation time. This helper survived because
 * `lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts` (the
 * pipeline the live `/create-league` UI actually calls) imports it directly.
 */
import type { LeagueSport, SoccerPipelineVariant } from '@prisma/client'
import type { SoccerPipeline } from '@/lib/redraft-creation/sport-config'

export function soccerPipelineToPrismaVariant(
  sport: LeagueSport,
  pipeline: SoccerPipeline | null
): SoccerPipelineVariant | null {
  if (sport !== 'SOCCER' || !pipeline) return null
  return pipeline === 'mls' ? 'MLS' : 'EURO'
}
