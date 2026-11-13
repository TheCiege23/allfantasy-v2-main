// ============================================
// VALUE & CONTEXT SERVICE
// ============================================
// Single unified module for all AF Legacy features.
// Trade AI, League Rankings, Waivers, AI Chat all use this.

import { Asset, LeagueSettings, LeagueIntelligence, ManagerProfile, Thresholds, Constraints } from './types'

import { SleeperRosterInput, FantasyCalcValueMap, computeStarterStrengthIndex } from './league-intelligence'

// ============================================
// TRADING BLOCK
// ============================================

export type TradingBlockSource = 'sleeper_api' | 'user_flagged' | 'inferred'

export interface TradingBlockAsset extends Asset {
  blockSource: TradingBlockSource
  blockReason?: string
}

export interface TradingBlockConfig {
  includeSleeperBlock: boolean
  includeUserFlagged: boolean
  includeInferred: boolean
  inferredCriteria: {
    benchOnly: boolean
    surplusPositions: boolean
    nonStarters: boolean
    excludeUntouchable: boolean
    minValue: number
  }
}

export const DEFAULT_TRADING_BLOCK_CONFIG: TradingBlockConfig = {
  includeSleeperBlock: true,
  includeUserFlagged: true,
  includeInferred: true,
  inferredCriteria: {
    benchOnly: false,
    surplusPositions: true,
    nonStarters: true,
    excludeUntouchable: true,
    minValue: 1000
  }
}

export interface UserAssetFlags {
  [assetId: string]: {
    onTheBlock?: boolean
    untouchable?: boolean
    flaggedAt?: number
  }
}

export function buildTradingBlock(
  assets: Asset[],
  surplus: string[],
  sleeperBlockIds: string[],
  userFlags: UserAssetFlags,
  config: TradingBlockConfig = DEFAULT_TRADING_BLOCK_CONFIG
): TradingBlockAsset[] {
  const block: TradingBlockAsset[] = []
  const seen = new Set<string>()

  if (config.includeSleeperBlock) {
    for (const asset of assets) {
      if (sleeperBlockIds.includes(asset.id) && !seen.has(asset.id)) {
        block.push({
          ...asset,
          blockSource: 'sleeper_api',
          blockReason: 'Listed on Sleeper trading block'
        })
        seen.add(asset.id)
      }
    }
  }

  if (config.includeUserFlagged) {
    for (const asset of assets) {
      const flags = userFlags[asset.id]
      if (flags?.onTheBlock && !seen.has(asset.id)) {
        block.push({
          ...asset,
          blockSource: 'user_flagged',
          blockReason: 'Flagged by user as available'
        })
        seen.add(asset.id)
      }
    }
  }

  if (config.includeInferred) {
    const criteria = config.inferredCriteria
    
    for (const asset of assets) {
      if (seen.has(asset.id)) continue
      if (asset.value < criteria.minValue) continue
      if (criteria.excludeUntouchable && userFlags[asset.id]?.untouchable) continue
      if (asset.isCornerstone) continue

      let isInferred = false
      let reason = ''

      if (criteria.surplusPositions && asset.type === 'PLAYER' && asset.pos) {
        if (surplus.includes(asset.pos)) {
          isInferred = true
          reason = `Surplus ${asset.pos} (depth exceeds starters)`
        }
      }

      if (!isInferred && criteria.nonStarters && asset.type === 'PLAYER') {
        if (asset.tags?.includes('bench') || !asset.tags?.includes('starter')) {
          isInferred = true
          reason = 'Non-starter with trade value'
        }
      }

      if (asset.type === 'PICK' && asset.round && asset.round >= 2) {
        isInferred = true
        reason = `${asset.pickSeason} Round ${asset.round} pick available`
      }

      if (isInferred) {
        block.push({
          ...asset,
          blockSource: 'inferred',
          blockReason: reason
        })
        seen.add(asset.id)
      }
    }
  }

  return block.sort((a, b) => b.value - a.value)
}

// ============================================
// FORMAT MODIFIERS
// ============================================

export interface FormatModifiers {
  qbScarcityBoost: number
  teScarcityBoost: number
  rbScarcityBoost: number
  wrScarcityBoost: number
  
  idpEnabled: boolean
  idpModifiers: Record<string, number>
  
  bonusModifiers: {
    bigPlay: number
    passingTd: number
    reception: number
  }
}

export function computeFormatModifiers(settings: LeagueSettings): FormatModifiers {
  let qbScarcityBoost = 1.0
  let teScarcityBoost = 1.0
  let rbScarcityBoost = 1.0
  let wrScarcityBoost = 1.0

  if (settings.isSF) {
    qbScarcityBoost = 1.5
  }

  if (settings.isTEP) {
    const mult = settings.tepBonus || 0.5
    teScarcityBoost = 1.0 + mult * 0.5
  }

  if (settings.scoringType === 'PPR') {
    wrScarcityBoost = 1.15
    rbScarcityBoost = 0.95
  } else if (settings.scoringType === 'Standard') {
    rbScarcityBoost = 1.1
  }

  if (settings.numTeams >= 14) {
    rbScarcityBoost *= 1.1
    wrScarcityBoost *= 1.05
  }

  const idpModifiers: Record<string, number> = {}
  if (settings.idpEnabled) {
    const scoringType = settings.idpScoringType || 'balanced'
    if (scoringType === 'tackle_heavy') {
      idpModifiers['LB'] = 1.4
      idpModifiers['DL'] = 1.1
      idpModifiers['DB'] = 1.0
      idpModifiers['EDGE'] = 1.1
    } else if (scoringType === 'big_play') {
      idpModifiers['LB'] = 1.0
      idpModifiers['DL'] = 1.2
      idpModifiers['DB'] = 1.3
      idpModifiers['EDGE'] = 1.3
    } else {
      idpModifiers['LB'] = 1.2
      idpModifiers['DL'] = 1.1
      idpModifiers['DB'] = 1.1
      idpModifiers['EDGE'] = 1.15
    }
  }

  return {
    qbScarcityBoost,
    teScarcityBoost,
    rbScarcityBoost,
    wrScarcityBoost,
    idpEnabled: settings.idpEnabled ?? false,
    idpModifiers,
    bonusModifiers: {
      bigPlay: 0,
      passingTd: 4,
      reception: settings.scoringType === 'PPR' ? 1 : settings.scoringType === 'Half PPR' ? 0.5 : 0
    }
  }
}

// ============================================
// WAIVER CONTEXT
// ============================================

export interface WaiverContext {
  teamNeeds: string[]
  replacementValues: Record<string, number>
  positionScarcity: Record<string, number>
  recommendedBudget: Record<string, number>
}

export function computeWaiverContext(
  profile: ManagerProfile,
  formatModifiers: FormatModifiers,
  waiverwireAssets: Asset[]
): WaiverContext {
  const teamNeeds = profile.needs

  const replacementValues: Record<string, number> = {}
  const positionScarcity: Record<string, number> = {}

  const positions = ['QB', 'RB', 'WR', 'TE']
  
  for (const pos of positions) {
    const available = waiverwireAssets.filter(a => a.pos === pos)
    const avgValue = available.length > 0 
      ? available.reduce((s, a) => s + a.value, 0) / available.length 
      : 500
    
    replacementValues[pos] = Math.round(avgValue)

    const topAvailable = available.filter(a => a.value >= 2000).length
    positionScarcity[pos] = topAvailable <= 2 ? 1.3 : topAvailable <= 5 ? 1.1 : 1.0
  }

  const recommendedBudget: Record<string, number> = {}
  for (const need of teamNeeds) {
    const scarcity = positionScarcity[need] || 1.0
    const modifier = need === 'QB' ? formatModifiers.qbScarcityBoost :
                     need === 'TE' ? formatModifiers.teScarcityBoost :
                     need === 'RB' ? formatModifiers.rbScarcityBoost :
                     formatModifiers.wrScarcityBoost
    
    recommendedBudget[need] = Math.round(20 * scarcity * modifier)
  }

  return {
    teamNeeds,
    replacementValues,
    positionScarcity,
    recommendedBudget
  }
}

// ============================================
// LEAGUE RANKINGS CONTEXT
// ============================================

export interface LeagueRankingMetrics {
  rosterId: number
  managerName: string
  
  rosterValue: number
  starterStrength: number
  depthScore: number
  futureOutlook: number
  
  overallRank: number
  rosterValueRank: number
  starterStrengthRank: number
  futureOutlookRank: number
  
  direction: string
  standingsRank: number
}

export function computeLeagueRankings(
  intelligence: LeagueIntelligence,
  formatModifiers: FormatModifiers
): LeagueRankingMetrics[] {
  const metrics: LeagueRankingMetrics[] = []

  for (const profile of Object.values(intelligence.managerProfiles)) {
    const assets = profile.assets || []
    const rosterValue = assets
      .filter(a => a.type === 'PLAYER')
      .reduce((s, a) => s + a.value, 0)

    const starterStrength = profile.starterStrengthIndex || 
      computeStarterStrengthIndex(assets, intelligence.settings?.starterSlots ?? 9)

    const benchAssets = assets.filter(a => 
      a.type === 'PLAYER' && a.value >= 1500 && a.value < 4000
    )
    const depthScore = benchAssets.reduce((s, a) => s + a.value, 0)

    const youngAssets = assets.filter(a => 
      a.type === 'PLAYER' && a.age && a.age <= 25
    )
    const picks = assets.filter(a => a.type === 'PICK')
    const futureOutlook = youngAssets.reduce((s, a) => s + a.value, 0) + 
                          picks.reduce((s, a) => s + a.value, 0)

    metrics.push({
      rosterId: profile.rosterId,
      managerName: profile.displayName,
      rosterValue,
      starterStrength,
      depthScore,
      futureOutlook,
      overallRank: 0,
      rosterValueRank: 0,
      starterStrengthRank: 0,
      futureOutlookRank: 0,
      direction: profile.contenderTier,
      standingsRank: profile.standingsRank || 99
    })
  }

  const sortedByRosterValue = [...metrics].sort((a, b) => b.rosterValue - a.rosterValue)
  sortedByRosterValue.forEach((m, i) => { m.rosterValueRank = i + 1 })

  const sortedByStarters = [...metrics].sort((a, b) => b.starterStrength - a.starterStrength)
  sortedByStarters.forEach((m, i) => { m.starterStrengthRank = i + 1 })

  const sortedByFuture = [...metrics].sort((a, b) => b.futureOutlook - a.futureOutlook)
  sortedByFuture.forEach((m, i) => { m.futureOutlookRank = i + 1 })

  for (const m of metrics) {
    const avgRank = (m.rosterValueRank + m.starterStrengthRank + m.futureOutlookRank) / 3
    m.overallRank = Math.round(avgRank * 10) / 10
  }

  return metrics.sort((a, b) => a.overallRank - b.overallRank)
}

// ============================================
// AI CHAT CONTEXT
// ============================================

export interface AIChatContext {
  leagueSummary: string
  userSummary: string
  formatNotes: string[]
  factualClaims: string[]
}

export function buildAIChatContext(
  intelligence: LeagueIntelligence,
  userProfile: ManagerProfile,
  formatModifiers: FormatModifiers
): AIChatContext {
  const s = intelligence.settings
  if (!s) {
    return { leagueSummary: 'Unknown league', userSummary: 'Unknown user', formatNotes: [], factualClaims: [] }
  }
  
  const leagueSummary = `${s.leagueName || 'League'}: ${s.numTeams ?? 12}-team ${s.scoringType || 'Standard'}${s.isSF ? ' SF' : ' 1QB'}${s.isTEP ? ' TEP' : ''}${s.idpEnabled ? ' IDP' : ''}`

  const userAssets = userProfile.assets || []
  const cornerstones = userAssets.filter(a => a.isCornerstone)
  const picks = userAssets.filter(a => a.type === 'PICK')
  const totalValue = userAssets.reduce((sum, a) => sum + a.value, 0)

  const userSummary = `${userProfile.displayName}: ${userProfile.contenderTier} (${userProfile.record?.wins ?? 0}-${userProfile.record?.losses ?? 0}), ` +
    `${cornerstones.length} cornerstones, ${picks.length} picks, $${totalValue} total value`

  const formatNotes: string[] = []
  if (s.isSF) formatNotes.push('SF: QBs are premium (1.5x scarcity)')
  if (s.isTEP) formatNotes.push(`TEP: TEs boosted (${s.tepBonus || 0.5}x reception bonus)`)
  if (s.idpEnabled) formatNotes.push(`IDP: ${s.idpScoringType || 'balanced'} scoring, ${s.idpStarterSlots || 0} starters`)
  if ((s.numTeams ?? 12) >= 14) formatNotes.push('Deep league: Depth matters more')
  if ((s.numTeams ?? 12) <= 10) formatNotes.push('Shallow league: Star power > depth')

  const factualClaims: string[] = []
  factualClaims.push(`Needs: ${userProfile.needs.join(', ') || 'None identified'}`)
  factualClaims.push(`Surplus: ${userProfile.surplus.join(', ') || 'None identified'}`)
  
  if (userProfile.isChampion) factualClaims.push('User is defending champion')
  if (userProfile.isTopTwo) factualClaims.push('User is top-2 team')
  
  const topAssets = userAssets
    .filter(a => a.type === 'PLAYER')
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map(a => `${a.name} ($${a.value})`)
  factualClaims.push(`Top assets: ${topAssets.join(', ')}`)

  return {
    leagueSummary,
    userSummary,
    formatNotes,
    factualClaims
  }
}

// ============================================
// UNIFIED SERVICE
// ============================================

export interface ValueContextResult {
  intelligence: LeagueIntelligence
  formatModifiers: FormatModifiers
  
  tradingBlockByManager: Record<number, TradingBlockAsset[]>
  
  waiverContext?: WaiverContext
  leagueRankings: LeagueRankingMetrics[]
  aiChatContext?: AIChatContext
}

export interface ValueContextInput {
  settings: LeagueSettings
  rosters: SleeperRosterInput[]
  fantasyCalcValues: FantasyCalcValueMap
  
  thresholds?: Thresholds
  constraints?: Constraints
  previousChampionId?: string
  
  sleeperTradingBlocks?: Record<number, string[]>
  userAssetFlags?: Record<number, UserAssetFlags>
  tradingBlockConfig?: TradingBlockConfig
  
  waiverwireAssets?: Asset[]
  userRosterId?: number
}

// ============================================
// NEEDS/SURPLUS ATTACHMENT (FOR SNAPSHOT)
// ============================================

