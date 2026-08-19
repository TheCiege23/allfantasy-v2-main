/**
 * Decision OS — Parity Gate binding for `manager.lineup.set` (Slice 1).
 *
 * The reusable keyed-diff engine lives in core (lib/decision-os/core/parity). This module supplies
 * the lineup key (slot+player) and the fields to compare (recommendation + suggested replacement),
 * keeping the lineup-specific result shape. Any diff is reported (and must be explained) — cutover/
 * legacy-retire only when `passed`.
 */
import type { LineupActionItem, LineupActionSummaryPayload } from '@/lib/lineup-actions/types'
import type { Decision } from '@/lib/decision-os/core/decision'
import { compareKeyedParity, type ShadowParityResult } from '@/lib/decision-os/core/parity'

export interface LineupParityResult extends ShadowParityResult {
  /** Lineup-domain alias of comparedKeys. */
  comparedSlots: number
}

function slotKey(a: LineupActionItem): string {
  return `${a.slotId ?? a.slotIndex ?? a.reasonType}:${a.playerId ?? ''}`
}

/**
 * Compare the Decision OS decision against the legacy summary (filtered to one league).
 */
export function compareLineupParity(
  decision: Decision<LineupActionItem>,
  legacy: LineupActionSummaryPayload,
  leagueId: string,
): LineupParityResult {
  const legacyActions = (legacy.actions ?? []).filter((a) => a.leagueId === leagueId)
  const result = compareKeyedParity(decision.recommended_actions, legacyActions, {
    keyOf: slotKey,
    entityLabel: 'slot',
    fields: [
      { label: 'recommendedAction', valueOf: (a) => a.recommendedAction },
      { label: 'suggested replacement', valueOf: (a) => a.suggestedReplacementPlayerId },
    ],
  })
  return { ...result, comparedSlots: result.comparedKeys }
}
