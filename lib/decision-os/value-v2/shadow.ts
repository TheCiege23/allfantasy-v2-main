import type { AssetValueSnapshot, TradeValueContext } from '@/lib/trade-value/types'
import type { MarketValueSnapshotV2 } from './types'
import { marketSnapshot } from './market'

export function valueV2ShadowEnabled(): boolean {
  return process.env.DECISION_OS_VALUE_V2_SHADOW_ENABLED === 'true'
}

export interface ValueV2Shadow {
  league?: import('./league').LeagueRuntimeV2
  /**
   * The requesting team's competitive window, when the caller resolved one.
   *
   * ⚠ IT NEVER TOUCHES `assets[].marketValue`. The window changes how an asset
   * suits THIS roster and nothing else; market value must stay identical for
   * two managers in the same cohort at the same timestamp. The weighting is
   * carried beside the prices, not folded into them.
   *
   * Absent means no window was resolved. Absent is not 'competitive'.
   */
  window?: import('./windowDecision').WindowDecision
  version: '2.0'
  mode: 'shadow'
  authority: 'legacy'
  assets: MarketValueSnapshotV2[]
  marketComplete: boolean
  /** No utility is inferred from market balance or legacy strategy labels. */
  gaps: string[]
}

/** Snapshot seam shared by all canonical trade producers; no additional queries or provider calls. */
export function buildValueV2Shadow(assets: readonly AssetValueSnapshot[], context: TradeValueContext): ValueV2Shadow {
  const snapshots = assets.map((a, index): MarketValueSnapshotV2 => {
    return marketSnapshot({ assetId: a.playerId ?? `${a.kind}:${a.fromRosterId}:${index}`, kind: a.kind,
      observation: a.kind === 'player' ? a.sources.marketObservation ?? null : null,
      expectedValue: a.sources.fantasyCalcValue,
      policy: { now: context.capturedAt, maxAgeMs: 48 * 60 * 60 * 1000, expectedCohort: context.marketCohort } })
  })
  const window = context.teamWindowV2
  return { version: '2.0', mode: 'shadow', authority: 'legacy', assets: snapshots,
    ...(context.leagueRuntimeV2 ? { league: context.leagueRuntimeV2 } : {}),
    ...(window ? { window } : {}),
    marketComplete: snapshots.length > 0 && snapshots.every(a => a.marketValue !== null),
    gaps: [...(context.leagueRuntimeV2?.gaps ?? ['league_runtime_context_missing']),
      // A refusal names itself here rather than disappearing into a neutral weight.
      ...(window ? window.gaps.map(g => `window:${g}`) : ['team_competitive_window_missing']),
      ...(window?.state === 'refused' ? ['team_competitive_window_refused'] : []),
      'reference_scoring_and_topology_required', 'team_marginal_simulation_required', 'horizon_model_required', 'not_calibrated_for_live_authority'] }
}
