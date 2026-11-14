import { prisma } from '../prisma'

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max)
}

export interface ManagerTendencyProfile {
  managerId: string
  managerName: string
  sampleSize: number
  starterPremium: number
  positionBias: {
    QB: number
    RB: number
    WR: number
    TE: number
    PICK: number
  }
  riskTolerance: number
  consolidationBias: number
  overpayThreshold: number
  fairnessTolerance: number
  computedAt: number
}

export interface AcceptProbabilityInput {
  deltaThem: number
  teamNeedFit: number
  marketFairness: number
  perceivedLossByMarket: number
  marketDeltaOppPct: number
  dealShapeOpp: number
  volDeltaOpp: number
  tendencies: ManagerTendencyProfile | null
  oppLineupDeltaPPG?: number
  needFitPPG?: number
  oppReceiveAssets?: Array<{
    marketValue?: number
    value?: number
    pos?: string
    type?: string
    slot?: string
  }>
  hasLineupData?: boolean
  isDeadlineWindow?: boolean
  allTendencies?: Array<{
    sampleSize: number
    starterPremium: number
    positionBias: { QB: number; RB: number; WR: number; TE: number; PICK: number }
    riskTolerance: number
    consolidationBias: number
  }> | null
  calibratedWeights?: {
    b0: number
    w1: number
    w2: number
    w3: number
    w4: number
    w5: number
    w6: number
    w7: number
  } | null
  starterUpgradePPG?: number
  starterMatchOverride?: number
}

export interface AcceptProbabilityResult {
  probability: number
  label: 'Strong' | 'Aggressive' | 'Speculative' | 'Long Shot'
  rate: string
  emoji: string
  pill: string
  signals: string[]
}

interface NormalizedTrade {
  netDelta: number
  marketDeltaPct: number
  valueGiven: number
  valueReceived: number
  analysis: Record<string, any> | null
  playerAgeData: Record<string, any> | null
}

const STARTER_TIERS = ['Tier1', 'Tier2', 'Starter']

function computeStarterPremium(trades: NormalizedTrade[]): number {
  const starterTrades = trades.filter(t => {
    const tiers = t.analysis?.receivedTiers as string[] | undefined
    if (!tiers || !Array.isArray(tiers)) return false
    return tiers.some(tier => STARTER_TIERS.some(s => tier.includes(s)))
  })

  if (!starterTrades.length) return 0

  const avgDelta = starterTrades.reduce((sum, t) => sum + t.netDelta, 0) / starterTrades.length
  return clamp(avgDelta / 2000, -1, 1)
}

function computePositionBias(trades: NormalizedTrade[]): ManagerTendencyProfile['positionBias'] {
  const bias = { QB: 0, RB: 0, WR: 0, TE: 0, PICK: 0 }
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, PICK: 0 }

  for (const t of trades) {
    const assets = t.analysis?.receivedAssets as Array<{ position?: string }> | undefined
    if (!assets || !Array.isArray(assets)) continue

    for (const asset of assets) {
      const pos = (asset.position?.toUpperCase() || 'PICK') as keyof typeof bias
      if (bias[pos] !== undefined) {
        bias[pos] += t.netDelta
        counts[pos] += 1
      }
    }
  }

  return {
    QB: counts.QB > 0 ? clamp(bias.QB / counts.QB / 2000, -1, 1) : 0,
    RB: counts.RB > 0 ? clamp(bias.RB / counts.RB / 2000, -1, 1) : 0,
    WR: counts.WR > 0 ? clamp(bias.WR / counts.WR / 2000, -1, 1) : 0,
    TE: counts.TE > 0 ? clamp(bias.TE / counts.TE / 2000, -1, 1) : 0,
    PICK: counts.PICK > 0 ? clamp(bias.PICK / counts.PICK / 2000, -1, 1) : 0,
  }
}

function computeRiskTolerance(trades: NormalizedTrade[]): number {
  const ages = trades.flatMap(t => {
    const receivedAges = t.playerAgeData?.receivedAges as number[] | undefined
    return (receivedAges && Array.isArray(receivedAges)) ? receivedAges : []
  })

  if (!ages.length) return 0

  const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length
  return clamp((26 - avgAge) / 5, -1, 1)
}

function computeConsolidationBias(trades: NormalizedTrade[]): number {
  const consolidations = trades.filter(t => {
    const rcv = t.analysis?.receivedAssets as any[] | undefined
    const gvn = t.analysis?.givenAssets as any[] | undefined
    if (!rcv || !gvn || !Array.isArray(rcv) || !Array.isArray(gvn)) return false
    return rcv.length < gvn.length
  })

  return clamp(consolidations.length / trades.length, 0, 1)
}

function computeOverpayThreshold(trades: NormalizedTrade[]): number {
  const losingTrades = trades.filter(t => t.netDelta < 0)

  if (!losingTrades.length) return 0

  const avgLoss = losingTrades.reduce((sum, t) => sum + t.netDelta, 0) / losingTrades.length
  return clamp(avgLoss / 3000, -1, 0)
}

function computeFairnessTolerance(trades: NormalizedTrade[]): number {
  const avgAbs = trades.reduce((sum, t) => sum + Math.abs(t.netDelta), 0) / trades.length
  return clamp(avgAbs / 3000, 0, 1)
}

function normalizeTrades(rawTrades: Array<{
  valueGiven: number | null
  valueReceived: number | null
  valueDifferential: number | null
  analysisResult: any
  playerAgeData: any
}>): NormalizedTrade[] {
  return rawTrades.map(trade => {
    const valueGiven = trade.valueGiven ?? 0
    const valueReceived = trade.valueReceived ?? 0
    return {
      netDelta: valueReceived - valueGiven,
      marketDeltaPct: trade.valueDifferential ?? 0,
      valueGiven,
      valueReceived,
      analysis: trade.analysisResult as Record<string, any> | null,
      playerAgeData: trade.playerAgeData as Record<string, any> | null,
    }
  })
}

const DEFAULT_PROFILE_DATA = {
  starterPremium: 0,
  positionBias: { QB: 0, RB: 0, WR: 0, TE: 0, PICK: 0 },
  riskTolerance: 0,
  consolidationBias: 0,
  overpayThreshold: 0,
  fairnessTolerance: 0,
}

export function buildManagerProfile(trades: NormalizedTrade[]): Omit<ManagerTendencyProfile, 'managerId' | 'managerName' | 'computedAt'> {
  if (trades.length < 3) {
    return { sampleSize: trades.length, ...DEFAULT_PROFILE_DATA }
  }

  return {
    sampleSize: trades.length,
    starterPremium: computeStarterPremium(trades),
    positionBias: computePositionBias(trades),
    riskTolerance: computeRiskTolerance(trades),
    consolidationBias: computeConsolidationBias(trades),
    overpayThreshold: computeOverpayThreshold(trades),
    fairnessTolerance: computeFairnessTolerance(trades),
  }
}

const TENDENCY_CACHE = new Map<string, { data: ManagerTendencyProfile; cachedAt: number }>()
const TENDENCY_CACHE_TTL = 1000 * 60 * 60 * 24 * 7

export function clearTendencyMemoryCache(sleeperUsername?: string, sleeperLeagueId?: string): void {
  if (sleeperUsername && sleeperLeagueId) {
    TENDENCY_CACHE.delete(`${sleeperUsername}:${sleeperLeagueId}`)
  } else {
    TENDENCY_CACHE.clear()
  }
}

export async function computeManagerTendencies(
  sleeperUsername: string,
  sleeperLeagueId: string,
  managerName?: string
): Promise<ManagerTendencyProfile | null> {
  const cacheKey = `${sleeperUsername}:${sleeperLeagueId}`
  const cached = TENDENCY_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < TENDENCY_CACHE_TTL) {
    return cached.data
  }

  const history = await prisma.leagueTradeHistory.findFirst({
    where: { sleeperUsername, sleeperLeagueId },
    include: { trades: true },
  })

  if (!history || history.trades.length < 2) return null

  const rawTrades = history.trades.filter(t => t.analyzed || t.valueGiven != null)

  if (rawTrades.length < 2) return null

  const trades = normalizeTrades(rawTrades)
  const profileData = buildManagerProfile(trades)

  const profile: ManagerTendencyProfile = {
    ...profileData,
    managerId: sleeperUsername,
    managerName: managerName || sleeperUsername,
    computedAt: Date.now(),
  }

  TENDENCY_CACHE.set(cacheKey, { data: profile, cachedAt: Date.now() })
  return profile
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

type TendencyLikeProfile = {
  sampleSize: number
  starterPremium: number
  positionBias: { QB: number; RB: number; WR: number; TE: number; PICK: number }
  riskTolerance: number
  consolidationBias: number
}

function computeRawAlignFromProfile(
  tendency: TendencyLikeProfile,
  oppReceiveAssets: AcceptProbabilityInput['oppReceiveAssets'],
  hasLineupData: boolean,
  x4: number,
  x5: number,
  starterUpgradePPG?: number,
  starterMatchOverride?: number,
): number {
  const assets = oppReceiveAssets ?? []

  const starterMatch = starterMatchOverride != null
    ? Math.max(-1, Math.min(1, starterMatchOverride))
    : starterUpgradePPG != null
      ? Math.max(-1, Math.min(1, starterUpgradePPG / 2.0))
      : 0

  const positionMatch = (() => {
    const players = assets.filter(a => a.type === 'PLAYER' && a.pos)
    if (players.length === 0) return 0
    const mainAsset = players.reduce((best, a) => {
      const mv = a.marketValue ?? a.value ?? 0
      const bestMv = best.marketValue ?? best.value ?? 0
      return mv > bestMv ? a : best
    }, players[0])
    const mainPos = (mainAsset.pos ?? '').toUpperCase() as keyof TendencyLikeProfile['positionBias']
    return tendency.positionBias[mainPos] ?? 0
  })()

  const riskMatch = tendency.riskTolerance * Math.sign(x5)
  const consolidationMatch = (2 * tendency.consolidationBias - 1) * Math.sign(-x4)

  return 0.35 * starterMatch + 0.30 * positionMatch + 0.20 * riskMatch + 0.15 * consolidationMatch
}

function averageProfileTendency(tendencies: TendencyLikeProfile[]): TendencyLikeProfile | null {
  if (tendencies.length === 0) return null
  const n = tendencies.length
  return {
    sampleSize: tendencies.reduce((s, t) => s + t.sampleSize, 0),
    starterPremium: tendencies.reduce((s, t) => s + t.starterPremium, 0) / n,
    positionBias: {
      QB: tendencies.reduce((s, t) => s + t.positionBias.QB, 0) / n,
      RB: tendencies.reduce((s, t) => s + t.positionBias.RB, 0) / n,
      WR: tendencies.reduce((s, t) => s + t.positionBias.WR, 0) / n,
      TE: tendencies.reduce((s, t) => s + t.positionBias.TE, 0) / n,
      PICK: tendencies.reduce((s, t) => s + t.positionBias.PICK, 0) / n,
    },
    riskTolerance: tendencies.reduce((s, t) => s + t.riskTolerance, 0) / n,
    consolidationBias: tendencies.reduce((s, t) => s + t.consolidationBias, 0) / n,
  }
}

function computeManagerAlignFromProfile(
  tendencies: ManagerTendencyProfile | null,
  oppReceiveAssets: AcceptProbabilityInput['oppReceiveAssets'],
  hasLineupData: boolean,
  x4: number,
  x5: number,
  allTendencies?: TendencyLikeProfile[] | null,
  starterUpgradePPG?: number,
  starterMatchOverride?: number,
): number {
  const sampleSize = tendencies?.sampleSize ?? 0
  const m = Math.min(sampleSize / 10, 1)
  const l = 0.6 * (1 - m)
  const g = 0.4 * (1 - m)

  const x6Manager = (tendencies && sampleSize >= 5)
    ? computeRawAlignFromProfile(tendencies, oppReceiveAssets, hasLineupData, x4, x5, starterUpgradePPG, starterMatchOverride)
    : 0

  let x6League = 0
  const leagueEntries = (allTendencies ?? []).filter(t => t.sampleSize >= 3)
  if (leagueEntries.length > 0) {
    const leagueAvg = averageProfileTendency(leagueEntries)
    if (leagueAvg) {
      x6League = computeRawAlignFromProfile(leagueAvg, oppReceiveAssets, hasLineupData, x4, x5, starterUpgradePPG, starterMatchOverride)
    }
  }

  const x6Global = 0

  const blended = m * x6Manager + l * x6League + g * x6Global
  return Math.max(-2, Math.min(2, blended * 1.5))
}

export function computeAcceptProbability(input: AcceptProbabilityInput): AcceptProbabilityResult {
  const {
    marketDeltaOppPct,
    dealShapeOpp,
    volDeltaOpp,
    tendencies,
    oppLineupDeltaPPG,
    needFitPPG,
    oppReceiveAssets,
    hasLineupData = false,
    isDeadlineWindow = false,
    allTendencies = null,
    starterUpgradePPG,
    starterMatchOverride,
  } = input

  const x1 = oppLineupDeltaPPG != null
    ? Math.max(-2, Math.min(2, oppLineupDeltaPPG / 3.0))
    : null

  const x2 = needFitPPG != null
    ? Math.max(-2, Math.min(2, needFitPPG / 2.0))
    : null

  const x3 = Math.max(-2, Math.min(2, -marketDeltaOppPct / 12))

  const x4 = Math.max(-2, Math.min(2, dealShapeOpp / 2))

  const x5 = Math.max(-2, Math.min(2, volDeltaOpp * 2))

  const x6 = computeManagerAlignFromProfile(
    tendencies, oppReceiveAssets, hasLineupData, x4, x5, allTendencies, starterUpgradePPG, starterMatchOverride,
  )

  const oppGainingPPG = (oppLineupDeltaPPG ?? 0) > 0
  const x7 = (isDeadlineWindow && oppGainingPPG) ? 0.5 : 0

  const cw = input.calibratedWeights
  const b0 = cw?.b0 ?? -1.10
  const z = b0
    + (cw?.w1 ?? 1.25) * (x1 ?? 0)
    + (cw?.w2 ?? 0.70) * (x2 ?? 0)
    + (cw?.w3 ?? 0.90) * x3
    + (cw?.w4 ?? 0.15) * x4
    + (cw?.w5 ?? 0.25) * x5
    + (cw?.w6 ?? 0.85) * x6
    + (cw?.w7 ?? 0.20) * x7

  let probability = sigmoid(z)

  probability = Math.max(0.02, Math.min(0.95, probability))

  if (marketDeltaOppPct <= -25 && (needFitPPG ?? 0) < 0.75) {
    probability = Math.min(probability, 0.35)
  }

  const oppDelta = oppLineupDeltaPPG ?? 0
  if (oppDelta <= -1.0 && marketDeltaOppPct < 15) {
    probability = Math.min(probability, 0.20)
  }

  const signals: string[] = []

  if (tendencies && tendencies.sampleSize >= 3) {
    if (tendencies.starterPremium > 0.3) {
      signals.push('This manager historically pays a premium for starters')
    } else if (tendencies.starterPremium < -0.3) {
      signals.push('This manager typically acquires starters below market')
    }

    if (tendencies.overpayThreshold < -0.3) {
      signals.push('Has accepted trades where they gave up more value')
    }

    if (tendencies.consolidationBias > 0.5) {
      signals.push('Prefers consolidation trades (fewer, better pieces)')
    }

    if (tendencies.positionBias.PICK > 0.3) {
      signals.push('Values draft pick acquisition')
    } else if (tendencies.positionBias.PICK < -0.3) {
      signals.push('Willing to trade away picks for players')
    }

    const topBias = Object.entries(tendencies.positionBias)
      .filter(([k, v]) => k !== 'PICK' && v > 0.3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
    if (topBias.length > 0) {
      signals.push(`Tends to overpay for: ${topBias.map(([p]) => p).join(', ')}`)
    }

    if (tendencies.fairnessTolerance > 0.4) {
      signals.push('Accepts lopsided trades more readily')
    }
  } else {
    signals.push('Limited trade history — using league-wide defaults')
  }

  if (probability >= 0.65) {
    return { probability, label: 'Strong', rate: `${Math.round(probability * 100)}%`, emoji: '🟢', pill: 'High Accept', signals }
  }
  if (probability >= 0.45) {
    return { probability, label: 'Aggressive', rate: `${Math.round(probability * 100)}%`, emoji: '🟡', pill: 'Moderate', signals }
  }
  if (probability >= 0.25) {
    return { probability, label: 'Speculative', rate: `${Math.round(probability * 100)}%`, emoji: '🟠', pill: 'Low Accept', signals }
  }
  return { probability, label: 'Long Shot', rate: `${Math.round(probability * 100)}%`, emoji: '🔴', pill: 'Unlikely', signals }
}

export async function computeAndCacheTendencies(
  sleeperUsername: string,
  sleeperLeagueId: string,
  managerName?: string
): Promise<ManagerTendencyProfile | null> {
  const profile = await computeManagerTendencies(sleeperUsername, sleeperLeagueId, managerName)
  if (!profile) return null

  try {
    const existing = await getExistingManagerProfiles(sleeperUsername, sleeperLeagueId)
    const merged = { ...existing, [profile.managerId]: profile } as any
    await prisma.tradePreAnalysisCache.upsert({
      where: {
        sleeperUsername_sleeperLeagueId: { sleeperUsername, sleeperLeagueId },
      },
      update: {
        managerProfiles: merged,
        updatedAt: new Date(),
      },
      create: {
        sleeperUsername,
        sleeperLeagueId,
        managerProfiles: merged,
        status: 'ready',
      },
    })
  } catch { /* non-critical */ }

  return profile
}

async function getExistingManagerProfiles(
  sleeperUsername: string,
  sleeperLeagueId: string
): Promise<Record<string, ManagerTendencyProfile>> {
  try {
    const cache = await prisma.tradePreAnalysisCache.findUnique({
      where: {
        sleeperUsername_sleeperLeagueId: { sleeperUsername, sleeperLeagueId },
      },
      select: { managerProfiles: true },
    })
    return (cache?.managerProfiles as unknown as Record<string, ManagerTendencyProfile>) || {}
  } catch {
    return {}
  }
}

function describeNorm(v: number): string {
  if (v > 0.6) return 'very high'
  if (v > 0.3) return 'high'
  if (v > 0.1) return 'slightly high'
  if (v > -0.1) return 'neutral'
  if (v > -0.3) return 'slightly low'
  if (v > -0.6) return 'low'
  return 'very low'
}

export function tendenciesToPromptContext(t: ManagerTendencyProfile): string {
  const lines = [
    `Manager Tendencies for ${t.managerName} (${t.sampleSize} trades analyzed, all values -1 to +1):`,
  ]

  if (Math.abs(t.starterPremium) > 0.1) {
    const direction = t.starterPremium > 0 ? 'overpays' : 'underpays'
    lines.push(`- Starter premium: ${t.starterPremium.toFixed(2)} (${direction} for top-12 position players)`)
  }

  const biases = Object.entries(t.positionBias).filter(([, v]) => Math.abs(v) > 0.15)
  if (biases.length > 0) {
    for (const [pos, bias] of biases) {
      lines.push(`- ${pos} bias: ${bias > 0 ? '+' : ''}${bias.toFixed(2)} (${describeNorm(bias)})`)
    }
  }

  lines.push(`- Risk tolerance: ${t.riskTolerance.toFixed(2)} (${describeNorm(t.riskTolerance)})`)

  if (t.consolidationBias > 0.2) {
    lines.push(`- Consolidation bias: ${t.consolidationBias.toFixed(2)} (${t.consolidationBias > 0.5 ? 'strongly' : 'somewhat'} prefers 2-for-1 trades)`)
  }

  if (t.overpayThreshold < -0.1) {
    lines.push(`- Overpay threshold: ${t.overpayThreshold.toFixed(2)} (willing to accept negative value trades)`)
  }

  lines.push(`- Fairness tolerance: ${t.fairnessTolerance.toFixed(2)} (${t.fairnessTolerance > 0.4 ? 'accepts lopsided trades' : t.fairnessTolerance < 0.15 ? 'insists on even deals' : 'moderate'})`)

  return lines.join('\n')
}
