/**
 * The league's expanded starter slots — ONE definition for the screen and the server.
 *
 * GET /api/league/roster hands the lineup screen `starterSlots`, and a saved starter's `slotIndex`
 * (lib/league/lineupSlotPositions.ts) is an index into exactly that list. The lineup engine validates
 * each positioned starter against his slot, so it must expand the SAME list, or a legal save would be
 * refused (or an illegal one admitted). An NFL/NCAAF core redraft league uses the locked redraft
 * starter order rather than its stored template; every other league expands its template.
 *
 * 🛑 THE LOCKED ORDER IS THE LEAGUE'S OWN SAVED LAYOUT WHEN IT HAS ONE (owner, 2026-10-20). Only a
 * league with no saved layout gets the default contract's order. Without this, a league saved with
 * QB, RB, WR, WR, TE, DEF was shown (and validated against) the full default, with empty FLEX / K
 * slots. "Has a saved layout" is lib/redraft-core-contract/savedRosterLayout.ts — the same test the
 * draft-page repair uses — so the screen, the engine and the repair cannot disagree.
 */
import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'
import { expandStarterSlots, type ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { getRedraftDefaultContract, type RedraftDefaultContract } from '@/lib/league-concepts/redraftDefaults'
import { isNflRedraftCoreDashboardLeague, type NflRedraftCoreLeagueShape } from '@/lib/league/is-nfl-redraft-core-dashboard'
import {
  allowedPositionsForCanonicalSlot,
  isFlexibleCanonicalSlot,
  readSavedRosterLayout,
} from '@/lib/redraft-core-contract/savedRosterLayout'

export type LineupSlotLeague = NflRedraftCoreLeagueShape & { settings?: unknown }

/** Display name for a canonical slot token: `FLX` reads as FLEX, `SF` as SUPERFLEX. */
function slotLabelKey(raw: string): string {
  return raw === 'FLX' ? 'FLEX' : raw === 'SF' ? 'SUPERFLEX' : raw
}

/** Expand the locked redraft starter order (`FLX` reads as FLEX; repeated slots are numbered). */
export function expandLockedRedraftStarterSlots(order: string[]): ExpandedStarterSlot[] {
  const totals = order.reduce<Record<string, number>>((acc, raw) => {
    const key = slotLabelKey(raw)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  const seen: Record<string, number> = {}

  return order.map((raw, index) => {
    const key = slotLabelKey(raw)
    seen[key] = (seen[key] ?? 0) + 1

    return {
      index,
      label: totals[key] > 1 ? `${key}${seen[key]}` : key,
      allowedPositions: allowedPositionsForCanonicalSlot(raw === 'FLEX' ? 'FLX' : raw),
      isFlexible: isFlexibleCanonicalSlot(raw === 'FLEX' ? 'FLX' : raw),
    }
  })
}

function settingsRecordOf(league: LineupSlotLeague): Record<string, unknown> {
  return league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
    ? (league.settings as Record<string, unknown>)
    : {}
}

/** The locked redraft DEFAULT contract when this league uses the locked shell, else null. */
export function resolveLockedRedraftLineupContract(league: LineupSlotLeague): RedraftDefaultContract | null {
  if (!isNflRedraftCoreDashboardLeague(league)) return null
  const settingsRecord = settingsRecordOf(league)
  return getRedraftDefaultContract({
    sport: league.sport,
    draftType: settingsRecord.requested_draft_type ?? settingsRecord.draft_type ?? 'snake',
    scoringPresetId: typeof settingsRecord.scoring_preset_id === 'string' ? settingsRecord.scoring_preset_id : null,
  })
}

export type LockedRedraftStarterLayout = {
  /** One canonical token per starter slot, in display order (QB, RB, …, FLX, K, DEF). */
  starterOrder: string[]
  benchSlots: number
  irSlots: number
  /** Positions the starter slots accept, for the screen's player filter. */
  starterAllowedPositions: string[]
  /** 'saved' — the league's own layout; 'default' — the redraft contract (no saved layout). */
  source: 'saved' | 'default'
}

/**
 * The locked starter layout for an NFL/NCAAF core redraft league — its saved layout when it has one,
 * else the default contract — or null when the league does not use the locked shell.
 */
export function resolveLockedRedraftStarterLayout(league: LineupSlotLeague): LockedRedraftStarterLayout | null {
  const contract = resolveLockedRedraftLineupContract(league)
  if (!isNflRedraftCoreDashboardLeague(league)) return null
  const layoutSport = String(league.sport ?? '').toUpperCase() === 'NCAAF' ? 'NCAAF' : 'NFL'
  const saved = readSavedRosterLayout(layoutSport, settingsRecordOf(league))
  if (saved && saved.starterOrder.length > 0) {
    const slots = expandLockedRedraftStarterSlots(saved.starterOrder)
    return {
      starterOrder: saved.starterOrder,
      benchSlots: saved.benchSlots ?? contract?.rosterTemplate.benchSlots ?? 0,
      irSlots: saved.irSlots ?? contract?.rosterTemplate.irSlots ?? 0,
      starterAllowedPositions: [...new Set(slots.flatMap((slot) => slot.allowedPositions))],
      source: 'saved',
    }
  }
  if (!contract) return null
  return {
    starterOrder: [...contract.rosterTemplate.starterSlotOrder],
    benchSlots: contract.rosterTemplate.benchSlots,
    irSlots: contract.rosterTemplate.irSlots,
    starterAllowedPositions: [...contract.rosterTemplate.draftablePlayerPositions],
    source: 'default',
  }
}

export function resolveLineupStarterSlots(league: LineupSlotLeague, template: RosterTemplateDto | null | undefined): ExpandedStarterSlot[] {
  const layout = resolveLockedRedraftStarterLayout(league)
  if (layout) return expandLockedRedraftStarterSlots(layout.starterOrder)
  return template && Array.isArray(template.slots) ? expandStarterSlots(template) : []
}
