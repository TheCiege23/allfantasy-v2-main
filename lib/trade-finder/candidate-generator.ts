/*
 * TRADE FINDER — CANDIDATE GENERATOR
 *
 * Generates smart trade candidates using archetype templates,
 * deterministic scoring, and aggressive pruning.
 *
 * CONTRACT:
 * - All values are pre-computed (from LeagueDecisionContext + pricedAssets).
 * - No AI calls happen here — this is pure deterministic logic.
 * - Output is a ranked list of trade candidates ready for OpenAI ranking.
 *
 * DATA FLOW:
 *   LeagueDecisionContext + pricedAssets + rosters
 *   → identifyTradableAssets()
 *   → generateByArchetype() (5 archetypes)
 *   → scoreCandidates()
 *   → pruneAndRank()
 *   → TradeCandidate[]
 */

import { LeagueDecisionContext, TeamDecisionProfile, Position } from '@/lib/league-decision-context'

export type TradeObjective = 'WIN_NOW' | 'REBUILD' | 'BALANCED'
export type FinderMode = 'FAST' | 'DEEP'

type TradeArchetype =
  | 'POSITIONAL_SWAP'
  | 'CONSOLIDATION'
  | 'PICK_FOR_PLAYER'
  | 'WINDOW_ARBITRAGE'
  | 'INJURY_DISCOUNT'

export interface PricedAsset {
  assetId: string
  name: string
  value: number
  position: Position | string
  tier: string
  age?: number
  isStarter: boolean
  isPick?: boolean
  pickYear?: number
  pickRound?: number
  injuryFlag?: boolean
}

export interface TradeCandidate {
  tradeId: string
  teamA: { teamId: string; gives: PricedAsset[]; receives: PricedAsset[] }
  teamB: { teamId: string; gives: PricedAsset[]; receives: PricedAsset[] }
  finderScore: number
  archetype: TradeArchetype
  whyThisExists: string[]
  valueDeltaPct: number
  scoreBreakdown: {
    starterUpgrade: number
    objectiveAlignment: number
    valueFairness: number
    rosterFit: number
    scarcityBonus: number
  }
}

interface CandidateGeneratorInput {
  userTeamId: string
  leagueDecisionContext: LeagueDecisionContext
  pricedAssets: Record<string, PricedAsset[]>
  objective: TradeObjective
  mode: FinderMode
}

type OpportunityType = 'NEED_FIT' | 'CONSOLIDATION' | 'VOLATILITY_SWAP' | 'PICK_ARBITRAGE' | 'MONITOR'

export interface TradeOpportunity {
  type: OpportunityType
  title: string
  description: string
  icon: string
  targetManager?: string
  targetTeamId?: string
  relevantPlayers: Array<{ name: string; position: string; value: number; reason: string }>
  confidence: number
  actionable: boolean
}

interface CandidateGeneratorOutput {
  candidates: TradeCandidate[]
  opportunities: TradeOpportunity[]
  partnersEvaluated: number
  rawCandidatesGenerated: number
  prunedTo: number
}

const SCORE_THRESHOLD = 55
const FAIRNESS_WINDOW = 0.25

function tierValue(tier: string): number {
  switch (tier) {
    case 'Tier0_Untouchable': return 6
    case 'Tier1_Cornerstone': return 5
    case 'Tier2_HighEnd': return 4
    case 'Tier3_Starter': return 3
    case 'Tier4_Depth': return 2
    case 'Tier5_Filler': return 1
    default: return 1
  }
}

function isCoreLocked(asset: PricedAsset): boolean {
  return asset.isStarter && tierValue(asset.tier) >= 5
}

function getTradableAssets(
  assets: PricedAsset[],
  objective: TradeObjective,
  surpluses: Position[],
  needs: Position[]
): PricedAsset[] {
  return assets.filter(a => {
    if (isCoreLocked(a)) return false
    if (a.value < 500) return false

    if (a.isPick) {
      if (objective === 'WIN_NOW') return true
      if (objective === 'REBUILD') return a.pickRound !== 1
      return true
    }

    if (surpluses.includes(a.position as Position)) return true
    if (!a.isStarter && a.value >= 1000) return true
    if (a.isStarter && tierValue(a.tier) <= 3) return true

    return false
  })
}

function getTargetableAssets(
  assets: PricedAsset[],
  userNeeds: Position[]
): PricedAsset[] {
  return assets.filter(a => {
    if (a.value < 1000) return false
    if (a.isPick) return true
    if (userNeeds.includes(a.position as Position)) return true
    if (tierValue(a.tier) >= 4) return true
    return false
  })
}

function computeFinderScore(
  candidate: Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>,
  userTeam: TeamDecisionProfile,
  partnerTeam: TeamDecisionProfile,
  objective: TradeObjective,
  market: LeagueDecisionContext['market']
): { finderScore: number; scoreBreakdown: TradeCandidate['scoreBreakdown'] } {
  const userReceives = candidate.teamA.receives
  const userGives = candidate.teamA.gives
  const userGivenValue = userGives.reduce((s, a) => s + a.value, 0)
  const userReceivedValue = userReceives.reduce((s, a) => s + a.value, 0)

  let starterUpgrade = 0
  const receivedMaxTier = Math.max(...userReceives.map(a => tierValue(a.tier)), 0)
  const givenMaxTier = Math.max(...userGives.map(a => tierValue(a.tier)), 0)
  if (receivedMaxTier > givenMaxTier) starterUpgrade += 30
  const fillsNeed = userReceives.some(a =>
    !a.isPick && userTeam.needs.includes(a.position as Position)
  )
  if (fillsNeed) starterUpgrade += 40
  const upgradesPosition = userReceives.some(a => {
    if (a.isPick) return false
    const pos = a.position as Position
    const currentQuality = userTeam.starterQualityByPosition[pos] ?? 0
    return tierValue(a.tier) >= 3 && currentQuality < 60
  })
  if (upgradesPosition) starterUpgrade += 30
  starterUpgrade = Math.min(100, starterUpgrade)

  let objectiveAlignment = 0
  if (objective === 'WIN_NOW') {
    const receivesProducers = userReceives.filter(a => !a.isPick && tierValue(a.tier) >= 3).length
    objectiveAlignment += receivesProducers * 25
    const sellsPicks = userGives.filter(a => a.isPick).length
    objectiveAlignment += sellsPicks * 15
    const receivesYoungPicks = userReceives.filter(a => a.isPick).length
    objectiveAlignment -= receivesYoungPicks * 10
  } else if (objective === 'REBUILD') {
    const receivesPicks = userReceives.filter(a => a.isPick).length
    objectiveAlignment += receivesPicks * 25
    const receivesYoung = userReceives.filter(a => !a.isPick && (a.age ?? 25) <= 24).length
    objectiveAlignment += receivesYoung * 20
    const sellsAgingVets = userGives.filter(a => !a.isPick && (a.age ?? 25) >= 27).length
    objectiveAlignment += sellsAgingVets * 20
  } else {
    objectiveAlignment += 50
  }
  objectiveAlignment = Math.min(100, Math.max(0, objectiveAlignment))

  let valueFairness = 0
  if (userGivenValue > 0) {
    const delta = Math.abs(userReceivedValue - userGivenValue) / userGivenValue
    if (delta <= 0.05) valueFairness = 100
    else if (delta <= 0.10) valueFairness = 85
    else if (delta <= 0.15) valueFairness = 70
    else if (delta <= 0.20) valueFairness = 55
    else if (delta <= FAIRNESS_WINDOW) valueFairness = 40
    else valueFairness = 20
  }

  let rosterFit = 50
  const createsNewHole = userGives.some(a =>
    !a.isPick &&
    a.isStarter &&
    !userTeam.surpluses.includes(a.position as Position) &&
    userTeam.needs.includes(a.position as Position)
  )
  if (createsNewHole) rosterFit -= 40
  const partnerFillsTheirNeed = candidate.teamB.receives.some(a =>
    !a.isPick && partnerTeam.needs.includes(a.position as Position)
  )
  if (partnerFillsTheirNeed) rosterFit += 30
  rosterFit = Math.min(100, Math.max(0, rosterFit))

  let scarcityBonus = 0
  for (const asset of userReceives) {
    if (asset.isPick) continue
    const pos = asset.position as Position
    const scarcity = market.scarcityByPosition[pos] ?? 1
    if (scarcity >= 1.5) scarcityBonus += 30
    else if (scarcity >= 1.2) scarcityBonus += 15
  }
  scarcityBonus = Math.min(100, scarcityBonus)

  const finderScore = Math.round(
    starterUpgrade * 0.35 +
    objectiveAlignment * 0.25 +
    valueFairness * 0.20 +
    rosterFit * 0.10 +
    scarcityBonus * 0.10
  )

  return {
    finderScore,
    scoreBreakdown: {
      starterUpgrade,
      objectiveAlignment,
      valueFairness,
      rosterFit,
      scarcityBonus,
    },
  }
}

function generatePositionalSwaps(
  userTeamId: string,
  userTradable: PricedAsset[],
  partnerTeamId: string,
  partnerTargetable: PricedAsset[],
  userTeam: TeamDecisionProfile,
  partnerTeam: TeamDecisionProfile
): Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] {
  const candidates: Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] = []

  for (const userNeed of userTeam.needs) {
    if (!partnerTeam.surpluses.includes(userNeed)) continue

    const partnerAssetsAtNeed = partnerTargetable.filter(
      a => !a.isPick && a.position === userNeed
    )
    if (partnerAssetsAtNeed.length === 0) continue

    for (const partnerNeed of partnerTeam.needs) {
      if (!userTeam.surpluses.includes(partnerNeed)) continue

      const userAssetsForThem = userTradable.filter(
        a => !a.isPick && a.position === partnerNeed
      )
      if (userAssetsForThem.length === 0) continue

      const bestPartnerAsset = partnerAssetsAtNeed.sort((a, b) => b.value - a.value)[0]
      const bestUserAsset = findClosestValue(userAssetsForThem, bestPartnerAsset.value)
      if (!bestUserAsset) continue

      const delta = Math.abs(bestUserAsset.value - bestPartnerAsset.value)
      if (bestUserAsset.value > 0 && delta / bestUserAsset.value > FAIRNESS_WINDOW) continue

      candidates.push({
        tradeId: `swap_${userTeamId}_${partnerTeamId}_${userNeed}_${partnerNeed}`,
        teamA: {
          teamId: userTeamId,
          gives: [bestUserAsset],
          receives: [bestPartnerAsset],
        },
        teamB: {
          teamId: partnerTeamId,
          gives: [bestPartnerAsset],
          receives: [bestUserAsset],
        },
        archetype: 'POSITIONAL_SWAP',
        whyThisExists: ['SURPLUS_MATCH', `USER_NEEDS_${userNeed}`, `PARTNER_NEEDS_${partnerNeed}`],
        valueDeltaPct: bestUserAsset.value > 0
          ? Math.round(((bestPartnerAsset.value - bestUserAsset.value) / bestUserAsset.value) * 100)
          : 0,
      })
    }
  }

  return candidates
}

function generateConsolidations(
  userTeamId: string,
  userTradable: PricedAsset[],
  partnerTeamId: string,
  partnerTargetable: PricedAsset[],
  userTeam: TeamDecisionProfile,
  partnerTeam: TeamDecisionProfile
): Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] {
  const candidates: Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] = []

  const eliteTargets = partnerTargetable
    .filter(a => !a.isPick && tierValue(a.tier) >= 4)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)

  for (const target of eliteTargets) {
    const userPieces = userTradable
      .filter(a => !a.isPick && a.value < target.value && tierValue(a.tier) <= 3)
      .sort((a, b) => b.value - a.value)

    if (userPieces.length < 2) continue

    let bundle: PricedAsset[] = []
    let bundleValue = 0
    for (const piece of userPieces) {
      if (bundle.length >= 3) break
      bundle.push(piece)
      bundleValue += piece.value
      if (bundleValue >= target.value * 0.80 && bundleValue <= target.value * 1.20) break
    }

    if (bundle.length < 2) continue
    if (bundleValue < target.value * 0.75 || bundleValue > target.value * 1.25) continue

    candidates.push({
      tradeId: `consol_${userTeamId}_${partnerTeamId}_${target.assetId}`,
      teamA: {
        teamId: userTeamId,
        gives: bundle,
        receives: [target],
      },
      teamB: {
        teamId: partnerTeamId,
        gives: [target],
        receives: bundle,
      },
      archetype: 'CONSOLIDATION',
      whyThisExists: ['STARTER_UPGRADE', `CONSOLIDATION_${bundle.length}_FOR_1`],
      valueDeltaPct: bundleValue > 0
        ? Math.round(((target.value - bundleValue) / bundleValue) * 100)
        : 0,
    })
  }

  return candidates
}

function generatePickForPlayer(
  userTeamId: string,
  userTradable: PricedAsset[],
  partnerTeamId: string,
  partnerTargetable: PricedAsset[],
  userTeam: TeamDecisionProfile,
  partnerTeam: TeamDecisionProfile,
  objective: TradeObjective
): Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] {
  const candidates: Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] = []

  if (objective === 'WIN_NOW' || objective === 'BALANCED') {
    const userPicks = userTradable.filter(a => a.isPick && a.value >= 1500)
    const partnerPlayers = partnerTargetable
      .filter(a => !a.isPick && tierValue(a.tier) >= 3)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    for (const player of partnerPlayers) {
      const bestPick = findClosestValue(userPicks, player.value)
      if (!bestPick) continue
      const delta = Math.abs(bestPick.value - player.value)
      if (bestPick.value > 0 && delta / bestPick.value > FAIRNESS_WINDOW) continue

      candidates.push({
        tradeId: `p4p_buy_${userTeamId}_${partnerTeamId}_${player.assetId}`,
        teamA: {
          teamId: userTeamId,
          gives: [bestPick],
          receives: [player],
        },
        teamB: {
          teamId: partnerTeamId,
          gives: [player],
          receives: [bestPick],
        },
        archetype: 'PICK_FOR_PLAYER',
        whyThisExists: ['BUY_PRODUCER', `PICK_${bestPick.pickRound}_FOR_${player.position}`],
        valueDeltaPct: bestPick.value > 0
          ? Math.round(((player.value - bestPick.value) / bestPick.value) * 100)
          : 0,
      })
    }
  }

  if (objective === 'REBUILD' || objective === 'BALANCED') {
    const userVets = userTradable
      .filter(a => !a.isPick && (a.age ?? 25) >= 26 && a.value >= 2000)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
    const partnerPicks = partnerTargetable.filter(a => a.isPick && a.value >= 1500)

    for (const vet of userVets) {
      const bestPick = findClosestValue(partnerPicks, vet.value)
      if (!bestPick) continue
      const delta = Math.abs(bestPick.value - vet.value)
      if (vet.value > 0 && delta / vet.value > FAIRNESS_WINDOW) continue

      candidates.push({
        tradeId: `p4p_sell_${userTeamId}_${partnerTeamId}_${vet.assetId}`,
        teamA: {
          teamId: userTeamId,
          gives: [vet],
          receives: [bestPick],
        },
        teamB: {
          teamId: partnerTeamId,
          gives: [bestPick],
          receives: [vet],
        },
        archetype: 'PICK_FOR_PLAYER',
        whyThisExists: ['SELL_AGING_PRODUCER', `VET_${vet.position}_FOR_PICK`],
        valueDeltaPct: vet.value > 0
          ? Math.round(((bestPick.value - vet.value) / vet.value) * 100)
          : 0,
      })
    }
  }

  return candidates
}

function generateWindowArbitrage(
  userTeamId: string,
  userTradable: PricedAsset[],
  partnerTeamId: string,
  partnerTargetable: PricedAsset[],
  userTeam: TeamDecisionProfile,
  partnerTeam: TeamDecisionProfile,
  objective: TradeObjective
): Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] {
  const candidates: Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] = []

  const windowMismatch =
    (userTeam.competitiveWindow === 'WIN_NOW' && partnerTeam.competitiveWindow === 'REBUILD') ||
    (userTeam.competitiveWindow === 'REBUILD' && partnerTeam.competitiveWindow === 'WIN_NOW')
  if (!windowMismatch) return candidates

  if (userTeam.competitiveWindow === 'WIN_NOW') {
    const partnerProducers = partnerTargetable
      .filter(a => !a.isPick && tierValue(a.tier) >= 3 && (a.age ?? 25) >= 26)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)

    const userFutureAssets = userTradable
      .filter(a => a.isPick || (!a.isPick && (a.age ?? 25) <= 24))
      .sort((a, b) => b.value - a.value)

    for (const producer of partnerProducers) {
      const matchingAssets = buildValueMatch(userFutureAssets, producer.value)
      if (!matchingAssets) continue

      candidates.push({
        tradeId: `arb_wn_${userTeamId}_${partnerTeamId}_${producer.assetId}`,
        teamA: {
          teamId: userTeamId,
          gives: matchingAssets,
          receives: [producer],
        },
        teamB: {
          teamId: partnerTeamId,
          gives: [producer],
          receives: matchingAssets,
        },
        archetype: 'WINDOW_ARBITRAGE',
        whyThisExists: ['WINDOW_MISMATCH', 'CONTENDER_BUYS_PRODUCER', `REBUILDER_GETS_FUTURE`],
        valueDeltaPct: 0,
      })
    }
  } else {
    const userProducers = userTradable
      .filter(a => !a.isPick && tierValue(a.tier) >= 3 && (a.age ?? 25) >= 26)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)

    const partnerFutureAssets = partnerTargetable
      .filter(a => a.isPick || (!a.isPick && (a.age ?? 25) <= 24))
      .sort((a, b) => b.value - a.value)

    for (const producer of userProducers) {
      const matchingAssets = buildValueMatch(partnerFutureAssets, producer.value)
      if (!matchingAssets) continue

      candidates.push({
        tradeId: `arb_rb_${userTeamId}_${partnerTeamId}_${producer.assetId}`,
        teamA: {
          teamId: userTeamId,
          gives: [producer],
          receives: matchingAssets,
        },
        teamB: {
          teamId: partnerTeamId,
          gives: matchingAssets,
          receives: [producer],
        },
        archetype: 'WINDOW_ARBITRAGE',
        whyThisExists: ['WINDOW_MISMATCH', 'REBUILDER_SELLS_VET', `CONTENDER_GETS_PRODUCER`],
        valueDeltaPct: 0,
      })
    }
  }

  return candidates
}

function generateInjuryDiscounts(
  userTeamId: string,
  userTradable: PricedAsset[],
  partnerTeamId: string,
  partnerTargetable: PricedAsset[],
  userTeam: TeamDecisionProfile,
  partnerTeam: TeamDecisionProfile
): Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] {
  const candidates: Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] = []

  const injuredStars = partnerTargetable.filter(
    a => !a.isPick && a.injuryFlag && tierValue(a.tier) >= 3
  )

  for (const injured of injuredStars) {
    const discountedValue = injured.value * 0.80
    const offer = findClosestValue(userTradable, discountedValue)
    if (!offer) continue

    candidates.push({
      tradeId: `inj_${userTeamId}_${partnerTeamId}_${injured.assetId}`,
      teamA: {
        teamId: userTeamId,
        gives: [offer],
        receives: [injured],
      },
      teamB: {
        teamId: partnerTeamId,
        gives: [injured],
        receives: [offer],
      },
      archetype: 'INJURY_DISCOUNT',
      whyThisExists: ['INJURY_BUY_LOW', `${injured.position}_DISCOUNT`],
      valueDeltaPct: offer.value > 0
        ? Math.round(((injured.value - offer.value) / offer.value) * 100)
        : 0,
    })
  }

  return candidates
}

function findClosestValue(assets: PricedAsset[], targetValue: number): PricedAsset | null {
  if (assets.length === 0) return null
  let best: PricedAsset | null = null
  let bestDelta = Infinity
  for (const a of assets) {
    const delta = Math.abs(a.value - targetValue)
    if (delta < bestDelta) {
      bestDelta = delta
      best = a
    }
  }
  return best
}

function buildValueMatch(
  pool: PricedAsset[],
  targetValue: number
): PricedAsset[] | null {
  const single = findClosestValue(pool, targetValue)
  if (single && Math.abs(single.value - targetValue) / targetValue <= FAIRNESS_WINDOW) {
    return [single]
  }

  const sorted = [...pool].sort((a, b) => b.value - a.value)
  const bundle: PricedAsset[] = []
  let total = 0
  for (const a of sorted) {
    if (bundle.length >= 3) break
    bundle.push(a)
    total += a.value
    if (total >= targetValue * 0.80) break
  }

  if (bundle.length >= 1 && total >= targetValue * 0.75 && total <= targetValue * 1.25) {
    return bundle
  }

  return null
}

function deduplicateCandidates(
  candidates: TradeCandidate[]
): TradeCandidate[] {
  const seen = new Set<string>()
  return candidates.filter(c => {
    const key = [
      ...c.teamA.gives.map(a => a.assetId).sort(),
      '|',
      ...c.teamA.receives.map(a => a.assetId).sort(),
    ].join(',')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function generateFallbackOpportunities(
  userTeamId: string,
  leagueDecisionContext: LeagueDecisionContext,
  pricedAssets: Record<string, PricedAsset[]>,
  objective: TradeObjective,
  existingCandidateCount: number
): TradeOpportunity[] {
  const { teams, market, partnerFit } = leagueDecisionContext
  const userTeam = teams[userTeamId]
  if (!userTeam) return []

  const opportunities: TradeOpportunity[] = []
  const userAssets = pricedAssets[userTeamId] || []

  const allPartners = Object.entries(teams).filter(([id]) => id !== userTeamId)

  // 1. NEED-FIT DEALS — find managers whose weakest slot matches user surplus
  for (const [partnerId, partner] of allPartners) {
    if (opportunities.filter(o => o.type === 'NEED_FIT').length >= 2) break

    const partnerNeeds = partner.needs
    const userSurpluses = userTeam.surpluses
    const matchingPositions = partnerNeeds.filter(n => userSurpluses.includes(n))
    if (matchingPositions.length === 0) continue

    const partnerAssets = pricedAssets[partnerId] || []
    const relevantPlayers: TradeOpportunity['relevantPlayers'] = []

    for (const pos of matchingPositions) {
      const userPlayersAtPos = userAssets
        .filter(a => !a.isPick && a.position === pos && !isCoreLocked(a) && a.value >= 1000)
        .sort((a, b) => b.value - a.value)
      const bestSend = userPlayersAtPos[0]
      if (!bestSend) continue

      const partnerReturnOptions = partnerAssets
        .filter(a => !a.isPick && userTeam.needs.includes(a.position as Position) && a.value >= bestSend.value * 0.6)
        .sort((a, b) => b.value - a.value)
      const bestReturn = partnerReturnOptions[0]

      relevantPlayers.push({
        name: bestSend.name,
        position: pos,
        value: bestSend.value,
        reason: `Their weakest slot is ${pos} — your depth piece fills a real need`
      })
      if (bestReturn) {
        relevantPlayers.push({
          name: bestReturn.name,
          position: bestReturn.position as string,
          value: bestReturn.value,
          reason: `They could send back ${bestReturn.position} help you need`
        })
      }
    }

    if (relevantPlayers.length > 0) {
      const fitInfo = partnerFit[partnerId]
      opportunities.push({
        type: 'NEED_FIT',
        title: 'Need-Fit Deal',
        description: `They need ${matchingPositions.join('/')} and you have surplus depth. Value may not perfectly align today, but roster fit creates negotiation leverage.`,
        icon: '🎯',
        targetTeamId: partnerId,
        relevantPlayers: relevantPlayers.slice(0, 3),
        confidence: Math.min(75, 40 + matchingPositions.length * 15 + (fitInfo?.fitScore ?? 0) / 5),
        actionable: true,
      })
    }
  }

  // 2. CONSOLIDATION OFFERS — find elite players user could consolidate toward
  const eliteTargets: TradeOpportunity['relevantPlayers'] = []
  for (const [partnerId] of allPartners) {
    const partnerAssets = pricedAssets[partnerId] || []
    const elites = partnerAssets
      .filter(a => !a.isPick && tierValue(a.tier) >= 4 && a.value >= 5000)
      .sort((a, b) => b.value - a.value)

    for (const elite of elites.slice(0, 2)) {
      const userBundlePieces = userAssets
        .filter(a => !a.isPick && !isCoreLocked(a) && a.value >= 1000 && a.value < elite.value)
        .sort((a, b) => b.value - a.value)
      if (userBundlePieces.length < 2) continue

      let bundleValue = 0
      const bundle: PricedAsset[] = []
      for (const p of userBundlePieces) {
        if (bundle.length >= 3) break
        bundle.push(p)
        bundleValue += p.value
        if (bundleValue >= elite.value * 0.70) break
      }

      if (bundle.length >= 2 && bundleValue >= elite.value * 0.60) {
        eliteTargets.push({
          name: elite.name,
          position: elite.position as string,
          value: elite.value,
          reason: `Bundle ${bundle.length} pieces (${bundle.map(b => b.name).join(' + ')}) — value gap is ${Math.round((1 - bundleValue / elite.value) * 100)}%`
        })
      }
    }
  }
  if (eliteTargets.length > 0) {
    opportunities.push({
      type: 'CONSOLIDATION',
      title: 'Consolidation Offers',
      description: `No clean 1-for-1 value matches, but you have depth pieces to bundle for a star upgrade. Consolidation trades often need sweeteners to close the gap.`,
      icon: '📦',
      relevantPlayers: eliteTargets.slice(0, 3),
      confidence: Math.min(60, 30 + eliteTargets.length * 10),
      actionable: true,
    })
  }

  // 3. VOLATILITY SWAPS — find risk-on managers (high trade count or rebuilders)
  const riskOnPartners = allPartners
    .filter(([id]) => {
      const fit = partnerFit[id]
      return fit && fit.fitScore >= 25
    })
    .filter(([, partner]) => partner.competitiveWindow === 'REBUILD' || partner.flags.includes('ACTIVE_TRADER'))
    .slice(0, 3)

  if (riskOnPartners.length > 0) {
    const volatilePlayers: TradeOpportunity['relevantPlayers'] = []
    for (const [partnerId, partner] of riskOnPartners) {
      const partnerAssets = pricedAssets[partnerId] || []
      const injuredOrVolatile = partnerAssets
        .filter(a => !a.isPick && (a.injuryFlag || tierValue(a.tier) >= 3) && a.value >= 2000)
        .sort((a, b) => b.value - a.value)
      for (const p of injuredOrVolatile.slice(0, 2)) {
        volatilePlayers.push({
          name: p.name,
          position: p.position as string,
          value: p.value,
          reason: p.injuryFlag
            ? `Injured star on a ${partner.competitiveWindow === 'REBUILD' ? 'rebuilding' : 'active trading'} team — buy-low window`
            : `Volatile asset on a risk-tolerant team — they might sell for picks`
        })
      }
    }
    if (volatilePlayers.length > 0) {
      opportunities.push({
        type: 'VOLATILITY_SWAP',
        title: 'Volatility Swaps',
        description: `These managers are active traders or rebuilders who may accept riskier deals. Target their volatile or injured assets at a discount.`,
        icon: '🎰',
        relevantPlayers: volatilePlayers.slice(0, 3),
        confidence: Math.min(55, 25 + volatilePlayers.length * 10),
        actionable: true,
      })
    }
  }

  // 4. PICK ARBITRAGE — check if rookie fever makes picks extra valuable
  const pickInflation = market.pickInflationIndex
  if (pickInflation >= 1.2) {
    const userPicks = userAssets.filter(a => a.isPick && a.value >= 1500)
    const overvaluedPicks: TradeOpportunity['relevantPlayers'] = userPicks
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map(p => ({
        name: p.name,
        position: 'PICK',
        value: p.value,
        reason: `Pick inflation is ${Math.round(pickInflation * 100 - 100)}% above normal — sell high for proven producers`
      }))

    if (overvaluedPicks.length > 0) {
      opportunities.push({
        type: 'PICK_ARBITRAGE',
        title: 'Pick Arbitrage',
        description: `Rookie fever is running hot (${Math.round(pickInflation * 100 - 100)}% inflation). Your picks are worth more than usual — consider selling high for proven talent.`,
        icon: '📈',
        relevantPlayers: overvaluedPicks,
        confidence: Math.min(70, 35 + Math.round(pickInflation * 20)),
        actionable: userPicks.length > 0,
      })
    }
  }

  // 5. MONITOR LIST — always include top 3 players worth watching
  const monitorPlayers: TradeOpportunity['relevantPlayers'] = []

  for (const [partnerId] of allPartners) {
    const partnerAssets = pricedAssets[partnerId] || []
    for (const asset of partnerAssets) {
      if (asset.isPick || asset.value < 2000) continue
      if (asset.injuryFlag) {
        monitorPlayers.push({
          name: asset.name,
          position: asset.position as string,
          value: asset.value,
          reason: 'Currently injured — value may drop further, creating a buy window'
        })
      }
      if (userTeam.needs.includes(asset.position as Position) && tierValue(asset.tier) >= 4) {
        monitorPlayers.push({
          name: asset.name,
          position: asset.position as string,
          value: asset.value,
          reason: `Elite ${asset.position} that fills your need — watch for their team to start selling`
        })
      }
    }
  }

  const seen = new Set<string>()
  const uniqueMonitor = monitorPlayers.filter(p => {
    if (seen.has(p.name)) return false
    seen.add(p.name)
    return true
  }).sort((a, b) => b.value - a.value).slice(0, 3)

  if (uniqueMonitor.length > 0) {
    opportunities.push({
      type: 'MONITOR',
      title: 'Watch & Wait',
      description: existingCandidateCount === 0
        ? `No clean market wins today, but keep these players on your radar. Their situations could shift any week.`
        : `Keep these players on your radar for future opportunities.`,
      icon: '👀',
      relevantPlayers: uniqueMonitor,
      confidence: 30,
      actionable: false,
    })
  }

  if (!opportunities.some(o => o.type === 'MONITOR')) {
    const fallbackNeeds = userTeam.needs.slice(0, 3).map(pos => ({
      name: `Best available ${pos}`,
      position: pos as string,
      value: 0,
      reason: `You need ${pos} — monitor the market for value shifts`
    }))
    opportunities.push({
      type: 'MONITOR',
      title: 'Watch & Wait',
      description: 'No clear moves right now. Keep watching the market for value shifts.',
      icon: '👀',
      relevantPlayers: fallbackNeeds.length > 0 ? fallbackNeeds : [{ name: 'League landscape', position: 'ALL', value: 0, reason: 'Monitor for injured starters or bye-week fire sales' }],
      confidence: 20,
      actionable: false,
    })
  }

  return opportunities
}

export function generateTradeCandidates(
  input: CandidateGeneratorInput
): CandidateGeneratorOutput {
  const { userTeamId, leagueDecisionContext, pricedAssets, objective, mode } = input
  const { teams, market, partnerFit } = leagueDecisionContext

  const userTeam = teams[userTeamId]
  if (!userTeam) {
    return { candidates: [], opportunities: [], partnersEvaluated: 0, rawCandidatesGenerated: 0, prunedTo: 0 }
  }

  const partners = Object.values(partnerFit)
    .filter(p => p.fitScore >= 40)
    .sort((a, b) => b.fitScore - a.fitScore)

  const maxPartners = mode === 'FAST' ? 5 : 12
  const selectedPartners = partners.slice(0, maxPartners)

  const userAssets = pricedAssets[userTeamId] || []
  const userTradable = getTradableAssets(userAssets, objective, userTeam.surpluses, userTeam.needs)

  let rawCandidates: Omit<TradeCandidate, 'finderScore' | 'scoreBreakdown'>[] = []

  for (const partner of selectedPartners) {
    const partnerTeam = teams[partner.teamId]
    if (!partnerTeam) continue

    const partnerAssets = pricedAssets[partner.teamId] || []
    const partnerTargetable = getTargetableAssets(partnerAssets, userTeam.needs)

    rawCandidates.push(
      ...generatePositionalSwaps(userTeamId, userTradable, partner.teamId, partnerTargetable, userTeam, partnerTeam),
      ...generateConsolidations(userTeamId, userTradable, partner.teamId, partnerTargetable, userTeam, partnerTeam),
      ...generatePickForPlayer(userTeamId, userTradable, partner.teamId, partnerTargetable, userTeam, partnerTeam, objective),
      ...generateWindowArbitrage(userTeamId, userTradable, partner.teamId, partnerTargetable, userTeam, partnerTeam, objective),
      ...generateInjuryDiscounts(userTeamId, userTradable, partner.teamId, partnerTargetable, userTeam, partnerTeam),
    )
  }

  const scoredCandidates: TradeCandidate[] = rawCandidates.map(raw => {
    const partnerTeam = teams[raw.teamB.teamId]
    if (!partnerTeam) {
      return { ...raw, finderScore: 0, scoreBreakdown: { starterUpgrade: 0, objectiveAlignment: 0, valueFairness: 0, rosterFit: 0, scarcityBonus: 0 } }
    }
    const { finderScore, scoreBreakdown } = computeFinderScore(raw, userTeam, partnerTeam, objective, market)
    return { ...raw, finderScore, scoreBreakdown }
  })

  const qualifiedCandidates = scoredCandidates
    .filter(c => c.finderScore >= SCORE_THRESHOLD)

  const deduplicated = deduplicateCandidates(qualifiedCandidates)

  const maxResults = mode === 'FAST' ? 8 : 15
  const finalCandidates = deduplicated
    .sort((a, b) => b.finderScore - a.finderScore)
    .slice(0, maxResults)

  const opportunities = generateFallbackOpportunities(
    userTeamId,
    leagueDecisionContext,
    pricedAssets,
    objective,
    finalCandidates.length
  )

  return {
    candidates: finalCandidates,
    opportunities,
    partnersEvaluated: selectedPartners.length,
    rawCandidatesGenerated: rawCandidates.length,
    prunedTo: finalCandidates.length,
  }
}
