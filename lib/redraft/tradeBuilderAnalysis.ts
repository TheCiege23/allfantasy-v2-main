export type RedraftTradeBuilderAsset = {
  assetType: 'player' | 'draft_pick'
  playerName?: string | null
  position?: string | null
  team?: string | null
  injuryStatus?: string | null
  weeklyProjection?: number | null
  restOfSeasonProjection?: number | null
  floorProjection?: number | null
  ceilingProjection?: number | null
  projectionConfidenceScore?: number | null
  projectionSource?: string | null
  pickSeason?: number | null
  pickRound?: number | null
  label?: string | null
}

type RedraftTradeBuilderAnalysis = {
  fairnessScore: number
  riskScore: number
  positionalImpact: string
  chimmyExplanation: string
  sideAValue: number
  sideBValue: number
  favoredSide: 'A' | 'B' | 'even'
}

const POSITION_VALUES: Record<string, number> = {
  QB: 74,
  RB: 82,
  WR: 78,
  TE: 66,
  FLEX: 62,
  K: 24,
  DEF: 24,
  DST: 24,
}

const PICK_VALUES: Record<number, number> = {
  1: 68,
  2: 50,
  3: 34,
  4: 22,
  5: 14,
  6: 9,
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function stableNameBonus(name: string | null | undefined): number {
  if (!name) return 0
  let total = 0
  for (let i = 0; i < name.length; i += 1) total += name.charCodeAt(i)
  return (total % 13) - 6
}

function injuryPenalty(status: string | null | undefined): number {
  const normalized = String(status ?? '').toLowerCase()
  if (!normalized) return 0
  if (normalized.includes('out') || normalized.includes('ir') || normalized.includes('injured reserve')) return 18
  if (normalized.includes('doubtful')) return 12
  if (normalized.includes('questionable')) return 8
  if (normalized.includes('probable')) return 3
  return 5
}

function projectionAdjustedValue(asset: RedraftTradeBuilderAsset): number | null {
  const ros = Number(asset.restOfSeasonProjection)
  if (Number.isFinite(ros) && ros > 0) {
    const confidence = Number(asset.projectionConfidenceScore ?? 65)
    const confidenceMultiplier = confidence >= 78 ? 1.05 : confidence >= 58 ? 1 : 0.92
    return clamp(Math.round((ros / 2) * confidenceMultiplier), 8, 98)
  }

  const weekly = Number(asset.weeklyProjection)
  if (Number.isFinite(weekly) && weekly > 0) {
    const floor = Number(asset.floorProjection)
    const ceiling = Number(asset.ceilingProjection)
    const rangeRisk = Number.isFinite(floor) && Number.isFinite(ceiling) ? Math.max(0, ceiling - floor) : 0
    const confidence = Number(asset.projectionConfidenceScore ?? 65)
    const confidenceMultiplier = confidence >= 78 ? 1.04 : confidence >= 58 ? 1 : 0.9
    return clamp(Math.round((weekly * 5 - rangeRisk * 0.4) * confidenceMultiplier), 8, 98)
  }

  return null
}

export function estimateRedraftTradeAssetValue(asset: RedraftTradeBuilderAsset): number {
  if (asset.assetType === 'draft_pick') {
    const round = Number(asset.pickRound ?? 0)
    return PICK_VALUES[round] ?? 8
  }

  const projected = projectionAdjustedValue(asset)
  if (projected != null) return projected

  const position = String(asset.position ?? '').toUpperCase()
  const base = POSITION_VALUES[position] ?? 52
  const value = base + stableNameBonus(asset.playerName) - injuryPenalty(asset.injuryStatus)
  return clamp(Math.round(value), 8, 98)
}

function totalValue(assets: RedraftTradeBuilderAsset[]): number {
  return assets.reduce((sum, asset) => sum + estimateRedraftTradeAssetValue(asset), 0)
}

function topReceivedAsset(assets: RedraftTradeBuilderAsset[]): RedraftTradeBuilderAsset | null {
  let top: RedraftTradeBuilderAsset | null = null
  let topValue = -1
  for (const asset of assets) {
    const value = estimateRedraftTradeAssetValue(asset)
    if (value > topValue) {
      top = asset
      topValue = value
    }
  }
  return top
}

function describeReceivedImpact(label: string, received: RedraftTradeBuilderAsset[]): string {
  if (received.length === 0) return `${label} holds steady`
  const top = topReceivedAsset(received)
  if (!top) return `${label} holds steady`
  if (top.assetType === 'draft_pick') return `${label} adds draft flexibility`

  const position = String(top.position ?? '').toUpperCase()
  const value = estimateRedraftTradeAssetValue(top)
  if (value >= 80) return `${label} gains weekly consistency`
  if (position === 'RB') return `${label} improves RB depth`
  if (position === 'WR') return `${label} adds receiver depth`
  if (position === 'TE') return `${label} upgrades a thin position`
  if (position === 'QB') return `${label} gains lineup stability`
  return `${label} adds playable depth`
}

function receivedPositions(assets: RedraftTradeBuilderAsset[]): string {
  const positions = Array.from(
    new Set(
      assets
        .filter((asset) => asset.assetType === 'player')
        .map((asset) => String(asset.position ?? '').toUpperCase())
        .filter(Boolean),
    ),
  )
  const pickCount = assets.filter((asset) => asset.assetType === 'draft_pick').length
  const parts = [...positions]
  if (pickCount > 0) parts.push(`${pickCount} pick${pickCount === 1 ? '' : 's'}`)
  return parts.length ? parts.join(', ') : 'no assets'
}

export function analyzeRedraftTradeBuilder(input: {
  rosterALabel?: string
  rosterBLabel?: string
  rosterASends: RedraftTradeBuilderAsset[]
  rosterBSends: RedraftTradeBuilderAsset[]
}): RedraftTradeBuilderAnalysis {
  const rosterALabel = input.rosterALabel ?? 'Team A'
  const rosterBLabel = input.rosterBLabel ?? 'Team B'
  const sideAValue = totalValue(input.rosterASends)
  const sideBValue = totalValue(input.rosterBSends)
  const deltaForA = sideBValue - sideAValue
  const valueGap = Math.abs(deltaForA)
  const fairnessScore = clamp(Math.round(100 - valueGap * 1.15), 15, 100)

  const pickRisk = [...input.rosterASends, ...input.rosterBSends].filter((asset) => asset.assetType === 'draft_pick').length * 5
  const injuryRisk = [...input.rosterASends, ...input.rosterBSends].reduce(
    (sum, asset) => sum + injuryPenalty(asset.injuryStatus),
    0,
  )
  const projectionRisk = [...input.rosterASends, ...input.rosterBSends].reduce((sum, asset) => {
    const confidence = Number(asset.projectionConfidenceScore)
    return Number.isFinite(confidence) && confidence > 0 && confidence < 58 ? sum + 6 : sum
  }, 0)
  const complexityRisk = Math.max(0, input.rosterASends.length + input.rosterBSends.length - 2) * 4
  const riskScore = clamp(Math.round(18 + pickRisk + injuryRisk + projectionRisk + complexityRisk + valueGap * 0.25), 0, 100)

  const favoredSide = valueGap < 5 ? 'even' : deltaForA > 0 ? 'A' : 'B'
  const balance =
    favoredSide === 'even'
      ? 'close to even'
      : fairnessScore >= 82
        ? `slightly favorable to ${favoredSide === 'A' ? rosterALabel : rosterBLabel}`
        : fairnessScore >= 65
          ? `favorable to ${favoredSide === 'A' ? rosterALabel : rosterBLabel}`
          : `strongly favorable to ${favoredSide === 'A' ? rosterALabel : rosterBLabel}`

  return {
    fairnessScore,
    riskScore,
    sideAValue,
    sideBValue,
    favoredSide,
    positionalImpact: `${rosterALabel} receives ${receivedPositions(input.rosterBSends)}; ${rosterBLabel} receives ${receivedPositions(input.rosterASends)}.`,
    chimmyExplanation: `${describeReceivedImpact(rosterALabel, input.rosterBSends)}. ${describeReceivedImpact(rosterBLabel, input.rosterASends)}. Trade is ${balance}.`,
  }
}
