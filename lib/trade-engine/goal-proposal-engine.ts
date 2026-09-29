import type {
  Asset,
  LeagueIntelligence,
  ManagerProfile,
  TradeCandidate,
  AcceptDriver,
  NegotiationToolkit,
  NegotiationTheme,
  DriverDirection,
  DriverStrength,
} from './types'
import { runTradeEngine } from './trade-engine'
import { buildNegotiationToolkit, type NegotiationBuilderInput } from './negotiation-builder'
import type { TradeDriverData } from './trade-engine'

export type ProposalGoal =
  | 'rb_depth'
  | 'wr_depth'
  | 'qb_upgrade'
  | 'te_upgrade'
  | 'get_younger_rb'
  | 'get_younger_wr'
  | 'acquire_picks'
  | 'win_now'
  | 'rebuild'

type GoalSpec = {
  targetPositions: string[]
  ageFilter?: 'young' | 'prime' | null
  pickFocus: boolean
  preferStarters: boolean
  minValue: number
  maxValue: number
  description: string
}

const GOAL_SPECS: Record<ProposalGoal, GoalSpec> = {
  rb_depth:        { targetPositions: ['RB'], ageFilter: null, pickFocus: false, preferStarters: false, minValue: 2000, maxValue: 15000, description: 'Add RB depth' },
  wr_depth:        { targetPositions: ['WR'], ageFilter: null, pickFocus: false, preferStarters: false, minValue: 2000, maxValue: 15000, description: 'Add WR depth' },
  qb_upgrade:      { targetPositions: ['QB'], ageFilter: null, pickFocus: false, preferStarters: true,  minValue: 4000, maxValue: 99999, description: 'Upgrade at QB' },
  te_upgrade:      { targetPositions: ['TE'], ageFilter: null, pickFocus: false, preferStarters: true,  minValue: 3000, maxValue: 99999, description: 'Upgrade at TE' },
  get_younger_rb:  { targetPositions: ['RB'], ageFilter: 'young', pickFocus: false, preferStarters: false, minValue: 3000, maxValue: 99999, description: 'Get younger at RB' },
  get_younger_wr:  { targetPositions: ['WR'], ageFilter: 'young', pickFocus: false, preferStarters: false, minValue: 3000, maxValue: 99999, description: 'Get younger at WR' },
  acquire_picks:   { targetPositions: [],     ageFilter: null, pickFocus: true,  preferStarters: false, minValue: 1500, maxValue: 99999, description: 'Acquire draft picks' },
  win_now:         { targetPositions: ['QB', 'RB', 'WR', 'TE'], ageFilter: 'prime', pickFocus: false, preferStarters: true,  minValue: 5000, maxValue: 99999, description: 'Win now — acquire proven starters' },
  rebuild:         { targetPositions: ['QB', 'RB', 'WR', 'TE'], ageFilter: 'young', pickFocus: true,  preferStarters: false, minValue: 2000, maxValue: 99999, description: 'Rebuild — get young assets + picks' },
}

type PartnerScore = {
  rosterId: number
  profile: ManagerProfile
  score: number
  reasons: string[]
}

type ProposalTier = 'safe' | 'aggressive' | 'creative'

export type GoalProposal = {
  tier: ProposalTier
  tierLabel: string
  give: Asset[]
  receive: Asset[]
  giveTotal: number
  receiveTotal: number
  fairnessScore: number
  acceptProb: number
  acceptLabel: string
  topDrivers: Array<{
    name: string
    emoji: string
    direction: string
    strength: string
    detail: string
  }>
  counterPath: {
    description: string
    adjustments: Array<{
      description: string
      expectedDelta: number
    }>
  }
  dmCopy: {
    opener: string
    rationale: string
    fallback: string
  }
  sweeteners: Array<{
    suggestion: string
    expectedDelta: number
  }>
}

export type GoalProposalPartner = {
  rosterId: number
  displayName: string
  avatar?: string
  record?: { wins: number; losses: number }
  contenderTier: string
  matchReasons: string[]
  proposals: GoalProposal[]
}

export type GoalProposalOutput = {
  goal: ProposalGoal
  goalDescription: string
  partners: GoalProposalPartner[]
  stats: {
    partnersEvaluated: number
    candidatesGenerated: number
    proposalsBuilt: number
  }
}

function ageQualifies(age: number | undefined, filter: GoalSpec['ageFilter']): boolean {
  if (!filter) return true
  if (!age) return filter !== 'young'
  if (filter === 'young') return age <= 25
  if (filter === 'prime') return age >= 24 && age <= 30
  return true
}

function scorePartner(
  userProfile: ManagerProfile,
  partner: ManagerProfile,
  goalSpec: GoalSpec,
  intelligence: LeagueIntelligence,
): PartnerScore {
  let score = 0
  const reasons: string[] = []
  const partnerAssets = intelligence.assetsByRosterId[partner.rosterId] || []

  if (goalSpec.pickFocus) {
    const pickCount = partnerAssets.filter(a => a.type === 'PICK').length
    if (pickCount > 0) {
      score += pickCount * 8
      reasons.push(`Has ${pickCount} draft pick${pickCount > 1 ? 's' : ''}`)
    }
  }

  for (const pos of goalSpec.targetPositions) {
    const posAssets = partnerAssets.filter(a =>
      a.type === 'PLAYER' &&
      a.pos === pos &&
      a.value >= goalSpec.minValue &&
      a.value <= goalSpec.maxValue &&
      ageQualifies(a.age, goalSpec.ageFilter)
    )
    if (posAssets.length > 0) {
      score += posAssets.length * 10 + posAssets.reduce((s, a) => s + a.value, 0) / 1000
      reasons.push(`Has ${posAssets.length} matching ${pos}${posAssets.length > 1 ? 's' : ''}`)
    }
  }

  const needOverlap = userProfile.surplus.filter(p => partner.needs.includes(p))
  if (needOverlap.length > 0) {
    score += needOverlap.length * 15
    reasons.push(`Needs ${needOverlap.join('/')} (your surplus)`)
  }

  if (partner.tradeAggression === 'high') {
    score += 12
    reasons.push('Active trader')
  } else if (partner.tradeAggression === 'medium') {
    score += 6
  }

  if (partner.prefersPicks && !goalSpec.pickFocus) {
    score += 5
    reasons.push('Values picks (good trade partner)')
  }

  if (partner.prefersYouth && goalSpec.ageFilter === 'young') {
    score -= 5
  }

  return { rosterId: partner.rosterId, profile: partner, score, reasons }
}

function selectTargetAssets(partnerAssets: Asset[], goalSpec: GoalSpec): Asset[] {
  let targets: Asset[] = []

  if (goalSpec.pickFocus) {
    targets = partnerAssets
      .filter(a => a.type === 'PICK' && a.value >= goalSpec.minValue)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }

  const playerTargets = partnerAssets
    .filter(a =>
      a.type === 'PLAYER' &&
      goalSpec.targetPositions.includes(a.pos || '') &&
      a.value >= goalSpec.minValue &&
      a.value <= goalSpec.maxValue &&
      ageQualifies(a.age, goalSpec.ageFilter)
    )
    .sort((a, b) => {
      if (goalSpec.preferStarters) {
        const slotA = a.slot === 'Starter' ? 1 : 0
        const slotB = b.slot === 'Starter' ? 1 : 0
        if (slotA !== slotB) return slotB - slotA
      }
      return b.value - a.value
    })
    .slice(0, 5)

  targets = [...targets, ...playerTargets]
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  return targets
}

function parseAcceptanceRate(rate?: string): number {
  if (!rate) return 40
  const match = rate.match(/(\d+)-(\d+)/)
  if (match) return (parseInt(match[1]) + parseInt(match[2])) / 2
  const single = rate.match(/[<>]?(\d+)/)
  if (single) return parseInt(single[1])
  return 40
}

function dir(v: number): DriverDirection {
  if (v > 0.1) return 'UP'
  if (v < -0.1) return 'DOWN'
  return 'NEUTRAL'
}

function str(v: number): DriverStrength {
  const a = Math.abs(v)
  if (a >= 0.5) return 'STRONG'
  if (a >= 0.2) return 'MEDIUM'
  return 'WEAK'
}

function synthesizeDrivers(
  candidate: TradeCandidate,
  partner: ManagerProfile,
): AcceptDriver[] {
  const drivers: AcceptDriver[] = []
  const giveVal = candidate.giveTotal
  const recvVal = candidate.receiveTotal
  const deltaPct = recvVal > 0 ? ((giveVal - recvVal) / recvVal) * 100 : 0
  const fillsNeed = candidate.give.some(a => a.type === 'PLAYER' && partner.needs.includes(a.pos || ''))

  const fairnessSignal = candidate.fairnessScore - 0.5
  drivers.push({
    id: 'ar_market_mismatch',
    name: 'Market Fairness',
    emoji: '📈',
    direction: dir(fairnessSignal),
    strength: str(fairnessSignal),
    value: fairnessSignal,
    evidence: { metric: 'Fairness', raw: Math.round(candidate.fairnessScore * 100), unit: 'PCT', note: `${Math.round(candidate.fairnessScore * 100)}% fair` },
  })

  const needVal = fillsNeed ? 0.6 : -0.2
  drivers.push({
    id: 'ar_need_fit',
    name: 'Need Fit',
    emoji: '🎯',
    direction: dir(needVal),
    strength: str(needVal),
    value: needVal,
    evidence: { metric: 'Need Match', note: fillsNeed ? `Fills their ${partner.needs.join('/')} need` : 'Does not fill a roster need' },
  })

  const valueSignal = deltaPct > 0 ? Math.min(1, deltaPct / 15) : Math.max(-1, deltaPct / 15)
  drivers.push({
    id: 'ar_opp_lineup_gain',
    name: 'Value Delta',
    emoji: '📊',
    direction: dir(valueSignal),
    strength: str(valueSignal),
    value: valueSignal,
    evidence: { metric: 'Delta', raw: Math.round(deltaPct), unit: 'PCT', note: `${deltaPct > 0 ? '+' : ''}${Math.round(deltaPct)}% value shift for them` },
  })

  return drivers.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
}

function buildDmCopy(
  give: Asset[],
  receive: Asset[],
  partner: ManagerProfile,
  fillsNeed: boolean,
  fairnessScore: number,
): { opener: string; rationale: string; fallback: string } {
  const mainReceivePos = receive.find(a => a.type === 'PLAYER')?.pos || 'depth'
  const mainGiveNames = give.filter(a => a.type === 'PLAYER').map(a => a.name).slice(0, 2).join(' + ')
  const mainReceiveNames = receive.filter(a => a.type === 'PLAYER').map(a => a.name).slice(0, 2).join(' + ')

  if (fillsNeed) {
    return {
      opener: `Hey, I noticed you could use help at ${partner.needs.join('/')} — I think ${mainGiveNames || 'this package'} could be a great fit for you.`,
      // No claim that the deal is FAIR: the one trade grade says that, and the user sees it beside this copy.
      rationale: `This fills your ${partner.needs[0] || mainReceivePos} gap and I'm getting ${mainReceiveNames || 'what I need'} in return.`,
      fallback: `No worries if the pieces don't line up perfectly — happy to tweak it. What would make this work for you?`,
    }
  }

  if (fairnessScore >= 0.85) {
    return {
      opener: `I think this could help us both — want to take a look?`,
      rationale: `We're both getting pieces that fit our teams better.`,
      fallback: `If the fit isn't quite right, I'm open to adjusting. What would you need to make this work?`,
    }
  }

  return {
    opener: `Hey, I've been looking at rosters and think we could work something out — interested?`,
    rationale: `${mainGiveNames || 'My offer'} for ${mainReceiveNames || 'your pieces'} helps both our lineups.`,
    fallback: `Totally understand if you're not sold yet — let me know what you'd need to make it happen.`,
  }
}

function buildCounterPath(
  candidate: TradeCandidate,
  userBench: Asset[],
  userPicks: Asset[],
  partner: ManagerProfile,
) {
  const adjustments: Array<{ description: string; expectedDelta: number }> = []

  const benchForNeed = userBench.find(a =>
    a.type === 'PLAYER' &&
    partner.needs.includes(a.pos || '') &&
    !candidate.give.some(g => g.id === a.id)
  )
  if (benchForNeed) {
    adjustments.push({
      description: `Add ${benchForNeed.name} (${benchForNeed.pos}) — fills their ${benchForNeed.pos} need`,
      expectedDelta: 5,
    })
  }

  const cheapPick = userPicks
    .filter(p => !candidate.give.some(g => g.id === p.id) && (p.round ?? 4) >= 3)
    .sort((a, b) => a.value - b.value)[0]
  if (cheapPick) {
    adjustments.push({
      description: `Throw in ${cheapPick.displayName || 'a late-round pick'} to sweeten the deal`,
      expectedDelta: 4,
    })
  }

  if (adjustments.length === 0) {
    adjustments.push({
      description: 'Offer to add FAAB or a future pick to close the gap',
      expectedDelta: 3,
    })
  }

  return {
    description: adjustments.length > 0
      ? `If rejected: ${adjustments.map(a => a.description).join(' OR ')}`
      : 'Consider adding a late-round pick or FAAB to sweeten the deal.',
    adjustments,
  }
}

function findBestAssetCombo(
  pool: Asset[],
  targetValue: number,
  toleranceLow: number,
  toleranceHigh: number,
  maxAssets: number = 3,
): Asset[] | null {
  const sorted = pool.filter(a => a.value > 0).sort((a, b) => b.value - a.value).slice(0, 15)

  let bestCombo: Asset[] | null = null
  let bestDiff = Infinity

  for (let size = 1; size <= Math.min(maxAssets, sorted.length); size++) {
    const combos = getAssetCombos(sorted, size)
    for (const combo of combos) {
      const total = combo.reduce((s, a) => s + a.value, 0)
      if (total >= toleranceLow && total <= toleranceHigh) {
        const diff = Math.abs(total - targetValue)
        if (diff < bestDiff) {
          bestDiff = diff
          bestCombo = combo
        }
      }
    }
  }

  if (!bestCombo) {
    for (let size = 1; size <= Math.min(maxAssets, sorted.length); size++) {
      const combos = getAssetCombos(sorted, size)
      for (const combo of combos) {
        const total = combo.reduce((s, a) => s + a.value, 0)
        const diff = Math.abs(total - targetValue)
        if (diff < bestDiff && total >= toleranceLow * 0.8) {
          bestDiff = diff
          bestCombo = combo
        }
      }
    }
  }

  return bestCombo
}

function getAssetCombos(arr: Asset[], size: number): Asset[][] {
  if (size === 1) return arr.map(a => [a])
  const result: Asset[][] = []
  for (let i = 0; i <= arr.length - size; i++) {
    const rest = getAssetCombos(arr.slice(i + 1), size - 1)
    for (const combo of rest) {
      result.push([arr[i], ...combo])
    }
    if (result.length > 500) break
  }
  return result
}

function buildDirectProposals(
  targets: Asset[],
  userAssets: Asset[],
  partner: ManagerProfile,
  userBench: Asset[],
  userPicks: Asset[],
  goalSpec: GoalSpec,
): GoalProposal[] {
  const proposals: GoalProposal[] = []
  const tradableUser = userAssets.filter(a => a.type !== 'FAAB' && a.value >= 500)
  const usedAssetIds = new Set<string>()

  const tierDefs: Array<{ tier: ProposalTier; label: string; ratioLow: number; ratioHigh: number; ratioTarget: number }> = [
    { tier: 'safe', label: 'Safe — Fair Value', ratioLow: 0.90, ratioHigh: 1.10, ratioTarget: 1.0 },
    { tier: 'aggressive', label: 'Aggressive — You Win', ratioLow: 0.75, ratioHigh: 0.92, ratioTarget: 0.85 },
  ]

  for (const target of targets.slice(0, 2)) {
    if (target.value <= 0) continue
    for (const { tier, label, ratioLow, ratioHigh, ratioTarget } of tierDefs) {
      if (proposals.length >= 3) break

      const pool = tradableUser.filter(a => !usedAssetIds.has(a.id))
      const targetVal = target.value * ratioTarget
      const combo = findBestAssetCombo(pool, targetVal, target.value * ratioLow, target.value * ratioHigh)
      if (!combo || combo.length === 0) continue

      const giveTotal = combo.reduce((s, a) => s + a.value, 0)
      const receiveTotal = target.value
      const fairnessRaw = 1 - Math.abs(giveTotal - receiveTotal) / Math.max(giveTotal, receiveTotal, 1)
      const fairnessScore = Math.max(0, Math.min(1, fairnessRaw))
      const fillsNeed = combo.some(a => a.type === 'PLAYER' && partner.needs.includes(a.pos || ''))

      const acceptBase = fairnessScore * 60 + (fillsNeed ? 15 : 0)
      const acceptProb = Math.round(Math.max(10, Math.min(85, acceptBase)))

      combo.forEach(a => usedAssetIds.add(a.id))

      proposals.push({
        tier,
        tierLabel: label,
        give: combo,
        receive: [target],
        giveTotal,
        receiveTotal,
        fairnessScore,
        acceptProb,
        acceptLabel: acceptProb >= 60 ? 'Likely' : acceptProb >= 40 ? 'Possible' : 'Long Shot',
        topDrivers: [
          {
            name: 'Market Fairness',
            emoji: '📈',
            direction: fairnessScore >= 0.85 ? 'UP' : fairnessScore >= 0.6 ? 'NEUTRAL' : 'DOWN',
            strength: fairnessScore >= 0.85 ? 'STRONG' : 'MEDIUM',
            detail: `${Math.round(fairnessScore * 100)}% fair`,
          },
          {
            name: 'Need Fit',
            emoji: '🎯',
            direction: fillsNeed ? 'UP' : 'NEUTRAL',
            strength: fillsNeed ? 'STRONG' : 'WEAK',
            detail: fillsNeed ? `Fills their ${partner.needs.join('/')} need` : 'No direct need match',
          },
        ],
        counterPath: {
          description: 'If rejected, consider adding a late-round pick or bench player to sweeten the deal.',
          adjustments: [{ description: 'Add a sweetener asset', expectedDelta: 5 }],
        },
        dmCopy: buildDmCopy(combo, [target], partner, fillsNeed, fairnessScore),
        sweeteners: [],
      })
    }
    if (proposals.length >= 3) break
  }

  return proposals
}

export function generateGoalProposals(
  userRosterId: number,
  goal: ProposalGoal,
  intelligence: LeagueIntelligence,
  options?: {
    maxPartners?: number
    calibratedWeights?: { b0: number; w1: number; w2: number; w3: number; w4: number; w5: number; w6: number; w7: number } | null
  },
): GoalProposalOutput {
  const goalSpec = GOAL_SPECS[goal]
  const userProfile = intelligence.managerProfiles[userRosterId]
  const maxPartners = options?.maxPartners ?? 3

  if (!userProfile) {
    return {
      goal,
      goalDescription: goalSpec.description,
      partners: [],
      stats: { partnersEvaluated: 0, candidatesGenerated: 0, proposalsBuilt: 0 },
    }
  }

  const allPartners = Object.values(intelligence.managerProfiles)
    .filter(m => m.rosterId !== userRosterId)

  const scored = allPartners
    .map(p => scorePartner(userProfile, p, goalSpec, intelligence))
    .filter(p => p.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPartners)

  let totalCandidates = 0
  let totalProposals = 0

  const engineOut = runTradeEngine(
    userRosterId,
    intelligence,
    intelligence.constraints,
    options?.calibratedWeights,
  )
  totalCandidates = engineOut.stats.candidatesGenerated

  const userAssets = intelligence.assetsByRosterId[userRosterId] || []
  const userBench = userAssets.filter(a => a.type === 'PLAYER' && a.slot === 'Bench' && a.value >= 500)
  const userPicks = userAssets.filter(a => a.type === 'PICK')

  const partners: GoalProposalPartner[] = []

  for (const partner of scored) {
    const partnerAssets = intelligence.assetsByRosterId[partner.rosterId] || []
    const targets = selectTargetAssets(partnerAssets, goalSpec)
    if (targets.length === 0) continue

    const partnerCandidates = (engineOut.validTrades || []).filter(
      c => c.toRosterId === partner.rosterId
    )

    const proposals: GoalProposal[] = []
    const usedCandidateIds = new Set<string>()

    const safeBand = { min: 0.92, max: 1.08, target: 1.0 }
    const aggressiveBand = { min: 0.80, max: 0.93, target: 0.87 }
    const creativeBand = { min: 0.95, max: 1.25, target: 1.10 }

    const tiers: Array<{ tier: ProposalTier; label: string; band: typeof safeBand }> = [
      { tier: 'safe', label: 'Safe — Fair Value', band: safeBand },
      { tier: 'aggressive', label: 'Aggressive — You Win', band: aggressiveBand },
      { tier: 'creative', label: 'Creative — Multi-Asset', band: creativeBand },
    ]

    const targetIds = new Set(targets.map(t => t.id))

    for (const { tier, label, band } of tiers) {
      const available = partnerCandidates.filter(c => !usedCandidateIds.has(c.id))

      let goalMatching = available.filter(c =>
        c.receive.some(a => targetIds.has(a.id))
      )

      if (goalMatching.length === 0) {
        goalMatching = available.filter(c =>
          c.receive.some(a =>
            goalSpec.pickFocus ? a.type === 'PICK' :
            goalSpec.targetPositions.includes(a.pos || '')
          )
        )
      }

      if (goalMatching.length === 0) continue

      const inBand = goalMatching.filter(c => {
        const ratio = c.giveTotal / Math.max(c.receiveTotal, 1)
        return ratio >= band.min && ratio <= band.max
      })

      let bestCandidate: TradeCandidate
      if (inBand.length > 0) {
        inBand.sort((a, b) => {
          const distA = Math.abs((a.giveTotal / Math.max(a.receiveTotal, 1)) - band.target)
          const distB = Math.abs((b.giveTotal / Math.max(b.receiveTotal, 1)) - band.target)
          return distA - distB
        })
        bestCandidate = inBand[0]
      } else {
        goalMatching.sort((a, b) => {
          const distA = Math.abs((a.giveTotal / Math.max(a.receiveTotal, 1)) - band.target)
          const distB = Math.abs((b.giveTotal / Math.max(b.receiveTotal, 1)) - band.target)
          return distA - distB
        })
        bestCandidate = goalMatching[0]
      }

      usedCandidateIds.add(bestCandidate.id)

      const give = bestCandidate.give
      const receive = bestCandidate.receive
      const fillsNeed = give.some(a => a.type === 'PLAYER' && partner.profile.needs.includes(a.pos || ''))
      const drivers = synthesizeDrivers(bestCandidate, partner.profile)
      const acceptProb = parseAcceptanceRate(bestCandidate.acceptanceRate)

      const topDrivers = drivers.slice(0, 3).map(d => ({
        name: d.name,
        emoji: d.emoji,
        direction: d.direction,
        strength: d.strength,
        detail: d.evidence.note || '',
      }))

      proposals.push({
        tier,
        tierLabel: label,
        give,
        receive,
        giveTotal: bestCandidate.giveTotal,
        receiveTotal: bestCandidate.receiveTotal,
        fairnessScore: bestCandidate.fairnessScore,
        acceptProb,
        acceptLabel: bestCandidate.acceptanceLabel,
        topDrivers,
        counterPath: buildCounterPath(bestCandidate, userBench, userPicks, partner.profile),
        dmCopy: buildDmCopy(give, receive, partner.profile, fillsNeed, bestCandidate.fairnessScore),
        sweeteners: [],
      })
      totalProposals++
    }

    if (proposals.length === 0 && targets.length > 0) {
      const directProposals = buildDirectProposals(
        targets, userAssets, partner.profile, userBench, userPicks, goalSpec,
      )
      for (const dp of directProposals) {
        proposals.push(dp)
        totalProposals++
      }
    }

    if (proposals.length > 0) {
      partners.push({
        rosterId: partner.rosterId,
        displayName: partner.profile.displayName,
        avatar: partner.profile.avatar,
        record: partner.profile.record,
        contenderTier: partner.profile.contenderTier,
        matchReasons: partner.reasons,
        proposals,
      })
    }
  }

  return {
    goal,
    goalDescription: goalSpec.description,
    partners,
    stats: {
      partnersEvaluated: scored.length,
      candidatesGenerated: totalCandidates,
      proposalsBuilt: totalProposals,
    },
  }
}
