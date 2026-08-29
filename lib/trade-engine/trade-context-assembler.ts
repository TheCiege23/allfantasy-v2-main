import { prisma } from '../prisma'
import { priceAssets, type PricedAsset, type ValuationContext, type AssetsInput, type PickInput } from '../hybrid-valuation'
import { getPlayerAnalyticsBatch, type PlayerAnalytics } from '../player-analytics'
import { buildManagerProfile, type ManagerTendencyProfile } from './manager-tendency-engine'
import {
  computeNeedsSurplus,
  computeStarterStrengthIndex,
  classifyCornerstone,
} from './league-intelligence'
import { type Asset, type LeagueSettings, DEFAULT_THRESHOLDS } from './types'
import { getPlayerADP, type ADPEntry } from '../adp-data'
import { loadLeagueTradeValues } from '../league-values/leagueTradeValues'
import {
  TradeDecisionContextV1Schema,
  type TradeDecisionContextV1,
  type AssetValuation,
  type PlayerRiskMarker,
  type TeamSnapshot,
  type CompetitorSnapshot,
  type MissingDataFlags,
  type ManagerPreferenceVector,
  TRADE_DECISION_CONTEXT_VERSION,
  classifyAgeBucket,
  computeSourceFreshness,
} from './trade-decision-context'

export interface TradeParty {
  name: string
  assets: string[]
}

export interface LeagueContextInput {
  leagueId?: string
  leagueName?: string
  platform?: string
  scoringType?: string
  numTeams?: number
  isSF?: boolean
  isTEP?: boolean
  tepBonus?: number
  rosterPositions?: string[]
  starterSlots?: number
  benchSlots?: number
  taxiSlots?: number
  scoringSettings?: Record<string, number>
}

function extractPlayerNames(assets: string[]): string[] {
  return assets
    .map(s => s.trim())
    .filter(s => s.length > 2 && !/^\d{4}\s/.test(s) && !/pick/i.test(s))
}

function isPickAsset(asset: string): boolean {
  return /pick|round|1st|2nd|3rd|4th/i.test(asset.toLowerCase())
}

function parsePickFromString(asset: string): PickInput {
  const yearMatch = asset.match(/(\d{4})/)
  const roundMatch = asset.match(/(\d)(st|nd|rd|th)/i)
  const currentYear = new Date().getFullYear()

  let round = 1
  if (roundMatch) {
    round = parseInt(roundMatch[1])
  } else if (/2nd|second/i.test(asset)) {
    round = 2
  } else if (/3rd|third/i.test(asset)) {
    round = 3
  } else if (/4th|fourth/i.test(asset)) {
    round = 4
  }

  const tierMatch = asset.toLowerCase()
  let tier: 'early' | 'mid' | 'late' | null = null
  if (tierMatch.includes('early')) tier = 'early'
  else if (tierMatch.includes('late')) tier = 'late'
  else if (tierMatch.includes('mid')) tier = 'mid'

  return {
    year: yearMatch ? parseInt(yearMatch[1]) : currentYear + 1,
    round,
    tier,
  }
}

async function fetchInjuries(playerNames: string[]): Promise<Map<string, { status: string; type: string | null; description: string | null; date: string | null; fetchedAt: string | null }>> {
  const result = new Map<string, { status: string; type: string | null; description: string | null; date: string | null; fetchedAt: string | null }>()
  if (playerNames.length === 0) return result

  try {
    const injuries = await prisma.sportsInjury.findMany({
      where: {
        playerName: { in: playerNames },
        sport: 'NFL',
      },
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
    console.warn('[trade-context] Injury fetch failed:', e)
  }

  return result
}

type InjuryInfo = { status: string; type: string | null; description: string | null; date: string | null; fetchedAt: string | null }

const HIGH_REINJURY_TYPES = new Set(['acl', 'achilles', 'hamstring', 'ankle', 'concussion', 'knee', 'shoulder'])

function estimateMissedGames(injury: InjuryInfo | null): number | null {
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
  injury: InjuryInfo | null,
  recencyDays: number | null
): 'low' | 'moderate' | 'high' | 'unknown' {
  if (!injury) return 'unknown'
  const injType = (injury.type || '').toLowerCase()
  const desc = (injury.description || '').toLowerCase()
  const combined = `${injType} ${desc}`

  const isHighRiskType = [...HIGH_REINJURY_TYPES].some(t => combined.includes(t))
  const isRecent = recencyDays !== null && recencyDays < 90

  if (isHighRiskType && isRecent) return 'high'
  if (isHighRiskType || isRecent) return 'moderate'
  return 'low'
}

interface ManagerContextResult {
  managerId: string
  managerName: string
  tendencies: ManagerTendencyProfile | null
  contenderTier: 'champion' | 'contender' | 'middle' | 'rebuild'
  needs: string[]
  surplus: string[]
  starterStrengthIndex: number
  rosterSize: number
  pickCount: number
  youngAssetCount: number
  rostersFetchedAt: string | null
}

async function fetchManagerContext(
  leagueId: string | undefined,
  partyName: string,
  settings: LeagueSettings
): Promise<ManagerContextResult | null> {
  if (!leagueId) return null

  try {
    const league = await prisma.league.findFirst({
      where: { platformLeagueId: leagueId },
      include: { rosters: true },
    })

    if (!league) return null

    const partyLower = partyName.toLowerCase()
    const roster = league.rosters.find(r => {
      const pd = r.playerData as any
      const ownerName = pd?.ownerDisplayName || pd?.displayName || ''
      return ownerName.toLowerCase().includes(partyLower)
    }) || league.rosters[0]

    if (!roster) return null

    const playerData = Array.isArray(roster.playerData)
      ? (roster.playerData as any[])
      : ((roster.playerData as any)?.players || [])

    const rosterAssets: Asset[] = playerData.map((p: any, idx: number) => ({
      id: `${roster.id}-${idx}`,
      name: p.fullName || p.playerName || p.full_name || 'Unknown',
      type: 'PLAYER' as const,
      pos: p.position || 'UNKNOWN',
      value: p.marketValue || p.value || 0,
      age: p.age || null,
    }))

    let tendencies: ManagerTendencyProfile | null = null
    try {
      const tradeNotifs = await prisma.tradeNotification.findMany({
        where: { userId: league.userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      if (tradeNotifs.length >= 3) {
        const normalizedTrades = tradeNotifs.map(t => {
          const data = (t as any).tradeData || {}
          return {
            sideA: Array.isArray(data.sideA) ? data.sideA : [],
            sideB: Array.isArray(data.sideB) ? data.sideB : [],
          }
        })
        const profile = buildManagerProfile(normalizedTrades as any)
        tendencies = {
          managerId: String(roster.id),
          managerName: partyName,
          computedAt: Date.now(),
          ...profile,
        }
      }
    } catch {
    }

    const { needs, surplus } = computeNeedsSurplus(rosterAssets, settings)
    const starterIdx = computeStarterStrengthIndex(rosterAssets, settings.starterSlots || 8)
    const youngAssets = rosterAssets.filter(a => a.age != null && (a.age as number) <= 25).length
    const picks = rosterAssets.filter(a => a.type === 'PICK').length

    return {
      managerId: String(roster.id),
      managerName: partyName,
      tendencies,
      contenderTier: 'middle',
      needs,
      surplus,
      starterStrengthIndex: starterIdx,
      rosterSize: rosterAssets.length,
      pickCount: picks,
      youngAssetCount: youngAssets,
      rostersFetchedAt: (roster as any).updatedAt ? new Date((roster as any).updatedAt).toISOString() : null,
    }
  } catch (e) {
    console.warn('[trade-context] Manager context fetch failed:', e)
    return null
  }
}

async function fetchCompetitorSnapshots(
  leagueId: string | undefined,
  excludeNames: string[],
  settings: LeagueSettings
): Promise<{ competitors: CompetitorSnapshot[]; fetchedAt: string | null }> {
  if (!leagueId) return { competitors: [], fetchedAt: null }

  try {
    const league = await prisma.league.findFirst({
      where: { platformLeagueId: leagueId },
      include: { rosters: true },
    })

    if (!league || !league.rosters.length) return { competitors: [], fetchedAt: null }

    const excludeLower = excludeNames.map(n => n.toLowerCase())
    const competitors: CompetitorSnapshot[] = []

    for (const roster of league.rosters) {
      const pd = roster.playerData as any
      const ownerName = pd?.ownerDisplayName || pd?.displayName || `Team ${roster.id}`
      if (excludeLower.some(e => ownerName.toLowerCase().includes(e))) continue

      const playerData = Array.isArray(roster.playerData)
        ? (roster.playerData as any[])
        : (pd?.players || [])

      const rosterAssets: Asset[] = playerData.map((p: any, idx: number) => ({
        id: `comp-${roster.id}-${idx}`,
        name: p.fullName || p.playerName || 'Unknown',
        type: 'PLAYER' as const,
        pos: p.position || 'UNKNOWN',
        value: p.marketValue || p.value || 0,
        age: p.age || null,
      }))

      const { needs, surplus } = computeNeedsSurplus(rosterAssets, settings)
      const starterIdx = computeStarterStrengthIndex(rosterAssets, settings.starterSlots || 8)

      competitors.push({
        teamId: String(roster.id),
        teamName: ownerName,
        contenderTier: 'middle',
        starterStrengthIndex: starterIdx,
        needs,
        surplus,
      })
    }

    return {
      competitors: competitors.slice(0, 10),
      fetchedAt: new Date().toISOString(),
    }
  } catch {
    return { competitors: [], fetchedAt: null }
  }
}

async function fetchLeagueTradeHistory(leagueId: string | undefined): Promise<{ totalTrades: number; recentTrades: number; avgValueDelta: number; fetchedAt: string }> {
  const now = new Date().toISOString()
  if (!leagueId) return { totalTrades: 0, recentTrades: 0, avgValueDelta: 0, fetchedAt: now }

  try {
    const league = await prisma.league.findFirst({ where: { platformLeagueId: leagueId } })
    if (!league) return { totalTrades: 0, recentTrades: 0, avgValueDelta: 0, fetchedAt: now }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [total, recent] = await Promise.all([
      prisma.tradeNotification.count({ where: { userId: league.userId } }),
      prisma.tradeNotification.count({ where: { userId: league.userId, createdAt: { gte: thirtyDaysAgo } } }),
    ])

    return { totalTrades: total, recentTrades: recent, avgValueDelta: 0, fetchedAt: now }
  } catch {
    return { totalTrades: 0, recentTrades: 0, avgValueDelta: 0, fetchedAt: now }
  }
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

export async function assembleTradeDecisionContext(
  sideA: TradeParty,
  sideB: TradeParty,
  leagueInput: LeagueContextInput
): Promise<TradeDecisionContextV1> {
  const assembledAt = new Date().toISOString()
  const contextId = `tdc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const warnings: string[] = []

  const leagueSettings: LeagueSettings = {
    leagueName: leagueInput.leagueName || 'Unknown League',
    scoringType: (leagueInput.scoringType as any) || 'PPR',
    numTeams: leagueInput.numTeams || 12,
    isTEP: leagueInput.isTEP || false,
    tepBonus: leagueInput.tepBonus || 0,
    isSF: leagueInput.isSF || false,
    rosterPositions: leagueInput.rosterPositions || ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX'],
    starterSlots: leagueInput.starterSlots || 8,
    benchSlots: leagueInput.benchSlots || 6,
    taxiSlots: leagueInput.taxiSlots || 0,
    startingQB: leagueInput.isSF ? 2 : 1,
    startingRB: 2,
    startingWR: 2,
    startingTE: 1,
    startingFlex: 2,
    ppr: leagueInput.scoringType === 'Standard' ? 0 : leagueInput.scoringType === 'Half PPR' ? 0.5 : 1,
  }

  const allAssetNames = [...sideA.assets, ...sideB.assets]
  const allPlayerNames = extractPlayerNames(allAssetNames)

  /*
   * The league's own IDP board, so defenders in this path are priced by the league's
   * scoring rather than the flat per-position constant in lib/hybrid-valuation.ts.
   *
   * ⚠ `leagueSettings.rosterPositions` IS NOT PASSED HERE, ON PURPOSE. It carries an
   * offensive-only DEFAULT when the caller supplied none, and handing that to the
   * valuation would state that the league has zero IDP starting slots — which makes
   * replacement level unresolvable and refuses the whole board. Passing the raw input
   * instead lets `loadLeagueTradeValues` fetch the real slots when it is absent.
   *
   * ⚠ DYNASTY IS ASSUMED because this input carries no format field. It only selects
   * between two decay curves, and every league in production that genuinely scores
   * IDP is dynasty (see lib/idp-kicker-values.ts), so the redraft curve is currently
   * unreachable from anywhere. If a format ever reaches this input, pass it.
   */
  const leagueValues = leagueInput.leagueId
    ? await loadLeagueTradeValues({
        prisma,
        platformLeagueId: leagueInput.leagueId,
        isDynasty: true,
        prefetched: {
          rosterPositions: leagueInput.rosterPositions ?? null,
          numTeams: leagueInput.numTeams ?? null,
        },
      }).catch(() => null)
    : null

  const valuationFetchedAt = new Date().toISOString()
  const valuationCtx: ValuationContext = {
    asOfDate: new Date().toISOString().split('T')[0],
    isSuperFlex: leagueSettings.isSF ?? false,
    numTeams: leagueSettings.numTeams,
    ...(leagueValues && leagueValues.byNameLower.size > 0 && { leagueValueByNameLower: leagueValues.byNameLower }),
  }

  const playerNames: string[] = []
  const pickInputs: PickInput[] = []
  const pickNameMap = new Map<number, string>()

  for (const name of allAssetNames) {
    if (isPickAsset(name)) {
      const idx = pickInputs.length
      pickInputs.push(parsePickFromString(name))
      pickNameMap.set(idx, name.trim())
    } else {
      playerNames.push(name.trim())
    }
  }

  const assetsInput: AssetsInput = {
    players: playerNames,
    picks: pickInputs,
  }

  const [pricedResult, analyticsMap, injuryMap, adpResults, managerA, managerB, tradeHistory, competitorData] = await Promise.all([
    priceAssets(assetsInput, valuationCtx).catch(e => {
      warnings.push(`Valuation failed: ${e.message}`)
      return { total: 0, compositeTotal: 0, items: [] as PricedAsset[], stats: { playersFromExcel: 0, playersFromFantasyCalc: 0, playersFromIdpVorp: 0, playersFromKickerFlat: 0, playersUnknown: 0, picksFromExcel: 0, picksFromCurve: 0 } }
    }),
    getPlayerAnalyticsBatch(allPlayerNames).catch(e => {
      warnings.push(`Analytics fetch failed: ${e.message}`)
      return new Map<string, PlayerAnalytics>()
    }),
    fetchInjuries(allPlayerNames),
    Promise.all(
      allPlayerNames.slice(0, 20).map(name => getPlayerADP(name).catch(() => null))
    ),
    fetchManagerContext(leagueInput.leagueId, sideA.name, leagueSettings),
    fetchManagerContext(leagueInput.leagueId, sideB.name, leagueSettings),
    fetchLeagueTradeHistory(leagueInput.leagueId),
    fetchCompetitorSnapshots(leagueInput.leagueId, [sideA.name, sideB.name], leagueSettings),
  ])

  const pricedMap = new Map<string, PricedAsset>()
  for (const p of pricedResult.items) {
    pricedMap.set(p.name.toLowerCase(), p)
  }

  const adpMap = new Map<string, ADPEntry>()
  let adpFetchedAt: string | null = null
  for (const entry of adpResults) {
    if (entry) {
      adpMap.set(entry.name.toLowerCase(), entry)
    }
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

  function buildAssetValuation(assetName: string): AssetValuation {
    const nameLower = assetName.trim().toLowerCase()
    const priced = pricedMap.get(nameLower)
    const adp = adpMap.get(nameLower)
    const isPick = isPickAsset(assetName)

    const asset: Asset = {
      id: `ctx-${nameLower.replace(/\s+/g, '-')}`,
      name: assetName.trim(),
      type: isPick ? 'PICK' : 'PLAYER',
      pos: priced?.position || 'UNKNOWN',
      value: priced?.value || 0,
      age: priced?.age ?? undefined,
    }

    const classified = classifyCornerstone(asset, leagueSettings, DEFAULT_THRESHOLDS)

    return {
      name: assetName.trim(),
      type: isPick ? 'PICK' : 'PLAYER',
      position: priced?.position || 'UNKNOWN',
      age: priced?.age ?? null,
      team: (priced as any)?.team || null,
      marketValue: priced?.assetValue?.marketValue || 0,
      impactValue: priced?.assetValue?.impactValue || 0,
      vorpValue: priced?.assetValue?.vorpValue || 0,
      volatility: priced?.assetValue?.volatility || 0,
      valuationSource: {
        source: priced?.source || 'unknown',
        valuedAt: valuationFetchedAt,
      },
      adp: adp ? {
        rank: adp.adp,
        positionalRank: adp.position || null,
        value: adp.value,
        fetchedAt: assembledAt,
      } : null,
      isCornerstone: classified.isCornerstone || false,
      cornerstoneReason: classified.cornerstoneReason || '',
    }
  }

  function buildRiskMarker(assetName: string): PlayerRiskMarker {
    const nameTrimmed = assetName.trim()
    const nameLower = nameTrimmed.toLowerCase()
    const priced = pricedMap.get(nameLower)
    const analytics = analyticsMap.get(nameTrimmed) || null
    const injury = injuryMap.get(nameTrimmed) || null

    const age = priced?.age || null
    const position = priced?.position || 'UNKNOWN'

    let recencyDays: number | null = null
    if (injury?.date) {
      const injDate = new Date(injury.date)
      recencyDays = Math.round((Date.now() - injDate.getTime()) / (1000 * 60 * 60 * 24))
    }

    const missedGames = estimateMissedGames(injury)
    const reinjuryRisk = classifyReinjuryRisk(injury, recencyDays)

    return {
      playerName: nameTrimmed,
      ageBucket: classifyAgeBucket(age, position),
      currentAge: age,
      injuryStatus: injury ? {
        status: injury.status,
        type: injury.type,
        description: injury.description,
        reportDate: injury.date,
        recencyDays,
        missedGames,
        reinjuryRisk,
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

  function buildTeamSnapshot(
    party: TradeParty,
    managerCtx: ManagerContextResult | null
  ): TeamSnapshot {
    const assets = party.assets.map(buildAssetValuation)
    const totalValue = assets.reduce((sum, a) => sum + a.marketValue, 0)

    const playerAssetNames = party.assets.filter(a => !isPickAsset(a))
    const riskMarkers = playerAssetNames.map(buildRiskMarker)

    const pickCount = party.assets.filter(a => isPickAsset(a)).length
    const youngCount = assets.filter(a => a.age != null && a.age <= 25).length

    return {
      teamId: managerCtx?.managerId || party.name,
      teamName: party.name,
      assets,
      totalValue,
      riskMarkers,
      rosterComposition: {
        size: managerCtx?.rosterSize || assets.length,
        pickCount: managerCtx?.pickCount || pickCount,
        youngAssetCount: managerCtx?.youngAssetCount || youngCount,
        starterStrengthIndex: managerCtx?.starterStrengthIndex || 0,
      },
      needs: managerCtx?.needs || [],
      surplus: managerCtx?.surplus || [],
      contenderTier: managerCtx?.contenderTier || 'middle',
      managerPreferences: managerCtx?.tendencies
        ? tendencyToPreferenceVector(managerCtx.tendencies)
        : null,
    }
  }

  const teamA = buildTeamSnapshot(sideA, managerA)
  const teamB = buildTeamSnapshot(sideB, managerB)

  const totalA = teamA.totalValue
  const totalB = teamB.totalValue
  const absDiff = Math.abs(totalA - totalB)
  const maxVal = Math.max(totalA, totalB, 1)
  const pctDiff = Math.round((absDiff / maxVal) * 100)

  const adpHits = allPlayerNames.filter(n => adpMap.has(n.toLowerCase())).length
  const assetsTotal = allPlayerNames.length + pickInputs.length
  const assetsCovered = allPlayerNames.filter(n => pricedMap.has(n.toLowerCase())).length + pickInputs.length
  const coveragePercent = assetsTotal > 0 ? Math.round((assetsCovered / assetsTotal) * 100) : 0

  const valuationsMissing = allPlayerNames.filter(n => !pricedMap.has(n.toLowerCase()))
  const adpMissing = allPlayerNames.filter(n => !adpMap.has(n.toLowerCase()))
  const analyticsMissing = allPlayerNames.filter(n => !analyticsMap.has(n))

  const managerTendenciesUnavailable: string[] = []
  if (!managerA?.tendencies) managerTendenciesUnavailable.push(sideA.name)
  if (!managerB?.tendencies) managerTendenciesUnavailable.push(sideB.name)

  const tradeFrequency = tradeHistory.totalTrades >= 20
    ? 'high' as const
    : tradeHistory.totalTrades >= 5
    ? 'medium' as const
    : 'low' as const

  const STALENESS_SLA = {
    injury: 7 * 24 * 60 * 60 * 1000,
    valuation: 3 * 24 * 60 * 60 * 1000,
    adp: 7 * 24 * 60 * 60 * 1000,
    analytics: 14 * 24 * 60 * 60 * 1000,
    tradeHistory: 7 * 24 * 60 * 60 * 1000,
  }

  const isStale = (fetchedAt: string | null, slaMs: number): boolean => {
    if (!fetchedAt) return true
    return (Date.now() - new Date(fetchedAt).getTime()) > slaMs
  }

  const missingData: MissingDataFlags = {
    valuationsMissing,
    adpMissing,
    analyticsMissing,
    injuryDataStale: isStale(latestInjuryFetchedAt, STALENESS_SLA.injury),
    valuationDataStale: isStale(valuationFetchedAt, STALENESS_SLA.valuation),
    adpDataStale: allPlayerNames.length > 0
      && (adpMap.size === 0 || isStale(adpFetchedAt, STALENESS_SLA.adp)),
    analyticsDataStale: allPlayerNames.length > 0
      && (analyticsMap.size === 0 || analyticsMap.size / allPlayerNames.length < 0.3),
    tradeHistoryStale: isStale(tradeHistory.fetchedAt, STALENESS_SLA.tradeHistory),
    managerTendenciesUnavailable,
    competitorDataUnavailable: competitorData.competitors.length === 0,
    tradeHistoryInsufficient: tradeHistory.totalTrades < 3,
  }

  const raw = {
    version: TRADE_DECISION_CONTEXT_VERSION,
    assembledAt,
    contextId,

    leagueConfig: {
      leagueId: leagueInput.leagueId || null,
      name: leagueSettings.leagueName,
      platform: leagueInput.platform || null,
      scoringType: leagueSettings.scoringType,
      numTeams: leagueSettings.numTeams,
      isSF: leagueSettings.isSF ?? false,
      isTEP: leagueSettings.isTEP,
      tepBonus: leagueSettings.tepBonus,
      rosterPositions: leagueSettings.rosterPositions,
      starterSlots: leagueSettings.starterSlots,
      benchSlots: leagueSettings.benchSlots || 6,
      taxiSlots: leagueSettings.taxiSlots || 0,
      scoringSettings: leagueInput.scoringSettings || {},
    },

    sideA: teamA,
    sideB: teamB,

    competitors: competitorData.competitors,

    valueDelta: {
      absoluteDiff: absDiff,
      percentageDiff: pctDiff,
      favoredSide: pctDiff <= 5 ? 'Even' as const : totalA > totalB ? 'A' as const : 'B' as const,
    },

    tradeHistoryStats: {
      totalTrades: tradeHistory.totalTrades,
      recentTrades: tradeHistory.recentTrades,
      recencyWindowDays: 30,
      avgValueDelta: tradeHistory.avgValueDelta,
      leagueTradeFrequency: tradeFrequency,
      computedAt: tradeHistory.fetchedAt,
    },

    missingData,

    dataQuality: {
      assetsCovered,
      assetsTotal,
      coveragePercent,
      adpHitRate: allPlayerNames.length > 0 ? Math.round((adpHits / allPlayerNames.length) * 100) : 0,
      injuryDataAvailable: injuryMap.size > 0,
      analyticsAvailable: analyticsMap.size > 0,
      warnings,
    },

    dataSources: {
      valuationFetchedAt,
      adpFetchedAt,
      injuryFetchedAt: latestInjuryFetchedAt,
      analyticsFetchedAt: analyticsMap.size > 0 ? assembledAt : null,
      rostersFetchedAt: managerA?.rostersFetchedAt || managerB?.rostersFetchedAt || null,
      tradeHistoryFetchedAt: tradeHistory.fetchedAt,
    },

    sourceFreshness: computeSourceFreshness({
      valuationFetchedAt,
      adpFetchedAt,
      injuryFetchedAt: latestInjuryFetchedAt,
      analyticsFetchedAt: analyticsMap.size > 0 ? assembledAt : null,
      rostersFetchedAt: managerA?.rostersFetchedAt || managerB?.rostersFetchedAt || null,
      tradeHistoryFetchedAt: tradeHistory.fetchedAt,
    }),
  }

  return TradeDecisionContextV1Schema.parse(raw)
}

export function contextToPromptV1(ctx: TradeDecisionContextV1): string {
  const lines: string[] = []

  lines.push(`=== TRADE DECISION CONTEXT V1 ===`)
  lines.push(`Context ID: ${ctx.contextId}`)
  lines.push(`Assembled: ${ctx.assembledAt} | Version: ${ctx.version}`)
  lines.push(`Coverage: ${ctx.dataQuality.assetsCovered}/${ctx.dataQuality.assetsTotal} assets (${ctx.dataQuality.coveragePercent}%), ADP: ${ctx.dataQuality.adpHitRate}%`)
  if (ctx.dataQuality.warnings.length > 0) {
    lines.push(`Warnings: ${ctx.dataQuality.warnings.join('; ')}`)
  }
  lines.push('')

  lines.push(`--- LEAGUE CONFIG ---`)
  lines.push(`${ctx.leagueConfig.name} | ${ctx.leagueConfig.scoringType} | ${ctx.leagueConfig.numTeams} teams`)
  lines.push(`SF: ${ctx.leagueConfig.isSF} | TEP: ${ctx.leagueConfig.isTEP} (bonus: ${ctx.leagueConfig.tepBonus})`)
  lines.push(`Starters: ${ctx.leagueConfig.starterSlots} | Bench: ${ctx.leagueConfig.benchSlots} | Taxi: ${ctx.leagueConfig.taxiSlots}`)
  lines.push(`Positions: ${ctx.leagueConfig.rosterPositions.join(', ')}`)
  lines.push('')

  for (const [label, side] of [['SIDE A', ctx.sideA], ['SIDE B', ctx.sideB]] as const) {
    lines.push(`--- ${label}: ${side.teamName} (Total: ${side.totalValue}) ---`)
    lines.push(`  Tier: ${side.contenderTier} | Roster: ${side.rosterComposition.size} | Picks: ${side.rosterComposition.pickCount} | Young: ${side.rosterComposition.youngAssetCount} | SSI: ${side.rosterComposition.starterStrengthIndex}`)
    lines.push(`  Needs: ${side.needs.join(', ') || 'None'} | Surplus: ${side.surplus.join(', ') || 'None'}`)

    if (side.managerPreferences) {
      const mp = side.managerPreferences
      lines.push(`  Prefs (n=${mp.sampleSize}): StarterPrem=${mp.starterPremium.toFixed(2)}, Risk=${mp.riskTolerance.toFixed(2)}, Consol=${mp.consolidationBias.toFixed(2)}, Overpay=${mp.overpayThreshold.toFixed(2)}`)
      lines.push(`  PosBias: QB=${mp.positionBias.QB.toFixed(2)} RB=${mp.positionBias.RB.toFixed(2)} WR=${mp.positionBias.WR.toFixed(2)} TE=${mp.positionBias.TE.toFixed(2)} PICK=${mp.positionBias.PICK.toFixed(2)}`)
    }

    lines.push(`  Assets:`)
    for (const a of side.assets) {
      let line = `    ${a.name} [${a.position}/${a.type}] — Mkt: ${a.marketValue}, Impact: ${a.impactValue}, VORP: ${a.vorpValue}, Vol: ${(a.volatility * 100).toFixed(0)}%`
      if (a.age) line += `, Age: ${a.age}`
      if (a.team) line += `, Team: ${a.team}`
      line += ` (src: ${a.valuationSource.source})`
      if (a.adp) line += ` | ADP: #${a.adp.rank}`
      if (a.isCornerstone) line += ` | CORNERSTONE: ${a.cornerstoneReason}`
      lines.push(line)
    }

    if (side.riskMarkers.length > 0) {
      lines.push(`  Risk Markers:`)
      for (const rm of side.riskMarkers) {
        let line = `    ${rm.playerName}: age=${rm.ageBucket}`
        if (rm.injuryStatus) {
          line += ` | INJURY: ${rm.injuryStatus.status}`
          if (rm.injuryStatus.recencyDays != null) line += ` (${rm.injuryStatus.recencyDays}d ago)`
        }
        if (rm.analytics) {
          const parts: string[] = []
          if (rm.analytics.athleticGrade != null) parts.push(`Ath:${rm.analytics.athleticGrade.toFixed(1)}`)
          if (rm.analytics.collegeProductionGrade != null) parts.push(`ColProd:${rm.analytics.collegeProductionGrade.toFixed(1)}`)
          if (rm.analytics.breakoutAge != null) parts.push(`BA:${rm.analytics.breakoutAge}`)
          if (parts.length) line += ` | ${parts.join(', ')}`
        }
        lines.push(line)
      }
    }
    lines.push('')
  }

  lines.push(`--- VALUE DELTA ---`)
  lines.push(`Absolute: ${ctx.valueDelta.absoluteDiff} | Percentage: ${ctx.valueDelta.percentageDiff}% | Favored: Side ${ctx.valueDelta.favoredSide}`)
  lines.push('')

  if (ctx.tradeHistoryStats.totalTrades > 0) {
    lines.push(`--- TRADE HISTORY (${ctx.tradeHistoryStats.recencyWindowDays}d window) ---`)
    lines.push(`Total: ${ctx.tradeHistoryStats.totalTrades} | Recent: ${ctx.tradeHistoryStats.recentTrades} | Frequency: ${ctx.tradeHistoryStats.leagueTradeFrequency || 'unknown'}`)
    lines.push('')
  }

  if (ctx.competitors.length > 0) {
    lines.push(`--- KEY COMPETITORS (${ctx.competitors.length}) ---`)
    for (const c of ctx.competitors.slice(0, 5)) {
      lines.push(`  ${c.teamName}: ${c.contenderTier}, SSI=${c.starterStrengthIndex}, Needs=[${c.needs.join(',')}], Surplus=[${c.surplus.join(',')}]`)
    }
    lines.push('')
  }

  const md = ctx.missingData
  const flags: string[] = []
  if (md.valuationsMissing.length > 0) flags.push(`Valuations missing: ${md.valuationsMissing.join(', ')}`)
  if (md.adpMissing.length > 0) flags.push(`ADP missing: ${md.adpMissing.join(', ')}`)
  if (md.injuryDataStale) flags.push('Injury data stale (>7d)')
  if (md.managerTendenciesUnavailable.length > 0) flags.push(`No tendency data: ${md.managerTendenciesUnavailable.join(', ')}`)
  if (md.competitorDataUnavailable) flags.push('No competitor data')
  if (md.tradeHistoryInsufficient) flags.push('Insufficient trade history (<3 trades)')

  if (flags.length > 0) {
    lines.push(`--- MISSING DATA FLAGS ---`)
    for (const f of flags) lines.push(`  ! ${f}`)
    lines.push('')
  }

  lines.push(`--- DATA SOURCES ---`)
  lines.push(`  Valuations: ${ctx.dataSources.valuationFetchedAt}`)
  if (ctx.dataSources.adpFetchedAt) lines.push(`  ADP: ${ctx.dataSources.adpFetchedAt}`)
  if (ctx.dataSources.injuryFetchedAt) lines.push(`  Injuries: ${ctx.dataSources.injuryFetchedAt}`)
  if (ctx.dataSources.analyticsFetchedAt) lines.push(`  Analytics: ${ctx.dataSources.analyticsFetchedAt}`)
  if (ctx.dataSources.rostersFetchedAt) lines.push(`  Rosters: ${ctx.dataSources.rostersFetchedAt}`)
  lines.push('')

  lines.push(`=== END CONTEXT ===`)

  return lines.join('\n')
}
