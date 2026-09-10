import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { AssetValueSnapshot } from '@/lib/trade-value/types'
import { buildValueV2Shadow, type ValueV2Shadow } from './shadow'
import type { MarketObservationV2 } from './market'

/** Consume prices BEFORE legacy TEP boosts so a league adjustment cannot become a market observation. */
export function buildConsoleValueV2Shadow(input: {
  give: readonly PricedAsset[]
  get: readonly PricedAsset[]
  sport: string
  isDynasty: boolean
  ppr: number
  numTeams: number
  isSuperFlex: boolean
  capturedAt: string
  givePlayerIds?: readonly (string | null)[]
  getPlayerIds?: readonly (string | null)[]
  observationsByPlayerId?: ReadonlyMap<string, MarketObservationV2>
  leagueRuntimeV2?: import('./league').LeagueRuntimeV2
}): ValueV2Shadow {
  const adapt = (a: PricedAsset, from: string, to: string, index: number, playerId?: string | null): AssetValueSnapshot => ({
    kind: a.type === 'pick' ? 'draft_pick' : a.position === 'FAAB' ? 'faab' : 'player',
    fromRosterId: from, toRosterId: to, playerId: playerId ?? `console:${from}:${index}:${a.name}`, playerName: a.name,
    position: a.position ?? null, internalValue: a.value,
    sources: { fantasyCalcValue: !a.unpriced && a.source === 'fantasycalc' ? a.assetValue.marketValue : null,
      marketObservation: playerId && a.source === 'fantasycalc' ? input.observationsByPlayerId?.get(playerId) ?? null : null,
      projectionValue: null, adpValue: null, rankingValue: null, idpValue: a.source === 'idp-vorp' ? a.value : null },
  })
  return buildValueV2Shadow([
    ...input.give.map((a, i) => adapt(a, 'requester', 'partner', i, input.givePlayerIds?.[i])),
    ...input.get.map((a, i) => adapt(a, 'partner', 'requester', i, input.getPlayerIds?.[i])),
  ], { leagueRuntimeV2: input.leagueRuntimeV2, sport: input.sport, leagueType: input.isDynasty ? 'dynasty' : 'redraft', scoring: `ppr:${input.ppr}`,
    rosterFormat: `${input.numTeams}teams/${input.isSuperFlex ? 'SF' : '1QB'}`, capturedAt: input.capturedAt,
    marketCohort: { sport: input.sport, format: input.isDynasty ? 'dynasty' : 'redraft', numQbs: input.isSuperFlex ? 2 : 1, numTeams: input.numTeams, ppr: input.ppr } })
}
