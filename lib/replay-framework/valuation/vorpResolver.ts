/**
 * Decision OS Replay Framework — VORP enrichment, per
 * docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §11 (Phase 7).
 *
 * Reuses the exact same reusable VORP primitive native AllFantasy trade
 * flows call (`computePlayerVorp()`, `lib/vorp-engine.ts`) — not the heavier
 * `pricePlayer()`/`lib/hybrid-valuation.ts` wrapper, which does name-based
 * historical-Excel lookups and live analytics-API calls this replay
 * pipeline has no use for (it already resolves players by Sleeper ID via
 * `findPlayerBySleeperId()`, matching `FantasyCalcPlayer` directly — no
 * name-matching step needed). `computePlayerVorp()` is a pure function with
 * zero network/DB dependency beyond the already-fetched `fcPlayers` array
 * this pipeline already has.
 */
import { computePlayerVorp, type LeagueRosterConfig } from '@/lib/vorp-engine'
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'

/**
 * Derives a real `LeagueRosterConfig` from the league's actual
 * `roster_positions` (e.g. `['QB','RB','RB','WR','WR','WR','TE','FLEX','FLEX','SUPER_FLEX','BN',...]`)
 * rather than falling back to `hybrid-valuation.ts`'s generic default
 * (1 QB / 2 RB / 2 WR / 1 TE / 2 flex) — more faithful replay fidelity,
 * since a real league's actual starting-slot counts are already available.
 */
export function deriveLeagueRosterConfig(rosterPositions: string[], numTeams: number, isSuperFlex: boolean): LeagueRosterConfig {
  const count = (pos: string) => rosterPositions.filter((p) => p === pos).length
  const flexCount = count('FLEX') + count('WRRB_FLEX') + count('REC_FLEX')
  const superFlexCount = count('SUPER_FLEX') + count('QB_FLEX')

  return {
    numTeams: numTeams > 0 ? numTeams : 12,
    startingQB: count('QB') || 1,
    startingRB: count('RB') || 2,
    startingWR: count('WR') || 2,
    startingTE: count('TE') || 1,
    startingFlex: flexCount + superFlexCount || (isSuperFlex ? 3 : 2),
    superflex: isSuperFlex || superFlexCount > 0,
  }
}

/**
 * Resolves a single player's VORP value. Returns 0 (never throws, never
 * fabricates) when the player didn't resolve against FantasyCalc — the same
 * graceful-degradation convention already established throughout this
 * pipeline (`REPLAY_FALLBACK_VALUE` for market value). A 0 vorpValue simply
 * means that specific asset doesn't count toward `hasVorpData`; if any
 * other asset in the same trade/roster resolves with real VORP, the overall
 * computation still qualifies.
 */
export function resolvePlayerVorp(
  fc: FantasyCalcPlayer | null,
  config: LeagueRosterConfig,
  fcPlayers: FantasyCalcPlayer[],
): number {
  if (!fc) return 0
  const position = fc.player.position
  if (!position) return 0
  return computePlayerVorp(position, fc.positionRank, fc.redraftValue, config, fcPlayers)
}
