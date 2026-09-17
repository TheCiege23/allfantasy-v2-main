/**
 * DYNASTY PICK-VALUE ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Rookie/future pick capital lives in `future_draft_picks` (now migrated). This engine
 * reads the REAL picks attached to `context.teams[].picks` and summarizes them. Pick
 * `estValue` is a transparent structural TIER (round + seasons-out, see
 * `pickHeuristicValue`) — NOT a fabricated market value.
 *
 * Honest states (driven by `context.availability.futurePicks`):
 *   - 'missing'         → table not migrated for this env → needsProviderIntegration.
 *   - 'available_empty' → tracking enabled, no picks recorded yet → trackingEnabledEmpty.
 *   - 'available'       → real picks summarized.
 *   - 'partial'         → real picks listed, but only the traded ones → no total (`partial`).
 */

import type { DynastyFuturePick, DynastyTeamSummary, DynastyWarRoomContext } from './types'

export interface DynastyPickLine {
  id: string
  season: number
  round: number
  estValue: number | null
  traded: boolean
  fromOriginalOwner: boolean
  note: string
}

export interface DynastyPickValueResult {
  rosterId: string
  picks: DynastyPickLine[]
  /** Sum of structural pick tiers (null when no priced picks, or when the list is partial). */
  totalEstValue: number | null
  /**
   * The list is known to be incomplete (only traded picks), so it is not the team's capital:
   * `totalEstValue` is withheld and `earlyPickCount` counts only the listed picks.
   */
  partial: boolean
  earlyPickCount: number
  missingDataFlags: string[]
  /** True only when the backing table is absent (provider integration pending). */
  needsProviderIntegration: boolean
  /** True when tracking is enabled but no picks are recorded for the team yet. */
  trackingEnabledEmpty: boolean
}

/** Shared, deterministic pick-capital summary for a team's held picks. */
export function summarizePickCapital(picks: DynastyFuturePick[]): {
  totalEstValue: number | null
  earlyPickCount: number
  count: number
} {
  let total = 0
  let anyValued = false
  let early = 0
  for (const pk of picks) {
    if (pk.estValue != null) {
      total += pk.estValue
      anyValued = true
    }
    if (pk.round <= 2) early += 1
  }
  return {
    totalEstValue: anyValued ? Math.round(total * 10) / 10 : null,
    earlyPickCount: early,
    count: picks.length,
  }
}

export function evaluateDynastyPickValue(
  context: DynastyWarRoomContext,
  rosterId: string,
): DynastyPickValueResult {
  const team: DynastyTeamSummary | undefined = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  const state = context.availability.futurePicks

  if (state === 'missing') {
    return {
      rosterId,
      picks: [],
      totalEstValue: null,
      partial: false,
      earlyPickCount: 0,
      missingDataFlags,
      needsProviderIntegration: true,
      trackingEnabledEmpty: false,
    }
  }
  const partial = state === 'partial'

  const picks = team?.picks ?? []
  if (picks.length === 0) {
    return {
      rosterId,
      picks: [],
      totalEstValue: null,
      partial,
      earlyPickCount: 0,
      missingDataFlags,
      needsProviderIntegration: false,
      trackingEnabledEmpty: state === 'available_empty' || !team,
    }
  }

  const lines: DynastyPickLine[] = picks.map((pk) => {
    /*
     * ⚠ BOTH IDS ARE IN `Roster.id` SPACE, AND THIS COMPARISON DEPENDS ON IT. Imported leagues store
     * provider team ids on the pick table; `dynastyPickCapital.ts` translates them before a pick
     * reaches the context. Compared raw, a provider id never equals a roster id.
     */
    const fromOriginalOwner = pk.originalRosterId == null || pk.originalRosterId === rosterId
    const origin = fromOriginalOwner
      ? 'own'
      : pk.originalTeamName
        ? `acquired from ${pk.originalTeamName}`
        : 'acquired via trade'
    return {
      id: pk.id,
      season: pk.season,
      round: pk.round,
      estValue: pk.estValue,
      traded: pk.traded,
      fromOriginalOwner,
      note:
        pk.estValue != null
          ? `${pk.season} Round ${pk.round} (${origin}; tier ${pk.estValue.toFixed(1)}).`
          : `${pk.season} Round ${pk.round} (${origin}; unpriced).`,
    }
  })
  const summary = summarizePickCapital(picks)

  return {
    rosterId,
    picks: lines,
    // A partial list's sum would read as the team's whole capital.
    totalEstValue: partial ? null : summary.totalEstValue,
    partial,
    earlyPickCount: summary.earlyPickCount,
    missingDataFlags,
    needsProviderIntegration: false,
    trackingEnabledEmpty: false,
  }
}
