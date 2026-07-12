/**
 * Trade Value Console — shadow-mode identity/valuation cross-check.
 * Fantasy OS Phase 18, first real Trade consumer migration.
 *
 * Scope, deliberately narrower than the Phase 17 design doc's aspiration
 * (which imagined comparing full fairness scores) — re-audited before
 * writing any code and found two real, structural reasons a full
 * fairness-score shadow isn't honestly buildable yet:
 *
 * 1. `/api/trade-value/analyze`'s client-supplied `playerId` is a
 *    `SportsPlayerRecord.id` (confirmed by reading `lib/data/players.ts`'s
 *    `getPlayer()` — a `prisma.sportsPlayerRecord.findUnique` lookup), a
 *    DIFFERENT internal id space from the Phase 14 canonical resolver's
 *    `PlayerIdentityMap`/`SportsPlayer` tables. It is NOT a raw provider id
 *    (Sleeper/ESPN/etc), so the resolver's direct-id steps (1-3) cannot be
 *    driven by it directly.
 * 2. The existing `lib/shared-services/trade/TradeShadowService.ts`
 *    requires `sideARosterId`/`sideBRosterId` (real provider `source_team_id`
 *    values) — this route has no roster concept at all (sport-wide
 *    asset-to-asset comparison, `leagueId` optional, no rosters). That
 *    service's contract cannot be satisfied here without inventing roster
 *    ids that don't exist for this request shape.
 *
 * What IS honestly buildable and genuinely valuable: for each player asset
 * the authoritative engine already resolved (name + position + team),
 * independently resolve the SAME player through the canonical
 * PlayerIdentityResolver and report whether identity resolution agrees —
 * using FantasyCalc's own embedded cross-provider ids (sleeperId/espnId/
 * mflId/fleaflickerId, confirmed present on `FantasyCalcPlayerIdentity`)
 * as a real provider-id bridge where available, falling back to name-only
 * resolution otherwise (a real, expected, non-fatal case — see
 * `identity_unresolvable` below). A secondary, derived market-value
 * cross-check is included but is NOT the primary signal, since both paths
 * ultimately read the same FantasyCalc source — genuine divergence here
 * would mean the identity resolution itself disagreed, not a fresh
 * independent valuation engine.
 *
 * SHADOW MODE ONLY until wired behind SHARED_SERVICES_TRADE_SHADOW_COMPARE.
 * Never throws past its own boundary. Never called on the response path.
 *
 * Phase 19 real-data finding and fix: a real query against `.env.test`
 * found `PlayerIdentityMap` is 100% NFL (0 rows for any other sport), so
 * every non-NFL asset (this route genuinely supports NBA/MLB/NHL/NCAAF/
 * Soccer) fell through to `resolvePlayer`'s name-match step — which only
 * searches `PlayerIdentityMap` — and was reported `identity_unresolvable`
 * even when `SportsPlayer` (a separate, real table, confirmed to carry
 * substantial multi-sport data: MLB 7,295 / NBA 1,756 / NCAAB 18,209 /
 * NCAAF 44,897 / NFL 17,257 / NHL 4,115 / Soccer 2,310 rows) had a clean
 * match. Fixed with one narrow, additive fallback — `resolveViaSportsPlayerName`
 * below — scoped entirely to this file. Does NOT touch the canonical
 * `PlayerIdentityResolver` (its NFL/Sleeper-focused contract is unchanged)
 * and does NOT touch the authoritative Trade engine.
 */

import { fetchFantasyCalcValues, findPlayerByName, type FantasyCalcPlayer } from '@/lib/player-valuations/canonicalPlayerValuations'
import { resolvePlayer } from '@/lib/shared-services/player-identity'
import { prisma } from '@/lib/prisma'
import type { ImportProvider } from '@/lib/league-import/types'
import type { ResolutionConfidence } from '@/lib/shared-services/player-identity/types'

export interface TradeValueConsoleAssetInput {
  name: string
  position: string | null
  team: string | null
  /** Defaults to 'NFL' when omitted — matches this file's existing test fixtures and the route's own default assumption. */
  sport?: string
  /** The console's own reported market value for this asset — used only for the secondary value cross-check, never as an identity input. */
  authoritativeMarketValue: number
}

export type TradeAssetShadowStatus =
  | 'identity_direct'
  | 'identity_name_match'
  /** Phase 19: a real name match found in SportsPlayer (not PlayerIdentityMap) — reported distinctly, never conflated with the canonical resolver's own name-match result. */
  | 'identity_name_match_multisport_fallback'
  | 'identity_ambiguous'
  | 'identity_unresolvable'
  | 'not_a_player'

export interface TradeAssetShadowResult {
  name: string
  status: TradeAssetShadowStatus
  confidence: ResolutionConfidence | null
  matchedProvider: ImportProvider | null
  /** shared canonical value minus authoritative marketValue, when both exist — a secondary, derived signal only (see module docstring). */
  valueDelta: number | null
}

export type TradeValueConsoleShadowStatus =
  | 'equivalent'
  | 'partial_identity_unresolved'
  | 'identity_unresolvable'
  | 'unsupported'

export interface TradeValueConsoleShadowResult {
  status: TradeValueConsoleShadowStatus
  assetResults: TradeAssetShadowResult[]
  resolvedCount: number
  unresolvedCount: number
  fantasyCalcFetchMs: number
}

/**
 * A player asset's FantasyCalc identity carries real cross-provider ids
 * (sleeperId/espnId/mflId/fleaflickerId) — used here as a real provider-id
 * bridge into the canonical resolver where present. Never fabricated: a
 * blank string on FantasyCalcPlayerIdentity means no id, not a match.
 */
function pickProviderId(identity: FantasyCalcPlayer['player']): { provider: ImportProvider; sourceId: string } | null {
  if (identity.sleeperId?.trim()) return { provider: 'sleeper', sourceId: identity.sleeperId.trim() }
  if (identity.espnId?.trim()) return { provider: 'espn', sourceId: identity.espnId.trim() }
  if (identity.mflId?.trim()) return { provider: 'mfl', sourceId: identity.mflId.trim() }
  if (identity.fleaflickerId?.trim()) return { provider: 'fleaflicker', sourceId: identity.fleaflickerId.trim() }
  return null
}

/**
 * Phase 19 fallback: a real, direct name+sport lookup against `SportsPlayer`
 * — used only when the canonical resolver (PlayerIdentityMap-backed) has
 * already reported `unresolved` AND the asset's sport is not NFL (NFL is
 * already well-covered by PlayerIdentityMap; querying SportsPlayer again
 * for NFL would be redundant, not incorrect, so this guard is a real
 * optimization, not a correctness requirement). Never throws past its own
 * boundary. Never fabricates a match — 0 or >1 case-insensitive name
 * matches both return null/ambiguous, never a guessed single result.
 */
async function resolveViaSportsPlayerName(
  name: string,
  sport: string
): Promise<{ status: 'identity_name_match_multisport_fallback' | 'identity_ambiguous' | 'identity_unresolvable' }> {
  try {
    const rows = await prisma.sportsPlayer.findMany({
      where: { name: { equals: name, mode: 'insensitive' }, sport: sport.toUpperCase() },
      select: { id: true },
    })
    if (rows.length === 0) return { status: 'identity_unresolvable' }
    if (rows.length > 1) return { status: 'identity_ambiguous' }
    return { status: 'identity_name_match_multisport_fallback' }
  } catch {
    return { status: 'identity_unresolvable' }
  }
}

async function resolveOneAsset(asset: TradeValueConsoleAssetInput, fcPlayers: FantasyCalcPlayer[]): Promise<TradeAssetShadowResult> {
  const sport = asset.sport ?? 'NFL'
  const fcMatch = findPlayerByName(fcPlayers, asset.name)
  const providerRef = fcMatch ? pickProviderId(fcMatch.player) : null

  const resolution = await resolvePlayer({
    provider: providerRef?.provider ?? 'sleeper',
    sourceId: providerRef?.sourceId,
    nameHint: asset.name,
    positionHint: asset.position,
    teamHint: asset.team,
  })

  let status: TradeAssetShadowStatus =
    resolution.confidence === 'direct'
      ? 'identity_direct'
      : resolution.confidence === 'name_match_confident'
        ? 'identity_name_match'
        : resolution.confidence === 'name_match_ambiguous'
          ? 'identity_ambiguous'
          : 'identity_unresolvable'

  if (status === 'identity_unresolvable' && sport.toUpperCase() !== 'NFL') {
    const fallback = await resolveViaSportsPlayerName(asset.name, sport)
    status = fallback.status
  }

  const valueDelta = fcMatch ? fcMatch.value - asset.authoritativeMarketValue : null

  return {
    name: asset.name,
    status,
    confidence: resolution.confidence,
    matchedProvider: providerRef?.provider ?? null,
    valueDelta,
  }
}

/**
 * Runs the shadow identity/value cross-check for a Trade Value Console
 * request's player assets. Never throws — a failure resolving one asset is
 * reported as `identity_unresolvable` for that asset, never allowed to
 * abort the whole comparison.
 */
export async function evaluateTradeValueConsoleShadow(
  assets: TradeValueConsoleAssetInput[]
): Promise<TradeValueConsoleShadowResult> {
  if (assets.length === 0) {
    return { status: 'unsupported', assetResults: [], resolvedCount: 0, unresolvedCount: 0, fantasyCalcFetchMs: 0 }
  }

  const fcStart = Date.now()
  const fcPlayers = await fetchFantasyCalcValues({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 })
  const fantasyCalcFetchMs = Date.now() - fcStart

  const assetResults = await Promise.all(
    assets.map(async (asset) => {
      try {
        return await resolveOneAsset(asset, fcPlayers)
      } catch (err) {
        return {
          name: asset.name,
          status: 'identity_unresolvable' as const,
          confidence: null,
          matchedProvider: null,
          valueDelta: null,
        }
      }
    })
  )

  const resolvedCount = assetResults.filter(
    (r) => r.status === 'identity_direct' || r.status === 'identity_name_match' || r.status === 'identity_name_match_multisport_fallback'
  ).length
  const unresolvedCount = assetResults.filter((r) => r.status === 'identity_unresolvable').length

  const status: TradeValueConsoleShadowStatus =
    unresolvedCount === assetResults.length
      ? 'identity_unresolvable'
      : unresolvedCount > 0
        ? 'partial_identity_unresolved'
        : 'equivalent'

  return { status, assetResults, resolvedCount, unresolvedCount, fantasyCalcFetchMs }
}
