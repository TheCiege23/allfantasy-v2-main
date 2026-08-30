import { prisma } from '../prisma'
import { pricePlayer, type ValuationContext } from '../hybrid-valuation'
import { resolveLeagueValuePatch } from '@/lib/values/leagueValuePatch'
import { getPlayerAnalyticsBatch, type PlayerAnalytics } from '../player-analytics'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { buildManagerProfile, type ManagerTendencyProfile } from './manager-tendency-engine'
import {
  computeNeedsSurplus,
  computeStarterStrengthIndex,
  classifyCornerstone,
} from './league-intelligence'
import { type Asset, type LeagueSettings, type LeagueIntelligence, type ManagerProfile, DEFAULT_THRESHOLDS } from './types'
import { getPlayerADP, type ADPEntry } from '../adp-data'
import { getPreAnalysisStatus } from '../trade-pre-analysis'
import { convertSleeperToAssets } from './convertSleeperToAssets'
import {
  getAllPlayers,
  getLeagueInfo,
  getLeagueRosters,
  getLeagueTransactions,
  getLeagueUsers,
  type SleeperUser,
  type SleeperPlayer,
} from '../sleeper-client'
import {
  type LeagueDecisionContext,
  type LeagueTeamSnapshot,
  type TradeDecisionContextV1,
  type AssetValuation,
  type PlayerRiskMarker,
  type TeamSnapshot,
  type CompetitorSnapshot,
  type ManagerPreferenceVector,
  type MissingDataFlags,
  LEAGUE_DECISION_CONTEXT_VERSION,
  TRADE_DECISION_CONTEXT_VERSION,
  TradeDecisionContextV1Schema,
  classifyAgeBucket,
  computeSourceFreshness,
} from './trade-decision-context'

type SleeperRoster = {
  roster_id: number
  owner_id: string | null
  co_owners?: string[] | null
  players?: string[] | null
  starters?: string[] | null
  reserve?: string[] | null
  taxi?: string[] | null
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
    fpts_against?: number
    fpts_against_decimal?: number
  }
}

type RosterSlot = 'Starter' | 'Bench' | 'IR' | 'Taxi'

type RosteredPlayer = {
  id: string
  name: string
  pos: string
  team?: string
  slot: RosterSlot
  isIdp?: boolean
  age?: number
}

type ParsedRoster = {
  rosterId: number
  userId: string
  displayName: string
  avatar?: string
  pointsFor: number
  record: { wins: number; losses: number; ties?: number }
  players: RosteredPlayer[]
  tradeCount: number
}

const playersCache: { at: number; data: Record<string, SleeperPlayer> | null } = { at: 0, data: null }
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

async function getSleeperPlayers(): Promise<Record<string, SleeperPlayer>> {
  const now = Date.now()
  if (playersCache.data && now - playersCache.at < CACHE_TTL_MS) return playersCache.data
  const data = await getAllPlayers()
  playersCache.at = now
  playersCache.data = data
  return data
}

function isIdpPos(pos?: string) {
  const p = (pos || '').toUpperCase()
  return p === 'DL' || p === 'LB' || p === 'DB' || p === 'EDGE' || p === 'IDP'
}

function buildRoster(
  playerIds: string[],
  starters: Set<string>,
  reserve: Set<string>,
  taxi: Set<string>,
  dict: Record<string, SleeperPlayer>
): RosteredPlayer[] {
  return playerIds.map(pid => {
    const meta = dict[pid] || {}
    const name =
      meta.full_name ||
      [meta.first_name, meta.last_name].filter(Boolean).join(' ') ||
      pid
    const pos = (meta.position || '').toUpperCase()
    const team = (meta.team || '').toUpperCase() || undefined

    let slot: RosterSlot = 'Bench'
    if (starters.has(pid)) slot = 'Starter'
    else if (reserve.has(pid)) slot = 'IR'
    else if (taxi.has(pid)) slot = 'Taxi'

    return { id: pid, name, pos: pos || 'UNK', team, slot, isIdp: isIdpPos(pos), age: meta.age }
  })
}

async function fetchInjuries(
  playerNames: string[]
): Promise<Map<string, { status: string; type: string | null; description: string | null; date: string | null; fetchedAt: string | null }>> {
  const result = new Map<string, { status: string; type: string | null; description: string | null; date: string | null; fetchedAt: string | null }>()
  if (playerNames.length === 0) return result

  try {
    const injuries = await prisma.sportsInjury.findMany({
      where: { playerName: { in: playerNames }, sport: 'NFL' },
      orderBy: { fetchedAt: 'desc' },
    })
    for (const inj of injuries) {
      if (!result.has(inj.playerName)) {
        result.set(inj.playerName, {
          status: inj.status || 'Unknown',
          type: inj.type,
          description: inj.description,
          date: inj.date ? inj.date.toISOString().split('T')[0] : null,
          fetchedAt: inj.fetchedAt ? inj.fetchedAt.toISOString() : null,
        })
      }
    }
  } catch (e) {
    console.warn('[league-context] Injury fetch failed:', e)
  }
  return result
}

const HIGH_REINJURY_TYPES = new Set(['acl', 'achilles', 'hamstring', 'ankle', 'concussion', 'knee', 'shoulder'])

function estimateMissedGames(injury: { status: string; description: string | null } | null): number | null {
  if (!injury) return null
  const status = (injury.status || '').toLowerCase()
  if (status === 'out') return 4
  if (status === 'doubtful') return 2
  if (status === 'questionable') return 1
  if (status === 'ir' || status.includes('injured reserve')) return 8
  if (status === 'pup' || status.includes('physically unable')) return 6
  if (status === 'suspended') return 4
  const desc = (injury.description || '').toLowerCase()
  if (desc.includes('season-ending') || desc.includes('torn')) return 16
  if (desc.includes('surgery')) return 10
  if (desc.includes('sprain') || desc.includes('strain')) return 3
  return null
}

function classifyReinjuryRisk(
  injury: { type: string | null; description: string | null } | null,
  recencyDays: number | null
): 'low' | 'moderate' | 'high' | 'unknown' {
  if (!injury) return 'unknown'
  const combined = `${(injury.type || '').toLowerCase()} ${(injury.description || '').toLowerCase()}`
  const isHighRiskType = [...HIGH_REINJURY_TYPES].some(t => combined.includes(t))
  const isRecent = recencyDays !== null && recencyDays < 90
  if (isHighRiskType && isRecent) return 'high'
  if (isHighRiskType || isRecent) return 'moderate'
  return 'low'
}

function tendencyToPreferenceVector(t: ManagerTendencyProfile): ManagerPreferenceVector {
  return {
    sampleSize: t.sampleSize,
    starterPremium: t.starterPremium,
    positionBias: t.positionBias,
    riskTolerance: t.riskTolerance,
    consolidationBias: t.consolidationBias,
    overpayThreshold: t.overpayThreshold,
    fairnessTolerance: t.fairnessTolerance,
    computedAt: new Date(t.computedAt).toISOString(),
  }
}

export interface BuildLeagueContextInput {
  leagueId: string
  username: string
  platform?: string
}

export async function buildLeagueDecisionContext(
  input: BuildLeagueContextInput
): Promise<LeagueDecisionContext> {
  const assembledAt = new Date().toISOString()
  const contextId = `ldc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const warnings: string[] = []
  const { leagueId, username, platform } = input

  const [leagueData, rostersData, usersData, transactionsData] = await Promise.all([
    getLeagueInfo(leagueId),
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
    getLeagueTransactions(leagueId, 1).catch(() => []),
  ])

  if (!leagueData || !Array.isArray(rostersData) || !Array.isArray(usersData)) {
    throw new Error('Failed to fetch league data from Sleeper')
  }

  const tradeCountByRosterId: Record<number, number> = {}
  let totalTrades = 0
  let recentTrades = 0
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  for (const tx of transactionsData) {
    if (tx.type === 'trade' && tx.roster_ids) {
      totalTrades++
      if (tx.status_updated && tx.status_updated * 1000 > thirtyDaysAgo) recentTrades++
      for (const rid of tx.roster_ids) {
        tradeCountByRosterId[rid] = (tradeCountByRosterId[rid] || 0) + 1
      }
    }
  }

  const userMap = new Map<string, SleeperUser>()
  for (const u of usersData) userMap.set(u.user_id, u)

  const scoringSettings = leagueData.scoring_settings || {}
  const leagueSettings2 = leagueData.settings || {}
  const rosterPositions: string[] = leagueData.roster_positions || []
  const scoringType =
    scoringSettings.rec === 1 ? 'PPR' :
    scoringSettings.rec === 0.5 ? 'Half PPR' :
    'Standard'
  const tepBonus = Number(scoringSettings.bonus_rec_te || 0)
  const isTEP = tepBonus > 0
  const isSF = rosterPositions.some((p: string) => {
    const up = String(p || '').toUpperCase()
    return up === 'SUPER_FLEX' || up === 'SF'
  })
  const totalRosters = Number(leagueData.total_rosters)
  const configuredTeams = Number((leagueSettings2 as { num_teams?: unknown }).num_teams)
  const numTeams =
    (Number.isFinite(totalRosters) && totalRosters > 0 ? totalRosters : null) ??
    (Number.isFinite(configuredTeams) && configuredTeams > 0 ? configuredTeams : null) ??
    12
  const taxiSlots = Number(leagueSettings2.taxi_slots || 0)
  const benchSlots = rosterPositions.filter((p: string) => String(p).toUpperCase() === 'BN').length
  const starterSlots = rosterPositions.filter((p: string) => {
    const up = String(p).toUpperCase()
    return up !== 'BN' && up !== 'IR'
  }).length

  const leagueSettingsObj: LeagueSettings = {
    leagueName: leagueData.name || 'Dynasty League',
    scoringType: scoringType as any,
    numTeams,
    isTEP,
    tepBonus,
    isSF,
    rosterPositions,
    starterSlots,
    benchSlots,
    taxiSlots,
    startingQB: isSF ? 2 : 1,
    startingRB: 2,
    startingWR: 2,
    startingTE: 1,
    startingFlex: 2,
    ppr: scoringType === 'Standard' ? 0 : scoringType === 'Half PPR' ? 0.5 : 1,
  }

  const dict = await getSleeperPlayers()

  const parsedRosters: ParsedRoster[] = (rostersData as SleeperRoster[])
    .filter(r => r.owner_id)
    .map(r => {
      const user = userMap.get(r.owner_id!)
      const playerIds = (r.players || []).filter(Boolean)
      const starters = new Set((r.starters || []).filter(Boolean))
      const reserve = new Set((r.reserve || []).filter(Boolean))
      const taxi = new Set((r.taxi || []).filter(Boolean))
      const players = buildRoster(playerIds, starters, reserve, taxi, dict)

      const wins = r.settings?.wins ?? 0
      const losses = r.settings?.losses ?? 0
      const ties = r.settings?.ties ?? 0
      const fpts = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100

      return {
        rosterId: r.roster_id,
        userId: r.owner_id!,
        displayName: user?.display_name || user?.username || `Team ${r.roster_id}`,
        avatar: user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : undefined,
        pointsFor: fpts,
        record: { wins, losses, ...(ties > 0 ? { ties } : {}) },
        players,
        tradeCount: tradeCountByRosterId[r.roster_id] || 0,
      }
    })

  let fcPlayers: any[] = []
  const leaguePpr = scoringType === 'PPR' ? 1 : scoringType === 'Half PPR' ? 0.5 : 0
  try {
    fcPlayers = await getFantasyCalcValuesDbFirst({
      isDynasty: leagueSettings2.type === 2,
      numQbs: isSF ? 2 : 1,
      numTeams,
      ppr: leaguePpr,
    })
  } catch { fcPlayers = [] }

  /*
   * This league's own defenders and kickers, priced by its own scoring and starting slots.
   * The Sleeper payloads fetched at the top are handed through, so no round trip is repeated.
   */
  const leagueValuePatch = await resolveLeagueValuePatch({
    platformLeagueId: leagueId,
    sleeperLeague: leagueData,
    prefetched: { rosters: rostersData },
  })
  const leagueValueByNameLower = leagueValuePatch.leagueValueByNameLower ?? null

  const valuationCtx: ValuationContext = {
    asOfDate: new Date().toISOString().slice(0, 10),
    isSuperFlex: isSF,
    fantasyCalcPlayers: fcPlayers,
    numTeams,
    ppr: leaguePpr,
    isDynasty: leagueSettings2.type === 2,
    ...leagueValuePatch,
  }

  /*
   * ⚠ DEFENDERS WERE SKIPPED OUTRIGHT HERE, NOT MISPRICED — AND THE TWO NEED DIFFERENT FIXES.
   * Nothing could price them, so every one came back unpriced and would have written a zero
   * into a map the rest of this context treats as real value; excluding them was the honest
   * behaviour at the time. It is still the honest behaviour for a league with no board.
   *
   * A defender is included now only when this league's own board actually priced him, which
   * is the same rule `/api/trade-finder/matchmaking` applies for the same reason.
   */
  const allPlayerNames = new Set<string>()
  for (const r of parsedRosters) {
    for (const p of r.players) {
      if (!p.name) continue
      if (p.isIdp && !leagueValueByNameLower?.has(p.name.toLowerCase().trim())) continue
      allPlayerNames.add(p.name)
    }
  }
  const uniqueNames = Array.from(allPlayerNames)

  const valuationFetchedAt = new Date().toISOString()
  const fantasyCalcValueMap: Record<string, { value: number; marketValue?: number; impactValue?: number; vorpValue?: number; volatility?: number; position?: string; age?: number; team?: string; source?: string }> = {}
  const batchSize = 50
  for (let i = 0; i < uniqueNames.length; i += batchSize) {
    const batch = uniqueNames.slice(i, i + batchSize)
    const pricedBatch = await Promise.all(batch.map(name => pricePlayer(name, valuationCtx)))
    for (const priced of pricedBatch) {
      if (priced.value > 0) {
        fantasyCalcValueMap[priced.name] = {
          value: priced.value,
          marketValue: priced.assetValue.marketValue,
          impactValue: priced.assetValue.impactValue,
          vorpValue: priced.assetValue.vorpValue,
          volatility: priced.assetValue.volatility,
          position: priced.position,
          age: priced.age,
          team: (priced as any).team,
          source: priced.source,
        }
      }
    }
  }

  const [analyticsMap, injuryMap, adpResults] = await Promise.all([
    getPlayerAnalyticsBatch(uniqueNames).catch(e => {
      warnings.push(`Analytics fetch failed: ${e.message}`)
      return new Map<string, PlayerAnalytics>()
    }),
    fetchInjuries(uniqueNames),
    Promise.all(uniqueNames.slice(0, 100).map(name => getPlayerADP(name).catch(() => null))),
  ])

  const adpMap = new Map<string, ADPEntry>()
  let adpFetchedAt: string | null = null
  for (const entry of adpResults) {
    if (entry) adpMap.set(entry.name.toLowerCase(), entry)
  }
  if (adpMap.size > 0) {
    try {
      const latestSnapshot = await prisma.playerAnalyticsSnapshot.findFirst({
        select: { updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      })
      adpFetchedAt = latestSnapshot?.updatedAt?.toISOString() || assembledAt
    } catch {
      adpFetchedAt = assembledAt
    }
  }

  let latestInjuryFetchedAt: string | null = null
  for (const [, inj] of injuryMap) {
    if (inj.fetchedAt && (!latestInjuryFetchedAt || inj.fetchedAt > latestInjuryFetchedAt)) {
      latestInjuryFetchedAt = inj.fetchedAt
    }
  }

  let cachedTendencies: Record<string, ManagerTendencyProfile> = {}
  try {
    const preAnalysis = await getPreAnalysisStatus(username, leagueId)
    if (preAnalysis.status === 'ready' && preAnalysis.cache?.managerTendencies) {
      cachedTendencies = preAnalysis.cache.managerTendencies as Record<string, ManagerTendencyProfile>
    }
  } catch {}

  const leagueAverage = parsedRosters.reduce((sum, r) => sum + r.pointsFor, 0) / Math.max(1, parsedRosters.length)

  const assetsByRosterId = convertSleeperToAssets({
    rosters: parsedRosters.map(r => ({
      rosterId: r.rosterId,
      players: r.players.map(p => ({
        id: p.id,
        name: p.name,
        pos: p.pos,
        team: p.team,
        slot: p.slot,
        isIdp: p.isIdp,
        age: p.age,
      })),
    })),
    fantasyCalcValues: fantasyCalcValueMap,
    leagueSettings: { isSF, isTEP },
  })

  function buildAssetVal(name: string): AssetValuation {
    const nameLower = name.trim().toLowerCase()
    const fc = fantasyCalcValueMap[name] || fantasyCalcValueMap[name.trim()]
    const adp = adpMap.get(nameLower)

    const asset: Asset = {
      id: `ctx-${nameLower.replace(/\s+/g, '-')}`,
      name: name.trim(),
      type: 'PLAYER',
      pos: fc?.position || 'UNKNOWN',
      value: fc?.value || 0,
      age: fc?.age ?? undefined,
    }
    const classified = classifyCornerstone(asset, leagueSettingsObj, DEFAULT_THRESHOLDS)


    return {
      name: name.trim(),
      type: 'PLAYER',
      position: fc?.position || 'UNKNOWN',
      age: fc?.age ?? null,
      team: fc?.team || null,
      marketValue: fc?.marketValue || 0,
      impactValue: fc?.impactValue || 0,
      vorpValue: fc?.vorpValue || 0,
      volatility: fc?.volatility || 0,
      valuationSource: { source: fc?.source || 'unknown', valuedAt: valuationFetchedAt },
      adp: adp ? {
        rank: adp.adp,
        positionalRank: adp.position || null,
        value: adp.value,
        fetchedAt: adpFetchedAt || assembledAt,
      } : null,
      isCornerstone: classified.isCornerstone || false,
      cornerstoneReason: classified.cornerstoneReason || '',
    }
  }

  function buildRiskMarker(name: string): PlayerRiskMarker {
    const nameTrimmed = name.trim()
    const fc = fantasyCalcValueMap[nameTrimmed]
    const analytics = analyticsMap.get(nameTrimmed) || null
    const injury = injuryMap.get(nameTrimmed) || null
    const age = fc?.age || null
    const position = fc?.position || 'UNKNOWN'

    let recencyDays: number | null = null
    if (injury?.date) {
      recencyDays = Math.round((Date.now() - new Date(injury.date).getTime()) / (1000 * 60 * 60 * 24))
    }

    return {
      playerName: nameTrimmed,
      ageBucket: classifyAgeBucket(age ?? null, position),
      currentAge: age ?? null,
      injuryStatus: injury ? {
        status: injury.status,
        type: injury.type,
        description: injury.description,
        reportDate: injury.date,
        recencyDays,
        missedGames: estimateMissedGames(injury),
        reinjuryRisk: classifyReinjuryRisk(injury, recencyDays),
      } : null,
      analytics: analytics ? {
        athleticGrade: analytics.combine?.athleticismScore ?? null,
        collegeProductionGrade: analytics.college?.dominatorRating ?? null,
        weeklyVolatility: analytics.weeklyVolatility ?? null,
        breakoutAge: analytics.college?.breakoutAge ?? null,
        comparablePlayers: analytics.comparablePlayers?.join(', ') ?? null,
      } : null,
    }
  }

  const teams: LeagueTeamSnapshot[] = parsedRosters.map(r => {
    const rosterAssets = assetsByRosterId[r.rosterId] || []
    const playerNames = r.players.filter(p => !p.isIdp).map(p => p.name)

    const assets: AssetValuation[] = playerNames
      .filter(n => fantasyCalcValueMap[n])
      .map(buildAssetVal)

    const totalValue = assets.reduce((sum, a) => sum + a.marketValue, 0)
    const riskMarkers = playerNames.filter(n => fantasyCalcValueMap[n]).map(buildRiskMarker)
    const pickCount = rosterAssets.filter(a => a.type === 'PICK').length
    const youngCount = assets.filter(a => a.age != null && a.age <= 25).length

    const { needs, surplus } = computeNeedsSurplus(rosterAssets, leagueSettingsObj)
    const starterStrengthIndex = computeStarterStrengthIndex(rosterAssets, starterSlots)

    const contenderTier =
      r.pointsFor > leagueAverage * 1.15 ? 'champion' as const :
      r.pointsFor > leagueAverage * 1.05 ? 'contender' as const :
      r.pointsFor < leagueAverage * 0.85 ? 'rebuild' as const :
      'middle' as const

    const tendency = cachedTendencies[r.userId] || null

    return {
      teamId: String(r.rosterId),
      teamName: r.displayName,
      rosterId: r.rosterId,
      userId: r.userId,
      record: r.record,
      pointsFor: r.pointsFor,
      avatar: r.avatar || null,
      tradeCount: r.tradeCount,
      assets,
      totalValue,
      riskMarkers,
      rosterComposition: {
        size: r.players.length,
        pickCount,
        youngAssetCount: youngCount,
        starterStrengthIndex,
      },
      needs,
      surplus,
      contenderTier,
      managerPreferences: tendency ? tendencyToPreferenceVector(tendency) : null,
    }
  })

  const allPlayerNamesList = uniqueNames
  const valuationsMissing = allPlayerNamesList.filter(n => !fantasyCalcValueMap[n])
  const adpMissing = allPlayerNamesList.filter(n => !adpMap.has(n.toLowerCase()))
  const analyticsMissing = allPlayerNamesList.filter(n => !analyticsMap.has(n))
  const managerTendenciesUnavailable = teams
    .filter(t => !t.managerPreferences)
    .map(t => t.teamName)

  const STALENESS_SLA = {
    injury: 7 * 24 * 60 * 60 * 1000,
    valuation: 3 * 24 * 60 * 60 * 1000,
    adp: 7 * 24 * 60 * 60 * 1000,
    tradeHistory: 7 * 24 * 60 * 60 * 1000,
  }
  const isStale = (fetchedAt: string | null, slaMs: number): boolean => {
    if (!fetchedAt) return true
    return (Date.now() - new Date(fetchedAt).getTime()) > slaMs
  }

  const tradeFrequency = totalTrades >= 20 ? 'high' as const : totalTrades >= 5 ? 'medium' as const : 'low' as const

  const assetsCovered = allPlayerNamesList.filter(n => !!fantasyCalcValueMap[n]).length
  const assetsTotal = allPlayerNamesList.length
  const coveragePercent = assetsTotal > 0 ? Math.round((assetsCovered / assetsTotal) * 100) : 0
  const adpHits = allPlayerNamesList.filter(n => adpMap.has(n.toLowerCase())).length

  const missingData: MissingDataFlags = {
    valuationsMissing,
    adpMissing,
    analyticsMissing,
    injuryDataStale: isStale(latestInjuryFetchedAt, STALENESS_SLA.injury),
    valuationDataStale: isStale(valuationFetchedAt, STALENESS_SLA.valuation),
    adpDataStale: allPlayerNamesList.length > 0 && (adpMap.size === 0 || isStale(adpFetchedAt, STALENESS_SLA.adp)),
    analyticsDataStale: allPlayerNamesList.length > 0 && (analyticsMap.size === 0 || analyticsMap.size / allPlayerNamesList.length < 0.3),
    tradeHistoryStale: false,
    managerTendenciesUnavailable,
    competitorDataUnavailable: teams.length < 2,
    tradeHistoryInsufficient: totalTrades < 3,
  }

  const leagueCtx: LeagueDecisionContext = {
    version: LEAGUE_DECISION_CONTEXT_VERSION,
    assembledAt,
    contextId,

    leagueConfig: {
      leagueId,
      name: leagueData.name || 'Dynasty League',
      platform: platform || 'sleeper',
      scoringType,
      numTeams,
      isSF,
      isTEP,
      tepBonus,
      rosterPositions,
      starterSlots,
      benchSlots,
      taxiSlots,
      scoringSettings,
    },

    teams,

    tradeHistoryStats: {
      totalTrades,
      recentTrades,
      recencyWindowDays: 30,
      avgValueDelta: 0,
      leagueTradeFrequency: tradeFrequency,
      computedAt: assembledAt,
    },

    missingData,

    dataQuality: {
      assetsCovered,
      assetsTotal,
      coveragePercent,
      adpHitRate: allPlayerNamesList.length > 0 ? Math.round((adpHits / allPlayerNamesList.length) * 100) : 0,
      injuryDataAvailable: injuryMap.size > 0,
      analyticsAvailable: analyticsMap.size > 0,
      warnings,
    },

    dataSources: {
      valuationFetchedAt,
      adpFetchedAt,
      injuryFetchedAt: latestInjuryFetchedAt,
      analyticsFetchedAt: analyticsMap.size > 0 ? assembledAt : null,
      rostersFetchedAt: assembledAt,
      tradeHistoryFetchedAt: assembledAt,
    },

    sourceFreshness: computeSourceFreshness({
      valuationFetchedAt,
      adpFetchedAt,
      injuryFetchedAt: latestInjuryFetchedAt,
      analyticsFetchedAt: analyticsMap.size > 0 ? assembledAt : null,
      rostersFetchedAt: assembledAt,
      tradeHistoryFetchedAt: assembledAt,
    }),
  }

  return leagueCtx
}

export function deriveTradeDecisionContext(
  leagueCtx: LeagueDecisionContext,
  sideATeamId: string,
  sideBTeamId: string,
  sideAAssetNames: string[],
  sideBAssetNames: string[]
): TradeDecisionContextV1 {
  const teamA = leagueCtx.teams.find(t => t.teamId === sideATeamId || String(t.rosterId) === sideATeamId)
  const teamB = leagueCtx.teams.find(t => t.teamId === sideBTeamId || String(t.rosterId) === sideBTeamId)

  if (!teamA || !teamB) {
    throw new Error(`Teams not found in league context: ${sideATeamId}, ${sideBTeamId}`)
  }

  const filterAssets = (team: LeagueTeamSnapshot, names: string[]): AssetValuation[] => {
    const nameLower = new Set(names.map(n => n.trim().toLowerCase()))
    return team.assets.filter(a => nameLower.has(a.name.toLowerCase()))
  }

  const sideAAssets = filterAssets(teamA, sideAAssetNames)
  const sideBAssets = filterAssets(teamB, sideBAssetNames)

  const sideAValue = sideAAssets.reduce((sum, a) => sum + a.marketValue, 0)
  const sideBValue = sideBAssets.reduce((sum, a) => sum + a.marketValue, 0)
  const absDiff = Math.abs(sideAValue - sideBValue)
  const maxVal = Math.max(sideAValue, sideBValue, 1)
  const pctDiff = Math.round((absDiff / maxVal) * 100)

  const filterRiskMarkers = (team: LeagueTeamSnapshot, names: string[]) => {
    const nameLower = new Set(names.map(n => n.trim().toLowerCase()))
    return team.riskMarkers.filter(r => nameLower.has(r.playerName.toLowerCase()))
  }

  const competitors: CompetitorSnapshot[] = leagueCtx.teams
    .filter(t => t.teamId !== sideATeamId && t.teamId !== sideBTeamId)
    .map(t => ({
      teamId: t.teamId,
      teamName: t.teamName,
      contenderTier: t.contenderTier,
      starterStrengthIndex: t.rosterComposition.starterStrengthIndex,
      needs: t.needs,
      surplus: t.surplus,
    }))

  const buildSideSnapshot = (
    team: LeagueTeamSnapshot,
    assetNames: string[]
  ): TeamSnapshot => ({
    teamId: team.teamId,
    teamName: team.teamName,
    assets: filterAssets(team, assetNames),
    totalValue: filterAssets(team, assetNames).reduce((sum, a) => sum + a.marketValue, 0),
    riskMarkers: filterRiskMarkers(team, assetNames),
    rosterComposition: team.rosterComposition,
    needs: team.needs,
    surplus: team.surplus,
    contenderTier: team.contenderTier,
    managerPreferences: team.managerPreferences,
  })

  const raw = {
    version: TRADE_DECISION_CONTEXT_VERSION,
    assembledAt: leagueCtx.assembledAt,
    contextId: `tdc-${leagueCtx.contextId}`,

    leagueConfig: leagueCtx.leagueConfig,

    sideA: buildSideSnapshot(teamA, sideAAssetNames),
    sideB: buildSideSnapshot(teamB, sideBAssetNames),

    competitors,

    valueDelta: {
      absoluteDiff: absDiff,
      percentageDiff: pctDiff,
      favoredSide: pctDiff <= 5 ? 'Even' as const : sideAValue > sideBValue ? 'A' as const : 'B' as const,
    },

    tradeHistoryStats: leagueCtx.tradeHistoryStats,
    missingData: leagueCtx.missingData,
    dataQuality: leagueCtx.dataQuality,
    dataSources: leagueCtx.dataSources,
    sourceFreshness: leagueCtx.sourceFreshness,
  }

  return TradeDecisionContextV1Schema.parse(raw)
}

export function leagueContextToIntelligence(
  leagueCtx: LeagueDecisionContext
): { intelligence: LeagueIntelligence; parsedRosters: Array<{ rosterId: number; userId: string; displayName: string; avatar?: string; pointsFor: number; record: { wins: number; losses: number; ties?: number } }> } {
  const assetsByRosterId: Record<number, Asset[]> = {}
  const managerProfiles: Record<number, ManagerProfile> = {}

  for (const team of leagueCtx.teams) {
    const assets: Asset[] = team.assets.map((a, idx) => ({
      id: `${team.rosterId}-${idx}`,
      name: a.name,
      type: a.type,
      pos: a.position,
      value: a.marketValue,
      marketValue: a.marketValue,
      impactValue: a.impactValue,
      vorpValue: a.vorpValue,
      volatility: a.volatility,
      age: a.age ?? undefined,
      team: a.team || undefined,
      isCornerstone: a.isCornerstone,
      cornerstoneReason: a.cornerstoneReason,
    }))

    assetsByRosterId[team.rosterId] = assets

    managerProfiles[team.rosterId] = {
      rosterId: team.rosterId,
      userId: team.userId,
      displayName: team.teamName,
      avatar: team.avatar || undefined,
      record: team.record ? { wins: team.record.wins, losses: team.record.losses, ties: team.record.ties } : undefined,
      pointsFor: team.pointsFor,
      isChampion: team.contenderTier === 'champion',
      contenderTier: team.contenderTier,
      starterStrengthIndex: team.rosterComposition.starterStrengthIndex,
      needs: team.needs,
      surplus: team.surplus,
      tradeAggression:
        team.tradeCount >= 5 ? 'high' as const :
        team.tradeCount >= 2 ? 'medium' as const :
        'low' as const,
      prefersYouth: false,
      prefersPicks: false,
      prefersConsolidation: false,
      assets,
      faabRemaining: undefined,
    }
  }

  const intelligence: LeagueIntelligence = {
    assetsByRosterId,
    managerProfiles,
    leagueSettings: {
      leagueName: leagueCtx.leagueConfig.name,
      scoringType: leagueCtx.leagueConfig.scoringType as any,
      numTeams: leagueCtx.leagueConfig.numTeams,
      isTEP: leagueCtx.leagueConfig.isTEP,
      tepBonus: leagueCtx.leagueConfig.tepBonus,
      isSF: leagueCtx.leagueConfig.isSF,
      rosterPositions: leagueCtx.leagueConfig.rosterPositions,
      starterSlots: leagueCtx.leagueConfig.starterSlots,
      benchSlots: leagueCtx.leagueConfig.benchSlots,
      taxiSlots: leagueCtx.leagueConfig.taxiSlots,
    },
    leagueTradeFrequency: leagueCtx.tradeHistoryStats.leagueTradeFrequency || undefined,
  }

  const parsedRosters = leagueCtx.teams.map(t => ({
    rosterId: t.rosterId,
    userId: t.userId,
    displayName: t.teamName,
    avatar: t.avatar || undefined,
    pointsFor: t.pointsFor,
    record: t.record || { wins: 0, losses: 0 },
  }))

  return { intelligence, parsedRosters }
}
