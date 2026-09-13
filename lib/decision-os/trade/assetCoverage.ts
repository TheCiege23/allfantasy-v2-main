import type {
  AssetValueSnapshot,
  TradeAssetCoverage,
  TradeAssetCoverageItem,
} from '@/lib/trade-value/types'

const IDP = new Set(['DL', 'DE', 'DT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'FS', 'SS', 'EDGE', 'NT'])

function classify(asset: AssetValueSnapshot): TradeAssetCoverageItem['assetClass'] {
  const canonical = asset.canonicalAssetType?.toLowerCase()
  const position = asset.position?.toUpperCase()
  if (canonical === 'devy') return 'college_devy'
  if (canonical === 'keeper' || canonical === 'contract' || canonical === 'salary') return 'specialty'
  if (asset.kind === 'draft_pick') return 'draft_pick'
  if (asset.kind === 'faab') return 'faab'
  if (asset.kind === 'player' && position === 'K') return 'kicker'
  if (asset.kind === 'player' && position && IDP.has(position)) return 'idp'
  if (asset.kind === 'player') return 'offense'
  return 'unknown'
}

export function assessTradeAssetCoverage(assets: AssetValueSnapshot[]): TradeAssetCoverage {
  const items = assets.map((asset, index): TradeAssetCoverageItem => {
    const assetClass = classify(asset)
    let resolved = false
    let reason: string | null = null
    if (asset.kind === 'player') {
      resolved = asset.valuationBasis === 'projection' || asset.valuationBasis === 'market' || asset.valuationBasis === 'idp'
      if (!resolved) reason = `${asset.playerName ?? asset.playerId ?? 'Player'} has no projection, market, or league-specific value.`
    } else if (asset.kind === 'draft_pick') {
      resolved = asset.pickRound != null && asset.internalValue > 0
      if (!resolved) reason = 'Draft pick is missing a round or a supported pick curve.'
    } else if (asset.kind === 'faab') {
      resolved = asset.faabAmount != null && asset.faabAmount >= 0
      if (!resolved) reason = 'FAAB asset is missing an amount.'
    } else {
      reason = `${asset.canonicalAssetType ?? 'Specialty asset'} does not have a supported deterministic value model.`
    }
    return {
      key: asset.playerId ?? asset.pickLabel ?? `${asset.kind}:${index}`,
      assetClass,
      resolved,
      reason,
    }
  })
  const resolvedCount = items.filter((item) => item.resolved).length
  const totalCount = items.length
  const coveragePct = totalCount ? Math.round((resolvedCount / totalCount) * 100) : 0
  const status = totalCount > 0 && resolvedCount === totalCount ? 'complete' : resolvedCount === 0 ? 'blocked' : 'partial'
  return {
    status,
    coveragePct,
    resolvedCount,
    totalCount,
    items,
    warnings: items.filter((item) => !item.resolved && item.reason).map((item) => item.reason as string),
  }
}
