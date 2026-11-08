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
  computeStartupDraftCapacity,
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
  /*
   * 🛑 A DYNASTY STARTUP DRAFT FILLS THE ACTIVE ROSTER, NOT TAXI AND IR. League creation already caps it
   * (`computeStartupDraftCapacity`, `executeCanonicalLeagueCreation`): a draft that also fills taxi
   * hands every team more players than its active limit, and from then on every trade that adds a
   * player is refused for exceeding it. This helper is what a commissioner's roster edit re-runs, and it
   * counted taxi — so adding ONE bench spot before the draft took a 12-team startup from 24 rounds to 35
   * (dynasty simulation, 2026-11-08). Same cap here, so both paths agree.
   */
  const rounds = countsTaxiAndDevy
    ? Math.max(1, Math.min(breakdown.rounds, computeStartupDraftCapacity(payload.template.slots)))
    : breakdown.rounds
  return { ...breakdown, rounds, countsTaxiAndDevy }
}
