import { prisma } from '../prisma'
import { pricePlayer, type ValuationContext } from '../hybrid-valuation'
import { getPlayerAnalyticsBatch, type PlayerAnalytics } from '../player-analytics'
import { fetchFantasyCalcValues } from '@/lib/player-valuations/canonicalPlayerValuations'
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
  expandRosterPositionTokens,
  isSuperflexToken,
  countStarterSlots,
  countBenchSlots,
} from './rosterPositionFormat'
import { runImportedLeagueNormalizationPipeline } from '../league-import/ImportedLeagueNormalizationPipeline'
import { IMPORT_PROVIDERS, type ImportProvider, type NormalizedImportResult } from '../league-import/types'
import type { SleeperImportPayload } from '../league-import/adapters/sleeper/types'
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
  /** A stable numeric id for this call only — see resolveNumericRosterId's docstring for why this isn't always the provider's real id. */
  rosterId: number
  /** The provider's real, canonical team/roster identifier — always prefer this over rosterId for cross-system references. */
  sourceTeamId: string
  userId: string
  displayName: string
  avatar?: string
  pointsFor: number
  record: { wins: number; losses: number; ties?: number }
  players: RosteredPlayer[]
  tradeCount: number
}

function isIdpPos(pos?: string) {
  const p = (pos || '').toUpperCase()
  return p === 'DL' || p === 'LB' || p === 'DB' || p === 'EDGE' || p === 'IDP'
}

/**
 * Builds a roster's classified player list from the provider-neutral
 * `player_map` (name/position/team, keyed by the provider's own source
 * player id) that every import adapter already produces — see
 * lib/league-import/adapters/{sleeper,espn,yahoo,mfl,fantrax,fleaflicker}/*Adapter.ts,
 * all six populate this field. Age is intentionally left undefined here:
 * the original Sleeper-only implementation also set it from Sleeper's own
 * player dict, but nothing downstream ever read `RosteredPlayer.age` again
 * (verified by reading the rest of this file before refactoring it) — every
 * real age-based calculation below uses FantasyCalc's own age data instead.
 */
function buildRosterFromPlayerMap(
  playerIds: string[],
  starters: Set<string>,
  reserve: Set<string>,
  taxi: Set<string>,
  playerMap: Record<string, { name: string; position: string; team: string }>
): RosteredPlayer[] {
  return playerIds.map((pid) => {
    const meta = playerMap[pid]
    const name = meta?.name || pid
    const pos = (meta?.position || '').toUpperCase()
    const team = (meta?.team || '').toUpperCase() || undefined

    let slot: RosterSlot = 'Bench'
    if (starters.has(pid)) slot = 'Starter'
    else if (reserve.has(pid)) slot = 'IR'
    else if (taxi.has(pid)) slot = 'Taxi'

    return { id: pid, name, pos: pos || 'UNK', team, slot, isIdp: isIdpPos(pos) }
  })
}

/**
 * A stable numeric id for THIS call only, keyed on array position when the
 * provider's real team identifier isn't a clean integer (e.g. Yahoo's
 * compound team keys like "423.l.116.t.4" — not parseable without losing
 * information). Sleeper and ESPN's own ids already parse cleanly as
 * integers, so this is a no-op for them. Every downstream reference that
 * needs the REAL provider identifier uses `sourceTeamId` instead — see
 * `ParsedRoster`/`LeagueTeamSnapshot.teamId`, which is always the true
 * `source_team_id`, never this synthetic fallback.
 */
function resolveNumericRosterId(sourceTeamId: string, index: number): number {
  const parsed = Number(sourceTeamId)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : index + 1
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

function resolveProvider(platform: string | undefined): ImportProvider {
  const candidate = (platform || 'sleeper').toLowerCase()
  const match = (IMPORT_PROVIDERS as readonly string[]).find((p) => p === candidate)
  // Defaults to sleeper for an unrecognized value rather than throwing — matches
  // the original code's own unconditional `platform || 'sleeper'` fallback
  // behavior exactly, so every existing caller (which never passes `platform`
  // today) sees identical behavior to before this refactor.
  return (match as ImportProvider | undefined) ?? 'sleeper'
}

export interface BuildLeagueContextInput {
  leagueId: string
  username: string
  platform?: string
  /**
   * AllFantasy account id — required for ESPN/Yahoo/MFL/Fantrax (their fetch
   * services resolve stored credentials by userId; see
   * ImportedLeagueNormalizationPipeline.ts). Not required for Sleeper or
   * Fleaflicker, matching every other provider-aware entry point in this
   * codebase (e.g. app/api/leagues/import/commit/route.ts).
   */
  userId?: string
}

export async function buildLeagueDecisionContext(
  input: BuildLeagueContextInput
): Promise<LeagueDecisionContext> {
  const assembledAt = new Date().toISOString()
  const contextId = `ldc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const warnings: string[] = []
  const { leagueId, username, userId } = input
  const provider = resolveProvider(input.platform)

  const normalizationResult = await runImportedLeagueNormalizationPipeline({
    provider,
    sourceId: leagueId,
    userId,
  })
  if (!normalizationResult.success) {
    throw new Error(`Failed to fetch league data from ${provider}: ${normalizationResult.error}`)
  }
  const normalized: NormalizedImportResult = normalizationResult.normalized

  const rawRosterPositions = (normalized.league.roster_positions as string[] | undefined) ?? []
  const expandedPositions = expandRosterPositionTokens(rawRosterPositions)
  const scoringSettings = (normalized.league.scoring_settings as Record<string, number> | undefined) ?? {}
  const scoringType =
    scoringSettings.rec === 1 ? 'PPR' :
    scoringSettings.rec === 0.5 ? 'Half PPR' :
    'Standard'
  const tepBonus = Number(scoringSettings.bonus_rec_te || 0)
  const isTEP = tepBonus > 0
  const isSF = expandedPositions.some(isSuperflexToken)
  const numTeams = normalized.league.leagueSize > 0 ? normalized.league.leagueSize : 12
  const benchSlots = countBenchSlots(expandedPositions)
  const starterSlots = countStarterSlots(expandedPositions)

  // Taxi squad SIZE (not which players are on it — that's normalized.rosters[].taxi_ids,
  // already provider-neutral) is not yet captured by the normalization layer for any
  // provider (confirmed: NormalizedLeagueSettings has no taxi_slots field). Sleeper's
  // raw payload still carries it, so we preserve exact Sleeper behavior via the raw
  // payload this phase's earlier work already threads through
  // (ImportedLeagueNormalizationResult.rawPayload — see Phase 2B). Every other
  // provider gets an honest 0 plus a data-quality warning, never a silent guess.
  let taxiSlots = 0
  if (provider === 'sleeper') {
    const rawSleeperPayload = normalizationResult.rawPayload as SleeperImportPayload | undefined
    taxiSlots = Number(rawSleeperPayload?.league?.settings?.taxi_slots ?? 0)
  } else if (expandedPositions.length > 0) {
    warnings.push(
      `taxiSlots defaulted to 0: not yet captured by the ${provider} import normalization layer (only which players are on taxi is known, not the league-configured slot count).`
    )
  }

  const leagueSettingsObj: LeagueSettings = {
    leagueName: normalized.league.name || 'Dynasty League',
    scoringType: scoringType as any,
    numTeams,
    isTEP,
    tepBonus,
    isSF,
    rosterPositions: expandedPositions,
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

  const playerMap = normalized.player_map ?? {}
  if (Object.keys(playerMap).length === 0) {
    warnings.push(`Player identity map is empty for this ${provider} import — player names/positions may be unavailable.`)
  }

  const tradeCountBySourceTeamId: Record<string, number> = {}
  let totalTrades = 0
  let recentTrades = 0
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  for (const tx of normalized.transactions ?? []) {
    if (tx.type === 'trade') {
      totalTrades++
      const createdMs = new Date(tx.created_at).getTime()
      if (Number.isFinite(createdMs) && createdMs > thirtyDaysAgo) recentTrades++
      for (const rid of tx.roster_ids ?? []) {
        tradeCountBySourceTeamId[rid] = (tradeCountBySourceTeamId[rid] || 0) + 1
      }
    }
  }

  const parsedRosters: ParsedRoster[] = (normalized.rosters ?? [])
    .filter((r) => r.source_manager_id)
    .map((r, index) => {
      const starters = new Set((r.starter_ids ?? []).filter(Boolean))
      const reserve = new Set((r.reserve_ids ?? []).filter(Boolean))
      const taxi = new Set((r.taxi_ids ?? []).filter(Boolean))
      const players = buildRosterFromPlayerMap(r.player_ids ?? [], starters, reserve, taxi, playerMap)

      return {
        rosterId: resolveNumericRosterId(r.source_team_id, index),
        sourceTeamId: r.source_team_id,
        userId: r.source_manager_id,
        displayName: r.owner_name || r.team_name || `Team ${r.source_team_id}`,
        avatar: r.avatar_url ?? undefined,
        pointsFor: r.points_for,
        record: { wins: r.wins, losses: r.losses, ...(r.ties > 0 ? { ties: r.ties } : {}) },
        players,
        tradeCount: tradeCountBySourceTeamId[r.source_team_id] || 0,
      }
    })

  let fcPlayers: any[] = []
  try {
    fcPlayers = await fetchFantasyCalcValues({
      isDynasty: normalized.league.isDynasty,
      numQbs: isSF ? 2 : 1,
      numTeams,
      ppr: 1,
    })
  } catch { fcPlayers = [] }

  const valuationCtx: ValuationContext = {
    asOfDate: new Date().toISOString().slice(0, 10),
    isSuperFlex: isSF,
    fantasyCalcPlayers: fcPlayers,
    numTeams,
  }

  const allPlayerNames = new Set<string>()
  for (const r of parsedRosters) {
    for (const p of r.players) {
      if (p.name && !p.isIdp) allPlayerNames.add(p.name)
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

  // Sleeper-only cache (lib/trade-pre-analysis.ts keys entirely on sleeperUsername/
  // sleeperLeagueId — a separate, out-of-scope module this phase does not touch).
  // Gated to sleeper so a non-Sleeper username is never looked up against it.
  let cachedTendencies: Record<string, ManagerTendencyProfile> = {}
  if (provider === 'sleeper') {
    try {
      const preAnalysis = await getPreAnalysisStatus(username, leagueId)
      if (preAnalysis.status === 'ready' && preAnalysis.cache?.managerTendencies) {
        cachedTendencies = preAnalysis.cache.managerTendencies as Record<string, ManagerTendencyProfile>
      }
    } catch {}
  }

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
      teamId: r.sourceTeamId,
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
      name: normalized.league.name || 'Dynasty League',
      platform: provider,
      scoringType,
      numTeams,
      isSF,
      isTEP,
      tepBonus,
      rosterPositions: expandedPositions,
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
