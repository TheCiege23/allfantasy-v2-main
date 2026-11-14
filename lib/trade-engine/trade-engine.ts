// ============================================
// LAYER B: TRADE ENGINE (Rule-Based)
// ============================================

import { Asset, LeagueIntelligence, ManagerProfile, ContenderTier, TradeCandidate, TradeEngineOutput, HardRuleResult, Constraints, DEFAULT_CONSTRAINTS, AcceptDriver, DriverDirection, DriverStrength, ManagerTendencyData } from './types'
import { computeAcceptProbability, type AcceptProbabilityInput, type ManagerTendencyProfile } from './manager-tendency-engine'

// ============================================
// VORP DELTA CONSTANTS
// ============================================
const VORP_SEASON_SCALE = 850   // 17 weeks * 50 multiplier — converts vorpValue back to weekly PPG VORP

function computeVorpDelta(
  give: Asset[],
  receive: Asset[],
  consolPenalty: number,
): { vorpDeltaYou: number; vorpDeltaThem: number; vorpScore: number } {
  const giveWeekly = give.reduce((s, a) => s + ((a.vorpValue ?? 0) / VORP_SEASON_SCALE), 0) * consolPenalty
  const receiveWeekly = receive.reduce((s, a) => s + ((a.vorpValue ?? 0) / VORP_SEASON_SCALE), 0)

  const vorpDeltaYou = Math.round((receiveWeekly - giveWeekly) * 100) / 100
  const vorpDeltaThem = Math.round((giveWeekly - receiveWeekly) * 100) / 100

  const vorpScore = Math.round((0.50 + 0.20 * Math.tanh((vorpDeltaYou - vorpDeltaThem) / 5)) * 100) / 100

  return { vorpDeltaYou, vorpDeltaThem, vorpScore }
}

function computeVorpDeltaProxy(
  give: Asset[],
  receive: Asset[],
  consolPenalty: number,
): { vorpDeltaYou: number; vorpDeltaThem: number; vorpScore: number } {
  const giveWeekly = give.reduce((s, a) => {
    const v = a.vorpValue ?? estimateVorpProxy(a)
    return s + v / VORP_SEASON_SCALE
  }, 0) * consolPenalty
  const receiveWeekly = receive.reduce((s, a) => {
    const v = a.vorpValue ?? estimateVorpProxy(a)
    return s + v / VORP_SEASON_SCALE
  }, 0)

  const vorpDeltaYou = Math.round((receiveWeekly - giveWeekly) * 100) / 100
  const vorpDeltaThem = Math.round((giveWeekly - receiveWeekly) * 100) / 100

  const vorpScore = Math.round((0.50 + 0.20 * Math.tanh((vorpDeltaYou - vorpDeltaThem) / 5)) * 100) / 100

  return { vorpDeltaYou, vorpDeltaThem, vorpScore }
}

// ============================================
// TRADE STRUCTURES
// ============================================

type TradeStructure = '1-for-1' | '2-for-1' | '1-for-2' | '2-for-2' | '3-for-1' | '1-for-3'

function getTradeStructure(give: Asset[], receive: Asset[]): TradeStructure | null {
  const g = give.length
  const r = receive.length
  if (g === 1 && r === 1) return '1-for-1'
  if (g === 2 && r === 1) return '2-for-1'
  if (g === 1 && r === 2) return '1-for-2'
  if (g === 2 && r === 2) return '2-for-2'
  if (g === 3 && r === 1) return '3-for-1'
  if (g === 1 && r === 3) return '1-for-3'
  return null
}

function getConsolidationPenalty(structure: TradeStructure | null, give?: Asset[], receive?: Asset[]): number {
  if (!structure) return 1.0
  if (structure === '1-for-1' || structure === '2-for-2') return 1.0

  const bestReceiveValue = receive ? Math.max(...receive.map(a => a.value || 0)) : 0
  const bestGiveValue = give ? Math.max(...give.map(a => a.value || 0)) : 0

  const starValue = Math.max(bestReceiveValue, bestGiveValue)
  let starBoost = 0
  if (starValue >= 7000) starBoost = 0.15
  else if (starValue >= 5000) starBoost = 0.10
  else if (starValue >= 3000) starBoost = 0.05

  if (structure === '2-for-1') return 1.30 + starBoost
  if (structure === '3-for-1') return 1.50 + starBoost
  if (structure === '1-for-2') return 1.0 / (1.30 + starBoost)
  if (structure === '1-for-3') return 1.0 / (1.50 + starBoost)
  return 1.0
}

// ============================================
// HARD RULES
// ============================================

function checkCornerstoneRule(
  give: Asset[],
  receive: Asset[],
  constraints: Constraints
): HardRuleResult {
  const reasons: string[] = []

  const givingCornerstone = give.some(a => a.isCornerstone)
  const receivingCornerstone = receive.some(a => a.isCornerstone)

  if (givingCornerstone && !receivingCornerstone && constraints.banOneForOneCornerstoneForNon) {
    reasons.push('Cannot trade cornerstone for non-cornerstone assets.')
  }

  return { ok: reasons.length === 0, reasons }
}

function checkAssetCount(
  give: Asset[],
  receive: Asset[],
  constraints: Constraints
): HardRuleResult {
  const reasons: string[] = []
  if (give.length > constraints.maxAssetsPerSide) {
    reasons.push(`Too many assets on give side (max ${constraints.maxAssetsPerSide}).`)
  }
  if (receive.length > constraints.maxAssetsPerSide) {
    reasons.push(`Too many assets on receive side (max ${constraints.maxAssetsPerSide}).`)
  }
  return { ok: reasons.length === 0, reasons }
}

function checkNoFiller(give: Asset[], receive: Asset[], minValue: number): HardRuleResult {
  const reasons: string[] = []
  for (const a of [...give, ...receive]) {
    if (a.type === 'PLAYER' && a.value < minValue && !a.isCornerstone) {
      reasons.push(`${a.name || 'Unknown'} is filler (<${minValue} value).`)
    }
  }
  return { ok: reasons.length === 0, reasons }
}

function checkFaabLimit(
  give: Asset[],
  receive: Asset[],
  constraints: Constraints
): HardRuleResult {
  const reasons: string[] = []
  
  const totalGiveValue = give.reduce((sum, a) => sum + a.value, 0)
  const totalReceiveValue = receive.reduce((sum, a) => sum + a.value, 0)
  
  for (const a of give) {
    if (a.type === 'FAAB' && a.value > totalGiveValue * constraints.faabMaxPercentOfTotal) {
      reasons.push('FAAB exceeds 15% of total give value.')
    }
  }
  for (const a of receive) {
    if (a.type === 'FAAB' && a.value > totalReceiveValue * constraints.faabMaxPercentOfTotal) {
      reasons.push('FAAB exceeds 15% of total receive value.')
    }
  }
  
  return { ok: reasons.length === 0, reasons }
}

function checkParityGuardrail(
  fromManager: ManagerProfile,
  toManager: ManagerProfile,
  give: Asset[],
  receive: Asset[],
  constraints: Constraints
): HardRuleResult {
  if (!constraints.parityGuardrailEnabled) return { ok: true, reasons: [] }
  
  const reasons: string[] = []
  
  if (toManager.isChampion) {
    const giveValue = give.reduce((sum, a) => sum + a.value, 0)
    const receiveValue = receive.reduce((sum, a) => sum + a.value, 0)
    const requiredPremium = giveValue * (constraints.championPremiumMultiplier ?? 1.12)
    if (receiveValue < requiredPremium) {
      reasons.push(`Champion must pay 12% premium. Need ${requiredPremium.toFixed(0)} value, only giving ${receiveValue.toFixed(0)}.`)
    }
  }
  
  if (toManager.isTopTwo && !toManager.isChampion) {
    const giveValue = give.reduce((sum, a) => sum + a.value, 0)
    const receiveValue = receive.reduce((sum, a) => sum + a.value, 0)
    const requiredPremium = giveValue * (constraints.topTeamPremiumMultiplier ?? 1.08)
    if (receiveValue < requiredPremium) {
      reasons.push(`Top-2 team must pay 8% premium.`)
    }
  }
  
  const starterGain = receive.filter(a => a.type === 'PLAYER' && a.value >= 3000).reduce((sum, a) => sum + a.value, 0)
  const starterLoss = give.filter(a => a.type === 'PLAYER' && a.value >= 3000).reduce((sum, a) => sum + a.value, 0)
  const netGain = starterGain - starterLoss
  
  const maxIncrease = constraints.maxStarterStrengthIncrease ?? 5000
  if (toManager.isTopTwo && netGain > maxIncrease) {
    reasons.push(`Trade would increase top team's starter strength by ${netGain}, exceeding max ${maxIncrease}.`)
  }
  
  return { ok: reasons.length === 0, reasons }
}

// ============================================
// FAIRNESS SCORING
// finalInternalScore = 0.40 * lineupImpactScore
//                    + 0.25 * vorpScore (replacement/scarcity)
//                    + 0.20 * marketScore
//                    + 0.15 * behaviorScore (manager/league fit)
//
// Stateless fallbacks when roster/VORP/manager data missing:
// - VORP proxy from market value + position rank estimation
// - Volatility adjustment penalizes high-variance assets
// - Starter likelihood proxy replaces lineup impact
// - Neutral 0.5 behavior score when no manager context
// ============================================

function ratioToFairness(ratio: number): number {
  if (ratio >= 0.95 && ratio <= 1.05) return 1.0
  if (ratio >= 0.90 && ratio <= 1.10) return 0.85
  if (ratio >= 0.85 && ratio <= 1.15) return 0.70
  if (ratio >= 0.80 && ratio <= 1.20) return 0.50
  if (ratio >= 0.70 && ratio <= 1.30) return 0.30
  return 0.10
}

function sumField(assets: Asset[], field: 'impactValue' | 'vorpValue' | 'marketValue'): number {
  return assets.reduce((sum, a) => sum + (a[field] ?? 0), 0)
}

// ============================================
// STATELESS ENRICHMENT (no roster context needed)
// ============================================

const POSITION_REPLACEMENT_PPG: Record<string, number> = {
  QB: 11.0, RB: 4.5, WR: 4.0, TE: 3.0
}

const POSITION_TOP_PPG: Record<string, number> = {
  QB: 25.0, RB: 22.0, WR: 20.0, TE: 17.0
}

const POSITION_SCARCITY: Record<string, number> = {
  QB: 0.65, RB: 0.80, WR: 0.72, TE: 0.60
}

const POSITION_BASE_VOLATILITY: Record<string, number> = {
  QB: 0.12, RB: 0.30, WR: 0.18, TE: 0.22
}

const AGE_DECAY_RATES: Record<string, { peakAge: number; decayRate: number }> = {
  QB: { peakAge: 28, decayRate: 0.015 },
  RB: { peakAge: 24, decayRate: 0.04 },
  WR: { peakAge: 26, decayRate: 0.02 },
  TE: { peakAge: 27, decayRate: 0.02 },
}

function getEffectiveMarketValue(asset: Asset): number {
  return (asset.marketValue != null && asset.marketValue > 0) ? asset.marketValue : asset.value
}

function estimateVorpProxy(asset: Asset): number {
  if (asset.type !== 'PLAYER') {
    const mv = getEffectiveMarketValue(asset)
    const round = asset.round ?? 3
    const roundScale: Record<number, number> = { 1: 0.70, 2: 0.55, 3: 0.40, 4: 0.30 }
    const scale = roundScale[round] ?? 0.25
    const impact = Math.round(mv * scale)
    const baseline: Record<number, number> = { 1: 0, 2: 200, 3: 400, 4: 600 }
    return Math.max(0, impact - (baseline[round] ?? 800))
  }

  const pos = (asset.pos ?? 'WR').toUpperCase()
  const mv = getEffectiveMarketValue(asset)
  if (mv <= 0) return 0

  const maxMarket = pos === 'QB' ? 10000 : pos === 'RB' ? 9000 : pos === 'WR' ? 8500 : 5000
  const percentile = Math.min(1, Math.max(0, mv / maxMarket))

  const topPPG = POSITION_TOP_PPG[pos] ?? 15.0
  const replPPG = POSITION_REPLACEMENT_PPG[pos] ?? 4.0
  const estimatedPPG = replPPG + (topPPG - replPPG) * Math.pow(percentile, 0.7)
  const weeklyVorp = Math.max(0, estimatedPPG - replPPG)
  return Math.round(weeklyVorp * 17 * 50)
}

function estimateVolatility(asset: Asset): number {
  if (asset.type !== 'PLAYER') {
    const round = asset.round ?? 3
    return round <= 1 ? 0.35 : round <= 2 ? 0.42 : 0.50
  }

  const pos = (asset.pos ?? 'WR').toUpperCase()
  let vol = POSITION_BASE_VOLATILITY[pos] ?? 0.20

  if (asset.age != null) {
    const curve = AGE_DECAY_RATES[pos]
    if (curve) {
      const yearsFromPeak = Math.max(0, asset.age - curve.peakAge)
      vol += yearsFromPeak * curve.decayRate
    }
  }

  return Math.min(0.60, Math.max(0.05, vol))
}

function estimateStarterLikelihood(asset: Asset): number {
  if (asset.type !== 'PLAYER') {
    const round = asset.round ?? 3
    return round === 1 ? 0.75 : round === 2 ? 0.40 : 0.15
  }

  const pos = (asset.pos ?? 'WR').toUpperCase()
  const mv = getEffectiveMarketValue(asset)
  if (mv <= 0) return 0

  const scarcity = POSITION_SCARCITY[pos] ?? 0.65
  const maxMarket = pos === 'QB' ? 10000 : pos === 'RB' ? 9000 : pos === 'WR' ? 8500 : 5000
  const tierPercentile = Math.min(1, mv / maxMarket)

  if (tierPercentile >= 0.70) return 1.0 * scarcity + 0.35 * (1 - scarcity)
  if (tierPercentile >= 0.40) return 0.70 * scarcity + 0.20 * (1 - scarcity)
  if (tierPercentile >= 0.20) return 0.35 * scarcity + 0.10 * (1 - scarcity)
  return 0.10
}

function estimatePlayerPPG(asset: Asset): number {
  if (asset.type !== 'PLAYER') return 0

  const pos = (asset.pos ?? 'WR').toUpperCase()
  const mv = getEffectiveMarketValue(asset)
  if (mv <= 0) return POSITION_REPLACEMENT_PPG[pos] ?? 4.0

  const maxMarket = pos === 'QB' ? 10000 : pos === 'RB' ? 9000 : pos === 'WR' ? 8500 : 5000
  const percentile = Math.min(1, Math.max(0, mv / maxMarket))
  const topPPG = POSITION_TOP_PPG[pos] ?? 15.0
  const replPPG = POSITION_REPLACEMENT_PPG[pos] ?? 4.0
  return replPPG + (topPPG - replPPG) * Math.pow(percentile, 0.7)
}

type SlotRequirement = { slot: string; eligiblePositions: string[] }

function parseRosterSlots(rosterPositions: string[]): SlotRequirement[] {
  const slots: SlotRequirement[] = []
  for (const rp of rosterPositions) {
    const upper = rp.toUpperCase()
    if (upper === 'QB') slots.push({ slot: 'QB', eligiblePositions: ['QB'] })
    else if (upper === 'RB') slots.push({ slot: 'RB', eligiblePositions: ['RB'] })
    else if (upper === 'WR') slots.push({ slot: 'WR', eligiblePositions: ['WR'] })
    else if (upper === 'TE') slots.push({ slot: 'TE', eligiblePositions: ['TE'] })
    else if (upper === 'FLEX' || upper === 'REC_FLEX') slots.push({ slot: 'FLEX', eligiblePositions: ['RB', 'WR', 'TE'] })
    else if (upper === 'SUPER_FLEX') slots.push({ slot: 'SUPER_FLEX', eligiblePositions: ['QB', 'RB', 'WR', 'TE'] })
    else if (upper === 'WR/TE' || upper === 'WRRB_FLEX') slots.push({ slot: 'FLEX', eligiblePositions: ['WR', 'RB'] })
  }
  return slots
}

function computeBestLineupPPG(roster: Asset[], rosterPositions: string[]): number {
  const slots = parseRosterSlots(rosterPositions)
  if (slots.length === 0) return 0

  const players = roster
    .filter(a => a.type === 'PLAYER' && a.pos)
    .map(a => ({ asset: a, pos: (a.pos!).toUpperCase(), ppg: estimatePlayerPPG(a), used: false }))

  players.sort((a, b) => b.ppg - a.ppg)

  const positionalSlots = slots.filter(s => s.eligiblePositions.length === 1)
  const flexSlots = slots.filter(s => s.eligiblePositions.length > 1)
    .sort((a, b) => a.eligiblePositions.length - b.eligiblePositions.length)

  let totalPPG = 0

  for (const slot of positionalSlots) {
    const eligible = players.find(p => !p.used && slot.eligiblePositions.includes(p.pos))
    if (eligible) {
      eligible.used = true
      totalPPG += eligible.ppg
    }
  }

  for (const slot of flexSlots) {
    const eligible = players.find(p => !p.used && slot.eligiblePositions.includes(p.pos))
    if (eligible) {
      eligible.used = true
      totalPPG += eligible.ppg
    }
  }

  return totalPPG
}

export type SlotAssignment = { slot: string; ppg: number; playerName?: string }

export function computeBestLineupBySlot(roster: Asset[], rosterPositions: string[]): SlotAssignment[] {
  const slots = parseRosterSlots(rosterPositions)
  if (slots.length === 0) return []

  const players = roster
    .filter(a => a.type === 'PLAYER' && a.pos)
    .map(a => ({ asset: a, pos: (a.pos!).toUpperCase(), ppg: estimatePlayerPPG(a), used: false, name: a.name ?? '' }))

  players.sort((a, b) => b.ppg - a.ppg)

  const positionalSlots = slots.filter(s => s.eligiblePositions.length === 1)
  const flexSlots = slots.filter(s => s.eligiblePositions.length > 1)
    .sort((a, b) => a.eligiblePositions.length - b.eligiblePositions.length)

  const assignments: SlotAssignment[] = []

  for (const slot of positionalSlots) {
    const eligible = players.find(p => !p.used && slot.eligiblePositions.includes(p.pos))
    if (eligible) {
      eligible.used = true
      assignments.push({ slot: slot.slot, ppg: eligible.ppg, playerName: eligible.name })
    } else {
      assignments.push({ slot: slot.slot, ppg: 0 })
    }
  }

  for (const slot of flexSlots) {
    const eligible = players.find(p => !p.used && slot.eligiblePositions.includes(p.pos))
    if (eligible) {
      eligible.used = true
      assignments.push({ slot: slot.slot, ppg: eligible.ppg, playerName: eligible.name })
    } else {
      assignments.push({ slot: slot.slot, ppg: 0 })
    }
  }

  return assignments
}

function computeNeedFitPPG(
  rosterBefore: Asset[],
  rosterAfter: Asset[],
  rosterPositions: string[],
): number {
  const slotsBefore = computeBestLineupBySlot(rosterBefore, rosterPositions)
  const slotsAfter = computeBestLineupBySlot(rosterAfter, rosterPositions)

  if (slotsBefore.length === 0 || slotsAfter.length === 0) return 0

  const slotDeltas = slotsBefore.map((sb, i) => ({
    slotIndex: i,
    slotType: sb.slot,
    beforePPG: sb.ppg,
    afterPPG: slotsAfter[i]?.ppg ?? 0,
    delta: (slotsAfter[i]?.ppg ?? 0) - sb.ppg,
  }))

  slotDeltas.sort((a, b) => a.delta - b.delta)

  const totalStarters = slotDeltas.length
  const K = Math.max(1, Math.round(totalStarters * 0.20))

  let totalBottomK = 0
  for (let i = 0; i < K; i++) {
    totalBottomK += slotDeltas[i].delta
  }
  return totalBottomK / K
}

type LineupDeltaResult = {
  deltaYou: number
  deltaThem: number
  beforeYou: number
  afterYou: number
  beforeThem: number
  afterThem: number
  hasLineupData: boolean
  lineupImpactScore: number
  needFitPPGThem?: number
  starterUpgradePPGThem?: number
}

function computeLineupDelta(
  yourRoster: Asset[],
  theirRoster: Asset[],
  give: Asset[],
  receive: Asset[],
  rosterPositions: string[],
): LineupDeltaResult {
  const noData: LineupDeltaResult = { deltaYou: 0, deltaThem: 0, beforeYou: 0, afterYou: 0, beforeThem: 0, afterThem: 0, hasLineupData: false, lineupImpactScore: 0.5, needFitPPGThem: undefined }

  if (yourRoster.length === 0 || rosterPositions.length === 0) return noData

  const giveIds = new Set(give.map(a => a.id))
  const receiveIds = new Set(receive.map(a => a.id))

  const yourRosterAfter = [
    ...yourRoster.filter(a => !giveIds.has(a.id)),
    ...receive,
  ]
  const beforeYou = computeBestLineupPPG(yourRoster, rosterPositions)
  const afterYou = computeBestLineupPPG(yourRosterAfter, rosterPositions)
  const deltaYou = afterYou - beforeYou

  let deltaThem = 0
  let beforeThem = 0
  let afterThem = 0
  let needFitPPGThem: number | undefined

  let starterUpgradePPGThem: number | undefined

  if (theirRoster.length > 0) {
    const theirRosterAfter = [
      ...theirRoster.filter(a => !receiveIds.has(a.id)),
      ...give,
    ]
    beforeThem = computeBestLineupPPG(theirRoster, rosterPositions)
    afterThem = computeBestLineupPPG(theirRosterAfter, rosterPositions)
    deltaThem = afterThem - beforeThem
    needFitPPGThem = computeNeedFitPPG(theirRoster, theirRosterAfter, rosterPositions)

    const slotsBefore = computeBestLineupBySlot(theirRoster, rosterPositions)
    const slotsAfter = computeBestLineupBySlot(theirRosterAfter, rosterPositions)
    if (slotsBefore.length > 0 && slotsAfter.length > 0) {
      const slotDeltas = slotsBefore.map((sb, i) => (slotsAfter[i]?.ppg ?? 0) - sb.ppg)
      starterUpgradePPGThem = Math.max(...slotDeltas)
    }
  }

  const raw = (deltaYou - deltaThem) / 4
  const normalized = 0.50 + 0.35 * Math.tanh(raw)
  const lineupImpactScore = Math.round(normalized * 100) / 100

  return {
    deltaYou: Math.round(deltaYou * 100) / 100,
    deltaThem: Math.round(deltaThem * 100) / 100,
    beforeYou: Math.round(beforeYou * 100) / 100,
    afterYou: Math.round(afterYou * 100) / 100,
    beforeThem: Math.round(beforeThem * 100) / 100,
    afterThem: Math.round(afterThem * 100) / 100,
    hasLineupData: true,
    lineupImpactScore,
    needFitPPGThem: needFitPPGThem != null ? Math.round(needFitPPGThem * 100) / 100 : undefined,
    starterUpgradePPGThem: starterUpgradePPGThem != null ? Math.round(starterUpgradePPGThem * 100) / 100 : undefined,
  }
}

function weightedAvgVol(assets: Asset[]): number {
  if (assets.length === 0) return 0
  let totalWeight = 0
  let weightedSum = 0
  for (const a of assets) {
    const mv = getEffectiveMarketValue(a)
    const vol = (a.volatility != null && a.volatility > 0) ? a.volatility : estimateVolatility(a)
    const weight = Math.max(mv, 1)
    weightedSum += vol * weight
    totalWeight += weight
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

function computeVolatilityAdjustment(give: Asset[], receive: Asset[]): number {
  const giveVol = weightedAvgVol(give)
  const receiveVol = weightedAvgVol(receive)
  const volDelta = receiveVol - giveVol

  if (Math.abs(volDelta) < 0.05) return 0
  return -volDelta * 0.15
}

// ============================================
// MANAGER/LEAGUE BEHAVIOR SCORE (0-1)
// Measures strategic fit: does this trade align
// with each manager's competitive window and needs?
// ============================================

function hasRealManagerData(m: ManagerProfile | null): boolean {
  if (!m) return false
  if (m.contenderTier !== 'middle') return true
  if (m.needs && m.needs.length > 0) return true
  if (m.surplus && m.surplus.length > 0) return true
  return false
}

function classifyAssetProfile(assets: Asset[]): { youthHeavy: boolean; pickHeavy: boolean; winNowHeavy: boolean } {
  let youngCount = 0
  let veteranCount = 0
  let pickCount = 0
  let playerCount = 0
  for (const a of assets) {
    if (a.type === 'PICK') { pickCount++; continue }
    playerCount++
    if (a.age != null) {
      if (a.age <= 25) youngCount++
      if (a.age >= 28) veteranCount++
    }
  }
  return {
    youthHeavy: youngCount > veteranCount && youngCount >= 1,
    pickHeavy: pickCount >= playerCount && pickCount >= 1,
    winNowHeavy: veteranCount > youngCount && veteranCount >= 1,
  }
}

function computeTeamNeedFit(
  assetsGiven: Asset[],
  manager: ManagerProfile | null,
): number {
  if (!manager) return 0
  let fit = 0
  if (manager.needs.length > 0) {
    const positions = assetsGiven.filter(a => a.type === 'PLAYER' && a.pos).map(a => a.pos!.toUpperCase())
    const hits = positions.filter(p => manager.needs.map(n => n.toUpperCase()).includes(p)).length
    fit += Math.min(hits * 0.4, 1.0)
  }
  if (manager.surplus.length > 0) {
    const positions = assetsGiven.filter(a => a.type === 'PLAYER' && a.pos).map(a => a.pos!.toUpperCase())
    const surplusHits = positions.filter(p => manager.surplus.map(s => s.toUpperCase()).includes(p)).length
    fit -= surplusHits * 0.2
  }
  return Math.max(-1, Math.min(1, fit))
}

function computeBehaviorScore(
  give: Asset[],
  receive: Asset[],
  fromManager: ManagerProfile | null,
  toManager: ManagerProfile | null,
  fromTendency?: ManagerTendencyData | null,
  toTendency?: ManagerTendencyData | null,
): { score: number; hasData: boolean; teamNeedFitYou: number; teamNeedFitThem: number } {
  const hasFrom = hasRealManagerData(fromManager)
  const hasTo = hasRealManagerData(toManager)
  const hasTendency = !!(fromTendency || toTendency)
  if (!hasFrom && !hasTo && !hasTendency) return { score: 0.5, hasData: false, teamNeedFitYou: 0, teamNeedFitThem: 0 }

  let behaviorBoost = 0

  const receiveProfile = classifyAssetProfile(receive)
  const giveProfile = classifyAssetProfile(give)

  if (hasFrom && fromManager) {
    const tier = fromManager.contenderTier
    if (tier === 'contender' || tier === 'champion') {
      if (receiveProfile.winNowHeavy) behaviorBoost += 0.8
      else if (receiveProfile.pickHeavy || receiveProfile.youthHeavy) behaviorBoost -= 0.6
    } else if (tier === 'rebuild') {
      if (receiveProfile.youthHeavy || receiveProfile.pickHeavy) behaviorBoost += 0.8
      else if (receiveProfile.winNowHeavy) behaviorBoost -= 0.6
    }
  }

  if (hasTo && toManager) {
    const tier = toManager.contenderTier
    if (tier === 'contender' || tier === 'champion') {
      if (giveProfile.winNowHeavy) behaviorBoost += 0.5
      else if (giveProfile.pickHeavy || giveProfile.youthHeavy) behaviorBoost -= 0.4
    } else if (tier === 'rebuild') {
      if (giveProfile.youthHeavy || giveProfile.pickHeavy) behaviorBoost += 0.5
      else if (giveProfile.winNowHeavy) behaviorBoost -= 0.4
    }
  }

  const teamNeedFitYou = computeTeamNeedFit(receive, fromManager)
  const teamNeedFitThem = computeTeamNeedFit(give, toManager)
  behaviorBoost += teamNeedFitYou * 0.6
  behaviorBoost += teamNeedFitThem * 0.3

  if (fromTendency) {
    behaviorBoost += fromTendency.starterPremium * 0.3

    const receivedPositions = receive.filter(a => a.type === 'PLAYER' && a.pos).map(a => a.pos!.toUpperCase())
    for (const pos of receivedPositions) {
      const key = pos as keyof typeof fromTendency.positionBias
      const bias = fromTendency.positionBias[key] ?? 0
      if (bias > 0) behaviorBoost += Math.min(bias * 0.25, 0.25)
    }
  }

  if (toTendency) {
    const givenPositions = give.filter(a => a.type === 'PLAYER' && a.pos).map(a => a.pos!.toUpperCase())
    for (const pos of givenPositions) {
      const key = pos as keyof typeof toTendency.positionBias
      const bias = toTendency.positionBias[key] ?? 0
      if (bias > 0) behaviorBoost += Math.min(bias * 0.15, 0.15)
    }
  }

  const score = Math.round((0.50 + 0.15 * Math.tanh(behaviorBoost)) * 100) / 100

  return { score: Math.min(1.0, Math.max(0.0, score)), hasData: true, teamNeedFitYou, teamNeedFitThem }
}

type RosterContext = {
  yourRoster: Asset[]
  theirRoster: Asset[]
  rosterPositions: string[]
}

function computeFairnessScore(
  give: Asset[],
  receive: Asset[],
  fromManager: ManagerProfile,
  toManager: ManagerProfile,
  _isSF: boolean,
  _isTEP: boolean,
  rosterCtx?: RosterContext,
): { score: number; breakdown: Record<string, number>; lineupDelta?: LineupDeltaResult } {
  const structure = getTradeStructure(give, receive)
  const consolPenalty = getConsolidationPenalty(structure, give, receive)

  const giveVorp = sumField(give, 'vorpValue') * consolPenalty
  const receiveVorp = sumField(receive, 'vorpValue')
  const hasVorpData = giveVorp > 0 || receiveVorp > 0

  const giveMarketRaw = sumField(give, 'marketValue')
  const receiveMarketRaw = sumField(receive, 'marketValue')
  const marketDeltaPct = giveMarketRaw > 0
    ? ((receiveMarketRaw - giveMarketRaw) / Math.max(giveMarketRaw, receiveMarketRaw, 1)) * 100
    : 0
  const marketScore = Math.round((0.50 + 0.15 * Math.tanh(marketDeltaPct / 20)) * 100) / 100

  const behavior = computeBehaviorScore(give, receive, fromManager, toManager)
  const behaviorScore = behavior.score
  const hasBehaviorData = behavior.hasData

  let lineupDelta: LineupDeltaResult | undefined
  if (rosterCtx && rosterCtx.yourRoster.length > 0 && rosterCtx.rosterPositions.length > 0) {
    lineupDelta = computeLineupDelta(
      rosterCtx.yourRoster, rosterCtx.theirRoster,
      give, receive, rosterCtx.rosterPositions,
    )
  }

  const hasLineupData = lineupDelta?.hasLineupData ?? false

  const giveImpact = sumField(give, 'impactValue') * consolPenalty
  const receiveImpact = sumField(receive, 'impactValue')
  const hasImpactData = giveImpact > 0 || receiveImpact > 0

  let score: number
  let lineupImpactScore: number
  let vorpScore: number

  // FULL MODE: lineup simulation available OR have impactValue data, plus VORP data
  if ((hasLineupData || hasImpactData) && hasVorpData) {
    if (hasLineupData && lineupDelta) {
      lineupImpactScore = lineupDelta.lineupImpactScore
    } else {
      const impactRatio = receiveImpact / Math.max(giveImpact, 1)
      lineupImpactScore = ratioToFairness(impactRatio)
    }

    const vd = computeVorpDelta(give, receive, consolPenalty)
    vorpScore = vd.vorpScore

    if (hasBehaviorData) {
      score = 0.40 * lineupImpactScore + 0.25 * vorpScore + 0.20 * marketScore + 0.15 * behaviorScore
    } else {
      score = 0.47 * lineupImpactScore + 0.29 * vorpScore + 0.24 * marketScore
    }
  }
  // VORP_STARTER MODE: VORP data + starter proxy (no lineup simulation or impact data)
  else if (hasVorpData) {
    const vd = computeVorpDelta(give, receive, consolPenalty)
    vorpScore = vd.vorpScore

    const giveStarter = give.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0) * consolPenalty
    const receiveStarter = receive.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0)
    const starterRatio = receiveStarter / Math.max(giveStarter, 1)
    lineupImpactScore = ratioToFairness(starterRatio)

    const volAdj = computeVolatilityAdjustment(give, receive)
    if (hasBehaviorData) {
      score = 0.30 * lineupImpactScore + 0.30 * vorpScore + 0.25 * marketScore + 0.15 * behaviorScore + volAdj
    } else {
      score = 0.35 * lineupImpactScore + 0.35 * vorpScore + 0.30 * marketScore + volAdj
    }
  }
  // MARKET_PROXY MODE: no VORP or impact data, full stateless
  else {
    const vd = computeVorpDeltaProxy(give, receive, consolPenalty)
    vorpScore = vd.vorpScore

    const giveStarter = give.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0) * consolPenalty
    const receiveStarter = receive.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0)
    const starterRatio = receiveStarter / Math.max(giveStarter, 1)
    lineupImpactScore = ratioToFairness(starterRatio)

    const volAdj = computeVolatilityAdjustment(give, receive)
    if (hasBehaviorData) {
      score = 0.25 * lineupImpactScore + 0.30 * vorpScore + 0.30 * marketScore + 0.15 * behaviorScore + volAdj
    } else {
      score = 0.30 * lineupImpactScore + 0.35 * vorpScore + 0.35 * marketScore + volAdj
    }
  }

  score = Math.max(0, Math.min(1, score))

  return {
    score,
    breakdown: {
      lineupImpact: lineupImpactScore,
      vorp: vorpScore,
      market: marketScore,
      behavior: behaviorScore,
    },
    lineupDelta,
  }
}

// ============================================
// STRUCTURED DRIVER DATA (for AI narrative constraint)
// ============================================

export type TradeVerdict = 'Elite Asset Theft' | 'Strong Win' | 'Slight Win' | 'Fair' | 'Overpay Risk' | 'Major Overpay'
export type TradeLean = 'You' | 'Them' | 'Even'
export type ConfidenceRating = 'HIGH' | 'MEDIUM' | 'LEARNING'

export type TradeDriverData = {
  scoringMode: 'full' | 'vorp_starter' | 'market_proxy'

  lineupImpactScore: number
  vorpScore: number
  marketScore: number
  behaviorScore: number
  hasBehaviorData: boolean

  totalScore: number
  fairnessDelta: number
  acceptProbability: number
  confidenceScore: number
  confidenceRating: ConfidenceRating

  verdict: TradeVerdict
  lean: TradeLean
  labels: string[]

  lineupDelta?: {
    hasLineupData: boolean
    deltaYou: number
    deltaThem: number
    beforeYou: number
    afterYou: number
    beforeThem: number
    afterThem: number
  }

  vorpDelta: {
    vorpDeltaYou: number
    vorpDeltaThem: number
  }

  confidenceFactors: {
    dataCompleteness: number
    projectionCertainty: number
    marketAlignment: number
    volatilityPenalty: number
    missingRosterPenalty: number
  }

  fairnessScore: number
  volatilityAdj: number
  marketDeltaPct: number
  starterLikelihoodDelta: number
  consolidationPenalty: number
  riskFlags: string[]
  positionScarcity: Record<string, number>
  dominantDriver: string
  driverNarrative: string
  acceptDrivers: AcceptDriver[]
  confidenceDrivers: AcceptDriver[]
  acceptBullets: string[]
  sensitivitySentence: string
}

function driverDirection(value: number): DriverDirection {
  if (value > 0.10) return 'UP'
  if (value < -0.10) return 'DOWN'
  return 'NEUTRAL'
}

function driverStrength(value: number): DriverStrength {
  const abs = Math.abs(value)
  if (abs >= 0.50) return 'STRONG'
  if (abs >= 0.20) return 'MEDIUM'
  return 'WEAK'
}

function makeDriver(
  id: string, name: string, emoji: string,
  value: number,
  evidence: AcceptDriver['evidence'],
): AcceptDriver {
  const v = Math.max(-1, Math.min(1, Math.round(value * 100) / 100))
  return { id, name, emoji, direction: driverDirection(v), strength: driverStrength(v), value: v, evidence }
}

function buildAcceptDrivers(ar: SmartAcceptResult): AcceptDriver[] {
  const drivers: AcceptDriver[] = []
  const noRosters = !ar.hasLineupData

  if (noRosters) {
    drivers.push(makeDriver('ar_opp_lineup_gain', 'Opponent Lineup Gain', '📊', 0, {
      metric: 'deltaThem', raw: 0, unit: 'PPG', note: 'no rosters',
    }))
    drivers.push(makeDriver('ar_need_fit', 'Need-Fit Improvement', '🎯', 0, {
      metric: 'need_fit_ppg', raw: 0, unit: 'PPG', note: 'no rosters',
    }))
  } else {
    drivers.push(makeDriver('ar_opp_lineup_gain', 'Opponent Lineup Gain', '📊',
      ar.deltaThem / 3.0, {
        metric: 'deltaThem', raw: ar.deltaThem, unit: 'PPG',
      }))
    drivers.push(makeDriver('ar_need_fit', 'Need-Fit Improvement', '🎯',
      ar.needFitPPG / 2.0, {
        metric: 'need_fit_ppg', raw: ar.needFitPPG, unit: 'PPG',
        note: 'Bottom-k slot improvement',
      }))
  }

  drivers.push(makeDriver('ar_market_mismatch', 'Market Perceived Loss', '📈',
    (-ar.marketDeltaOppPct) / 12, {
      metric: 'marketDeltaOppPct', raw: ar.marketDeltaOppPct, unit: 'PCT',
    }))

  drivers.push(makeDriver('ar_deal_shape', 'Deal Shape', '⚖️',
    ar.shape / 2, {
      metric: 'shape', raw: ar.shape, unit: 'COUNT',
      note: 'Received minus given pieces',
    }))

  drivers.push(makeDriver('ar_volatility_delta', 'Volatility Delta', '🌊',
    2 * ar.volDelta, {
      metric: 'vol_delta', raw: ar.volDelta, unit: 'SCORE',
    }))

  {
    const { m, l, g } = ar.blendWeights
    const isColdStart = m < 0.5
    const note = isColdStart
      ? `Cold start blend: m=${m}, l=${l}, g=${g}`
      : undefined
    drivers.push(makeDriver('ar_manager_alignment', 'Manager Alignment', '🧠',
      1.5 * ar.managerAlign, {
        metric: 'managerAlign', raw: ar.managerAlign, unit: 'SCORE',
        note,
      }))
  }

  if (ar.x7 !== 0) {
    drivers.push(makeDriver('ar_timing_pressure', 'Timing Pressure', '⏰',
      ar.x7, {
        note: 'Deadline window',
      }))
  }

  {
    const capValue = ar.capApplied === 'hard' ? -1 : ar.capApplied === 'soft' ? -0.5 : 0
    drivers.push(makeDriver('ar_caps', 'Acceptance Caps', '🛡️',
      capValue, {
        note: ar.capApplied === 'none' ? 'No caps applied' : ar.capNote,
      }))
  }

  return drivers
}

type ConfidenceDriverInput = {
  hasLineupData: boolean
  hasYourRoster: boolean
  hasTheirRoster: boolean
  hasRosterPositions: boolean
  give: Asset[]
  receive: Asset[]
  lineupDelta?: { deltaYou: number; deltaThem: number } | null
  marketDeltaPct: number
  lineupImpactScore: number
  vorpScore: number
  marketScore: number
  volatilityAdj: number
  opponentSampleSize: number
  marketCacheAgeMinutes?: number
}

function buildConfidenceDrivers(input: ConfidenceDriverInput): AcceptDriver[] {
  const drivers: AcceptDriver[] = []

  {
    const missing: string[] = []
    if (!input.hasYourRoster) missing.push('your roster')
    if (!input.hasTheirRoster) missing.push('opponent roster')
    if (!input.hasRosterPositions) missing.push('roster positions')
    let v: number
    if (input.hasYourRoster && input.hasTheirRoster && input.hasRosterPositions) {
      v = 1
    } else if (input.hasYourRoster || input.hasTheirRoster) {
      v = -0.5
    } else {
      v = -1
    }
    drivers.push(makeDriver('cf_data_completeness', 'Data Completeness', '📋', v, {
      note: missing.length === 0 ? 'Full rosters + positions available' : `Missing: ${missing.join(', ')}`,
    }))
  }

  {
    const allAssets = [...input.give, ...input.receive]
    const total = allAssets.length
    const unknown = allAssets.filter(a =>
      (a.marketValue == null || a.marketValue <= 0) && a.value <= 0
    ).length
    const coverage = total > 0 ? 1 - (unknown / total) : 0
    const v = 2 * coverage - 1
    drivers.push(makeDriver('cf_value_coverage', 'Valuation Coverage', '📊', v, {
      metric: 'unknown_assets', raw: unknown, unit: 'COUNT',
    }))
  }

  {
    let signal: number
    if (input.lineupDelta) {
      signal = Math.abs(input.lineupDelta.deltaYou - input.lineupDelta.deltaThem)
    } else {
      signal = Math.abs(input.marketDeltaPct) / 10
    }
    const norm = Math.min(signal / 4.0, 1)
    const v = 2 * norm - 1
    drivers.push(makeDriver('cf_signal_strength', 'Signal Strength', '📡', v, {
      metric: 'signal_magnitude', raw: Math.round(signal * 100) / 100, unit: 'SCORE',
    }))
  }

  {
    const age = input.marketCacheAgeMinutes ?? 5
    let stability: number
    if (age < 15) stability = 1
    else if (age < 60) stability = 0.5
    else stability = 0
    const v = 2 * stability - 1
    drivers.push(makeDriver('cf_market_stability', 'Market Stability', '🏛️', v, {
      metric: 'cache_age_minutes', raw: age, unit: 'COUNT',
    }))
  }

  {
    const n = input.opponentSampleSize
    const norm = Math.min(n / 10, 1)
    const v = 2 * norm - 1
    drivers.push(makeDriver('cf_manager_profile_strength', 'Manager Profile Strength', '👤', v, {
      metric: 'sample_size', raw: n, unit: 'COUNT',
    }))
  }

  {
    const allReceived = input.receive
    let totalVol = 0
    let count = 0
    for (const a of allReceived) {
      const vol = (a.volatility != null && a.volatility > 0) ? a.volatility : estimateVolatility(a)
      totalVol += vol
      count++
    }
    const avgVol = count > 0 ? totalVol / count : 0
    const v = -Math.min(avgVol / 0.7, 1)
    drivers.push(makeDriver('cf_volatility_penalty', 'Volatility Penalty', '🌊', v, {
      metric: 'avg_volatility', raw: Math.round(avgVol * 100) / 100, unit: 'SCORE',
    }))
  }

  {
    const scores = [input.marketScore, input.lineupImpactScore, input.vorpScore]
    const mean = scores.reduce((s, x) => s + x, 0) / scores.length
    const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length
    const stddev = Math.sqrt(variance)
    const maxStddev = 0.25
    const agreement = 1 - Math.min(stddev / maxStddev, 1)
    const v = 2 * agreement - 1
    drivers.push(makeDriver('cf_model_agreement', 'Model Agreement', '🤝', v, {
      metric: 'score_stddev', raw: Math.round(stddev * 1000) / 1000, unit: 'SCORE',
    }))
  }

  return drivers
}

type BulletContext = {
  acceptDrivers: AcceptDriver[]
  confidenceDrivers: AcceptDriver[]
  give: Asset[]
  receive: Asset[]
  fairnessDelta: number
  verdict: TradeVerdict
}

const BULLET_TEMPLATES: Record<string, (d: AcceptDriver, ctx: BulletContext) => string | null> = {
  ar_opp_lineup_gain: (d, _ctx) => {
    const ppg = d.evidence.raw ?? 0
    if (d.strength === 'WEAK') return null
    if (d.direction === 'UP')
      return `Opponent's lineup improves by +${Math.abs(ppg).toFixed(1)} PPG, making them more likely to accept.`
    return `Opponent's lineup drops by ${Math.abs(ppg).toFixed(1)} PPG — they may not see this as a gain.`
  },
  ar_need_fit: (d, _ctx) => {
    const ppg = d.evidence.raw ?? 0
    if (d.strength === 'WEAK') return null
    if (d.direction === 'UP')
      return `Directly upgrades your opponent's weakest starter slot (+${Math.abs(ppg).toFixed(1)} PPG), so they're more likely to engage.`
    return `Doesn't address opponent's weakest starter slots, reducing appeal.`
  },
  ar_market_mismatch: (d, ctx) => {
    const oppPct = Math.round(Math.abs(d.evidence.raw ?? 0))
    if (d.strength === 'WEAK') return null
    if (d.direction === 'UP')
      return `Market values favor the opponent by ~${oppPct}%, making them more open to the deal.`
    if (oppPct <= 12)
      return `Market values show they'd be giving up ~${oppPct}% more than they get, which could slow acceptance.`
    return `Market values show they'd be giving up ~${oppPct}% more than they get, which may hurt acceptance.`
  },
  ar_deal_shape: (d, _ctx) => {
    const pieces = Math.abs(d.evidence.raw ?? 0)
    if (d.strength === 'WEAK') return null
    if (d.direction === 'UP')
      return `Opponent receives ${pieces} more piece${pieces !== 1 ? 's' : ''} than they give — consolidation often appeals to trade partners.`
    return `Opponent gives up ${pieces} more piece${pieces !== 1 ? 's' : ''} than they receive — expansion trades face more resistance.`
  },
  ar_volatility_delta: (d, _ctx) => {
    if (d.strength === 'WEAK') return null
    if (d.direction === 'UP')
      return `Opponent receives lower-volatility assets, adding stability they may value.`
    return `High volatility in the assets offered could make the opponent hesitant.`
  },
  ar_manager_alignment: (d, _ctx) => {
    if (d.strength === 'WEAK') return null
    if (d.direction === 'UP')
      return `This manager's trade history suggests they value what you're offering, improving acceptance odds.`
    return `This manager's trade history suggests a mismatch with what you're offering.`
  },
  ar_timing_pressure: (d, _ctx) => {
    if (d.direction !== 'UP') return null
    return `Trade deadline pressure increases urgency — managers are more willing to deal in this window.`
  },
  ar_caps: (d, _ctx) => {
    if (d.direction === 'NEUTRAL') return null
    if (d.value <= -0.75)
      return `Safety cap applied: the opponent loses significant lineup value, capping acceptance probability.`
    return `Safety cap applied: large market imbalance limits acceptance probability.`
  },
}

function buildAcceptBullets(ctx: BulletContext): string[] {
  const ranked = [...ctx.acceptDrivers]
    .filter(d => d.direction !== 'NEUTRAL')
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  const bullets: string[] = []
  for (const d of ranked) {
    if (bullets.length >= 3) break
    const template = BULLET_TEMPLATES[d.id]
    if (!template) continue
    const text = template(d, ctx)
    if (text) bullets.push(text)
  }

  if (bullets.length < 3) {
    const delta = ctx.fairnessDelta
    if (delta > 5)
      bullets.push(`Overall value leans in your favor by ${delta} points on our fairness scale.`)
    else if (delta < -5)
      bullets.push(`Overall value favors your trade partner by ${Math.abs(delta)} points on our fairness scale.`)
    else
      bullets.push(`This trade grades as a fair exchange on our composite scoring model.`)
  }

  while (bullets.length < 3) {
    bullets.push(`Verdict: ${ctx.verdict} — based on lineup impact, scarcity, and market consensus.`)
  }

  return bullets.slice(0, 3)
}

function buildSensitivitySentence(ctx: BulletContext): string {
  const cfMap = new Map(ctx.confidenceDrivers.map(d => [d.id, d]))

  const dataCompleteness = cfMap.get('cf_data_completeness')
  if (dataCompleteness && dataCompleteness.value <= -0.5) {
    const positions = ctx.receive
      .filter(a => a.type === 'PLAYER' && a.pos)
      .map(a => a.pos!.toUpperCase())
    const posStr = positions.length > 0 ? positions[0] : 'key'
    return `No roster context; starter impact is estimated and could swing if their ${posStr} room is strong/weak.`
  }

  const volPenalty = cfMap.get('cf_volatility_penalty')
  if (volPenalty && volPenalty.value <= -0.5) {
    return `High role volatility means acceptance may change quickly with news/usage.`
  }

  const managerProfile = cfMap.get('cf_manager_profile_strength')
  if (managerProfile && managerProfile.value <= -0.3) {
    return `Limited trade history for this manager; personalization is league/global weighted.`
  }

  const marketStability = cfMap.get('cf_market_stability')
  if (marketStability && marketStability.value <= -0.3) {
    return `Market values may be stale; a refresh could shift the verdict.`
  }

  const modelAgreement = cfMap.get('cf_model_agreement')
  if (modelAgreement && modelAgreement.value <= -0.3) {
    return `Scoring layers disagree on this trade's value; the verdict is less certain.`
  }

  return `League scoring, roster depth, and trade deadline timing could shift this verdict.`
}

function computeVerdict(totalScore100: number): TradeVerdict {
  if (totalScore100 >= 80) return 'Elite Asset Theft'
  if (totalScore100 >= 65) return 'Strong Win'
  if (totalScore100 >= 55) return 'Slight Win'
  if (totalScore100 >= 45) return 'Fair'
  if (totalScore100 >= 30) return 'Overpay Risk'
  return 'Major Overpay'
}

function computeLean(totalScore100: number): TradeLean {
  if (totalScore100 > 52) return 'You'
  if (totalScore100 < 48) return 'Them'
  return 'Even'
}

function computeLabels(lineupImpact: number, vorpScore: number, marketScore: number): string[] {
  const labels: string[] = []
  if (lineupImpact > 0.65) labels.push('Starter Upgrade')
  if (vorpScore > 0.65) labels.push('Scarcity Gain')
  if (marketScore > 0.65) labels.push('Market Win')
  if (lineupImpact < 0.35) labels.push('Lineup Downgrade')
  if (vorpScore < 0.35) labels.push('Scarcity Loss')
  if (marketScore < 0.35) labels.push('Market Overpay')
  return labels
}

function computeSmartConfidence(
  scoringMode: 'full' | 'vorp_starter' | 'market_proxy',
  hasLineupData: boolean,
  hasImpactData: boolean,
  hasVorpData: boolean,
  hasMarketData: boolean,
  hasBehaviorData: boolean,
  lineupDeltaMagnitude: number,
  marketDeltaPct: number,
  volatilityAdj: number,
): { score: number; rating: ConfidenceRating; factors: TradeDriverData['confidenceFactors'] } {
  let score = 50

  let dataCompleteness = 0
  if (hasLineupData || hasImpactData) dataCompleteness += 10
  if (hasVorpData) dataCompleteness += 10
  if (hasMarketData) dataCompleteness += 5
  if (hasBehaviorData) dataCompleteness += 5
  score += dataCompleteness

  let projectionCertainty = 0
  if (lineupDeltaMagnitude > 1.5) projectionCertainty += 10
  else if (lineupDeltaMagnitude > 0.5) projectionCertainty += 5
  if (scoringMode === 'full') projectionCertainty += 10
  else if (scoringMode === 'vorp_starter') projectionCertainty += 5
  score += projectionCertainty

  let marketAlignment = 0
  if (Math.abs(marketDeltaPct) < 10) marketAlignment += 5
  else if (Math.abs(marketDeltaPct) < 20) marketAlignment += 2
  score += marketAlignment

  const volatilityPenalty = Math.min(15, Math.round(Math.abs(volatilityAdj) * 100))
  score -= volatilityPenalty

  const missingRosterPenalty = scoringMode === 'market_proxy' ? 15 : scoringMode === 'vorp_starter' ? 8 : 0
  score -= missingRosterPenalty

  score = Math.max(0, Math.min(100, score))

  let rating: ConfidenceRating
  if (score >= 80) rating = 'HIGH'
  else if (score >= 60) rating = 'MEDIUM'
  else rating = 'LEARNING'

  return {
    score: Math.round(score),
    rating,
    factors: { dataCompleteness, projectionCertainty, marketAlignment, volatilityPenalty, missingRosterPenalty },
  }
}

type TendencyLike = {
  sampleSize: number
  starterPremium: number
  positionBias: { QB: number; RB: number; WR: number; TE: number; PICK: number }
  riskTolerance: number
  consolidationBias: number
}

function computeRawAlign(
  tendency: TendencyLike,
  oppReceives: Asset[],
  hasLineupData: boolean,
  x4: number,
  x5: number,
  starterUpgradePPG?: number,
  starterMatchOverride?: number,
): number {
  const starterMatch = starterMatchOverride != null
    ? Math.max(-1, Math.min(1, starterMatchOverride))
    : starterUpgradePPG != null
      ? Math.max(-1, Math.min(1, starterUpgradePPG / 2.0))
      : 0

  const positionMatch = (() => {
    const players = oppReceives.filter(a => a.type === 'PLAYER' && a.pos)
    if (players.length === 0) return 0
    const mainAsset = players.reduce((best, a) => {
      const mv = a.marketValue ?? a.value ?? 0
      const bestMv = best.marketValue ?? best.value ?? 0
      return mv > bestMv ? a : best
    }, players[0])
    const mainPos = (mainAsset.pos ?? '').toUpperCase() as keyof TendencyLike['positionBias']
    return tendency.positionBias[mainPos] ?? 0
  })()

  const riskMatch = tendency.riskTolerance * Math.sign(x5)
  const consolidationMatch = (2 * tendency.consolidationBias - 1) * Math.sign(-x4)

  return 0.35 * starterMatch + 0.30 * positionMatch + 0.20 * riskMatch + 0.15 * consolidationMatch
}

function averageTendency(tendencies: ManagerTendencyData[]): TendencyLike | null {
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

function computeManagerAlign(
  toTendency: ManagerTendencyData | null | undefined,
  oppReceives: Asset[],
  hasLineupData: boolean,
  x4: number,
  x5: number,
  allTendencies?: Record<number, ManagerTendencyData> | null,
  starterUpgradePPG?: number,
  starterMatchOverride?: number,
): number {
  const sampleSize = toTendency?.sampleSize ?? 0
  const m = Math.min(sampleSize / 10, 1)
  const l = 0.6 * (1 - m)
  const g = 0.4 * (1 - m)

  const x6Manager = (toTendency && sampleSize >= 5)
    ? computeRawAlign(toTendency, oppReceives, hasLineupData, x4, x5, starterUpgradePPG, starterMatchOverride)
    : 0

  let x6League = 0
  const allEntries = allTendencies ? Object.values(allTendencies).filter(t => t.sampleSize >= 3) : []
  if (allEntries.length > 0) {
    const leagueAvg = averageTendency(allEntries)
    if (leagueAvg) {
      x6League = computeRawAlign(leagueAvg, oppReceives, hasLineupData, x4, x5, starterUpgradePPG, starterMatchOverride)
    }
  }

  const x6Global = 0

  const blended = m * x6Manager + l * x6League + g * x6Global
  return Math.max(-2, Math.min(2, blended * 1.5))
}

type SmartAcceptResult = {
  probability: number
  deltaThem: number
  needFitPPG: number
  marketDeltaOppPct: number
  shape: number
  volDelta: number
  managerAlign: number
  x7: number
  blendWeights: { m: number; l: number; g: number }
  capApplied: 'none' | 'soft' | 'hard'
  capNote: string
  hasLineupData: boolean
}

function computeSmartAcceptProbability(
  vorpDeltaThem: number,
  teamNeedFitThem: number,
  behaviorScore: number,
  marketScore: number,
  marketDeltaPct: number,
  hasBehaviorData: boolean,
  oppLineupDeltaPPG?: number,
  needFitPPGThem?: number,
  dealShapeOpp?: number,
  volDeltaOpp?: number,
  toTendency?: ManagerTendencyData | null,
  oppReceives?: Asset[],
  hasLineupData?: boolean,
  isDeadlineWindow?: boolean,
  allTendencies?: Record<number, ManagerTendencyData> | null,
  calibratedWeights?: { b0: number; w1: number; w2: number; w3: number; w4: number; w5: number; w6: number; w7: number } | null,
  starterUpgradePPG?: number,
  starterMatchOverride?: number,
): SmartAcceptResult {
  const deltaThem = oppLineupDeltaPPG ?? 0
  const needFitPPG = needFitPPGThem ?? 0
  const shape = dealShapeOpp ?? 0
  const volReceive = volDeltaOpp != null ? volDeltaOpp : 0
  const marketDeltaOppPct = -marketDeltaPct

  const x1 = oppLineupDeltaPPG != null
    ? Math.max(-2, Math.min(2, oppLineupDeltaPPG / 3.0))
    : null

  const x2 = needFitPPGThem != null
    ? Math.max(-2, Math.min(2, needFitPPGThem / 2.0))
    : null

  const x3 = Math.max(-2, Math.min(2, -marketDeltaOppPct / 12))

  const x4 = shape !== 0
    ? Math.max(-2, Math.min(2, shape / 2))
    : 0

  const x5 = volReceive !== 0
    ? Math.max(-2, Math.min(2, volReceive * 2))
    : 0

  const x6 = computeManagerAlign(
    toTendency, oppReceives ?? [], hasLineupData ?? false, x4, x5, allTendencies, starterUpgradePPG, starterMatchOverride,
  )

  const sampleSize = toTendency?.sampleSize ?? 0
  const m = Math.min(sampleSize / 10, 1)
  const l = 0.6 * (1 - m)
  const g = 0.4 * (1 - m)

  const oppGainingPPG = deltaThem > 0
  const x7 = (isDeadlineWindow && oppGainingPPG) ? 0.5 : 0

  const cw = calibratedWeights
  const b0 = cw?.b0 ?? -1.10
  const z = b0
    + (cw?.w1 ?? 1.25) * (x1 ?? 0)
    + (cw?.w2 ?? 0.70) * (x2 ?? 0)
    + (cw?.w3 ?? 0.90) * x3
    + (cw?.w4 ?? 0.15) * x4
    + (cw?.w5 ?? 0.25) * x5
    + (cw?.w6 ?? 0.85) * x6
    + (cw?.w7 ?? 0.20) * x7

  let prob = 1 / (1 + Math.exp(-z))
  prob = Math.max(0.02, Math.min(0.95, prob))

  let capApplied: 'none' | 'soft' | 'hard' = 'none'
  let capNote = ''

  if (deltaThem <= -1.0 && marketDeltaOppPct < 15) {
    prob = Math.min(prob, 0.20)
    capApplied = 'hard'
    capNote = 'Cap: deltaThem <= -1.0'
  } else if (marketDeltaOppPct <= -25 && needFitPPG < 0.75) {
    prob = Math.min(prob, 0.35)
    capApplied = 'soft'
    capNote = 'Cap: marketDeltaOppPct <= -25 and need_fit_ppg < 0.75'
  }

  const managerAlignRaw = x6 / 1.5

  return {
    probability: Math.round(prob * 100) / 100,
    deltaThem: Math.round(deltaThem * 100) / 100,
    needFitPPG: Math.round(needFitPPG * 100) / 100,
    marketDeltaOppPct: Math.round(marketDeltaOppPct * 100) / 100,
    shape,
    volDelta: Math.round(volReceive * 100) / 100,
    managerAlign: Math.round(managerAlignRaw * 100) / 100,
    x7,
    blendWeights: { m: Math.round(m * 100) / 100, l: Math.round(l * 100) / 100, g: Math.round(g * 100) / 100 },
    capApplied,
    capNote,
    hasLineupData: hasLineupData ?? false,
  }
}

export function computeTradeDrivers(
  give: Asset[],
  receive: Asset[],
  fromManager: ManagerProfile | null,
  toManager: ManagerProfile | null,
  isSF: boolean,
  isTEP: boolean,
  rosterCtx?: RosterContext,
  fromTendency?: ManagerTendencyData | null,
  toTendency?: ManagerTendencyData | null,
  isDeadlineWindow?: boolean,
  allTendencies?: Record<number, ManagerTendencyData> | null,
  calibratedWeights?: { b0: number; w1: number; w2: number; w3: number; w4: number; w5: number; w6: number; w7: number } | null,
): TradeDriverData {
  const structure = getTradeStructure(give, receive)
  const consolPenalty = getConsolidationPenalty(structure, give, receive)

  const giveVorp = sumField(give, 'vorpValue') * consolPenalty
  const receiveVorp = sumField(receive, 'vorpValue')
  const hasVorpData = giveVorp > 0 || receiveVorp > 0

  const giveMarket = sumField(give, 'marketValue') * consolPenalty
  const receiveMarket = sumField(receive, 'marketValue')
  const giveMarketRaw = sumField(give, 'marketValue')
  const receiveMarketRaw = sumField(receive, 'marketValue')
  const marketDeltaPct = giveMarketRaw > 0
    ? Math.round(((receiveMarketRaw - giveMarketRaw) / Math.max(giveMarketRaw, receiveMarketRaw, 1)) * 100)
    : 0

  const marketScore = Math.round((0.50 + 0.15 * Math.tanh(marketDeltaPct / 20)) * 100) / 100

  const behavior = computeBehaviorScore(give, receive, fromManager, toManager, fromTendency, toTendency)
  const behaviorScore = behavior.score
  const hasBehaviorData = behavior.hasData

  let lineupDelta: LineupDeltaResult | undefined
  if (rosterCtx && rosterCtx.yourRoster.length > 0 && rosterCtx.rosterPositions.length > 0) {
    lineupDelta = computeLineupDelta(
      rosterCtx.yourRoster, rosterCtx.theirRoster,
      give, receive, rosterCtx.rosterPositions,
    )
  }
  const hasLineupData = lineupDelta?.hasLineupData ?? false

  const giveImpact = sumField(give, 'impactValue') * consolPenalty
  const receiveImpact = sumField(receive, 'impactValue')
  const hasImpactData = giveImpact > 0 || receiveImpact > 0

  let scoringMode: 'full' | 'vorp_starter' | 'market_proxy' = 'market_proxy'
  let lineupImpactScore = 0
  let vorpScore = 0
  let volatilityAdj = 0

  const giveStarterL = give.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0)
  const receiveStarterL = receive.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0)
  const starterLikelihoodDelta = giveStarterL > 0
    ? Math.round(((receiveStarterL - giveStarterL) / Math.max(giveStarterL, receiveStarterL, 1)) * 100)
    : 0

  let vorpDeltaResult: { vorpDeltaYou: number; vorpDeltaThem: number; vorpScore: number }

  if ((hasLineupData || hasImpactData) && hasVorpData) {
    scoringMode = 'full'
    if (hasLineupData && lineupDelta) {
      lineupImpactScore = lineupDelta.lineupImpactScore
    } else {
      const impactRatio = receiveImpact / Math.max(giveImpact, 1)
      lineupImpactScore = ratioToFairness(impactRatio)
    }
    vorpDeltaResult = computeVorpDelta(give, receive, consolPenalty)
    vorpScore = vorpDeltaResult.vorpScore
  } else if (hasVorpData) {
    scoringMode = 'vorp_starter'
    vorpDeltaResult = computeVorpDelta(give, receive, consolPenalty)
    vorpScore = vorpDeltaResult.vorpScore
    const giveS = giveStarterL * consolPenalty
    const starterRatio = receiveStarterL / Math.max(giveS, 1)
    lineupImpactScore = ratioToFairness(starterRatio)
    volatilityAdj = computeVolatilityAdjustment(give, receive)
  } else {
    scoringMode = 'market_proxy'
    vorpDeltaResult = computeVorpDeltaProxy(give, receive, consolPenalty)
    vorpScore = vorpDeltaResult.vorpScore
    const giveS = giveStarterL * consolPenalty
    const starterRatio = receiveStarterL / Math.max(giveS, 1)
    lineupImpactScore = ratioToFairness(starterRatio)
    volatilityAdj = computeVolatilityAdjustment(give, receive)
  }

  const positionScarcity: Record<string, number> = {}
  for (const a of [...give, ...receive]) {
    if (a.type === 'PLAYER' && a.pos) {
      const pos = a.pos.toUpperCase()
      if (!positionScarcity[pos]) {
        positionScarcity[pos] = POSITION_SCARCITY[pos] ?? 0.65
      }
    }
  }

  const dummyManager: ManagerProfile = { displayName: '', needs: [], surplus: [], isChampion: false, contenderTier: 'middle' as ContenderTier, tradeAggression: 'medium' as any, rosterId: 0, userId: '' }
  const fairnessResult = computeFairnessScore(
    give, receive,
    fromManager || dummyManager,
    toManager || dummyManager,
    isSF, isTEP,
    rosterCtx,
  )

  const riskFlags = computeRiskFlags(give, receive)

  let lW: number, vW: number, mW: number, bW: number
  if (scoringMode === 'full') {
    if (hasBehaviorData) { lW = 0.40; vW = 0.25; mW = 0.20; bW = 0.15 }
    else { lW = 0.47; vW = 0.29; mW = 0.24; bW = 0 }
  } else if (scoringMode === 'vorp_starter') {
    if (hasBehaviorData) { lW = 0.30; vW = 0.30; mW = 0.25; bW = 0.15 }
    else { lW = 0.35; vW = 0.35; mW = 0.30; bW = 0 }
  } else {
    if (hasBehaviorData) { lW = 0.25; vW = 0.30; mW = 0.30; bW = 0.15 }
    else { lW = 0.30; vW = 0.35; mW = 0.35; bW = 0 }
  }

  const scores = [
    { name: 'lineup impact', score: lineupImpactScore, weight: lW },
    { name: 'replacement value (VORP)', score: vorpScore, weight: vW },
    { name: 'market consensus', score: marketScore, weight: mW },
    ...(hasBehaviorData ? [{ name: 'manager/league behavior', score: behaviorScore, weight: bW }] : []),
  ]
  scores.sort((a, b) => (b.score * b.weight) - (a.score * a.weight))
  const dominantDriver = scores[0].name

  let driverNarrative = ''
  const behaviorNote = hasBehaviorData ? `, manager/league behavior (${Math.round(bW * 100)}%)` : ''
  if (scoringMode === 'full') {
    driverNarrative = `Scored with full roster context: lineup impact (${Math.round(lW * 100)}%), VORP (${Math.round(vW * 100)}%), market (${Math.round(mW * 100)}%)${behaviorNote}.`
  } else if (scoringMode === 'vorp_starter') {
    driverNarrative = `Scored with VORP data + estimated starter likelihood: starter proxy (${Math.round(lW * 100)}%), VORP (${Math.round(vW * 100)}%), market (${Math.round(mW * 100)}%)${behaviorNote}.`
  } else {
    driverNarrative = `Scored stateless: starter proxy (${Math.round(lW * 100)}%), estimated VORP (${Math.round(vW * 100)}%), market (${Math.round(mW * 100)}%)${behaviorNote}. No roster context available.`
  }

  const totalScore = Math.round(fairnessResult.score * 100) / 100
  const totalScore100 = Math.round(totalScore * 100)

  const fairnessDelta = Math.round(totalScore100 - 50)

  const verdict = computeVerdict(totalScore100)
  const lean = computeLean(totalScore100)
  const labels = computeLabels(lineupImpactScore, vorpScore, marketScore)

  const lineupDeltaMag = lineupDelta?.hasLineupData
    ? Math.abs(lineupDelta.deltaYou) + Math.abs(lineupDelta.deltaThem)
    : 0
  const confidence = computeSmartConfidence(
    scoringMode,
    hasLineupData, hasImpactData, hasVorpData,
    (giveMarket > 0 || receiveMarket > 0),
    hasBehaviorData,
    lineupDeltaMag, marketDeltaPct, volatilityAdj,
  )

  const dealShapeOpp = give.length - receive.length
  const volDeltaOpp = weightedAvgVol(give) - weightedAvgVol(receive)

  let noRosterStarterMatchProxy: number | undefined
  if (!hasLineupData) {
    const starterImpactReceived = give.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0)
    const starterImpactGiven = receive.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0)
    const starterImpactDeltaPct = starterImpactGiven > 0
      ? 100 * (starterImpactReceived - starterImpactGiven) / Math.max(1, starterImpactGiven)
      : 0
    noRosterStarterMatchProxy = Math.max(-1, Math.min(1, starterImpactDeltaPct / 15))
  }

  const acceptResult = computeSmartAcceptProbability(
    vorpDeltaResult.vorpDeltaThem,
    behavior.teamNeedFitThem,
    behaviorScore,
    marketScore,
    marketDeltaPct,
    hasBehaviorData,
    lineupDelta?.hasLineupData ? lineupDelta.deltaThem : undefined,
    lineupDelta?.needFitPPGThem,
    dealShapeOpp,
    volDeltaOpp,
    toTendency,
    give,
    hasLineupData,
    isDeadlineWindow,
    allTendencies,
    calibratedWeights,
    lineupDelta?.starterUpgradePPGThem,
    noRosterStarterMatchProxy,
  )

  const tradeResult: TradeDriverData = {
    scoringMode,

    lineupImpactScore,
    vorpScore,
    marketScore,
    behaviorScore,
    hasBehaviorData,

    totalScore,
    fairnessDelta,
    acceptProbability: acceptResult.probability,
    confidenceScore: confidence.score,
    confidenceRating: confidence.rating,

    verdict,
    lean,
    labels,

    lineupDelta: lineupDelta?.hasLineupData ? {
      hasLineupData: true,
      deltaYou: lineupDelta.deltaYou,
      deltaThem: lineupDelta.deltaThem,
      beforeYou: lineupDelta.beforeYou,
      afterYou: lineupDelta.afterYou,
      beforeThem: lineupDelta.beforeThem,
      afterThem: lineupDelta.afterThem,
    } : undefined,

    vorpDelta: {
      vorpDeltaYou: vorpDeltaResult.vorpDeltaYou,
      vorpDeltaThem: vorpDeltaResult.vorpDeltaThem,
    },

    confidenceFactors: confidence.factors,

    fairnessScore: fairnessResult.score,
    volatilityAdj,
    marketDeltaPct,
    starterLikelihoodDelta,
    consolidationPenalty: consolPenalty,
    riskFlags,
    positionScarcity,
    dominantDriver,
    driverNarrative,
    acceptDrivers: [],
    confidenceDrivers: [],
    acceptBullets: [],
    sensitivitySentence: '',
  }

  tradeResult.acceptDrivers = buildAcceptDrivers(acceptResult)

  const devyAssets = [...give, ...receive].filter(a => a.isDevy && a.draftProjectionScore)
  if (devyAssets.length > 0) {
    const partnerArchetype = toManager?.tradeAggression === 'low' ? 'FutureFocused' : null
    for (const da of devyAssets) {
      if (da.projectedDraftRound && da.projectedDraftRound <= 1) {
        tradeResult.acceptDrivers.push(makeDriver('devy_rd1_capital', 'Projected Rd 1 NFL Capital', '🏈',
          0.06, { metric: 'projectedDraftRound', raw: da.projectedDraftRound, unit: 'ROUND' }))
      } else if (da.projectedDraftRound && da.projectedDraftRound <= 2) {
        tradeResult.acceptDrivers.push(makeDriver('devy_rd2_capital', 'Projected Day 1-2 NFL Pick', '🏈',
          0.03, { metric: 'projectedDraftRound', raw: da.projectedDraftRound, unit: 'ROUND' }))
      }

      if (da.breakoutAge != null && da.breakoutAge <= 20) {
        tradeResult.acceptDrivers.push(makeDriver('devy_breakout', 'Early Breakout Age', '⚡',
          0.03, { metric: 'breakoutAge', raw: da.breakoutAge, unit: 'AGE' }))
      }

      if (da.injurySeverityScore != null && da.injurySeverityScore > 70) {
        tradeResult.acceptDrivers.push(makeDriver('devy_injury_risk', 'Devy Injury Concern', '🏥',
          -0.07, { metric: 'injurySeverityScore', raw: da.injurySeverityScore, unit: 'SCORE' }))
      } else if (da.injurySeverityScore != null && da.injurySeverityScore > 40) {
        tradeResult.acceptDrivers.push(makeDriver('devy_mod_injury', 'Moderate Injury Risk', '🏥',
          -0.03, { metric: 'injurySeverityScore', raw: da.injurySeverityScore, unit: 'SCORE' }))
      }

      if (da.volatilityScore != null && da.volatilityScore > 70) {
        tradeResult.acceptDrivers.push(makeDriver('devy_high_vol', 'High Volatility Devy', '🌊',
          -0.04, { metric: 'volatilityScore', raw: da.volatilityScore, unit: 'SCORE' }))
      }
    }

    if (partnerArchetype === 'FutureFocused') {
      tradeResult.acceptDrivers.push(makeDriver('devy_partner_youth', 'Partner Loves Youth', '🧠',
        0.08, { note: 'Future-focused partner archetype' }))
    }
  }

  tradeResult.confidenceDrivers = buildConfidenceDrivers({
    hasLineupData,
    hasYourRoster: (rosterCtx?.yourRoster?.length ?? 0) > 0,
    hasTheirRoster: (rosterCtx?.theirRoster?.length ?? 0) > 0,
    hasRosterPositions: (rosterCtx?.rosterPositions?.length ?? 0) > 0,
    give,
    receive,
    lineupDelta: lineupDelta?.hasLineupData ? { deltaYou: lineupDelta.deltaYou, deltaThem: lineupDelta.deltaThem } : null,
    marketDeltaPct,
    lineupImpactScore,
    vorpScore,
    marketScore,
    volatilityAdj,
    opponentSampleSize: toTendency?.sampleSize ?? 0,
  })

  const bulletCtx: BulletContext = {
    acceptDrivers: tradeResult.acceptDrivers,
    confidenceDrivers: tradeResult.confidenceDrivers,
    give,
    receive,
    fairnessDelta,
    verdict,
  }
  tradeResult.acceptBullets = buildAcceptBullets(bulletCtx)
  tradeResult.sensitivitySentence = buildSensitivitySentence(bulletCtx)
  return tradeResult
}

// ============================================
// ACCEPTANCE LABELING
// ============================================

// ============================================
// RISK FLAGS
// ============================================

function computeRiskFlags(give: Asset[], receive: Asset[]): string[] {
  const flags: string[] = []
  
  for (const a of receive) {
    if (a.type === 'PLAYER') {
      if (a.age && a.age >= 30 && (a.pos === 'RB')) {
        flags.push(`${a.name} is ${a.age}+ RB - high decline risk`)
      }
      if (a.age && a.age >= 32 && (a.pos === 'WR' || a.pos === 'TE')) {
        flags.push(`${a.name} is ${a.age}+ - moderate decline risk`)
      }
      if (a.age && a.age >= 38) {
        flags.push(`${a.name} is ${a.age}+ - extreme retirement risk`)
      }
    }
    if (a.type === 'PICK' && a.projected === 'late') {
      flags.push(`${a.displayName || 'Pick'} projects late - limited upside`)
    }
  }
  
  for (const a of give) {
    if (a.isCornerstone) {
      flags.push(`Giving up cornerstone: ${a.name || a.displayName}`)
    }
  }
  
  return flags
}

// ============================================
// EXPLANATION BUILDER
// ============================================

function buildExplanation(
  give: Asset[],
  receive: Asset[],
  fromManager: ManagerProfile,
  toManager: ManagerProfile
): { whyTheyAccept: string[]; whyYouAccept: string[] } {
  const whyTheyAccept: string[] = []
  const whyYouAccept: string[] = []
  
  for (const a of give) {
    if (a.type === 'PLAYER' && toManager.needs.includes(a.pos || '')) {
      whyTheyAccept.push(`Fills their ${a.pos} need with ${a.name}`)
    }
    if (a.type === 'PICK' && toManager.contenderTier === 'rebuild') {
      whyTheyAccept.push(`Adds draft capital for rebuild`)
    }
  }
  
  if (toManager.contenderTier === 'contender' || toManager.contenderTier === 'champion') {
    const starters = give.filter(a => a.type === 'PLAYER' && a.value >= 4000)
    if (starters.length > 0) {
      whyTheyAccept.push(`Gets proven starter(s) for push: ${starters.map(s => s.name).join(', ')}`)
    }
  }
  
  for (const a of receive) {
    if (a.type === 'PLAYER' && fromManager.needs.includes(a.pos || '')) {
      whyYouAccept.push(`Fills your ${a.pos} need with ${a.name}`)
    }
    if (a.type === 'PICK' && fromManager.contenderTier === 'rebuild') {
      whyYouAccept.push(`Adds draft capital for rebuild`)
    }
    if (a.type === 'PLAYER' && a.age && a.age <= 24 && a.value >= 4000) {
      whyYouAccept.push(`Acquires young asset: ${a.name} (${a.age})`)
    }
  }
  
  const giveValue = give.reduce((sum, a) => sum + a.value, 0)
  const receiveValue = receive.reduce((sum, a) => sum + a.value, 0)
  if (receiveValue > giveValue * 1.05) {
    whyYouAccept.push(`Value advantage: receiving ${receiveValue} for ${giveValue}`)
  }
  
  if (whyTheyAccept.length === 0) whyTheyAccept.push('Fair value exchange')
  if (whyYouAccept.length === 0) whyYouAccept.push('Fair value exchange')
  
  return { whyTheyAccept, whyYouAccept }
}

// ============================================
// CANDIDATE GENERATOR
// ============================================

function generateCandidates(
  fromRosterId: number,
  intelligence: LeagueIntelligence
): Array<{ toRosterId: number; give: Asset[]; receive: Asset[] }> {
  const candidates: Array<{ toRosterId: number; give: Asset[]; receive: Asset[] }> = []
  const fromAssets = intelligence.assetsByRosterId[fromRosterId] || []
  const fromManager = intelligence.managerProfiles[fromRosterId]
  
  if (!fromManager) return []
  
  const tradableAssets = fromAssets.filter(a => {
    if (a.type === 'FAAB') return true
    if (a.value < 1000) return false
    return true
  })
  
  for (const [toRosterIdStr, toAssets] of Object.entries(intelligence.assetsByRosterId)) {
    const toRosterId = parseInt(toRosterIdStr, 10)
    if (toRosterId === fromRosterId) continue
    
    const toManager = intelligence.managerProfiles[toRosterId]
    if (!toManager) continue
    
    const theirTradable = toAssets.filter(a => {
      if (a.type === 'FAAB') return true
      if (a.value < 1000) return false
      return true
    })
    
    for (const give of tradableAssets.slice(0, 15)) {
      for (const receive of theirTradable.slice(0, 15)) {
        if (give.type === 'FAAB' || receive.type === 'FAAB') continue
        const ratio = receive.value / Math.max(give.value, 1)
        if (ratio >= 0.7 && ratio <= 1.3) {
          candidates.push({ toRosterId, give: [give], receive: [receive] })
        }
      }
    }
    
    for (let i = 0; i < Math.min(tradableAssets.length, 10); i++) {
      for (let j = i + 1; j < Math.min(tradableAssets.length, 10); j++) {
        const giveBundle = [tradableAssets[i], tradableAssets[j]]
        const giveValue = giveBundle.reduce((sum, a) => sum + a.value, 0)
        
        for (const receive of theirTradable.filter(a => a.value >= giveValue * 0.7)) {
          candidates.push({ toRosterId, give: giveBundle, receive: [receive] })
        }
      }
    }
    
    for (const give of tradableAssets.filter(a => a.value >= 5000)) {
      for (let i = 0; i < Math.min(theirTradable.length, 10); i++) {
        for (let j = i + 1; j < Math.min(theirTradable.length, 10); j++) {
          const receiveBundle = [theirTradable[i], theirTradable[j]]
          const receiveValue = receiveBundle.reduce((sum, a) => sum + a.value, 0)
          if (receiveValue >= give.value * 0.7 && receiveValue <= give.value * 1.3) {
            candidates.push({ toRosterId, give: [give], receive: receiveBundle })
          }
        }
      }
    }
  }
  
  return candidates.slice(0, 500)
}

// ============================================
// MAIN ENGINE
// ============================================

export function runTradeEngine(
  userRosterId: number,
  intelligence: LeagueIntelligence,
  constraints: Constraints = DEFAULT_CONSTRAINTS,
  calibratedWeights?: { b0: number; w1: number; w2: number; w3: number; w4: number; w5: number; w6: number; w7: number } | null,
): TradeEngineOutput {
  const candidates = generateCandidates(userRosterId, intelligence)
  const validTrades: TradeCandidate[] = []
  const rejectedTrades: Array<{ give: Asset[]; receive: Asset[]; reasons: string[] }> = []
  
  const fromManager = intelligence.managerProfiles[userRosterId]
  if (!fromManager) {
    return { validTrades: [], rejectedTrades: [], stats: { candidatesGenerated: 0, candidatesRejected: 0, candidatesValid: 0 } }
  }
  
  let offerId = 0
  
  for (const candidate of candidates) {
    const { toRosterId, give, receive } = candidate
    const toManager = intelligence.managerProfiles[toRosterId]
    if (!toManager) continue
    
    const allReasons: string[] = []
    
    const cornerstone = checkCornerstoneRule(give, receive, constraints)
    if (!cornerstone.ok) allReasons.push(...cornerstone.reasons)
    
    const assetCount = checkAssetCount(give, receive, constraints)
    if (!assetCount.ok) allReasons.push(...assetCount.reasons)
    
    const noFiller = checkNoFiller(give, receive, constraints.noFillerMinValue)
    if (!noFiller.ok) allReasons.push(...noFiller.reasons)
    
    const faab = checkFaabLimit(give, receive, constraints)
    if (!faab.ok) allReasons.push(...faab.reasons)
    
    const parity = checkParityGuardrail(fromManager, toManager, give, receive, constraints)
    if (!parity.ok) allReasons.push(...parity.reasons)
    
    if (allReasons.length > 0) {
      rejectedTrades.push({ give, receive, reasons: allReasons })
      continue
    }
    
    const { score: fairnessScore } = computeFairnessScore(
      give, receive, fromManager, toManager,
      intelligence.settings?.isSF ?? false, intelligence.settings?.isTEP ?? false
    )
    
    if (fairnessScore < 0.3) {
      rejectedTrades.push({ give, receive, reasons: ['Fairness score too low'] })
      continue
    }
    
    const fillsTheirNeed = give.some(a => a.type === 'PLAYER' && toManager.needs.includes(a.pos || ''))
    
    const riskFlags = computeRiskFlags(give, receive)
    const explanation = buildExplanation(give, receive, fromManager, toManager)
    
    const giveValue = give.reduce((sum, a) => sum + a.value, 0)
    const receiveValue = receive.reduce((sum, a) => sum + a.value, 0)

    const toManagerTendency = intelligence.managerTendencies?.[toRosterId] ?? null
    const tendencyAsProfile: ManagerTendencyProfile | null = toManagerTendency
      ? { ...toManagerTendency }
      : null

    const oppMarketDeltaPct = receiveValue > 0
      ? Math.round(((giveValue - receiveValue) / Math.max(giveValue, receiveValue, 1)) * 100)
      : 0

    const oppStarterReceived = give.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0)
    const oppStarterGiven = receive.reduce((s, a) => s + estimateStarterLikelihood(a) * getEffectiveMarketValue(a), 0)
    const oppStarterDeltaPct = oppStarterGiven > 0
      ? 100 * (oppStarterReceived - oppStarterGiven) / Math.max(1, oppStarterGiven)
      : 0
    const tradeFinderStarterProxy = Math.max(-1, Math.min(1, oppStarterDeltaPct / 15))

    const acceptInput: AcceptProbabilityInput = {
      deltaThem: receiveValue - giveValue,
      teamNeedFit: fillsTheirNeed ? 0.8 : 0.2,
      marketFairness: Math.round(fairnessScore * 100),
      perceivedLossByMarket: Math.max(0, giveValue - receiveValue),
      marketDeltaOppPct: oppMarketDeltaPct,
      dealShapeOpp: give.length - receive.length,
      volDeltaOpp: weightedAvgVol(give) - weightedAvgVol(receive),
      tendencies: tendencyAsProfile,
      oppReceiveAssets: give.map(a => ({
        marketValue: a.marketValue,
        value: a.value,
        pos: a.pos,
        type: a.type,
        slot: a.slot,
      })),
      allTendencies: intelligence.managerTendencies
        ? Object.values(intelligence.managerTendencies).map(t => ({
            sampleSize: t.sampleSize,
            starterPremium: t.starterPremium,
            positionBias: t.positionBias,
            riskTolerance: t.riskTolerance,
            consolidationBias: t.consolidationBias,
          }))
        : null,
      calibratedWeights: calibratedWeights ?? null,
      starterMatchOverride: tradeFinderStarterProxy,
    }
    const acceptance = computeAcceptProbability(acceptInput)
    
    validTrades.push({
      id: `trade_${++offerId}`,
      offerId: `trade_${offerId}`,
      fromRosterId: userRosterId,
      toRosterId,
      fromManagerName: fromManager.displayName,
      toManagerName: toManager.displayName,
      give,
      receive,
      giveTotal: giveValue,
      receiveTotal: receiveValue,
      fairnessScore,
      valueRatio: receiveValue / Math.max(giveValue, 1),
      acceptanceLabel: acceptance.label,
      acceptanceRate: acceptance.rate,
      vetoLikelihood: 'Low' as const,
      cornerstoneRulesSatisfied: true,
      parityRulesSatisfied: true,
      parityFlags: [],
      riskFlags,
      explanation,
      ai: {},
      displayEmoji: acceptance.emoji,
      priorityPill: acceptance.pill
    })
  }
  
  validTrades.sort((a, b) => b.fairnessScore - a.fairnessScore)
  
  return {
    validTrades: validTrades.slice(0, 50),
    rejectedTrades,
    stats: {
      candidatesGenerated: candidates.length,
      candidatesRejected: rejectedTrades.length,
      candidatesValid: validTrades.length
    }
  }
}
