import type { ManagerTendencyProfile } from '@/lib/trade-engine/manager-tendency-engine'
import type { ManagerProfile, LeagueIntelligence } from '@/lib/trade-engine/types'
import type { PricedAsset } from './candidate-generator'

export type MatchmakingGoal =
  | 'rb_depth'
  | 'wr_depth'
  | 'qb_upgrade'
  | 'te_upgrade'
  | 'get_younger'
  | 'acquire_picks'
  | 'win_now'
  | 'rebuild'
  | 'target_player'

interface MatchmakingInput {
  userRosterId: number
  goal: MatchmakingGoal
  targetPlayerName?: string
  targetPlayerId?: string
  intelligence: LeagueIntelligence
  pricedAssets: Record<string, PricedAsset[]>
  tendencies: Record<string, ManagerTendencyProfile>
  maxResults?: number
}

interface OfferAsset {
  assetId: string
  name: string
  value: number
  position: string
  isPick: boolean
}

interface OfferSkeleton {
  userGives: OfferAsset[]
  partnerGives: OfferAsset[]
  fairnessPct: number
}

interface PartnerMatch {
  rosterId: number
  displayName: string
  avatar?: string
  contenderTier: string
  matchScore: number
  scoreBreakdown: {
    needOverlap: number
    targetAvailability: number
    biasAlignment: number
    tradeFrequency: number
    overpayWillingness: number
  }
  reasons: string[]
  acceptEstimate: number
  acceptLabel: string
  suggestedOffer: OfferSkeleton | null
  tendencyInsights: string[]
}

interface MatchmakingOutput {
  goal: MatchmakingGoal
  goalDescription: string
  targetPlayer?: string
  partners: PartnerMatch[]
  stats: {
    partnersEvaluated: number
    qualifiedPartners: number
  }
}

type GoalConfig = {
  targetPositions: string[]
  pickFocus: boolean
  preferStarters: boolean
  minValue: number
  description: string
}

const GOAL_CONFIGS: Record<MatchmakingGoal, GoalConfig> = {
  rb_depth:       { targetPositions: ['RB'], pickFocus: false, preferStarters: false, minValue: 2000, description: 'Find RB depth' },
  wr_depth:       { targetPositions: ['WR'], pickFocus: false, preferStarters: false, minValue: 2000, description: 'Find WR depth' },
  qb_upgrade:     { targetPositions: ['QB'], pickFocus: false, preferStarters: true,  minValue: 4000, description: 'Upgrade at QB' },
  te_upgrade:     { targetPositions: ['TE'], pickFocus: false, preferStarters: true,  minValue: 3000, description: 'Upgrade at TE' },
  get_younger:    { targetPositions: ['QB', 'RB', 'WR', 'TE'], pickFocus: false, preferStarters: false, minValue: 3000, description: 'Get younger assets' },
  acquire_picks:  { targetPositions: [],     pickFocus: true,  preferStarters: false, minValue: 1500, description: 'Acquire draft picks' },
  win_now:        { targetPositions: ['QB', 'RB', 'WR', 'TE'], pickFocus: false, preferStarters: true,  minValue: 5000, description: 'Win now — buy proven starters' },
  rebuild:        { targetPositions: ['QB', 'RB', 'WR', 'TE'], pickFocus: true,  preferStarters: false, minValue: 2000, description: 'Rebuild — get young + picks' },
  target_player:  { targetPositions: [],     pickFocus: false, preferStarters: false, minValue: 0,    description: 'Acquire specific player' },
}

const WEIGHTS = {
  needOverlap: 0.30,
  targetAvailability: 0.25,
  biasAlignment: 0.20,
  tradeFrequency: 0.15,
  overpayWillingness: 0.10,
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

function findTargetPlayer(
  pricedAssets: Record<string, PricedAsset[]>,
  targetName?: string,
  targetId?: string,
): { ownerId: string; asset: PricedAsset } | null {
  for (const [ownerId, assets] of Object.entries(pricedAssets)) {
    for (const asset of assets) {
      if (targetId && asset.assetId === targetId) return { ownerId, asset }
      if (targetName && asset.name.toLowerCase() === targetName.toLowerCase()) return { ownerId, asset }
    }
  }
  if (targetName) {
    const lower = targetName.toLowerCase()
    for (const [ownerId, assets] of Object.entries(pricedAssets)) {
      for (const asset of assets) {
        if (asset.name.toLowerCase().includes(lower)) return { ownerId, asset }
      }
    }
  }
  return null
}

function scoreNeedOverlap(
  userProfile: ManagerProfile,
  partnerProfile: ManagerProfile,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  const theyNeedOurSurplus = userProfile.surplus.filter(p => partnerProfile.needs.includes(p))
  if (theyNeedOurSurplus.length > 0) {
    score += theyNeedOurSurplus.length * 30
    reasons.push(`Needs ${theyNeedOurSurplus.join('/')} (your surplus)`)
  }

  const weNeedTheirSurplus = userProfile.needs.filter(p => partnerProfile.surplus.includes(p))
  if (weNeedTheirSurplus.length > 0) {
    score += weNeedTheirSurplus.length * 20
    reasons.push(`Has surplus ${weNeedTheirSurplus.join('/')} (your need)`)
  }

  return { score: clamp(score, 0, 100), reasons }
}

function scoreTargetAvailability(
  partnerAssets: PricedAsset[],
  goalConfig: GoalConfig,
  targetAsset?: PricedAsset | null,
  targetOwnerId?: string,
  partnerId?: string,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  if (targetAsset && targetOwnerId === partnerId) {
    score = 100
    reasons.push(`Owns ${targetAsset.name} (${targetAsset.value.toLocaleString()} value)`)
    return { score, reasons }
  }

  if (goalConfig.pickFocus) {
    const picks = partnerAssets.filter(a => a.isPick && a.value >= goalConfig.minValue)
    if (picks.length > 0) {
      score += Math.min(picks.length * 20, 80)
      reasons.push(`Has ${picks.length} draft pick${picks.length > 1 ? 's' : ''}`)
    }
  }

  for (const pos of goalConfig.targetPositions) {
    const posAssets = partnerAssets.filter(a =>
      !a.isPick && a.position === pos && a.value >= goalConfig.minValue
    )
    if (posAssets.length > 0) {
      const topValue = Math.max(...posAssets.map(a => a.value))
      score += Math.min(posAssets.length * 15, 60)
      if (topValue >= 5000) score += 20
      reasons.push(`Has ${posAssets.length} ${pos}${posAssets.length > 1 ? 's' : ''} (top: ${topValue.toLocaleString()})`)
    }
  }

  return { score: clamp(score, 0, 100), reasons }
}

function scoreBiasAlignment(
  tendency: ManagerTendencyProfile | undefined,
  userSurplus: string[],
  goalConfig: GoalConfig,
  targetAsset?: PricedAsset | null,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 50

  if (!tendency || tendency.sampleSize < 3) {
    reasons.push('Limited trade history — using neutral bias')
    return { score: 50, reasons }
  }

  const offerPositions = userSurplus.length > 0 ? userSurplus : goalConfig.targetPositions
  for (const pos of offerPositions) {
    const key = pos.toUpperCase() as keyof typeof tendency.positionBias
    const bias = tendency.positionBias[key] ?? 0
    if (bias > 0.2) {
      score += bias * 30
      reasons.push(`Historically overpays for ${pos}`)
    } else if (bias < -0.2) {
      score -= Math.abs(bias) * 15
    }
  }

  if (targetAsset && !targetAsset.isPick) {
    const targetPos = (targetAsset.position || '').toUpperCase() as keyof typeof tendency.positionBias
    const targetBias = tendency.positionBias[targetPos] ?? 0
    if (targetBias < -0.15) {
      score += Math.abs(targetBias) * 20
      reasons.push(`Undervalues ${targetAsset.position} (more willing to trade)`)
    }
  }

  if (goalConfig.pickFocus && tendency.positionBias.PICK < -0.15) {
    score += Math.abs(tendency.positionBias.PICK) * 25
    reasons.push('Willing to trade away picks')
  }

  if (tendency.consolidationBias > 0.4 && userSurplus.length >= 2) {
    score += 10
    reasons.push('Prefers consolidation (your depth for their star)')
  }

  return { score: clamp(score, 0, 100), reasons }
}

function scoreTradeFrequency(
  partnerProfile: ManagerProfile,
  tendency: ManagerTendencyProfile | undefined,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 40

  if (partnerProfile.tradeAggression === 'high') {
    score = 90
    reasons.push('Very active trader')
  } else if (partnerProfile.tradeAggression === 'medium') {
    score = 60
    reasons.push('Moderately active trader')
  } else {
    score = 20
    reasons.push('Rarely trades')
  }

  if (tendency) {
    if (tendency.sampleSize >= 8) {
      score = Math.min(score + 10, 100)
    } else if (tendency.sampleSize <= 2) {
      score = Math.max(score - 15, 0)
    }
  }

  return { score: clamp(score, 0, 100), reasons }
}

function scoreOverpayWillingness(
  tendency: ManagerTendencyProfile | undefined,
  fairnessDelta: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = []

  if (!tendency || tendency.sampleSize < 3) {
    return { score: 50, reasons: ['No overpay data available'] }
  }

  let score = 50

  if (tendency.overpayThreshold < -0.3) {
    score += 30
    reasons.push('Has accepted unfavorable trades before')
  } else if (tendency.overpayThreshold < -0.15) {
    score += 15
    reasons.push('Somewhat willing to overpay')
  }

  if (tendency.fairnessTolerance > 0.4) {
    score += 20
    reasons.push('Accepts lopsided trades more readily')
  } else if (tendency.fairnessTolerance < 0.15) {
    score -= 10
    reasons.push('Insists on even deals')
  }

  if (tendency.starterPremium > 0.3) {
    score += 10
    reasons.push('Pays a premium for starters')
  }

  return { score: clamp(score, 0, 100), reasons }
}

function buildOfferSkeleton(
  userAssets: PricedAsset[],
  partnerAssets: PricedAsset[],
  userProfile: ManagerProfile,
  partnerProfile: ManagerProfile,
  goalConfig: GoalConfig,
  targetAsset?: PricedAsset | null,
): OfferSkeleton | null {
  let partnerGivesAsset: PricedAsset | null = null

  if (targetAsset) {
    const owned = partnerAssets.find(a => a.assetId === targetAsset.assetId)
    if (owned) partnerGivesAsset = owned
  }

  if (!partnerGivesAsset) {
    if (goalConfig.pickFocus) {
      partnerGivesAsset = partnerAssets
        .filter(a => a.isPick && a.value >= goalConfig.minValue)
        .sort((a, b) => b.value - a.value)[0] || null
    } else {
      const candidates = partnerAssets
        .filter(a =>
          !a.isPick &&
          goalConfig.targetPositions.includes(a.position as string) &&
          a.value >= goalConfig.minValue
        )
        .sort((a, b) => b.value - a.value)
      partnerGivesAsset = candidates[0] || null
    }
  }

  if (!partnerGivesAsset) return null

  const targetValue = partnerGivesAsset.value
  const tradable = userAssets
    .filter(a => {
      if (a.value < 500) return false
      if (a.isStarter && a.value >= 9000) return false
      if (!a.isPick && partnerProfile.needs.includes(a.position as string)) return true
      if (a.isPick) return true
      if (!a.isStarter && a.value >= 1000) return true
      return false
    })
    .sort((a, b) => b.value - a.value)

  let best: PricedAsset[] = []
  let bestDelta = Infinity

  for (const asset of tradable) {
    const delta = Math.abs(asset.value - targetValue)
    if (delta < bestDelta && delta / targetValue <= 0.25) {
      best = [asset]
      bestDelta = delta
    }
  }

  if (best.length === 0) {
    const sorted = tradable.filter(a => a.value < targetValue)
    const bundle: PricedAsset[] = []
    let total = 0
    for (const a of sorted) {
      if (bundle.length >= 3) break
      bundle.push(a)
      total += a.value
      if (total >= targetValue * 0.80) break
    }
    if (bundle.length >= 1 && total >= targetValue * 0.75 && total <= targetValue * 1.30) {
      best = bundle
    }
  }

  if (best.length === 0) return null

  const userTotal = best.reduce((s, a) => s + a.value, 0)
  const fairnessPct = userTotal > 0
    ? Math.round(((partnerGivesAsset.value - userTotal) / userTotal) * 100)
    : 0

  return {
    userGives: best.map(a => ({
      assetId: a.assetId,
      name: a.name,
      value: a.value,
      position: a.position as string,
      isPick: !!a.isPick,
    })),
    partnerGives: [{
      assetId: partnerGivesAsset.assetId,
      name: partnerGivesAsset.name,
      value: partnerGivesAsset.value,
      position: partnerGivesAsset.position as string,
      isPick: !!partnerGivesAsset.isPick,
    }],
    fairnessPct,
  }
}

function buildTendencyInsights(tendency?: ManagerTendencyProfile): string[] {
  if (!tendency || tendency.sampleSize < 3) return ['Limited trade history']

  const insights: string[] = []

  if (tendency.starterPremium > 0.3) {
    insights.push('Pays a premium for starters')
  } else if (tendency.starterPremium < -0.3) {
    insights.push('Gets starters below market')
  }

  const topBias = Object.entries(tendency.positionBias)
    .filter(([, v]) => Math.abs(v) > 0.2)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
  for (const [pos, bias] of topBias) {
    insights.push(`${bias > 0 ? 'Overpays' : 'Underpays'} for ${pos}`)
  }

  if (tendency.consolidationBias > 0.5) {
    insights.push('Prefers fewer, better pieces')
  }

  if (tendency.riskTolerance > 0.3) {
    insights.push('Risk-tolerant — buys upside')
  } else if (tendency.riskTolerance < -0.3) {
    insights.push('Risk-averse — wants proven players')
  }

  if (tendency.fairnessTolerance > 0.4) {
    insights.push('Accepts uneven trades')
  }

  return insights.length > 0 ? insights : [`${tendency.sampleSize} trades analyzed`]
}

function estimateAcceptProbability(matchScore: number, fairnessPct: number): { prob: number; label: string } {
  let base = matchScore / 100

  if (Math.abs(fairnessPct) <= 5) base += 0.10
  else if (Math.abs(fairnessPct) <= 10) base += 0.05
  else if (Math.abs(fairnessPct) <= 20) base -= 0.05
  else base -= 0.15

  const prob = clamp(Math.round(base * 100) / 100, 0.05, 0.90)

  if (prob >= 0.60) return { prob, label: 'Strong' }
  if (prob >= 0.40) return { prob, label: 'Moderate' }
  if (prob >= 0.20) return { prob, label: 'Low' }
  return { prob, label: 'Long Shot' }
}

export function findBestPartners(input: MatchmakingInput): MatchmakingOutput {
  const {
    userRosterId,
    goal,
    targetPlayerName,
    targetPlayerId,
    intelligence,
    pricedAssets,
    tendencies,
    maxResults = 5,
  } = input

  const goalConfig = GOAL_CONFIGS[goal] || GOAL_CONFIGS.target_player
  const userProfile = intelligence.managerProfiles[userRosterId]
  const userAssets = pricedAssets[String(userRosterId)] || []

  let targetFound: { ownerId: string; asset: PricedAsset } | null = null
  if (targetPlayerName || targetPlayerId) {
    targetFound = findTargetPlayer(pricedAssets, targetPlayerName, targetPlayerId)
  }

  const effectiveGoalConfig = targetFound
    ? { ...goalConfig, targetPositions: [targetFound.asset.position as string], minValue: 0 }
    : goalConfig

  const allPartners = Object.entries(intelligence.managerProfiles)
    .filter(([id]) => Number(id) !== userRosterId)

  const scored: PartnerMatch[] = []

  for (const [rosterIdStr, partnerProfile] of allPartners) {
    const rosterId = Number(rosterIdStr)
    const partnerPriced = pricedAssets[rosterIdStr] || []
    const tendency = tendencies[rosterIdStr] || tendencies[partnerProfile.userId] || undefined

    const need = scoreNeedOverlap(userProfile, partnerProfile)
    const target = scoreTargetAvailability(
      partnerPriced, effectiveGoalConfig, targetFound?.asset, targetFound?.ownerId, rosterIdStr
    )
    const bias = scoreBiasAlignment(tendency, userProfile.surplus, effectiveGoalConfig, targetFound?.asset)
    const freq = scoreTradeFrequency(partnerProfile, tendency)
    const overpay = scoreOverpayWillingness(tendency, 0)

    const matchScore = Math.round(
      need.score * WEIGHTS.needOverlap +
      target.score * WEIGHTS.targetAvailability +
      bias.score * WEIGHTS.biasAlignment +
      freq.score * WEIGHTS.tradeFrequency +
      overpay.score * WEIGHTS.overpayWillingness
    )

    if (goal === 'target_player' && targetFound && targetFound.ownerId !== rosterIdStr) {
      continue
    }

    if (target.score === 0 && goal !== 'target_player') continue

    const offer = buildOfferSkeleton(
      userAssets, partnerPriced, userProfile, partnerProfile,
      effectiveGoalConfig, targetFound?.asset
    )

    const { prob, label } = estimateAcceptProbability(
      matchScore, offer?.fairnessPct ?? 0
    )

    const allReasons = [
      ...need.reasons,
      ...target.reasons,
      ...bias.reasons.filter(r => !r.includes('neutral')),
      ...freq.reasons,
      ...overpay.reasons.filter(r => !r.includes('No overpay')),
    ]

    scored.push({
      rosterId,
      displayName: partnerProfile.displayName,
      avatar: partnerProfile.avatar,
      contenderTier: partnerProfile.contenderTier,
      matchScore,
      scoreBreakdown: {
        needOverlap: need.score,
        targetAvailability: target.score,
        biasAlignment: bias.score,
        tradeFrequency: freq.score,
        overpayWillingness: overpay.score,
      },
      reasons: allReasons.slice(0, 6),
      acceptEstimate: prob,
      acceptLabel: label,
      suggestedOffer: offer,
      tendencyInsights: buildTendencyInsights(tendency),
    })
  }

  scored.sort((a, b) => b.matchScore - a.matchScore)
  const top = scored.slice(0, maxResults)

  return {
    goal,
    goalDescription: targetFound
      ? `Acquire ${targetFound.asset.name}`
      : goalConfig.description,
    targetPlayer: targetFound?.asset.name,
    partners: top,
    stats: {
      partnersEvaluated: allPartners.length,
      qualifiedPartners: scored.length,
    },
  }
}
