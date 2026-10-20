/**
 * The league's expanded starter slots — ONE definition for the screen and the server.
 *
 * GET /api/league/roster hands the lineup screen `starterSlots`, and a saved starter's `slotIndex`
 * (lib/league/lineupSlotPositions.ts) is an index into exactly that list. The lineup engine validates
 * each positioned starter against his slot, so it must expand the SAME list, or a legal save would be
 * refused (or an illegal one admitted). An NFL/NCAAF core redraft league uses the locked default
 * starter order rather than its stored template; every other league expands its template.
 */
import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'
import { expandStarterSlots, type ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { getRedraftDefaultContract, type RedraftDefaultContract } from '@/lib/league-concepts/redraftDefaults'
import { isNflRedraftCoreDashboardLeague, type NflRedraftCoreLeagueShape } from '@/lib/league/is-nfl-redraft-core-dashboard'

export type LineupSlotLeague = NflRedraftCoreLeagueShape & { settings?: unknown }

/** Expand the locked redraft starter order (`FLX` reads as FLEX; repeated slots are numbered). */
export function expandLockedRedraftStarterSlots(order: string[]): ExpandedStarterSlot[] {
  const totals = order.reduce<Record<string, number>>((acc, raw) => {
    const key = raw === 'FLX' ? 'FLEX' : raw
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  const seen: Record<string, number> = {}

  return order.map((raw, index) => {
    const key = raw === 'FLX' ? 'FLEX' : raw
    seen[key] = (seen[key] ?? 0) + 1

    const label = totals[key] > 1 ? `${key}${seen[key]}` : key
    const allowedPositions =
      key === 'FLEX'
        ? ['RB', 'WR', 'TE']
        : key === 'DEF'
          ? ['DEF', 'DST', 'D/ST']
          : [key]

    return {
      index,
      label,
      allowedPositions,
      isFlexible: key === 'FLEX',
    }
  })
}

/** The locked redraft contract when this league uses it, else null. */
export function resolveLockedRedraftLineupContract(league: LineupSlotLeague): RedraftDefaultContract | null {
  if (!isNflRedraftCoreDashboardLeague(league)) return null
  const settingsRecord =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
  return getRedraftDefaultContract({
    sport: league.sport,
    draftType: settingsRecord.requested_draft_type ?? settingsRecord.draft_type ?? 'snake',
    scoringPresetId: typeof settingsRecord.scoring_preset_id === 'string' ? settingsRecord.scoring_preset_id : null,
  })
}

export function resolveLineupStarterSlots(league: LineupSlotLeague, template: RosterTemplateDto | null | undefined): ExpandedStarterSlot[] {
  const contract = resolveLockedRedraftLineupContract(league)
  if (contract) return expandLockedRedraftStarterSlots(contract.rosterTemplate.starterSlotOrder)
  return template && Array.isArray(template.slots) ? expandStarterSlots(template) : []
}
