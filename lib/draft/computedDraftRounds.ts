/**
 * lib/draft/computedDraftRounds.ts
 *
 * Server side of "rounds = draftable roster spots". Reads the league's EFFECTIVE roster template
 * (the same one the draft pool and pick validation use) and applies the pure rule in
 * `draftSettingsPolicy.computeDraftRoundsFromSlots`.
 */

import { prisma } from '@/lib/prisma'
import { getLeagueDraftTemplatePayload } from '@/lib/league/league-draft-template-payload'
import {
  computeDraftRoundsFromSlots,
  formatCountsTaxiAndDevy,
  type DraftRoundsBreakdown,
} from '@/lib/draft/draftSettingsPolicy'

export type ComputedDraftRounds = DraftRoundsBreakdown & { countsTaxiAndDevy: boolean }

/** Null when the league has no usable roster template (then the saved rounds stand). */
export async function getComputedDraftRounds(leagueId: string): Promise<ComputedDraftRounds | null> {
  const [payload, league] = await Promise.all([
    getLeagueDraftTemplatePayload(leagueId).catch(() => null),
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { isDynasty: true, leagueVariant: true, leagueType: true, settings: true },
    }),
  ])
  if (!payload?.template?.slots?.length || !league) return null
  const s = (league.settings ?? {}) as Record<string, unknown>
  const countsTaxiAndDevy = formatCountsTaxiAndDevy(
    [
      league.leagueVariant,
      league.leagueType,
      payload.formatType,
      typeof s.league_type === 'string' ? s.league_type : null,
      typeof s.leagueType === 'string' ? s.leagueType : null,
      typeof s.league_variant === 'string' ? s.league_variant : null,
    ],
    league.isDynasty,
  )
  const breakdown = computeDraftRoundsFromSlots(payload.template.slots, countsTaxiAndDevy)
  if (breakdown.rosterSpots <= 0) return null
  return { ...breakdown, countsTaxiAndDevy }
}
