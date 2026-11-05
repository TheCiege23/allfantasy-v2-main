import 'server-only'

import { loadLeagueForTrade } from '@/lib/trade-value-console/league-loader'
import { snapshotFromLoaded } from '@/lib/trade-value-console/quick-badges'
import { resolveAssets, resolveLeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import { gradeInputsFromRedraftAssets } from '@/lib/decision-os/trade/tradeGradeInputs'

/** Dynasty market reference for the traded player packages, separate from Zombie settlement points. */
export async function zombieDynastyTradeReference(input: {
  leagueId: string
  userId: string
  proposerRosterId: string
  receiverRosterId: string
  assets: ReadonlyArray<{ assetType?: string; fromRosterId?: string; toRosterId?: string; playerId?: string | null; playerName?: string | null }>
}) {
  const league = await loadLeagueForTrade({ leagueId: input.leagueId, userId: input.userId })
  if (!league) return null
  const snapshot = snapshotFromLoaded(league)
  if (!snapshot.isDynasty) return null
  const players = input.assets.filter(asset => asset.assetType === 'player')
  if (!players.length || players.some(asset => ![input.proposerRosterId, input.receiverRosterId].includes(asset.fromRosterId ?? '') ||
      ![input.proposerRosterId, input.receiverRosterId].includes(asset.toRosterId ?? '') || asset.fromRosterId === asset.toRosterId)) return null
  const give = gradeInputsFromRedraftAssets(players.filter(asset => asset.fromRosterId === input.proposerRosterId).map(asset => ({ ...asset, assetType: 'player' })))
  const get = gradeInputsFromRedraftAssets(players.filter(asset => asset.toRosterId === input.proposerRosterId).map(asset => ({ ...asset, assetType: 'player' })))
  if (give.unpriceable.length || get.unpriceable.length) return null
  const chart = await resolveLeagueTradeChart({ leagueRow: league, leagueSnapshot: snapshot, leagueNormCtx: null })
  if (!chart.chartIsDynasty || !chart.fcPlayers.length) return null
  const price = async (assets: typeof give.assets) => {
    if (!assets.length) return 0
    const result = await resolveAssets(assets, { effectiveSport: 'NFL', nflCtx: chart.nflCtx,
      waiverBudget: chart.waiverBudget, fcPlayers: chart.fcPlayers, dataGaps: [], resolveEnrichmentIds: false })
    if (result.unresolved.length || result.lines.length !== assets.length || result.lines.some(line => line.unpriced || line.pricedSource !== 'fantasycalc')) return null
    return result.lines.reduce((sum, line) => sum + line.marketValue, 0)
  }
  const [giveValue, getValue] = await Promise.all([price(give.assets), price(get.assets)])
  return giveValue === null || getValue === null ? null : { giveValue, getValue, asOf: chart.fcSyncedAt ?? null }
}
