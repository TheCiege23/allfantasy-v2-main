import 'server-only'

import { recordAdvice, WAIVER_PANEL_SURFACE } from '@/lib/chimmy-advice/adviceStore'
import type { WaiverClaimRecommendation } from '@/lib/decision-os/waiver/decision'
import { resolveDropOnRoster, resolveWaiverAddTarget, topWaiverClaim, type WaiverTargetRefusal } from './waiverAdviceTarget'

/**
 * The advice ledger's waiver half (2026-11-15): the waiver panel's #1 pickup, recorded as it is shown
 * (components/waivers/AIWaiverRecommendationsPanel → /api/ai/waivers/recommend), so it can be graded once
 * the weeks are played (scripts/advice-ledger-report.mjs). The panel was the one waiver recommendation
 * nothing recorded — only Chimmy's chat adds were.
 *
 *   - ONLY THE TOP CLAIM, for the same reason Chimmy's is: the ranked list is the engine's working.
 *   - The claim's suggested DROP is recorded as the alternative when it can be placed on the user's
 *     roster unambiguously, so the report can say whether the add outscored who it replaced.
 *   - Ledger-only (`waiver_panel`): never Chimmy's, never on the Receipts card or in Chimmy's track
 *     record, and its upsert never takes over Chimmy's row for the same player.
 *   - Fire and forget: the route never awaits it. `ADVICE_LEDGER_WAIVERS=off` turns it off.
 */

export type PanelWaiverAdviceOutcome = 'recorded' | 'unavailable' | 'invalid' | 'no_claim' | 'disabled' | WaiverTargetRefusal

export async function recordPanelWaiverAdvice(
  args: { userId: string; leagueId: string; claims: readonly WaiverClaimRecommendation[] },
  env: NodeJS.ProcessEnv = process.env,
): Promise<PanelWaiverAdviceOutcome> {
  if (String(env['ADVICE_LEDGER_WAIVERS'] ?? '').trim().toLowerCase() === 'off') return 'disabled'
  const top = topWaiverClaim(args.claims)
  if (!top) return 'no_claim'
  const target = await resolveWaiverAddTarget({ userId: args.userId, leagueId: args.leagueId, top })
  if (!target.ok) return target.reason
  const drop = await resolveDropOnRoster({ dropName: top.dropPlayerName, rosterIds: target.rosterIds, sport: target.league.sport })
  return recordAdvice({
    userId: args.userId,
    leagueId: target.league.id,
    sport: target.league.sport,
    season: target.season,
    week: target.week,
    adviceType: 'add',
    surface: WAIVER_PANEL_SURFACE,
    rec: { key: target.sleeperId, name: target.playerName },
    alt: drop,
    slot: null,
    confidencePct: null,
  })
}

/** Never awaited by the route, never thrown into it. */
export function schedulePanelWaiverAdvice(args: { userId: string; leagueId: string; claims: readonly WaiverClaimRecommendation[] }): void {
  void recordPanelWaiverAdvice(args).catch((err) => {
    console.warn('[advice-ledger] waiver panel pick not recorded', err instanceof Error ? err.message : err)
  })
}
