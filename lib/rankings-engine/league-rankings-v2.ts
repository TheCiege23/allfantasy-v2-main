import {
  getLeagueRosters,
  getLeagueUsers,
  getLeagueInfo,
  getPlayoffBracket,
  getLeagueDrafts,
  getDraftPicks,
  getAllPlayers,
  SleeperRoster,
  SleeperUser,
  SleeperPlayoffBracket,
} from '../sleeper-client'
import { fetchFantasyCalcValues, FantasyCalcPlayer, FantasyCalcSettings, getValuationCacheAgeMs } from '../fantasycalc'
import { prisma } from '../prisma'
import { getWeekStatsFromCache } from './sleeper-matchup-cache'
import { buildIdpKickerValueMap, detectIdpLeague, detectKickerLeague } from '../idp-kicker-values'
import { getPlayerAnalyticsBatch } from '@/lib/player-analytics'
import { getCompositeWeightConfig, resolveWeightProfile, computeCompositeFromWeights, type CompositeWeightConfig } from './composite-weights'
import { getActiveCompositeParams, type LearnedCompositeParams } from './composite-param-learning'
import { getActiveWeightsForSegment } from './weekly-weight-learning'
import type { ComponentWeights } from './adaptive-weight-learning'
import { applyAntiGamingConstraints, type AntiGamingInput } from './anti-gaming'
import { getPreviousWeekSnapshots, getLeagueSparklines, type SnapshotMetrics } from './snapshots'
import { type TeamProjection } from '../monte-carlo'

export interface Driver {
  id: string
  polarity: 'UP' | 'DOWN' | 'NEUTRAL'
  impact: number
  evidence: Record<string, any>
}

export interface Action {
  id: string
  title: string
  why: string
  expectedImpact: 'LOW' | 'MEDIUM' | 'HIGH'
  cta: { label: string; href: string }
}

export interface RankExplanation {
  confidence: {
    score: number
    rating: 'HIGH' | 'MEDIUM' | 'LEARNING'
    drivers: Driver[]
  }
  drivers: Driver[]
  nextActions: Action[]
  valid: boolean
}

export interface MotivationalFrame {
  headline: string
  subtext: string
  suggestedAction: string
  tone: 'encouraging' | 'cautionary' | 'neutral' | 'celebratory'
  trigger: string
}

export interface PortfolioProjection {
  year1: number
  year3: number
  year5: number
  volatilityBand: number
}

export interface TeamScore {
  rosterId: number
  ownerId: string
  username: string | null
  displayName: string | null
  avatar: string | null
  role: string | null
  isOrphan: boolean

  winScore: number
  powerScore: number
  luckScore: number
  marketValueScore: number
  managerSkillScore: number
  futureCapitalScore: number
  composite: number
  portfolioProjection: PortfolioProjection

  rank: number
  prevRank: number | null
  rankDelta: number | null

  record: { wins: number; losses: number; ties: number }
  pointsFor: number
  pointsAgainst: number
  strengthOfSchedule: number
  expectedWins: number
  streak: number
  luckDelta: number
  shouldBeRecord: { wins: number; losses: number }
  bounceBackIndex: number
  motivationalFrame: MotivationalFrame

  starterValue: number
  benchValue: number
  totalRosterValue: number
  pickValue: number

  positionValues: Record<string, { starter: number; bench: number; total: number }>
  rosterExposure: Record<string, number>
  marketAdj: number

  phase: 'offseason' | 'in_season' | 'post_draft' | 'post_season'

  explanation: RankExplanation
  badges: Badge[]
  dataQuality: TeamDataQuality
  antiGaming: AntiGamingConstraintInfo | null
  rankChangeDrivers: RankChangeDriver[]
  forwardOdds: ForwardOdds
  confidenceBadge: ConfidenceBadge
  rankSparkline: number[]
}

export interface RankChangeDriver {
  id: string
  label: string
  polarity: 'UP' | 'DOWN' | 'NEUTRAL'
  value: number
  prevValue: number | null
  delta: number | null
  unit: string
}

export interface ForwardOdds {
  playoffPct: number
  top3Pct: number
  titlePct: number
  simCount: number
}

export interface ConfidenceBadge {
  tier: 'GOLD' | 'SILVER' | 'BRONZE'
  label: string
  tooltip: string
}

export interface AntiGamingConstraintInfo {
  constrained: boolean
  originalRank: number
  justifications: Array<{
    metric: string
    label: string
    previousValue: number | null
    currentValue: number
    delta: number | null
    passed: boolean
  }>
  failedMetrics: string[]
}

export interface TeamDataQuality {
  rankingConfidence: number
  confidenceRating: 'HIGH' | 'MEDIUM' | 'LOW'
  dataCoverage: 'FULL' | 'PARTIAL' | 'MINIMAL'
  stalenessHours: {
    injury: number | null
    valuation: number
    sleeperSync: number
  }
  signals: string[]
}

export interface Badge {
  id: string
  label: string
  icon: string
  tier: 'gold' | 'silver' | 'bronze' | 'none'
}

export interface MarketInsight {
  position: string
  premiumPct: number
  sample: number
  label: string
}

export interface WeeklyAward {
  id:
    | 'top_score'
    | 'high_score_margin'
    | 'biggest_upset'
    | 'unluckiest'
    | 'luckiest'
    | 'bounceback_alert'
    | 'points_against_victim'
    | 'boss_win'
  week: number
  rosterId: number
  title: string
  subtitle: string
  value: number
  evidence: Record<string, any>
}

export interface WeeklyAwardsPayload {
  week: number
  awards: WeeklyAward[]
}

export interface TradeHubShortcut {
  rosterId: number
  headline: string
  body: string
  ldiPos: string
  ldiScore: number
  leverageScore: number
  ctas: Array<{ id: 'generate_offers' | 'find_overpayers' | 'open_trade_hub'; label: string; href: string }>
  evidence: {
    exposureByPos: Record<string, number>
    ldiByPos: Record<string, number>
    topCurrencyPos: string
    topPartners: Array<{
      partnerName: string
      sample: number
      ldiForPos: number
      meanPremiumPctForPos: number
      tag: 'Overpayer' | 'Learning'
      posN: number
    }>
  }
}

export interface PartnerTendency {
  partnerName: string
  sample: number
  ldiByPos: Record<string, number>
  meanPremiumPctByPos: Record<string, number>
  topOverpayPos: string | null
  topDiscountPos: string | null
}

export interface LeagueRankingsV2Output {
  leagueId: string
  leagueName: string
  season: string
  week: number
  phase: 'offseason' | 'in_season' | 'post_draft' | 'post_season'
  isDynasty: boolean
  isSuperFlex: boolean
  isIdpLeague: boolean
  isKickerLeague: boolean
  teams: TeamScore[]
  weeklyPointsDistribution: { rosterId: number; weeklyPoints: number[] }[]
  computedAt: number
  marketInsights: MarketInsight[]
  ldiChips: LDIChip[]
  weeklyAwards: WeeklyAwardsPayload | null
  tradeHubShortcuts: TradeHubShortcut[]
  partnerTendencies: PartnerTendency[]
  meta: {
    ldiByPos: Record<string, number>
    partnerPosCounts: Record<string, Record<string, number>>
    ldiSampleTotal: number
    ldiTrend: Record<string, number>
    proposalTargets: Array<{
      position: string
      rosterId: string
      name: string
      score: number
      ldiByPos: number
      meanPremiumPct: number
      nByPos: number
      label: 'Overpayer' | 'Learning'
    }>
    weightVersion: string
    weightCalibratedAt: string
    learnedParams?: LearnedCompositeParams
    adaptiveWeights?: ComponentWeights
    segmentKey?: string
    modelConfidence: {
      score: number
      rating: 'HIGH' | 'MEDIUM' | 'LOW'
      teamsCovered: number
      teamsTotal: number
      avgDataCoverage: number
    }
    dataFreshness: {
      overall: 'fresh' | 'aging' | 'stale'
      avgStalenessHours: number
      staleSourceCount: number
    }
  }
}

export interface LDIChip {
  position: string
  ldi: number
  label: string
  type: 'hot' | 'cold'
}


interface LeagueSettings {
  leagueId: string
  name: string
  season: string
  isSF: boolean
  isDynasty: boolean
  ppr: 0 | 0.5 | 1
  numTeams: number
  status: string
  week: number
  rosterPositions: string[]
}

interface RosterRecord {
  rosterId: number
  ownerId: string
  ownerName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  playoffSeed: number | null
  isChampion: boolean
  players: string[]
  starters: string[]
}

async function fetchUnifiedLeagueTeamMeta(leagueId: string): Promise<Map<number, { role: string | null; isOrphan: boolean }>> {
  const unifiedLeague = await prisma.league.findFirst({
    where: {
      platform: 'sleeper',
      platformLeagueId: leagueId,
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      teams: {
        select: {
          externalId: true,
          role: true,
          isOrphan: true,
        },
      },
    },
  })

  const metaByRosterId = new Map<number, { role: string | null; isOrphan: boolean }>()
  for (const team of unifiedLeague?.teams ?? []) {
    const rosterId = Number(team.externalId)
    if (!Number.isFinite(rosterId)) continue
    metaByRosterId.set(rosterId, {
      role: team.role ?? null,
      isOrphan: team.isOrphan === true,
    })
  }

  return metaByRosterId
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function robustPercentileRank(value: number, values: number[]): number {
  const N = values.length
  if (N < 2) return 0.5
  const sorted = [...values].sort((a, b) => a - b)
  const allSame = sorted[0] === sorted[sorted.length - 1]
  if (allSame) return 0.5
  let sumRanks = 0
  let count = 0
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] === value) {
      sumRanks += i
      count++
    }
  }
  if (count === 0) {
    const idx = sorted.findIndex(v => v >= value)
    if (idx === -1) return 1.0
    return idx / Math.max(1, N - 1)
  }
  const avgRank = sumRanks / count
  const rawPercentile = avgRank / Math.max(1, N - 1)
  if (N < 6) {
    return 0.5 + (rawPercentile - 0.5) * 0.7
  }
  return rawPercentile
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  const sqDiffs = arr.map(v => (v - mean) ** 2)
  return Math.sqrt(sqDiffs.reduce((s, v) => s + v, 0) / arr.length)
}

async function fetchLeagueSettings(leagueId: string): Promise<LeagueSettings | null> {
  const dbLeague = await prisma.legacyLeague.findFirst({
    where: { sleeperLeagueId: leagueId },
    select: {
      sleeperLeagueId: true,
      name: true,
      season: true,
      isSF: true,
      isTEP: true,
      tepBonus: true,
      teamCount: true,
      scoringType: true,
      leagueType: true,
      specialtyFormat: true,
      status: true,
    },
    orderBy: { season: 'desc' },
  })

  if (dbLeague) {
    const isDynasty = dbLeague.leagueType?.toLowerCase() === 'dynasty' || dbLeague.leagueType === '2'
    const pprMap: Record<string, 0 | 0.5 | 1> = { 'ppr': 1, 'half_ppr': 0.5, 'standard': 0 }
    const ppr = pprMap[dbLeague.scoringType || ''] ?? 1

    const sleeperLeague = await getLeagueInfo(leagueId)
    const week = sleeperLeague ? Math.max(1, (sleeperLeague.settings as any)?.leg ?? 1) : 1
    const status = sleeperLeague?.status || dbLeague.status || 'in_season'

    return {
      leagueId,
      name: dbLeague.name,
      season: String(dbLeague.season),
      isSF: dbLeague.isSF,
      isDynasty,
      ppr,
      numTeams: dbLeague.teamCount || 12,
      status,
      week,
      rosterPositions: sleeperLeague?.roster_positions || [],
    }
  }

  const league = await getLeagueInfo(leagueId)
  if (!league) return null

  const rosterPositions = league.roster_positions || []
  const isSuperFlex = rosterPositions.some(
    p => p.toUpperCase() === 'SUPER_FLEX' || p.toUpperCase() === 'QB' && rosterPositions.filter(r => r.toUpperCase() === 'QB').length >= 2,
  )
  const scoringSettings = league.scoring_settings || {}
  const ppr = (scoringSettings.rec ?? 1) as 0 | 0.5 | 1
  const isDynasty = (league.settings as any)?.type === 2

  return {
    leagueId,
    name: league.name,
    season: league.season,
    isSF: isSuperFlex,
    isDynasty,
    ppr,
    numTeams: league.total_rosters || 12,
    status: league.status,
    week: Math.max(1, (league.settings as any)?.leg ?? 1),
    rosterPositions,
  }
}

async function fetchRosterRecords(leagueId: string): Promise<Map<number, RosterRecord> | null> {
  const dbLeague = await prisma.legacyLeague.findFirst({
    where: { sleeperLeagueId: leagueId },
    select: { id: true },
    orderBy: { season: 'desc' },
  })
  if (!dbLeague) return null

  const dbRosters = await prisma.legacyRoster.findMany({
    where: { leagueId: dbLeague.id },
    select: {
      rosterId: true,
      ownerId: true,
      ownerName: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      pointsAgainst: true,
      playoffSeed: true,
      isChampion: true,
      players: true,
    },
  })

  if (dbRosters.length === 0) return null

  const m = new Map<number, RosterRecord>()
  for (const r of dbRosters) {
    const players = Array.isArray(r.players) ? r.players as string[] : []
    m.set(r.rosterId, {
      rosterId: r.rosterId,
      ownerId: r.ownerId || '',
      ownerName: r.ownerName || null,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      playoffSeed: r.playoffSeed,
      isChampion: r.isChampion,
      players,
      starters: [],
    })
  }
  return m
}


function computeExpectedWins(
  rosterId: number,
  weeklyPointsByRoster: Map<number, number[]>,
  maxWeek: number,
): number {
  let expectedWins = 0
  for (let w = 0; w < maxWeek; w++) {
    const myPts = weeklyPointsByRoster.get(rosterId)?.[w]
    if (myPts === undefined || myPts === 0) continue
    const weekScores: number[] = []
    weeklyPointsByRoster.forEach((pts, rid) => {
      const p = pts[w]
      if (p !== undefined && p > 0) weekScores.push(p)
    })
    weekScores.sort((a, b) => b - a)
    const rank = weekScores.indexOf(myPts) + 1
    const ewCredit = (weekScores.length - rank) / Math.max(1, weekScores.length - 1)
    expectedWins += ewCredit
  }
  return expectedWins
}

function computeStreak(weeklyPoints: number[], weeklyOpponentPoints: number[]): number {
  let streak = 0
  for (let i = weeklyPoints.length - 1; i >= 0; i--) {
    if (weeklyPoints[i] === 0 && weeklyOpponentPoints[i] === 0) continue
    const won = weeklyPoints[i] > weeklyOpponentPoints[i]
    if (i === weeklyPoints.length - 1 || (streak > 0 && won) || (streak < 0 && !won)) {
      streak += won ? 1 : -1
    } else {
      break
    }
  }
  return streak
}

function computeSOS(
  rosterId: number,
  weekStats: { week: number; rosterId: number; matchupId: number | null }[],
  rosterRecords: Map<number, { wins: number; total: number }>,
): number {
  let oppWinPctSum = 0
  let oppCount = 0

  const myStats = weekStats.filter(s => s.rosterId === rosterId && s.matchupId !== null)
  for (const ms of myStats) {
    const opp = weekStats.find(
      s => s.week === ms.week && s.matchupId === ms.matchupId && s.rosterId !== rosterId,
    )
    if (!opp) continue
    const oppRec = rosterRecords.get(opp.rosterId)
    if (oppRec && oppRec.total > 0) {
      oppWinPctSum += oppRec.wins / oppRec.total
      oppCount++
    }
  }

  if (oppCount === 0) return 0.5
  return oppWinPctSum / oppCount
}

export interface PlayerValueMap {
  sleeperId: string
  value: number
  redraftValue: number
  position: string
  age: number | null
  name: string
}

function buildPlayerValueMap(fcPlayers: FantasyCalcPlayer[]): Map<string, PlayerValueMap> {
  const m = new Map<string, PlayerValueMap>()
  for (const fc of fcPlayers) {
    if (fc.player.sleeperId) {
      m.set(fc.player.sleeperId, {
        sleeperId: fc.player.sleeperId,
        value: fc.value,
        redraftValue: fc.redraftValue,
        position: fc.player.position || '',
        age: fc.player.maybeAge,
        name: fc.player.name,
      })
    }
  }
  return m
}

interface RosterValueResult {
  starterValue: number
  benchValue: number
  totalValue: number
  positionValues: Record<string, { starter: number; bench: number; total: number }>
}

function computeRosterValues(
  roster: SleeperRoster,
  valueMap: Map<string, PlayerValueMap>,
  isDynasty: boolean,
): RosterValueResult {
  let starterValue = 0
  let benchValue = 0
  const positionValues: Record<string, { starter: number; bench: number; total: number }> = {}

  const starters = new Set(roster.starters || [])
  const allPlayers = roster.players || []

  for (const pid of allPlayers) {
    const pv = valueMap.get(pid)
    if (!pv) continue
    const val = isDynasty ? pv.value : pv.redraftValue
    const pos = (pv.position || 'OTHER').toUpperCase()
    if (!positionValues[pos]) positionValues[pos] = { starter: 0, bench: 0, total: 0 }
    if (starters.has(pid)) {
      starterValue += val
      positionValues[pos].starter += val
    } else {
      benchValue += val
      positionValues[pos].bench += val
    }
    positionValues[pos].total += val
  }

  return { starterValue, benchValue, totalValue: starterValue + benchValue, positionValues }
}

function computeAgeAdjustedMarketValue(
  roster: SleeperRoster,
  valueMap: Map<string, PlayerValueMap>,
  isDynasty: boolean,
  ldiData: Record<string, { ldi: number }> | null,
  playerInjuryMap?: Map<string, PlayerInjuryProfile>,
): number {
  let total = 0
  for (const pid of roster.players || []) {
    const pv = valueMap.get(pid)
    if (!pv) continue
    let val = isDynasty ? pv.value : pv.redraftValue
    if (isDynasty && pv.age !== null) {
      const ageFactor = clamp(1 + 0.02 * (26 - pv.age), 0.88, 1.12)
      val = val * ageFactor
    }
    if (ldiData) {
      const posLdi = ldiData[pv.position.toUpperCase()]?.ldi ?? 50
      const posBoost = 0.85 + 0.30 * (posLdi / 100)
      val = val * posBoost
    }
    if (playerInjuryMap) {
      const profile = playerInjuryMap.get(pid)
      if (profile && profile.effectiveSeverity > 0.05) {
        const recency = profile.recencyDecay
        const sev = profile.severity
        const eff = profile.effectiveSeverity
        const unc = profile.uncertainty

        const certaintyWeight = 1 - unc * 0.35
        const recencyAmplifier = 0.5 + 0.5 * recency

        let baseDiscount: number
        if (sev >= 0.90) {
          baseDiscount = isDynasty ? 0.15 : 0.70
        } else if (sev >= 0.60) {
          baseDiscount = isDynasty ? 0.10 : 0.45
        } else if (sev >= 0.25) {
          baseDiscount = isDynasty ? 0.06 : 0.25
        } else {
          baseDiscount = isDynasty ? 0.02 : 0.10
        }

        const discount = baseDiscount * eff * certaintyWeight * recencyAmplifier

        if (isDynasty && sev >= 0.90 && recency >= 0.80) {
          val = val * (1 - discount * 0.60)
        } else {
          val = val * (1 - discount)
        }
      }
    }
    total += val
  }
  return total
}

async function fetchTradeMetrics(
  leagueId: string,
  rosterIdToUsername: Map<number, string>,
): Promise<Map<number, { tradeCount: number; avgPremium: number }>> {
  const result = new Map<number, { tradeCount: number; avgPremium: number }>()

  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperLeagueId: leagueId },
    select: {
      sleeperUsername: true,
      trades: {
        where: { analyzed: true },
        select: { valueGiven: true, valueReceived: true },
      },
    },
  })

  const usernameToMetrics = new Map<string, { tradeCount: number; avgPremium: number }>()
  for (const h of histories) {
    if (!h.sleeperUsername) continue
    let totalPremium = 0
    let validCount = 0
    for (const t of h.trades) {
      if (t.valueGiven !== null && t.valueReceived !== null) {
        totalPremium += ((t.valueReceived || 0) - (t.valueGiven || 0)) / Math.max(1, t.valueGiven || 0)
        validCount++
      }
    }
    usernameToMetrics.set(h.sleeperUsername.toLowerCase(), {
      tradeCount: h.trades.length,
      avgPremium: validCount > 0 ? totalPremium / validCount : 0,
    })
  }

  rosterIdToUsername.forEach((username, rid) => {
    const metrics = username ? usernameToMetrics.get(username.toLowerCase()) : undefined
    result.set(rid, metrics || { tradeCount: 0, avgPremium: 0 })
  })

  return result
}

async function fetchLdiForLeague(
  leagueId: string,
): Promise<Record<string, { ldi: number; meanPremiumPct?: number; sample?: number }> | null> {
  const snapshot = await prisma.leagueDemandWeekly.findFirst({
    where: { leagueId },
    orderBy: { weekStart: 'desc' },
    select: { demandByPosition: true },
  })
  if (!snapshot) return null
  const dj = snapshot.demandByPosition as any
  if (dj && typeof dj === 'object' && dj.QB) return dj
  return null
}

function detectPhase(week: number, season: string, leagueStatus?: string): 'offseason' | 'post_draft' | 'in_season' | 'post_season' {
  if (leagueStatus === 'pre_draft') return 'offseason'
  if (leagueStatus === 'drafting') return 'post_draft'
  if (leagueStatus === 'complete') return 'post_season'
  if (week === 0) return 'offseason'
  if (week >= 18) return 'post_season'
  return 'in_season'
}

interface PlayoffFinishInfo {
  isChampion: boolean
  isRunnerUp: boolean
  playoffWins: number
  playoffLosses: number
  bestFinish: number
  madePlayoffs: boolean
}

function analyzePlayoffBracket(
  bracket: SleeperPlayoffBracket[],
  rosterIds: number[],
): Map<number, PlayoffFinishInfo> {
  const result = new Map<number, PlayoffFinishInfo>()

  for (const rid of rosterIds) {
    result.set(rid, {
      isChampion: false,
      isRunnerUp: false,
      playoffWins: 0,
      playoffLosses: 0,
      bestFinish: 999,
      madePlayoffs: false,
    })
  }

  if (!bracket || bracket.length === 0) return result

  const maxRound = Math.max(...bracket.map(m => m.r))

  for (const match of bracket) {
    const { t1, t2, w, l, r: round } = match
    if (t1) {
      const info = result.get(t1)
      if (info) info.madePlayoffs = true
    }
    if (t2) {
      const info = result.get(t2)
      if (info) info.madePlayoffs = true
    }
    if (w && w > 0) {
      const winnerInfo = result.get(w)
      if (winnerInfo) {
        winnerInfo.playoffWins++
        if (round === maxRound) {
          winnerInfo.isChampion = true
          winnerInfo.bestFinish = 1
        }
      }
    }
    if (l && l > 0) {
      const loserInfo = result.get(l)
      if (loserInfo) {
        loserInfo.playoffLosses++
        if (round === maxRound) {
          loserInfo.isRunnerUp = true
          loserInfo.bestFinish = Math.min(loserInfo.bestFinish, 2)
        } else {
          const finishFromRound = Math.pow(2, maxRound - round) + 1
          loserInfo.bestFinish = Math.min(loserInfo.bestFinish, finishFromRound)
        }
      }
    }
  }

  for (const [rid, info] of result) {
    if (info.isChampion) info.bestFinish = 1
    else if (info.madePlayoffs && info.bestFinish === 999) {
      info.bestFinish = rosterIds.length
    }
  }

  return result
}

function computeWinScore(
  winPct: number,
  sos: number,
  phase: string,
  madePlayoffs: boolean,
  isChamp: boolean,
  playoffFinish: PlayoffFinishInfo | null,
  numTeams: number,
): number {
  const sosAdj = clamp((sos - 0.5) * 0.10, -0.05, 0.05)
  const wsBase = clamp01(winPct + sosAdj)

  if (phase === 'post_season') {
    let playoffFinishScore = 0.30
    const actualChamp = isChamp || (playoffFinish?.isChampion ?? false)
    const actualRunnerUp = playoffFinish?.isRunnerUp ?? false
    const bestFinish = playoffFinish?.bestFinish ?? 999

    if (actualChamp) playoffFinishScore = 1.0
    else if (actualRunnerUp || bestFinish <= 2) playoffFinishScore = 0.80
    else if (bestFinish <= 4) playoffFinishScore = 0.65
    else if (bestFinish <= 6) playoffFinishScore = 0.50
    else if (madePlayoffs) playoffFinishScore = 0.45
    return Math.round(100 * clamp01(0.45 * winPct + 0.55 * playoffFinishScore))
  }

  return Math.round(100 * wsBase)
}

interface PlayerInjuryProfile {
  severity: number
  recencyDecay: number
  uncertainty: number
  effectiveSeverity: number
  isStarter: boolean
  playerValue: number
}

interface RosterInjuryImpact {
  powerHealthRatio: number
  marketDiscount: number
  riskConcentration: number
  uncertaintyVolatility: number
  injuryProfiles: PlayerInjuryProfile[]
  byPlayerId: Map<string, PlayerInjuryProfile>
}

function applyLearnedParamsToProfile(
  profile: import('./composite-weights').CompositeWeightProfile,
  params: LearnedCompositeParams,
): import('./composite-weights').CompositeWeightProfile {
  const luckScale = 2.0 / Math.max(1.0, params.luckDampening)
  const fcDelta = params.futureCapitalInfluence - 0.05
  const totalOther = profile.win + profile.power + profile.market + profile.skill + profile.draftGain
  const rebalanceFactor = totalOther > 0 ? (totalOther - fcDelta) / totalOther : 1
  return {
    win: Math.max(0, profile.win * rebalanceFactor),
    power: Math.max(0, profile.power * rebalanceFactor),
    luck: Math.max(0, profile.luck * luckScale),
    market: Math.max(0, profile.market * rebalanceFactor),
    skill: Math.max(0, profile.skill * rebalanceFactor),
    draftGain: Math.max(0, profile.draftGain * rebalanceFactor),
    futureCapital: Math.max(0, profile.futureCapital + fcDelta),
  }
}

function applyAdaptiveComponentWeights(
  profile: import('./composite-weights').CompositeWeightProfile,
  cw: { market: number; impact: number; scarcity: number; demand: number },
): import('./composite-weights').CompositeWeightProfile {
  const baseline = { market: 0.25, impact: 0.25, scarcity: 0.25, demand: 0.25 }
  const marketShift = (cw.market - baseline.market) / baseline.market
  const impactShift = (cw.impact - baseline.impact) / baseline.impact

  const MAX_SHIFT = 0.15
  const clampedMarketDelta = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, marketShift * 0.10))
  const clampedImpactDelta = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, impactShift * 0.10))

  const adjusted = {
    win: Math.max(0, profile.win + clampedImpactDelta * profile.win),
    power: Math.max(0, profile.power + clampedImpactDelta * profile.power),
    luck: profile.luck,
    market: Math.max(0, profile.market + clampedMarketDelta * profile.market),
    skill: profile.skill,
    draftGain: profile.draftGain,
    futureCapital: Math.max(0, profile.futureCapital + clampedMarketDelta * profile.futureCapital * 0.5),
  }

  const total = adjusted.win + adjusted.power + adjusted.luck + adjusted.market + adjusted.skill + adjusted.draftGain + adjusted.futureCapital
  const origTotal = profile.win + profile.power + profile.luck + profile.market + profile.skill + profile.draftGain + profile.futureCapital
  if (total > 0 && origTotal > 0) {
    const scale = origTotal / total
    adjusted.win *= scale
    adjusted.power *= scale
    adjusted.market *= scale
    adjusted.futureCapital *= scale
  }

  return adjusted
}

function computePowerScore(
  starterP: number,
  benchP: number,
  isDynasty: boolean,
  injuryImpact: RosterInjuryImpact,
  params?: LearnedCompositeParams | null,
): number {
  const sbSplit = params?.starterBenchSplit ?? (isDynasty ? 0.70 : 0.80)
  const rawWeighted = sbSplit * starterP + (1 - sbSplit) * benchP
  const injInfluence = params?.injuryInfluence ?? 0.30

  let starterPowerDrag = 0
  let starterTotalValue = 0
  let uncertaintyDrag = 0

  for (const p of injuryImpact.injuryProfiles) {
    if (!p.isStarter) continue
    starterTotalValue += p.playerValue

    const recencyWeight = p.recencyDecay
    const severityDrag = p.effectiveSeverity * recencyWeight
    const uncertaintyPenalty = p.uncertainty * p.effectiveSeverity * 0.12
    starterPowerDrag += p.playerValue * (severityDrag - uncertaintyPenalty)
    uncertaintyDrag += p.playerValue * p.uncertainty * p.effectiveSeverity * 0.08
  }

  const healthRatio = starterTotalValue > 0
    ? clamp01(1 - starterPowerDrag / starterTotalValue)
    : injuryImpact.powerHealthRatio

  const healthMultiplier = (1 - injInfluence) + injInfluence * healthRatio

  const uncertaintyVolatility = starterTotalValue > 0
    ? clamp01(uncertaintyDrag / starterTotalValue)
    : 0
  const riskPenalty = 1 - 0.05 * injuryImpact.riskConcentration - 0.03 * uncertaintyVolatility

  const adjusted = rawWeighted * healthMultiplier * riskPenalty
  return Math.round(100 * clamp01(adjusted))
}

const INJURY_STATUS_SEVERITY: Record<string, number> = {
  'Out': 0.90,
  'IR': 1.00,
  'Doubtful': 0.60,
  'Questionable': 0.25,
  'Probable': 0.05,
  'Suspension': 0.80,
  'PUP': 0.75,
  'NFI': 0.75,
  'COV': 0.70,
  'NA': 0.00,
  'Active': 0.00,
}

const INJURY_UNCERTAINTY: Record<string, number> = {
  'Out': 0.10,
  'IR': 0.05,
  'Doubtful': 0.30,
  'Questionable': 0.50,
  'Probable': 0.60,
  'Suspension': 0.10,
  'PUP': 0.35,
  'NFI': 0.35,
  'COV': 0.40,
  'NA': 0.00,
  'Active': 0.00,
}

function computeRecencyDecay(injuryDateMs: number | null, nowMs: number): number {
  if (!injuryDateMs) return 1.0
  const daysSince = (nowMs - injuryDateMs) / (24 * 60 * 60 * 1000)
  if (daysSince <= 3) return 1.0
  if (daysSince <= 7) return 0.95
  if (daysSince <= 14) return 0.80
  if (daysSince <= 28) return 0.55
  if (daysSince <= 56) return 0.30
  return 0.15
}

function computePlayerInjuryProfile(
  pid: string,
  isStarter: boolean,
  sleeperPlayers: Record<string, any> | null,
  analyticsMap: Map<string, any> | undefined,
  dbInjuryMap: Map<string, { severity: string | null; date: Date | null; type: string | null; description: string | null }> | undefined,
  valueMap: Map<string, PlayerValueMap>,
  nowMs: number,
): PlayerInjuryProfile {
  const pVal = valueMap.get(pid)
  const playerValue = pVal ? Math.max(pVal.value, pVal.redraftValue) : 1

  let baseSeverity = 0
  let uncertainty = 0
  let injuryDateMs: number | null = null

  if (sleeperPlayers && sleeperPlayers[pid]) {
    const sp = sleeperPlayers[pid]
    const status = sp.injury_status || sp.status || 'Active'
    baseSeverity = INJURY_STATUS_SEVERITY[status] ?? 0
    uncertainty = INJURY_UNCERTAINTY[status] ?? 0
  }

  const playerName = pVal?.name
  if (dbInjuryMap && playerName) {
    const dbInjury = dbInjuryMap.get(playerName.toLowerCase())
    if (dbInjury) {
      if (dbInjury.date) {
        injuryDateMs = dbInjury.date.getTime()
      }

      const dbStatus = dbInjury.severity || ''
      const dbSev = INJURY_STATUS_SEVERITY[dbStatus] ?? 0
      if (dbSev > baseSeverity) {
        baseSeverity = dbSev
        uncertainty = INJURY_UNCERTAINTY[dbStatus] ?? uncertainty
      }

      if (dbInjury.type) {
        const t = dbInjury.type.toLowerCase()
        if (t.includes('acl') || t.includes('achilles') || t.includes('torn')) {
          baseSeverity = Math.max(baseSeverity, 0.95)
          uncertainty = Math.min(uncertainty, 0.10)
        } else if (t.includes('concussion')) {
          uncertainty = Math.max(uncertainty, 0.55)
        } else if (t.includes('hamstring') || t.includes('groin') || t.includes('calf')) {
          uncertainty = Math.max(uncertainty, 0.40)
        }
      }
    }
  }

  if (analyticsMap && playerName) {
    const analytics = analyticsMap.get(playerName)
    if (analytics?.injurySeverityScore != null) {
      const analyticsSev = Math.min(1, analytics.injurySeverityScore / 10)
      if (analyticsSev > baseSeverity) {
        baseSeverity = analyticsSev
      }
    }
  }

  const recencyDecay = computeRecencyDecay(injuryDateMs, nowMs)

  const effectiveSeverity = baseSeverity * recencyDecay

  return {
    severity: baseSeverity,
    recencyDecay,
    uncertainty,
    effectiveSeverity,
    isStarter,
    playerValue: Math.max(1, playerValue),
  }
}

function computeRosterInjuryImpact(
  roster: SleeperRoster,
  sleeperPlayers: Record<string, any> | null,
  analyticsMap: Map<string, any> | undefined,
  dbInjuryMap: Map<string, { severity: string | null; date: Date | null; type: string | null; description: string | null }> | undefined,
  valueMap: Map<string, PlayerValueMap>,
): RosterInjuryImpact {
  const starters = new Set(roster.starters || [])
  const allPlayers = roster.players || []
  if (allPlayers.length === 0) return { powerHealthRatio: 0.5, marketDiscount: 0, riskConcentration: 0, uncertaintyVolatility: 0, injuryProfiles: [], byPlayerId: new Map() }

  const nowMs = Date.now()
  const profiles: PlayerInjuryProfile[] = []
  const byPlayerId = new Map<string, PlayerInjuryProfile>()

  for (const pid of allPlayers) {
    if (pid === '0') continue
    const isStarter = starters.has(pid)
    const profile = computePlayerInjuryProfile(pid, isStarter, sleeperPlayers, analyticsMap, dbInjuryMap, valueMap, nowMs)
    profiles.push(profile)
    byPlayerId.set(pid, profile)
  }

  let starterTotalWeight = 0
  let starterHealthyWeight = 0
  let totalMarketValue = 0
  let injuredMarketValue = 0
  let highValueInjuredCount = 0
  let uncertaintyWeightedSum = 0
  let injuredPlayerWeight = 0

  for (const p of profiles) {
    if (p.isStarter) {
      starterTotalWeight += p.playerValue
      const healthFactor = 1 - p.effectiveSeverity
      const uncertaintyBoost = p.uncertainty * 0.15 * p.effectiveSeverity
      starterHealthyWeight += p.playerValue * (healthFactor + uncertaintyBoost)
    }

    totalMarketValue += p.playerValue

    if (p.effectiveSeverity > 0.1) {
      const marketPenalty = p.effectiveSeverity * (1 - p.uncertainty * 0.3)
      injuredMarketValue += p.playerValue * marketPenalty
      uncertaintyWeightedSum += p.playerValue * p.uncertainty * p.effectiveSeverity
      injuredPlayerWeight += p.playerValue * p.effectiveSeverity
    }

    if (p.effectiveSeverity > 0.5 && p.playerValue > 50) {
      highValueInjuredCount++
    }
  }

  const powerHealthRatio = starterTotalWeight > 0
    ? clamp01(starterHealthyWeight / starterTotalWeight)
    : 0.5

  const marketDiscount = totalMarketValue > 0
    ? clamp01(injuredMarketValue / totalMarketValue)
    : 0

  const riskConcentration = Math.min(1, highValueInjuredCount / 3)

  const uncertaintyVolatility = injuredPlayerWeight > 0
    ? clamp01(uncertaintyWeightedSum / injuredPlayerWeight)
    : 0

  return { powerHealthRatio, marketDiscount, riskConcentration, uncertaintyVolatility, injuryProfiles: profiles, byPlayerId }
}

/**
 * Slice 15 (wrong-row joins): this query previously had NO `sport` filter while
 * matching on `playerName`, so a same-named athlete in another sport could
 * supply the injury. This rankings path is Sleeper-backed and NFL-only (see
 * `getLeagueRosters`/`getAllPlayers` above), so NFL is the honest default
 * rather than an assumption smuggled into an unscoped query.
 */
async function fetchDbInjuryMap(playerNames: string[], sport = 'NFL'): Promise<Map<string, { severity: string | null; date: Date | null; type: string | null; description: string | null }>> {
  const result = new Map<string, { severity: string | null; date: Date | null; type: string | null; description: string | null }>()
  if (playerNames.length === 0) return result

  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const injuries = await prisma.sportsInjury.findMany({
      where: {
        sport,
        playerName: { in: playerNames },
        fetchedAt: { gte: cutoff },
      },
      orderBy: { fetchedAt: 'desc' },
      distinct: ['playerName'],
      select: {
        playerName: true,
        status: true,
        date: true,
        type: true,
        description: true,
      },
    })

    for (const inj of injuries) {
      result.set(inj.playerName.toLowerCase(), {
        severity: inj.status,
        date: inj.date,
        type: inj.type,
        description: inj.description,
      })
    }
  } catch {}

  return result
}

function computeTeamDataQuality(
  roster: SleeperRoster,
  valueMap: Map<string, PlayerValueMap>,
  rosterInjuryImpact: RosterInjuryImpact,
  dbInjuryMap: Map<string, { severity: string | null; date: Date | null; type: string | null; description: string | null }> | undefined,
  analyticsMap: Map<string, any> | undefined,
  valuationCacheAgeMs: number | null,
  sleeperLastSyncMs: number | null,
  weeklyPts: number[],
): TeamDataQuality {
  const players = roster.players || []
  const nowMs = Date.now()
  const signals: string[] = []

  let playersWithValue = 0
  let playersWithInjuryData = 0
  let playersWithAnalytics = 0
  let latestInjuryDateMs = 0

  for (const pid of players) {
    if (pid === '0') continue
    if (valueMap.has(pid)) playersWithValue++
    const pVal = valueMap.get(pid)
    const playerName = (pVal as any)?.name || (pVal as any)?.player || ''
    if (playerName && dbInjuryMap?.has(playerName.toLowerCase())) {
      playersWithInjuryData++
      const injEntry = dbInjuryMap.get(playerName.toLowerCase())
      if (injEntry?.date) {
        const d = injEntry.date instanceof Date ? injEntry.date.getTime() : new Date(injEntry.date).getTime()
        if (d > latestInjuryDateMs) latestInjuryDateMs = d
      }
    }
    if (playerName && analyticsMap?.has(playerName)) {
      playersWithAnalytics++
    }
  }

  const totalPlayers = Math.max(1, players.filter(p => p !== '0').length)
  const valueCoverage = playersWithValue / totalPlayers
  const injuryCoverage = playersWithInjuryData / totalPlayers
  const analyticsCoverage = playersWithAnalytics / totalPlayers

  const injuryHours = latestInjuryDateMs > 0
    ? Math.round((nowMs - latestInjuryDateMs) / 3600_000 * 10) / 10
    : null
  const valuationHours = valuationCacheAgeMs !== null
    ? Math.round(valuationCacheAgeMs / 3600_000 * 10) / 10
    : 0
  const sleeperHours = sleeperLastSyncMs !== null
    ? Math.round((nowMs - sleeperLastSyncMs) / 3600_000 * 10) / 10
    : null

  let confidence = 50

  if (valueCoverage >= 0.90) confidence += 20
  else if (valueCoverage >= 0.70) confidence += 12
  else { confidence += 5; signals.push(`Low valuation coverage (${Math.round(valueCoverage * 100)}%)`) }

  if (weeklyPts.length >= 4) confidence += 15
  else if (weeklyPts.length >= 2) confidence += 8
  else { confidence += 2; signals.push('Limited game history') }

  if (injuryHours !== null && injuryHours <= 24) confidence += 5
  else if (injuryHours !== null && injuryHours <= 72) confidence += 3
  else signals.push(injuryHours === null ? 'No DB injury data' : 'Injury data may be stale')

  if (injuryCoverage >= 0.30) confidence += 3
  else if (injuryCoverage > 0) confidence += 1
  else signals.push('No injury DB records for this roster')

  if (analyticsCoverage >= 0.50) confidence += 5
  else signals.push('Limited player analytics')

  if (valuationHours <= 1) confidence += 2
  else if (valuationHours > 24) { confidence -= 3; signals.push('Valuation data >24h old') }

  if (sleeperHours !== null && sleeperHours <= 6) confidence += 2
  else if (sleeperHours !== null && sleeperHours > 24) signals.push('Sleeper data >24h old')
  else if (sleeperHours === null) signals.push('Sleeper sync age unknown')

  const injuredStarterCount = rosterInjuryImpact.injuryProfiles.filter(
    p => p.isStarter && p.effectiveSeverity > 0.3,
  ).length
  if (injuredStarterCount >= 3) {
    confidence -= 5
    signals.push(`${injuredStarterCount} injured starters add uncertainty`)
  }

  if (rosterInjuryImpact.uncertaintyVolatility > 0.4) {
    confidence -= 3
    signals.push('High injury uncertainty — multiple Questionable/Doubtful players')
  } else if (rosterInjuryImpact.uncertaintyVolatility > 0.2) {
    confidence -= 1
  }

  // Three of the composite's five inputs — winScore, luckScore and
  // managerSkillScore — are all derived from played games. With none played they
  // resolve to the same value for every team in the league, so they contribute
  // nothing to the ordering: the ranking is really just power score and market
  // value wearing a five-factor label.
  //
  // Confidence measured only source freshness (valuation coverage, injury age,
  // sync age) and never asked whether the inputs themselves carried information.
  // Measured on real leagues: a league with no games played reported 79/100
  // "HIGH — Good Confidence", against 80/100 for a completed season where all
  // five inputs varied. A one-point difference between "we know almost nothing
  // about how these teams play" and "we watched a full season".
  //
  // The cap is deliberately not a small penalty. Three constants out of five is
  // not a slightly-degraded ranking; it is a different, much weaker claim, and
  // the badge that reads off this number should say so.
  // Weeks actually SCORED, not array length. The array can carry a zero-filled
  // entry for a league that has not kicked off, so length alone reports history
  // that does not exist — a team with a real played week always scores something.
  const playedWeeks = weeklyPts.filter((pts) => pts > 0).length
  const informativeInputs = playedWeeks > 0 ? 5 : 2
  if (informativeInputs < 5) {
    confidence = Math.min(confidence, 55)
    signals.push(
      'No games played yet — win, luck and manager-skill scores are identical for every team, so this ranking reflects roster value only',
    )
  }

  confidence = Math.max(10, Math.min(100, confidence))

  let dataCoverage: 'FULL' | 'PARTIAL' | 'MINIMAL'
  if (playedWeeks === 0) {
    // Rich valuation data does not make coverage FULL when the performance half
    // of the model has nothing to read.
    dataCoverage = 'MINIMAL'
  } else if (valueCoverage >= 0.85 && weeklyPts.length >= 3 && injuryCoverage >= 0.10) {
    dataCoverage = 'FULL'
  } else if (valueCoverage >= 0.50 || weeklyPts.length >= 2) {
    dataCoverage = 'PARTIAL'
  } else {
    dataCoverage = 'MINIMAL'
    signals.push('Insufficient data for reliable ranking')
  }

  const confidenceRating: 'HIGH' | 'MEDIUM' | 'LOW' =
    confidence >= 75 ? 'HIGH' : confidence >= 50 ? 'MEDIUM' : 'LOW'

  return {
    rankingConfidence: confidence,
    confidenceRating,
    dataCoverage,
    stalenessHours: {
      injury: injuryHours,
      valuation: valuationHours,
      sleeperSync: sleeperHours ?? 0,
    },
    signals,
  }
}

function computeDraftGainPercentile(
  rosterId: number,
  drafts: any[],
  valueMap: Map<string, PlayerValueMap>,
  isDynasty: boolean,
  allRosterIds: number[],
): number {
  if (!drafts || drafts.length === 0) return 50

  const latestDraft = drafts[0]
  if (!latestDraft?.draft_id) return 50

  const picks = latestDraft.picks || latestDraft.draft_order || null
  if (!picks || !Array.isArray(picks)) return 50

  const pickValues: { rosterId: number; currentValue: number; slotIndex: number }[] = []
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i]
    const pickRosterId = pick.roster_id ?? pick.picked_by
    const playerId = pick.player_id
    if (!pickRosterId || !playerId) continue

    const pVal = valueMap.get(playerId)
    const currentValue = pVal ? (isDynasty ? pVal.value : pVal.redraftValue) : 0
    pickValues.push({ rosterId: pickRosterId, currentValue, slotIndex: i })
  }

  if (pickValues.length === 0) return 50

  const allCurrentValues = pickValues.map(p => p.currentValue)
  const totalPicks = pickValues.length

  const gainByRoster = new Map<number, number>()
  for (const pv of pickValues) {
    const expectedPercentile = 1 - pv.slotIndex / Math.max(1, totalPicks - 1)
    const actualPercentile = robustPercentileRank(pv.currentValue, allCurrentValues)
    const delta = actualPercentile - expectedPercentile

    const prev = gainByRoster.get(pv.rosterId) || 0
    gainByRoster.set(pv.rosterId, prev + delta)
  }

  if (gainByRoster.size === 0) return 50

  const allGains = allRosterIds.map(rid => gainByRoster.get(rid) ?? 0)
  const myGain = gainByRoster.get(rosterId) ?? 0
  return Math.round(robustPercentileRank(myGain, allGains) * 100)
}

function computeLuckScore(luckDelta: number, allLuckDeltas: number[]): number {
  const luckP = robustPercentileRank(luckDelta, allLuckDeltas)
  return Math.round(100 * luckP)
}

function computeMarketValueScore(
  ageAdjustedTotal: number,
  allAgeAdjustedTotals: number[],
): number {
  const mvsRaw = robustPercentileRank(ageAdjustedTotal, allAgeAdjustedTotals)
  return Math.round(100 * mvsRaw)
}

function computeManagerSkillScore(
  tradeAvgPremium: number,
  allTradeAvgPremiums: number[],
  processConsistency: number,
  allProcessConsistencies: number[],
  isDynasty: boolean,
): number {
  const tradeP = robustPercentileRank(tradeAvgPremium, allTradeAvgPremiums)
  const waiverP = 0.5
  const draftP = 0.5
  const processP = robustPercentileRank(processConsistency, allProcessConsistencies)

  const mssRaw = isDynasty
    ? 0.35 * tradeP + 0.20 * waiverP + 0.25 * draftP + 0.20 * processP
    : 0.25 * tradeP + 0.35 * waiverP + 0.10 * draftP + 0.30 * processP

  return Math.round(100 * clamp01(mssRaw))
}

function computeFutureCapitalScore(teamRoster: any[]): number {
  let total = 0

  for (const player of teamRoster) {
    if (player.league === 'NCAA' && player.devyEligible) {
      const projection = player.draftProjectionScore ?? 50
      total += projection * 0.6
    }

    if (player.projectedDraftRound === 1) total += 20
    if (player.projectedDraftRound === 2) total += 12
  }

  return Math.min(100, Math.round(total / 5))
}

function ageCurveAdjustment(age: number, position: string): number {
  if (position === 'RB') {
    if (age <= 23) return 1.05
    if (age <= 25) return 1.0
    if (age <= 27) return 0.9
    return 0.75
  }

  if (position === 'WR') {
    if (age <= 24) return 1.05
    if (age <= 27) return 1.0
    if (age <= 30) return 0.95
    return 0.85
  }

  return 1.0
}

function devyGraduationProbability(player: any): number {
  if (!player.projectedDraftRound) return 0.3
  if (player.projectedDraftRound === 1) return 0.9
  if (player.projectedDraftRound === 2) return 0.75
  if (player.projectedDraftRound === 3) return 0.6
  return 0.4
}

function projectPortfolioRaw(teamRoster: any[], analyticsMap?: Map<string, any>): { currentValue: number; year3Value: number; year5Value: number; volatilitySum: number; playerCount: number } {
  let currentValue = 0
  let year3Value = 0
  let year5Value = 0
  let volatilitySum = 0
  let playerCount = 0

  for (const player of teamRoster) {
    const isDevy = player.devyEligible === true && player.league === 'NCAA'
    const pos = player.position || player.pos || 'WR'

    if (isDevy) {
      const gradProb = devyGraduationProbability(player)
      const projVal = (player.draftProjectionScore ?? 50) * gradProb
      currentValue += projVal * 0.3
      year3Value += projVal * 0.8
      year5Value += projVal * 1.0
      volatilitySum += (1 - gradProb) * 25
      playerCount++
    } else {
      const marketVal = player.marketValueScore ?? player.value ?? 0
      if (marketVal <= 0) continue
      const age = player.age ?? 24
      const curve1 = ageCurveAdjustment(age, pos)
      let curve3 = ageCurveAdjustment(age + 3, pos)
      let curve5 = ageCurveAdjustment(age + 5, pos)

      const analytics = analyticsMap?.get(player.name || player.player || '')

      if (analytics?.college?.breakoutAge != null && analytics.college.breakoutAge <= 20.5) {
        curve3 *= 1.05
        curve5 *= 1.05
      }
      if (analytics?.combine?.athleticismScore != null && analytics.combine.athleticismScore >= 100) {
        curve3 *= 1.03
        curve5 *= 1.03
      }

      currentValue += marketVal * curve1
      year3Value += marketVal * curve3
      year5Value += marketVal * curve5
      const baseVol = Math.abs(curve1 - curve5) * marketVal * 0.3
      const analyticsVol = analytics?.weeklyVolatility != null ? analytics.weeklyVolatility * marketVal * 0.005 : null
      volatilitySum += (analyticsVol ?? baseVol)
      playerCount++
    }
  }

  return { currentValue, year3Value, year5Value, volatilitySum, playerCount }
}

function projectPortfolioFromPercentiles(
  raw: { currentValue: number; year3Value: number; year5Value: number; volatilitySum: number; playerCount: number },
  allCurrentValues: number[],
  allYear3Values: number[],
  allYear5Values: number[],
): PortfolioProjection {
  if (raw.playerCount === 0) {
    return { year1: 50, year3: 45, year5: 40, volatilityBand: 15 }
  }

  const y1Pct = robustPercentileRank(raw.currentValue, allCurrentValues)
  const y3Pct = robustPercentileRank(raw.year3Value, allYear3Values)
  const y5Pct = robustPercentileRank(raw.year5Value, allYear5Values)

  const y1 = clamp(Math.round(20 + y1Pct * 75), 10, 98)
  const y3 = clamp(Math.round(15 + y3Pct * 80), 5, 98)
  const y5 = clamp(Math.round(10 + y5Pct * 85), 5, 98)

  const totalVal = raw.currentValue || 1
  const avgVol = Math.round((raw.volatilitySum / totalVal) * 40)

  return {
    year1: y1,
    year3: y3,
    year5: y5,
    volatilityBand: clamp(avgVol, 1, 30),
  }
}

function computeComposite(
  ws: number,
  ps: number,
  ls: number,
  mvs: number,
  mss: number,
  draftGainP: number,
  phase: string,
  isDynasty: boolean,
  futureCapitalScore: number = 0,
): number {
  const w = ws / 100
  const p = ps / 100
  const l = ls / 100
  const m = mvs / 100
  const s = mss / 100
  const dg = draftGainP / 100
  const fc = futureCapitalScore / 100

  if (phase === 'offseason') {
    if (isDynasty) {
      return Math.round(100 * clamp01(0.45 * m + 0.25 * p + 0.10 * s + 0.10 * fc + 0.10 * (1 - l)))
    }
    return Math.round(100 * clamp01(0.50 * p + 0.20 * s + 0.20 * m + 0.10 * w))
  }

  if (phase === 'post_draft') {
    if (isDynasty) {
      return Math.round(100 * clamp01(0.35 * m + 0.25 * p + 0.15 * dg + 0.15 * s + 0.10 * fc))
    }
    return Math.round(100 * clamp01(0.55 * p + 0.20 * dg + 0.15 * s + 0.10 * m))
  }

  if (phase === 'post_season') {
    if (isDynasty) {
      return Math.round(100 * clamp01(0.50 * w + 0.20 * p + 0.10 * s + 0.10 * m + 0.10 * fc))
    }
    return Math.round(100 * clamp01(0.55 * w + 0.20 * p + 0.10 * s + 0.15 * m))
  }

  if (isDynasty) {
    const luckTerm = 1 - Math.abs(l - 0.5) * 2
    return Math.round(100 * clamp01(0.20 * w + 0.30 * p + 0.08 * luckTerm + 0.17 * m + 0.15 * s + 0.10 * fc))
  }

  const luckTerm = 1 - Math.abs(l - 0.5) * 2
  return Math.round(100 * clamp01(0.45 * p + 0.30 * w + 0.15 * luckTerm + 0.10 * s))
}

const DRIVER_ALLOWLIST = new Set([
  'record_surge', 'record_slide',
  'points_for_spike', 'points_for_dip',
  'points_against_luck',
  'power_strength_gain', 'power_strength_drop',
  'depth_safety_gain', 'depth_safety_drop',
  'luck_positive', 'luck_negative',
  'market_value_gain', 'market_value_drop',
  'league_demand_tailwind', 'league_demand_headwind',
  'trade_edge_positive', 'trade_edge_negative',
  'waiver_roi_positive', 'waiver_roi_negative',
])

interface DriverContext {
  winScore: number
  powerScore: number
  luckScore: number
  marketValueScore: number
  managerSkillScore: number
  composite: number
  record: { wins: number; losses: number; ties: number }
  pointsFor: number
  pointsAgainst: number
  expectedWins: number
  streak: number
  starterValue: number
  benchValue: number
  totalRosterValue: number
  positionValues: Record<string, { starter: number; bench: number; total: number }>
  weeklyPts: number[]
  weeklyOppPts: number[]
  tradeEff: { tradeCount: number; avgPremium: number }
  allTeamCount: number
  starterPercentile: number
  benchPercentile: number
  marketPercentile: number
  ldiData: Record<string, { ldi: number }> | null
  isDynasty: boolean
}

function generateDrivers(ctx: DriverContext): Driver[] {
  const drivers: Driver[] = []
  const totalGames = ctx.record.wins + ctx.record.losses + ctx.record.ties
  const winPct = totalGames > 0 ? ctx.record.wins / totalGames : 0.5

  const recentPts = ctx.weeklyPts.slice(-4)
  const avgPtsAll = ctx.weeklyPts.length > 0 ? ctx.weeklyPts.reduce((s, v) => s + v, 0) / ctx.weeklyPts.length : 0
  const avgPtsRecent = recentPts.length > 0 ? recentPts.reduce((s, v) => s + v, 0) / recentPts.length : 0
  const recentOppPts = ctx.weeklyOppPts.slice(-4)
  const avgOppPtsRecent = recentOppPts.length > 0 ? recentOppPts.reduce((s, v) => s + v, 0) / recentOppPts.length : 0

  if (ctx.winScore >= 65 && ctx.streak >= 2) {
    drivers.push({
      id: 'record_surge',
      polarity: 'UP',
      impact: clamp01((ctx.winScore - 50) / 50),
      evidence: { wins: ctx.record.wins, losses: ctx.record.losses, streak: ctx.streak, winPctDelta: Math.round((winPct - 0.5) * 100) / 100 },
    })
  } else if (ctx.winScore <= 35 && ctx.streak <= -2) {
    drivers.push({
      id: 'record_slide',
      polarity: 'DOWN',
      impact: clamp01((50 - ctx.winScore) / 50),
      evidence: { wins: ctx.record.wins, losses: ctx.record.losses, streak: ctx.streak, winPctDelta: Math.round((winPct - 0.5) * 100) / 100 },
    })
  }

  if (recentPts.length >= 2 && avgPtsRecent > avgPtsAll * 1.10) {
    drivers.push({
      id: 'points_for_spike',
      polarity: 'UP',
      impact: clamp01((avgPtsRecent - avgPtsAll) / Math.max(1, avgPtsAll)),
      evidence: { pointsForWeek: Math.round(avgPtsRecent * 10) / 10, pointsForAvg: Math.round(avgPtsAll * 10) / 10, leagueRank: 0 },
    })
  } else if (recentPts.length >= 2 && avgPtsRecent < avgPtsAll * 0.90) {
    drivers.push({
      id: 'points_for_dip',
      polarity: 'DOWN',
      impact: clamp01((avgPtsAll - avgPtsRecent) / Math.max(1, avgPtsAll)),
      evidence: { pointsForWeek: Math.round(avgPtsRecent * 10) / 10, pointsForAvg: Math.round(avgPtsAll * 10) / 10, leagueRank: 0 },
    })
  }

  if (recentOppPts.length >= 2 && avgOppPtsRecent > avgPtsAll * 1.08) {
    drivers.push({
      id: 'points_against_luck',
      polarity: 'DOWN',
      impact: clamp01((avgOppPtsRecent - avgPtsAll) / Math.max(1, avgPtsAll) * 0.8),
      evidence: { pointsAgainstWeek: Math.round(avgOppPtsRecent * 10) / 10, leagueAvgPA: Math.round(avgPtsAll * 10) / 10, paPercentile: 0 },
    })
  } else if (recentOppPts.length >= 2 && avgOppPtsRecent < avgPtsAll * 0.92) {
    drivers.push({
      id: 'points_against_luck',
      polarity: 'UP',
      impact: clamp01((avgPtsAll - avgOppPtsRecent) / Math.max(1, avgPtsAll) * 0.5),
      evidence: { pointsAgainstWeek: Math.round(avgOppPtsRecent * 10) / 10, leagueAvgPA: Math.round(avgPtsAll * 10) / 10, paPercentile: 0 },
    })
  }

  if (ctx.starterPercentile >= 0.70) {
    drivers.push({
      id: 'power_strength_gain',
      polarity: 'UP',
      impact: clamp01(ctx.starterPercentile - 0.5),
      evidence: { starterPPG: 0, starterPPGDelta: 0, psPercentile: Math.round(ctx.starterPercentile * 100) },
    })
  } else if (ctx.starterPercentile <= 0.30) {
    drivers.push({
      id: 'power_strength_drop',
      polarity: 'DOWN',
      impact: clamp01(0.5 - ctx.starterPercentile),
      evidence: { starterPPG: 0, starterPPGDelta: 0, psPercentile: Math.round(ctx.starterPercentile * 100) },
    })
  }

  if (ctx.benchPercentile >= 0.70) {
    drivers.push({
      id: 'depth_safety_gain',
      polarity: 'UP',
      impact: clamp01((ctx.benchPercentile - 0.5) * 0.6),
      evidence: { benchValue: ctx.benchValue, benchRank: Math.round((1 - ctx.benchPercentile) * ctx.allTeamCount) + 1 },
    })
  } else if (ctx.benchPercentile <= 0.25) {
    drivers.push({
      id: 'depth_safety_drop',
      polarity: 'DOWN',
      impact: clamp01((0.5 - ctx.benchPercentile) * 0.6),
      evidence: { benchValue: ctx.benchValue, benchRank: Math.round((1 - ctx.benchPercentile) * ctx.allTeamCount) + 1 },
    })
  }

  const luckDelta = ctx.record.wins - ctx.expectedWins
  const last3Pts = ctx.weeklyPts.slice(-3)
  const last3Opp = ctx.weeklyOppPts.slice(-3)
  let last3Delta = 0
  for (let i = 0; i < last3Pts.length; i++) {
    if (last3Pts[i] > (last3Opp[i] || 0)) last3Delta += 1
    else last3Delta -= 1
  }

  if (ctx.luckScore >= 70) {
    drivers.push({
      id: 'luck_positive',
      polarity: 'UP',
      impact: clamp01((ctx.luckScore - 50) / 60),
      evidence: { expectedWins: Math.round(ctx.expectedWins * 10) / 10, actualWins: ctx.record.wins, delta: Math.round(luckDelta * 10) / 10, last3Delta },
    })
  } else if (ctx.luckScore <= 30) {
    drivers.push({
      id: 'luck_negative',
      polarity: 'DOWN',
      impact: clamp01((50 - ctx.luckScore) / 60),
      evidence: { expectedWins: Math.round(ctx.expectedWins * 10) / 10, actualWins: ctx.record.wins, delta: Math.round(luckDelta * 10) / 10, last3Delta },
    })
  }

  if (ctx.marketPercentile >= 0.70) {
    drivers.push({
      id: 'market_value_gain',
      polarity: 'UP',
      impact: clamp01(ctx.marketPercentile - 0.5),
      evidence: { mvsTotal: ctx.totalRosterValue, mvsDelta: 0, marketPercentile: Math.round(ctx.marketPercentile * 100) },
    })
  } else if (ctx.marketPercentile <= 0.30) {
    drivers.push({
      id: 'market_value_drop',
      polarity: 'DOWN',
      impact: clamp01(0.5 - ctx.marketPercentile),
      evidence: { mvsTotal: ctx.totalRosterValue, mvsDelta: 0, marketPercentile: Math.round(ctx.marketPercentile * 100) },
    })
  }

  if (ctx.ldiData && ctx.isDynasty) {
    const positions = ['QB', 'RB', 'WR', 'TE']
    let tailwindCount = 0
    let headwindCount = 0
    const ldiEvidence: Record<string, number> = {}
    const exposureEvidence: Record<string, number> = {}

    for (const pos of positions) {
      const ldi = ctx.ldiData[pos]?.ldi ?? 50
      ldiEvidence[`ldi${pos}`] = Math.round(ldi)
      const posVal = ctx.positionValues[pos]?.total ?? 0
      const totalVal = ctx.totalRosterValue || 1
      exposureEvidence[pos] = Math.round((posVal / totalVal) * 100)

      if (ldi >= 65 && posVal / totalVal >= 0.15) tailwindCount++
      else if (ldi <= 35 && posVal / totalVal >= 0.15) headwindCount++
    }

    if (tailwindCount >= 2) {
      drivers.push({
        id: 'league_demand_tailwind',
        polarity: 'UP',
        impact: clamp01(tailwindCount * 0.15),
        evidence: { ...ldiEvidence, rosterExposureByPos: exposureEvidence },
      })
    } else if (headwindCount >= 2) {
      drivers.push({
        id: 'league_demand_headwind',
        polarity: 'DOWN',
        impact: clamp01(headwindCount * 0.15),
        evidence: { ...ldiEvidence, rosterExposureByPos: exposureEvidence },
      })
    }
  }

  if (ctx.tradeEff.tradeCount >= 2 && ctx.tradeEff.avgPremium > 0.05) {
    drivers.push({
      id: 'trade_edge_positive',
      polarity: 'UP',
      impact: clamp01(ctx.tradeEff.avgPremium),
      evidence: { avgTradePremiumPct: Math.round(ctx.tradeEff.avgPremium * 100), sampleTrades: ctx.tradeEff.tradeCount },
    })
  } else if (ctx.tradeEff.tradeCount >= 2 && ctx.tradeEff.avgPremium < -0.05) {
    drivers.push({
      id: 'trade_edge_negative',
      polarity: 'DOWN',
      impact: clamp01(Math.abs(ctx.tradeEff.avgPremium)),
      evidence: { avgTradePremiumPct: Math.round(ctx.tradeEff.avgPremium * 100), sampleTrades: ctx.tradeEff.tradeCount },
    })
  }

  drivers.sort((a, b) => b.impact - a.impact)
  return drivers.slice(0, 6)
}

function computeConfidence(ctx: {
  hasAllScores: boolean
  weeklyPtsLength: number
  ldiData: Record<string, { ldi: number }> | null
  ldiSample: number
  hasRosterSimulation: boolean
  allTeamCount: number
}): { score: number; rating: 'HIGH' | 'MEDIUM' | 'LEARNING' } {
  let score = 50

  if (ctx.hasAllScores) score += 20
  if (ctx.weeklyPtsLength >= 4) score += 10
  if (ctx.ldiData && ctx.ldiSample >= 30) score += 10
  if (ctx.hasRosterSimulation) score += 10

  if (ctx.weeklyPtsLength === 0) score -= 25
  if (!ctx.hasRosterSimulation) score -= 15
  if (ctx.allTeamCount === 0) score -= 10

  score = clamp(score, 0, 100)

  const rating: 'HIGH' | 'MEDIUM' | 'LEARNING' =
    score >= 75 ? 'HIGH' : score >= 55 ? 'MEDIUM' : 'LEARNING'

  return { score, rating }
}

function generateNextActions(ctx: DriverContext, drivers: Driver[], leagueId: string): Action[] {
  const actions: Action[] = []

  const hasLuckNeg = drivers.some(d => d.id === 'luck_negative')
  const hasPowerDrop = drivers.some(d => d.id === 'power_strength_drop')
  const hasDepthDrop = drivers.some(d => d.id === 'depth_safety_drop')
  const hasTradeEdgePos = drivers.some(d => d.id === 'trade_edge_positive')
  const hasRecordSlide = drivers.some(d => d.id === 'record_slide')
  const hasMvDrop = drivers.some(d => d.id === 'market_value_drop')

  if (hasPowerDrop || hasRecordSlide) {
    actions.push({
      id: 'find_trade_upgrades',
      title: 'Find trade upgrades',
      why: 'Your starter strength is below league average — a targeted trade could raise your Power Score.',
      expectedImpact: 'HIGH',
      cta: { label: 'Open Trade Hub', href: `/league/${leagueId}/trade-hub` },
    })
  }

  if (hasDepthDrop) {
    actions.push({
      id: 'waiver_targets',
      title: 'Check waiver wire',
      why: 'Your bench depth ranks near the bottom — adding a waiver target reduces injury risk.',
      expectedImpact: 'MEDIUM',
      cta: { label: 'Waiver Targets', href: `/league/${leagueId}/waivers` },
    })
  }

  if (hasLuckNeg) {
    actions.push({
      id: 'stay_the_course',
      title: "Don't sell low — target a starter upgrade",
      why: 'Your scoring output is better than your record. Scheduling variance is the culprit, not your roster.',
      expectedImpact: 'MEDIUM',
      cta: { label: 'Trade Finder', href: `/league/${leagueId}/trade-finder` },
    })
  }

  if (hasMvDrop && ctx.isDynasty) {
    actions.push({
      id: 'sell_depreciating',
      title: 'Sell depreciating assets',
      why: 'Your roster market value is declining — selling aging players locks in value before further drops.',
      expectedImpact: 'HIGH',
      cta: { label: 'Trade Finder', href: `/league/${leagueId}/trade-finder` },
    })
  }

  if (hasTradeEdgePos && actions.length < 2) {
    actions.push({
      id: 'leverage_trade_edge',
      title: 'Leverage your trade edge',
      why: 'You consistently win trades — use this skill to target a high-value upgrade.',
      expectedImpact: 'MEDIUM',
      cta: { label: 'Trade Proposals', href: `/league/${leagueId}/trade-hub` },
    })
  }

  if (actions.length === 0) {
    actions.push({
      id: 'review_rankings',
      title: 'Review your rankings',
      why: 'Your team is performing as expected — monitor weekly changes for emerging opportunities.',
      expectedImpact: 'LOW',
      cta: { label: 'View Rankings', href: `/league/${leagueId}/rankings` },
    })
  }

  return actions.slice(0, 3)
}

function validateDrivers(drivers: Driver[]): boolean {
  for (const d of drivers) {
    if (!DRIVER_ALLOWLIST.has(d.id)) return false
    if (typeof d.impact !== 'number' || d.impact < 0 || d.impact > 1) return false
    if (!d.evidence || typeof d.evidence !== 'object' || Object.keys(d.evidence).length === 0) return false
  }
  return true
}

const DRIVER_LABELS: Record<string, string> = {
  record_surge: 'Win streak',
  record_slide: 'Losing streak',
  points_for_spike: 'Scoring surge',
  points_for_dip: 'Scoring drop',
  points_against_luck: 'Schedule luck',
  power_strength_gain: 'Roster strength up',
  power_strength_drop: 'Roster strength down',
  depth_safety_gain: 'Bench depth up',
  depth_safety_drop: 'Bench depth thin',
  luck_positive: 'Overperforming record',
  luck_negative: 'Underperforming record',
  market_value_gain: 'Rising market value',
  market_value_drop: 'Falling market value',
  league_demand_tailwind: 'League demand tailwind',
  league_demand_headwind: 'League demand headwind',
  trade_edge_positive: 'Trade savvy',
  trade_edge_negative: 'Trade losses',
  waiver_roi_positive: 'Waiver success',
  waiver_roi_negative: 'Waiver misses',
}

function buildRankChangeDrivers(
  drivers: Driver[],
  prevMetrics: SnapshotMetrics | null,
  currentMetrics: SnapshotMetrics | null,
): RankChangeDriver[] {
  const result: RankChangeDriver[] = []

  for (const d of drivers.slice(0, 3)) {
    const label = DRIVER_LABELS[d.id] ?? d.id
    let value = d.impact
    let prevValue: number | null = null
    let delta: number | null = null
    let unit = 'score'

    if (d.id === 'record_surge' || d.id === 'record_slide') {
      value = d.evidence?.streak ?? d.impact
      unit = 'game streak'
    } else if (d.id === 'points_for_spike' || d.id === 'points_for_dip') {
      value = d.evidence?.pointsForWeek ?? d.impact
      prevValue = d.evidence?.pointsForAvg ?? null
      delta = prevValue != null ? Math.round((value - prevValue) * 10) / 10 : null
      unit = 'ppg'
    } else if (d.id === 'power_strength_gain' || d.id === 'power_strength_drop') {
      value = currentMetrics ? Math.round(currentMetrics.starterValuePercentile * 100) : (d.evidence?.psPercentile ?? Math.round(d.impact * 100))
      if (prevMetrics) {
        prevValue = Math.round(prevMetrics.starterValuePercentile * 100)
        delta = value - prevValue
      }
      unit = 'percentile'
    } else if (d.id === 'luck_positive' || d.id === 'luck_negative') {
      value = currentMetrics ? Math.round(currentMetrics.expectedWins * 10) / 10 : (d.evidence?.delta ?? d.impact)
      if (prevMetrics) {
        prevValue = Math.round(prevMetrics.expectedWins * 10) / 10
        delta = Math.round((value - prevValue) * 10) / 10
      }
      unit = 'expected wins'
    } else if (d.id === 'market_value_gain' || d.id === 'market_value_drop') {
      value = d.evidence?.marketPercentile ?? Math.round(d.impact * 100)
      unit = 'percentile'
    } else if (d.id === 'trade_edge_positive' || d.id === 'trade_edge_negative') {
      value = currentMetrics ? Math.round(currentMetrics.tradeEffPremium * 100) : (d.evidence?.avgTradePremiumPct ?? Math.round(d.impact * 100))
      if (prevMetrics) {
        prevValue = Math.round(prevMetrics.tradeEffPremium * 100)
        delta = value - prevValue
      }
      unit = '% premium'
    } else if (d.id === 'depth_safety_gain' || d.id === 'depth_safety_drop') {
      value = d.evidence?.benchRank ?? Math.round(d.impact * 100)
      unit = 'bench rank'
    } else {
      value = Math.round(d.impact * 100)
      unit = 'impact %'
    }

    result.push({ id: d.id, label, polarity: d.polarity, value, prevValue, delta, unit })
  }

  return result
}

function computeAllForwardOdds(
  allTeams: { rosterId: number; weeklyPts: number[]; record: { wins: number; losses: number; ties: number } }[],
  leagueSize: number,
): Map<number, ForwardOdds> {
  const result = new Map<number, ForwardOdds>()
  const SIM_COUNT = 1000
  const defaultOdds: ForwardOdds = { playoffPct: 0, top3Pct: 0, titlePct: 0, simCount: 0 }

  if (allTeams.length < 2) {
    for (const t of allTeams) result.set(t.rosterId, defaultOdds)
    return result
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
  const sd = (arr: number[]) => {
    if (arr.length < 2) return 15
    const m = avg(arr)
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length) || 10
  }

  const projections: { rosterId: number; proj: TeamProjection; currentWins: number }[] = allTeams.map(t => ({
    rosterId: t.rosterId,
    proj: { mean: avg(t.weeklyPts), stdDev: sd(t.weeklyPts) },
    currentWins: t.record.wins,
  }))

  const gamesPlayed = allTeams[0] ? allTeams[0].record.wins + allTeams[0].record.losses + allTeams[0].record.ties : 0
  const remainingWeeks = Math.max(1, 14 - gamesPlayed)
  const playoffSpots = Math.max(2, Math.floor(leagueSize / 2))

  const teamCount = projections.length
  const playoffCounts = new Array(teamCount).fill(0)
  const top3Counts = new Array(teamCount).fill(0)
  const titleCounts = new Array(teamCount).fill(0)

  for (let sim = 0; sim < SIM_COUNT; sim++) {
    const simWins = projections.map(p => p.currentWins)

    for (let w = 0; w < remainingWeeks; w++) {
      for (let i = 0; i < teamCount; i++) {
        const oppIdx = (i + 1 + w) % teamCount
        const scoreA = projections[i].proj.mean + (Math.random() - 0.5) * projections[i].proj.stdDev * 2
        const scoreB = projections[oppIdx].proj.mean + (Math.random() - 0.5) * projections[oppIdx].proj.stdDev * 2
        if (scoreA > scoreB) simWins[i]++
      }
    }

    const ranked = simWins
      .map((w, idx) => ({ idx, wins: w }))
      .sort((a, b) => b.wins - a.wins)

    for (let r = 0; r < ranked.length; r++) {
      if (r < playoffSpots) playoffCounts[ranked[r].idx]++
      if (r < 3) top3Counts[ranked[r].idx]++
    }

    const playoffTeams = ranked.slice(0, playoffSpots).map(r => r.idx)
    if (playoffTeams.length >= 2) {
      let bracket = [...playoffTeams]
      while (bracket.length > 1) {
        const next: number[] = []
        for (let i = 0; i < bracket.length; i += 2) {
          if (i + 1 >= bracket.length) { next.push(bracket[i]); continue }
          const a = projections[bracket[i]].proj
          const b = projections[bracket[i + 1]].proj
          const sA = a.mean + (Math.random() - 0.5) * a.stdDev * 2
          const sB = b.mean + (Math.random() - 0.5) * b.stdDev * 2
          next.push(sA >= sB ? bracket[i] : bracket[i + 1])
        }
        bracket = next
      }
      titleCounts[bracket[0]]++
    }
  }

  for (let i = 0; i < teamCount; i++) {
    result.set(projections[i].rosterId, {
      playoffPct: Math.round((playoffCounts[i] / SIM_COUNT) * 1000) / 10,
      top3Pct: Math.round((top3Counts[i] / SIM_COUNT) * 1000) / 10,
      titlePct: Math.round((titleCounts[i] / SIM_COUNT) * 1000) / 10,
      simCount: SIM_COUNT,
    })
  }

  return result
}

function buildConfidenceBadge(dq: TeamDataQuality): ConfidenceBadge {
  if (dq.confidenceRating === 'HIGH' && dq.dataCoverage === 'FULL') {
    return { tier: 'GOLD', label: 'High Confidence', tooltip: `Ranking confidence ${dq.rankingConfidence}/100 — all data sources are fresh and complete.` }
  }
  if (dq.confidenceRating === 'HIGH' || (dq.confidenceRating === 'MEDIUM' && dq.dataCoverage !== 'MINIMAL')) {
    return { tier: 'SILVER', label: 'Good Confidence', tooltip: `Ranking confidence ${dq.rankingConfidence}/100 — most data sources available but some may be aging.` }
  }
  return { tier: 'BRONZE', label: 'Limited Data', tooltip: `Ranking confidence ${dq.rankingConfidence}/100 — key data sources may be missing or stale. Rankings may shift as data improves.` }
}

function computeModelConfidence(teams: TeamScore[]): {
  score: number
  rating: 'HIGH' | 'MEDIUM' | 'LOW'
  teamsCovered: number
  teamsTotal: number
  avgDataCoverage: number
} {
  if (teams.length === 0) return { score: 0, rating: 'LOW', teamsCovered: 0, teamsTotal: 0, avgDataCoverage: 0 }

  const validTeams = teams.filter(t => t.dataQuality)
  if (validTeams.length === 0) return { score: 0, rating: 'LOW', teamsCovered: 0, teamsTotal: teams.length, avgDataCoverage: 0 }

  const coverageScores = validTeams.map(t => {
    if (t.dataQuality.dataCoverage === 'FULL') return 100
    if (t.dataQuality.dataCoverage === 'PARTIAL') return 60
    return 25
  })
  const avgCoverage = Math.round(coverageScores.reduce((s, v) => s + v, 0) / validTeams.length)
  const confScores = validTeams.map(t => t.dataQuality.rankingConfidence)
  const avgConf = Math.round(confScores.reduce((s, v) => s + v, 0) / validTeams.length)
  const covered = validTeams.filter(t => t.dataQuality.dataCoverage !== 'MINIMAL').length

  const rating: 'HIGH' | 'MEDIUM' | 'LOW' = avgConf >= 70 ? 'HIGH' : avgConf >= 50 ? 'MEDIUM' : 'LOW'

  return { score: avgConf, rating, teamsCovered: covered, teamsTotal: teams.length, avgDataCoverage: avgCoverage }
}

function computeDataFreshness(teams: TeamScore[]): {
  overall: 'fresh' | 'aging' | 'stale'
  avgStalenessHours: number
  staleSourceCount: number
} {
  if (teams.length === 0) return { overall: 'stale', avgStalenessHours: 0, staleSourceCount: 0 }

  let totalHours = 0
  let staleCount = 0
  let sourceCount = 0

  for (const t of teams) {
    if (t.dataQuality?.stalenessHours) {
      for (const [, hours] of Object.entries(t.dataQuality.stalenessHours)) {
        if (typeof hours === 'number') {
          totalHours += hours
          sourceCount++
          if (hours > 48) staleCount++
        }
      }
    }
  }

  if (sourceCount === 0) return { overall: 'stale', avgStalenessHours: 0, staleSourceCount: 0 }
  const avgHours = Math.round((totalHours / sourceCount) * 10) / 10
  const overall: 'fresh' | 'aging' | 'stale' = avgHours <= 12 ? 'fresh' : avgHours <= 48 ? 'aging' : 'stale'

  return { overall, avgStalenessHours: avgHours, staleSourceCount: staleCount }
}

function buildRankExplanation(
  ctx: DriverContext,
  leagueId: string,
  ldiSample: number,
): RankExplanation {
  const drivers = generateDrivers(ctx)
  const hasAllScores = ctx.winScore > 0 || ctx.powerScore > 0 || ctx.luckScore > 0 || ctx.marketValueScore > 0 || ctx.managerSkillScore > 0
  const conf = computeConfidence({
    hasAllScores: hasAllScores && ctx.winScore >= 0 && ctx.powerScore >= 0 && ctx.luckScore >= 0 && ctx.marketValueScore >= 0 && ctx.managerSkillScore >= 0,
    weeklyPtsLength: ctx.weeklyPts.length,
    ldiData: ctx.ldiData,
    ldiSample,
    hasRosterSimulation: ctx.starterValue > 0,
    allTeamCount: ctx.allTeamCount,
  })

  const nextActions = generateNextActions(ctx, drivers, leagueId)
  const valid = validateDrivers(drivers)

  const topConfDrivers = drivers.slice(0, 3)

  return {
    confidence: { score: conf.score, rating: conf.rating, drivers: topConfDrivers },
    drivers,
    nextActions,
    valid,
  }
}

function getWeekValue(arr: number[], week: number): number | null {
  const idx = week - 1
  return Number.isFinite(arr?.[idx]) ? arr[idx] : null
}

interface CachedWeekStat {
  week: number
  rosterId: number
  pointsFor: number
  pointsAgainst: number
  win: number
  matchupId: number | null
}

function isWeekEligible(weekStats: CachedWeekStat[], w: number, teamCount: number): boolean {
  const rows = weekStats.filter(s => s.week === w)
  const withPoints = rows.filter(s => Number.isFinite(s.pointsFor))
  if (withPoints.length < Math.ceil(teamCount * 0.8)) return false
  const withMatchup = rows.filter(s => s.matchupId != null)
  if (withMatchup.length < Math.ceil(rows.length * 0.7)) return false
  const matchupGroups = new Map<number, number>()
  for (const r of withMatchup) {
    matchupGroups.set(r.matchupId!, (matchupGroups.get(r.matchupId!) ?? 0) + 1)
  }
  const unpaired = [...matchupGroups.values()].filter(c => c < 2).length
  if (unpaired > Math.ceil(matchupGroups.size * 0.2)) return false
  return true
}

function resolveAwardsWeek(args: {
  maxWeek: number
  weekStats: CachedWeekStat[]
  teamCount: number
}): number | null {
  const { maxWeek, weekStats, teamCount } = args
  if (isWeekEligible(weekStats, maxWeek, teamCount)) return maxWeek
  if (maxWeek > 1 && isWeekEligible(weekStats, maxWeek - 1, teamCount)) return maxWeek - 1
  return null
}

function computeWeeklyAwards(args: {
  week: number
  weekStats: CachedWeekStat[]
  weeklyPointsByRoster: Map<number, number[]>
  weeklyOpponentPointsByRoster: Map<number, number[]>
}): WeeklyAwardsPayload | null {
  const { week, weekStats } = args

  const rows = weekStats.filter(s => s.week === week)
  if (rows.length < 2) return null

  const pointsList = rows.map(r => r.pointsFor).filter(Number.isFinite).sort((a, b) => a - b)
  const median = pointsList.length
    ? (pointsList.length % 2
      ? pointsList[(pointsList.length - 1) / 2]
      : (pointsList[pointsList.length / 2 - 1] + pointsList[pointsList.length / 2]) / 2)
    : 0

  const ranked = [...rows].sort((a, b) => b.pointsFor - a.pointsFor)
  const awards: WeeklyAward[] = []

  const rankOf = (rid: number) => ranked.findIndex(r => r.rosterId === rid) + 1

  const top = ranked[0]
  awards.push({
    id: 'top_score',
    week,
    rosterId: top.rosterId,
    title: 'Top Score',
    subtitle: `${top.pointsFor.toFixed(1)} points`,
    value: top.pointsFor,
    evidence: { pointsFor: top.pointsFor, pointsAgainst: top.pointsAgainst, win: top.win, matchupId: top.matchupId, rankByPoints: 1, leagueMedian: median, deltaVsMedian: top.pointsFor - median },
  })

  let bestBoss = ranked[0]
  let bestBossVal = bestBoss.pointsFor - median
  for (const r of ranked) {
    const v = r.pointsFor - median
    if (v > bestBossVal) { bestBossVal = v; bestBoss = r }
  }
  awards.push({
    id: 'boss_win',
    week,
    rosterId: bestBoss.rosterId,
    title: 'Boss Win',
    subtitle: `${bestBossVal.toFixed(1)} above league median`,
    value: bestBossVal,
    evidence: { pointsFor: bestBoss.pointsFor, pointsAgainst: bestBoss.pointsAgainst, win: bestBoss.win, matchupId: bestBoss.matchupId, rankByPoints: rankOf(bestBoss.rosterId), leagueMedian: median, deltaVsMedian: bestBossVal },
  })

  const validMarginRows = rows.filter(r => r.matchupId != null && r.pointsAgainst > 0)
  if (validMarginRows.length) {
    let bestMarginRow = validMarginRows[0]
    let bestMarginVal = validMarginRows[0].pointsFor - validMarginRows[0].pointsAgainst
    for (const r of validMarginRows) {
      const v = r.pointsFor - r.pointsAgainst
      if (v > bestMarginVal) { bestMarginVal = v; bestMarginRow = r }
    }
    awards.push({
      id: 'high_score_margin',
      week,
      rosterId: bestMarginRow.rosterId,
      title: 'Biggest Beatdown',
      subtitle: `Won by ${bestMarginVal.toFixed(1)}`,
      value: bestMarginVal,
      evidence: { pointsFor: bestMarginRow.pointsFor, pointsAgainst: bestMarginRow.pointsAgainst, win: bestMarginRow.win, matchupId: bestMarginRow.matchupId, rankByPoints: rankOf(bestMarginRow.rosterId), leagueMedian: median, deltaVsMedian: bestMarginRow.pointsFor - median, margin: bestMarginVal },
    })
  }

  let victim = rows[0]
  for (const r of rows) if (r.pointsAgainst > victim.pointsAgainst) victim = r
  awards.push({
    id: 'points_against_victim',
    week,
    rosterId: victim.rosterId,
    title: 'Points-Against Victim',
    subtitle: `Faced ${victim.pointsAgainst.toFixed(1)}`,
    value: victim.pointsAgainst,
    evidence: { pointsFor: victim.pointsFor, pointsAgainst: victim.pointsAgainst, win: victim.win, matchupId: victim.matchupId, rankByPoints: rankOf(victim.rosterId), leagueMedian: median, deltaVsMedian: victim.pointsFor - median },
  })

  const validWinners = rows.filter(r => r.win === 1 && r.pointsAgainst > 0).sort((a, b) => a.pointsFor - b.pointsFor)
  if (validWinners.length) {
    const u = validWinners[0]
    const rbp = rankOf(u.rosterId)
    awards.push({
      id: 'biggest_upset',
      week,
      rosterId: u.rosterId,
      title: 'Biggest Upset',
      subtitle: `Won with ${u.pointsFor.toFixed(1)}`,
      value: u.pointsFor,
      evidence: { pointsFor: u.pointsFor, pointsAgainst: u.pointsAgainst, win: 1, matchupId: u.matchupId, rankByPoints: rbp, leagueMedian: median, deltaVsMedian: u.pointsFor - median },
    })
  }

  const losers = rows.filter(r => r.win === 0).sort((a, b) => b.pointsFor - a.pointsFor)
  if (losers.length) {
    const un = losers[0]
    const rbp = rankOf(un.rosterId)
    awards.push({
      id: 'unluckiest',
      week,
      rosterId: un.rosterId,
      title: 'Unluckiest Loss',
      subtitle: `Lost with the #${rbp} score`,
      value: un.pointsFor,
      evidence: { pointsFor: un.pointsFor, pointsAgainst: un.pointsAgainst, win: 0, matchupId: un.matchupId, rankByPoints: rbp, leagueMedian: median, deltaVsMedian: un.pointsFor - median },
    })
  }

  const marginWinners = validMarginRows
    .filter(r => r.win === 1)
    .map(r => ({ ...r, margin: r.pointsFor - r.pointsAgainst }))
    .filter(r => r.margin > 0)
    .sort((a, b) => a.margin - b.margin)
  if (marginWinners.length) {
    const lk = marginWinners[0]
    const rbp = rankOf(lk.rosterId)
    awards.push({
      id: 'luckiest',
      week,
      rosterId: lk.rosterId,
      title: 'Luckiest Win',
      subtitle: `Won by just ${lk.margin.toFixed(1)}`,
      value: lk.margin,
      evidence: { pointsFor: lk.pointsFor, pointsAgainst: lk.pointsAgainst, win: 1, matchupId: lk.matchupId, rankByPoints: rbp, leagueMedian: median, deltaVsMedian: lk.pointsFor - median, margin: lk.margin },
    })
  }

  if (losers.length) {
    const candidate = losers.find(r => rankOf(r.rosterId) <= 3)
    if (candidate) {
      const rbp = rankOf(candidate.rosterId)
      awards.push({
        id: 'bounceback_alert',
        week,
        rosterId: candidate.rosterId,
        title: 'Bounceback Alert',
        subtitle: 'Top-3 score in a loss — keep the process',
        value: candidate.pointsFor,
        evidence: { pointsFor: candidate.pointsFor, pointsAgainst: candidate.pointsAgainst, win: 0, matchupId: candidate.matchupId, rankByPoints: rbp, leagueMedian: median, deltaVsMedian: candidate.pointsFor - median },
      })
    }
  }

  const seen = new Set<string>()
  const out: WeeklyAward[] = []
  for (const a of awards) {
    const k = `${a.id}:${a.rosterId}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(a)
    if (out.length >= 6) break
  }

  return { week, awards: out }
}

function computeTradeHubShortcuts(args: {
  leagueId: string
  seasonYear: number
  teams: TeamScore[]
  ldiByPos: Record<string, number>
  ldiSampleTotal: number
  partnerPosCounts: PartnerPosCounts
}): TradeHubShortcut[] {
  const { leagueId, seasonYear, teams, ldiByPos, ldiSampleTotal, partnerPosCounts } = args

  if (teams.length < 8) return []
  if (ldiSampleTotal < 30) return []

  const positions = Object.keys(ldiByPos)
  if (!positions.length) return []

  const sortedPositions = positions
    .slice()
    .sort((a, b) => (ldiByPos[b] ?? 0) - (ldiByPos[a] ?? 0))

  let topCurrencyPos = sortedPositions[0]
  const topScore = ldiByPos[topCurrencyPos] ?? 0
  if (topCurrencyPos === 'PICK' && topScore < 72) {
    const next = sortedPositions.find(p => p !== 'PICK')
    if (next && (ldiByPos[next] ?? 0) >= 65) {
      topCurrencyPos = next
    } else {
      return []
    }
  }

  const topCurrencyScore = ldiByPos[topCurrencyPos] ?? 50
  if (topCurrencyScore < 65) return []

  const actionablePartners = Object.values(partnerPosCounts)
    .filter(counts => (counts[topCurrencyPos] ?? 0) >= 3)
    .length
  if (actionablePartners < 2) return []

  function makeShortcut(t: TeamScore, pos: string, score: number): TradeHubShortcut | null {
    const exp = (t.rosterExposure?.[pos] ?? 0) / 100
    if (exp < 0.18) return null

    const leverage = (score - 50) * 2 * exp
    const leverageScore = Math.max(0, Math.min(100, Math.round(50 + leverage)))

    return {
      rosterId: t.rosterId,
      headline: `You're holding the league's hottest currency: ${pos} (LDI ${score})`,
      body: `About ${Math.round(exp * 100)}% of your roster value is ${pos}. This league pays up for it—use it to upgrade a starter or secure future value.`,
      ldiPos: pos,
      ldiScore: score,
      leverageScore,
      ctas: [
        { id: 'generate_offers', label: 'Generate offers', href: `/legacy/trade-hub?leagueId=${leagueId}&season=${seasonYear}&rosterId=${t.rosterId}&pos=${encodeURIComponent(pos)}&mode=generate` },
        { id: 'find_overpayers', label: 'Find overpayers', href: `/legacy/trading-partners?leagueId=${leagueId}&season=${seasonYear}&pos=${encodeURIComponent(pos)}` },
        { id: 'open_trade_hub', label: 'Open Trade Hub', href: `/legacy/trade-hub?leagueId=${leagueId}&season=${seasonYear}` },
      ],
      evidence: {
        exposureByPos: t.rosterExposure ?? {},
        ldiByPos,
        topCurrencyPos: pos,
        topPartners: [],
      },
    }
  }

  const secondaryPositions = sortedPositions
    .filter(p => p !== topCurrencyPos && (ldiByPos[p] ?? 0) >= 60)
    .filter(p => p !== 'PICK' || (ldiByPos[p] ?? 0) >= 72)

  const out: TradeHubShortcut[] = []

  for (const t of teams) {
    const rosterShortcuts: TradeHubShortcut[] = []

    const primary = makeShortcut(t, topCurrencyPos, topCurrencyScore)
    if (primary) rosterShortcuts.push(primary)

    for (const secPos of secondaryPositions) {
      if (rosterShortcuts.length >= 2) break
      const secScore = ldiByPos[secPos] ?? 0
      const sc = makeShortcut(t, secPos, secScore)
      if (sc) rosterShortcuts.push(sc)
    }

    out.push(...rosterShortcuts)
  }

  out.sort((a, b) => b.leverageScore - a.leverageScore)
  return out.slice(0, 12)
}

function attachProposalTargetsToShortcuts(args: {
  shortcuts: TradeHubShortcut[]
  partnerTendencies: PartnerTendency[]
  partnerPosCounts: PartnerPosCounts
}): TradeHubShortcut[] {
  const { shortcuts, partnerTendencies, partnerPosCounts } = args

  const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

  function partnerScoreForPos(p: PartnerTendency, pos: string): number | null {
    const ldi = p.ldiByPos?.[pos]
    const mean = p.meanPremiumPctByPos?.[pos]
    if (typeof ldi !== 'number' || typeof mean !== 'number') return null

    const posN = partnerPosCounts?.[p.partnerName]?.[pos] ?? 0
    if (posN < 3) return null

    const s1 = 0.55 * (ldi / 100)
    const s2 = 0.30 * clamp01((mean + 0.20) / 0.40)
    const s3 = 0.15 * clamp01(posN / 10)
    return s1 + s2 + s3
  }

  function tagForPos(p: PartnerTendency, pos: string): 'Overpayer' | 'Learning' {
    const posN = partnerPosCounts?.[p.partnerName]?.[pos] ?? 0
    if (posN >= 5) return 'Overpayer'
    return 'Learning'
  }

  return shortcuts.map(sc => {
    const pos = sc.ldiPos?.toUpperCase?.() ?? sc.ldiPos

    const rankedPartners = partnerTendencies
      .map(p => {
        if (p.sample < 6) return null
        const score = partnerScoreForPos(p, pos)
        if (score == null) return null
        const ldiForPos = p.ldiByPos[pos]
        const meanPremiumPctForPos = p.meanPremiumPctByPos[pos]
        const posN = partnerPosCounts?.[p.partnerName]?.[pos] ?? 0
        return {
          partnerName: p.partnerName,
          sample: p.sample,
          ldiForPos,
          meanPremiumPctForPos,
          posN,
          tag: tagForPos(p, pos),
          _score: score,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)

    rankedPartners.sort((a, b) => b._score - a._score)

    const topPartners = rankedPartners.slice(0, 3).map(p => ({
      partnerName: p.partnerName,
      sample: p.sample,
      ldiForPos: p.ldiForPos,
      meanPremiumPctForPos: p.meanPremiumPctForPos,
      tag: p.tag,
      posN: p.posN,
    }))

    return { ...sc, evidence: { ...sc.evidence, topPartners } }
  })
}

function ldiFromMean(meanPremiumPct: number, scale = 0.12): number {
  const x = meanPremiumPct / scale
  const s = 50 + 50 * Math.tanh(x)
  return Math.max(0, Math.min(100, Math.round(s)))
}

type PartnerAgg = {
  sample: number
  sumByPos: Record<string, number>
  nByPos: Record<string, number>
}

type PartnerPosCounts = Record<string, Record<string, number>>

function partnerTendenciesFromTrades(trades: Array<{
  partnerName: string | null
  valueGiven: number | null
  valueReceived: number | null
  playersReceived: any
}>): { partnerTendencies: PartnerTendency[]; partnerPosCounts: PartnerPosCounts } {
  const agg = new Map<string, PartnerAgg>()

  for (const tr of trades) {
    if (!tr.partnerName) continue
    const given = tr.valueGiven ?? 0
    const received = tr.valueReceived ?? 0
    if (given <= 0 || received <= 0) continue

    const prem = (received - given) / Math.max(1, given)

    const players = Array.isArray(tr.playersReceived) ? tr.playersReceived : []
    if (!players.length) continue

    const weight = 1 / players.length

    let a = agg.get(tr.partnerName)
    if (!a) {
      a = { sample: 0, sumByPos: {}, nByPos: {} }
      agg.set(tr.partnerName, a)
    }
    a.sample += 1

    for (const p of players) {
      const pos = String(p?.position ?? '').toUpperCase()
      if (!pos) continue
      a.sumByPos[pos] = (a.sumByPos[pos] ?? 0) + prem * weight
      a.nByPos[pos] = (a.nByPos[pos] ?? 0) + 1
    }
  }

  const partnerPosCounts: PartnerPosCounts = {}
  const out: PartnerTendency[] = []

  for (const [partnerName, a] of agg.entries()) {
    if (a.sample < 6) continue

    const meanPremiumPctByPos: Record<string, number> = {}
    const ldiByPos: Record<string, number> = {}

    for (const [pos, sum] of Object.entries(a.sumByPos)) {
      const n = a.nByPos[pos] ?? 0
      if (n <= 0) continue
      const mean = sum / n
      meanPremiumPctByPos[pos] = mean
      ldiByPos[pos] = ldiFromMean(mean)
    }

    partnerPosCounts[partnerName] = { ...a.nByPos }

    let topOverpayPos: string | null = null
    let topDiscountPos: string | null = null
    let best = -Infinity
    let worst = Infinity
    for (const [pos, mean] of Object.entries(meanPremiumPctByPos)) {
      const posN = a.nByPos[pos] ?? 0
      if (posN < 3) continue
      if (mean > best) { best = mean; topOverpayPos = pos }
      if (mean < worst) { worst = mean; topDiscountPos = pos }
    }

    out.push({
      partnerName,
      sample: a.sample,
      ldiByPos,
      meanPremiumPctByPos,
      topOverpayPos,
      topDiscountPos,
    })
  }

  out.sort((a, b) => b.sample - a.sample)
  return { partnerTendencies: out.slice(0, 50), partnerPosCounts }
}

async function computePartnerTendencies(
  leagueId: string,
  seasonYear: number,
): Promise<{ partnerTendencies: PartnerTendency[]; partnerPosCounts: PartnerPosCounts }> {
  const windowStart = new Date(`${seasonYear}-01-01`)
  const windowEnd = new Date(`${seasonYear + 1}-01-01`)

  const partnerTrades = await prisma.leagueTrade.findMany({
    where: {
      history: { sleeperLeagueId: leagueId },
      partnerName: { not: null },
      createdAt: { gte: windowStart, lt: windowEnd },
    },
    select: {
      partnerName: true,
      valueGiven: true,
      valueReceived: true,
      playersReceived: true,
    },
  })

  return partnerTendenciesFromTrades(partnerTrades)
}

function computeBounceBackIndex(powerScore: number, luckDelta: number, streak: number): number {
  const psComponent = clamp01(powerScore / 100) * 50
  const luckComponent = luckDelta < -0.5 ? clamp01(Math.abs(luckDelta) / 4) * 35 : 0
  const streakComponent = streak < 0 ? clamp01(Math.abs(streak) / 4) * 15 : 0
  const raw = psComponent + luckComponent + streakComponent
  return Math.round(clamp(raw, 0, 100))
}

function computeMotivationalFrame(
  luckDelta: number,
  powerScore: number,
  winScore: number,
  luckScore: number,
  streak: number,
  record: { wins: number; losses: number },
): MotivationalFrame {
  if (luckDelta <= -1.5) {
    if (powerScore >= 60) {
      return {
        headline: 'Your process is better than your record.',
        subtext: `You're scoring like a playoff team — scheduling variance hit you for ${Math.abs(Math.round(luckDelta * 10) / 10)} wins.`,
        suggestedAction: "Don't sell low. Target 1 starter upgrade at FLEX to push through.",
        tone: 'encouraging',
        trigger: 'luck_negative_strong_roster',
      }
    }
    return {
      headline: 'Bad luck is masking your true ceiling.',
      subtext: `Your expected record is ${Math.round(record.wins - luckDelta)}-${Math.round(record.losses + luckDelta)} — the wins will come.`,
      suggestedAction: 'Stay the course. Look for a depth piece on waivers to reduce week-to-week variance.',
      tone: 'encouraging',
      trigger: 'luck_negative_general',
    }
  }

  if (luckDelta >= 1.5) {
    return {
      headline: 'Great job taking advantage — now protect against regression.',
      subtext: `You've outperformed expected wins by +${Math.round(luckDelta * 10) / 10}. Some regression is normal.`,
      suggestedAction: 'Add depth and reduce volatility. Trade a streaky asset for a consistent floor player.',
      tone: 'cautionary',
      trigger: 'luck_positive_overperforming',
    }
  }

  if (powerScore >= 65 && winScore <= 40) {
    return {
      headline: 'Strong roster, results lagging — you\'re close.',
      subtext: 'Your team grades out well but results haven\'t matched yet. This gap typically closes.',
      suggestedAction: 'Review your lineup — one start/sit decision could flip a close loss into a win.',
      tone: 'encouraging',
      trigger: 'power_high_wins_low',
    }
  }

  if (winScore >= 65 && powerScore <= 40) {
    return {
      headline: 'Great results, but roster strength is thin — reinforce with depth.',
      subtext: 'You\'re winning games but your roster value says the margins are tight.',
      suggestedAction: 'Use your record as leverage in trade talks. Add a reliable RB2/WR2 before the stretch.',
      tone: 'cautionary',
      trigger: 'wins_high_power_low',
    }
  }

  if (streak <= -3) {
    return {
      headline: 'Losing streaks end. Yours is about to.',
      subtext: `${Math.abs(streak)} straight losses is tough, but your underlying numbers say a turnaround is coming.`,
      suggestedAction: 'Don\'t panic-sell. Check if a lineup tweak or waiver add can spark the turnaround.',
      tone: 'encouraging',
      trigger: 'losing_streak',
    }
  }

  if (streak >= 3) {
    return {
      headline: 'Momentum is real — keep building.',
      subtext: `${streak} straight wins. You're playing with confidence and it shows.`,
      suggestedAction: 'Now is the time to make a move. Buy a championship piece while you have leverage.',
      tone: 'celebratory',
      trigger: 'winning_streak',
    }
  }

  if (powerScore >= 55 && luckScore >= 45 && luckScore <= 55) {
    return {
      headline: 'Steady as she goes.',
      subtext: 'Your record reflects your roster strength accurately. No luck skew detected.',
      suggestedAction: 'Look for marginal upgrades — a small edge at TE or FLEX could separate you from the pack.',
      tone: 'neutral',
      trigger: 'balanced_neutral',
    }
  }

  return {
    headline: 'Every week is a new opportunity.',
    subtext: 'Your scores and record are tracking close to expectations.',
    suggestedAction: 'Monitor the waiver wire and stay active in trade discussions.',
    tone: 'neutral',
    trigger: 'default',
  }
}

type RawTeam = Omit<TeamScore, 'badges' | 'rank' | 'prevRank' | 'rankDelta' | 'antiGaming' | 'rankChangeDrivers' | 'forwardOdds' | 'confidenceBadge' | 'rankSparkline'>

function generateBadges(team: RawTeam, allTeams: RawTeam[]): Badge[] {
  const badges: Badge[] = []

  const maxPS = Math.max(...allTeams.map(t => t.powerScore))
  if (team.powerScore === maxPS && maxPS > 60) {
    badges.push({ id: 'best_team', label: 'Best Team', icon: 'crown', tier: 'gold' })
  }

  const minLuck = Math.min(...allTeams.map(t => t.luckScore))
  if (team.luckScore === minLuck && minLuck < 35) {
    badges.push({ id: 'most_unlucky', label: 'Most Unlucky', icon: 'storm', tier: 'silver' })
  }

  const maxMSS = Math.max(...allTeams.map(t => t.managerSkillScore))
  if (team.managerSkillScore === maxMSS && maxMSS > 55) {
    badges.push({ id: 'best_negotiator', label: 'Best Negotiator', icon: 'handshake', tier: 'gold' })
  }

  const maxMVS = Math.max(...allTeams.map(t => t.marketValueScore))
  if (team.marketValueScore === maxMVS && maxMVS > 60) {
    badges.push({ id: 'dynasty_king', label: 'Dynasty King', icon: 'gem', tier: 'gold' })
  }

  const maxWS = Math.max(...allTeams.map(t => t.winScore))
  if (team.winScore === maxWS && maxWS > 60) {
    badges.push({ id: 'win_machine', label: 'Win Machine', icon: 'trophy', tier: 'gold' })
  }

  if (team.luckDelta <= -1.5) {
    badges.push({ id: 'should_be_record', label: `Should Be ${team.shouldBeRecord.wins}-${team.shouldBeRecord.losses}`, icon: 'clover', tier: 'silver' })
  }

  if (team.bounceBackIndex >= 70) {
    badges.push({ id: 'bounce_back', label: 'Bounce-Back Candidate', icon: 'rocket', tier: 'bronze' })
  }

  return badges
}

export async function computeLeagueRankingsV2(
  leagueId: string,
  currentWeek?: number,
): Promise<LeagueRankingsV2Output | null> {
  const settings = await fetchLeagueSettings(leagueId)
  if (!settings) return null

  const { name: leagueName, season, isSF, isDynasty, ppr, numTeams, status, rosterPositions } = settings
  const week = currentWeek ?? settings.week
  const phase = detectPhase(week, season, status)

  const leagueClassKey = isDynasty ? (isSF ? 'DYN_SF' : 'DYN_1QB') : (isSF ? 'RED_SF' : 'RED_1QB')
  const segmentKey = `${leagueClassKey}_${phase}`

  const [dbRosterRecords, learnedParams, previousSnapshots, sparklineMap, adaptiveComponentWeights, teamRoleMeta] = await Promise.all([
    fetchRosterRecords(leagueId),
    getActiveCompositeParams(segmentKey).catch(() => null),
    getPreviousWeekSnapshots({ leagueId, season, currentWeek: week }).catch(() => new Map()),
    getLeagueSparklines({ leagueId, season, maxWeeks: 12 }).catch(() => new Map()),
    getActiveWeightsForSegment(segmentKey).catch(() => null),
    fetchUnifiedLeagueTeamMeta(leagueId),
  ])

  const fcSettings: FantasyCalcSettings = { isDynasty, numQbs: isSF ? 2 : 1, numTeams, ppr }
  const [rosters, users, fcPlayers, ldiData, playoffBracket, sleeperPlayersRaw, leagueDrafts, weightConfig] = await Promise.all([
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
    fetchFantasyCalcValues(fcSettings),
    fetchLdiForLeague(leagueId),
    phase === 'post_season' ? getPlayoffBracket(leagueId) : Promise.resolve([]),
    getAllPlayers().catch(() => null),
    getLeagueDrafts(leagueId).catch(() => []),
    getCompositeWeightConfig(),
  ])
  const valuationCacheAgeMs = getValuationCacheAgeMs(fcSettings)
  let sleeperLastSyncMs: number | null = null
  try {
    const syncRow = await prisma.legacyLeague.findFirst({
      where: { sleeperLeagueId: leagueId },
      select: { updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    if (syncRow?.updatedAt) sleeperLastSyncMs = syncRow.updatedAt.getTime()
  } catch {}

  let draftWithPicks: any[] = []
  if (leagueDrafts.length > 0) {
    const latestDraft = leagueDrafts[0]
    if (latestDraft?.draft_id) {
      try {
        const picks = await getDraftPicks(latestDraft.draft_id)
        draftWithPicks = [{ ...latestDraft, picks }]
      } catch { draftWithPicks = [] }
    }
  }

  if (rosters.length === 0) return null

  const userMap = new Map<string, SleeperUser>()
  for (const u of users) {
    userMap.set(u.user_id, u)
  }

  const rosterIdToUsername = new Map<number, string>()
  for (const r of rosters) {
    const user = userMap.get(r.owner_id)
    rosterIdToUsername.set(r.roster_id, user?.username || r.owner_id)
  }

  const maxWeek = Math.min(week, 18)
  const { weekStats, weeklyPointsByRoster, weeklyOpponentPointsByRoster } = await getWeekStatsFromCache(leagueId, maxWeek)

  const rosterRecords = new Map<number, { wins: number; total: number }>()
  for (const r of rosters) {
    rosterRecords.set(r.roster_id, {
      wins: r.settings.wins,
      total: r.settings.wins + r.settings.losses + r.settings.ties,
    })
  }

  const playoffFinishMap = analyzePlayoffBracket(
    playoffBracket,
    rosters.map(r => r.roster_id),
  )

  const valueMap = buildPlayerValueMap(fcPlayers)

  const allPlayerNames: string[] = []
  for (const roster of rosters) {
    for (const pid of roster.players || []) {
      const pVal = valueMap.get(pid) as any
      const name = pVal?.name || pVal?.player
      if (name) allPlayerNames.push(name)
    }
  }
  let analyticsMap: Map<string, any> | undefined
  let dbInjuryMap: Map<string, { severity: string | null; date: Date | null; type: string | null; description: string | null }> | undefined
  try {
    const [analytics, injuries] = await Promise.all([
      getPlayerAnalyticsBatch(allPlayerNames).catch(() => new Map()),
      fetchDbInjuryMap(allPlayerNames).catch(() => new Map()),
    ])
    analyticsMap = analytics.size > 0 ? analytics : undefined
    dbInjuryMap = injuries.size > 0 ? injuries : undefined
  } catch {
    analyticsMap = undefined
    dbInjuryMap = undefined
  }

  const isIdpLeague = detectIdpLeague(rosterPositions)
  const isKickerLeague = detectKickerLeague(rosterPositions)
  if (isIdpLeague || isKickerLeague) {
    const allRosterPlayerIds: string[] = []
    for (const roster of rosters) {
      for (const pid of roster.players || []) {
        allRosterPlayerIds.push(pid)
      }
    }
    const idpKickerValues = await buildIdpKickerValueMap(allRosterPlayerIds, isDynasty)
    for (const [pid, pv] of idpKickerValues) {
      valueMap.set(pid, pv)
    }
  }

  const tradeEfficiency = await fetchTradeMetrics(leagueId, rosterIdToUsername)

  const ldiSampleCount = ldiData ? Object.values(ldiData).reduce((s: number, e: any) => s + (e?.sample ?? 0), 0) : 0

  const rawTeams: RawTeam[] = []

  const allStarterValues: number[] = []
  const allBenchValues: number[] = []
  const allAgeAdjustedTotals: number[] = []
  const allLuckDeltas: number[] = []
  const allTradeAvgPremiums: number[] = []
  const allProcessConsistencies: number[] = []
  const allPortfolioCurrentValues: number[] = []
  const allPortfolioYear3Values: number[] = []
  const allPortfolioYear5Values: number[] = []

  interface TeamIntermediate {
    roster: SleeperRoster
    user: SleeperUser | undefined
    rosterValues: RosterValueResult
    weeklyPts: number[]
    weeklyOppPts: number[]
    expectedWins: number
    sos: number
    winPct: number
    luckDelta: number
    ageAdjustedTotal: number
    tradeEff: { tradeCount: number; avgPremium: number }
    processConsistency: number
    ptsFor: number
    ptsAgainst: number
    playoffSeed: number | null
    isChampion: boolean
    portfolioRaw: { currentValue: number; year3Value: number; year5Value: number; volatilitySum: number; playerCount: number }
    rosterInjuryImpact: RosterInjuryImpact
  }

  const teamIntermediates: TeamIntermediate[] = []

  for (const roster of rosters) {
    const user = userMap.get(roster.owner_id)
    const rosterValues = computeRosterValues(roster, valueMap, isDynasty)
    const weeklyPts = weeklyPointsByRoster.get(roster.roster_id) || []
    const weeklyOppPts = weeklyOpponentPointsByRoster.get(roster.roster_id) || []
    const expectedWins = computeExpectedWins(roster.roster_id, weeklyPointsByRoster, maxWeek)
    const sos = computeSOS(roster.roster_id, weekStats, rosterRecords)
    const tradeEff = tradeEfficiency.get(roster.roster_id) || { tradeCount: 0, avgPremium: 0 }

    const wins = roster.settings.wins ?? 0
    const losses = roster.settings.losses ?? 0
    const ties = roster.settings.ties ?? 0
    const totalGames = wins + losses + ties
    const winPct = totalGames > 0 ? wins / totalGames : 0.5
    const luckDelta = wins - expectedWins

    const rosterInjuryImpact = computeRosterInjuryImpact(roster, sleeperPlayersRaw, analyticsMap, dbInjuryMap, valueMap)
    const ageAdjustedTotal = computeAgeAdjustedMarketValue(roster, valueMap, isDynasty, ldiData, rosterInjuryImpact.byPlayerId)

    const ptsFor = (roster.settings.fpts ?? 0) + (roster.settings.fpts_decimal ?? 0) / 100
    const ptsAgainst = (roster.settings.fpts_against ?? 0) + (roster.settings.fpts_against_decimal ?? 0) / 100

    const processConsistency = weeklyPts.length > 1
      ? 1 / (1 + stddev(weeklyPts) / Math.max(1, weeklyPts.reduce((s, v) => s + v, 0) / weeklyPts.length))
      : 0.5

    const dbRecord = dbRosterRecords?.get(roster.roster_id)
    const bracketInfo = playoffFinishMap.get(roster.roster_id)
    const playoffSeed = dbRecord?.playoffSeed ?? (roster as any).metadata?.playoff_seed ?? null
    const isChampion = bracketInfo?.isChampion ?? dbRecord?.isChampion ?? (roster as any).metadata?.is_champ ?? false

    const rosterPlayersForPortfolio = (roster.players || []).map((pid: string) => {
      const pVal = valueMap.get(pid) as any
      return {
        id: pid,
        name: pVal?.name || pVal?.player || '',
        league: pVal?.league ?? 'NFL',
        devyEligible: pVal?.devyEligible ?? false,
        draftProjectionScore: pVal?.draftProjectionScore ?? null,
        projectedDraftRound: pVal?.projectedDraftRound ?? null,
        position: pVal?.position || 'WR',
        pos: pVal?.position || 'WR',
        age: pVal?.age ?? null,
        value: pVal?.value ?? 0,
        marketValueScore: pVal?.value ?? 0,
      }
    })
    const portfolioRaw = projectPortfolioRaw(rosterPlayersForPortfolio, analyticsMap)

    allStarterValues.push(rosterValues.starterValue)
    allBenchValues.push(rosterValues.benchValue)
    allAgeAdjustedTotals.push(ageAdjustedTotal)
    allLuckDeltas.push(luckDelta)
    allTradeAvgPremiums.push(tradeEff.avgPremium)
    allProcessConsistencies.push(processConsistency)
    allPortfolioCurrentValues.push(portfolioRaw.currentValue)
    allPortfolioYear3Values.push(portfolioRaw.year3Value)
    allPortfolioYear5Values.push(portfolioRaw.year5Value)

    teamIntermediates.push({
      roster,
      user,
      rosterValues,
      weeklyPts,
      weeklyOppPts,
      expectedWins,
      sos,
      winPct,
      luckDelta,
      ageAdjustedTotal,
      tradeEff,
      processConsistency,
      ptsFor,
      ptsAgainst,
      playoffSeed,
      isChampion,
      portfolioRaw,
      rosterInjuryImpact,
    })
  }

  const allRosterIds = rosters.map(r => r.roster_id)
  const teamSnapshotMetrics = new Map<number, SnapshotMetrics>()

  for (const ti of teamIntermediates) {
    const { roster, user, rosterValues, weeklyPts, weeklyOppPts, expectedWins, sos, winPct, luckDelta, ageAdjustedTotal, tradeEff, processConsistency, ptsFor, ptsAgainst, playoffSeed, isChampion, portfolioRaw, rosterInjuryImpact } = ti

    const bracketFinish = playoffFinishMap.get(roster.roster_id) || null
    const madePlayoffs = bracketFinish?.madePlayoffs || (playoffSeed !== null && playoffSeed > 0)

    const winScore = computeWinScore(winPct, sos, phase, madePlayoffs, isChampion, bracketFinish, numTeams)

    const starterP = robustPercentileRank(rosterValues.starterValue, allStarterValues)
    const benchP = robustPercentileRank(rosterValues.benchValue, allBenchValues)
    const powerScore = computePowerScore(starterP, benchP, isDynasty, rosterInjuryImpact, learnedParams)

    const luckScore = computeLuckScore(luckDelta, allLuckDeltas)

    const marketValueScore = computeMarketValueScore(ageAdjustedTotal, allAgeAdjustedTotals)

    const managerSkillScore = computeManagerSkillScore(
      tradeEff.avgPremium,
      allTradeAvgPremiums,
      processConsistency,
      allProcessConsistencies,
      isDynasty,
    )

    const draftGainP = computeDraftGainPercentile(roster.roster_id, draftWithPicks, valueMap, isDynasty, allRosterIds)

    const rosterPlayersForCapital = (roster.players || []).map((pid: string) => {
      const pVal = valueMap.get(pid) as any
      return {
        id: pid,
        league: pVal?.league ?? 'NFL',
        devyEligible: pVal?.devyEligible ?? false,
        draftProjectionScore: pVal?.draftProjectionScore ?? null,
        projectedDraftRound: pVal?.projectedDraftRound ?? null,
        position: pVal?.position || 'WR',
        pos: pVal?.position || 'WR',
        age: pVal?.age ?? null,
        value: pVal?.value ?? 0,
        marketValueScore: pVal?.value ?? 0,
        injurySeverityScore: pVal?.injurySeverityScore ?? null,
        transferStatus: pVal?.transferStatus ?? false,
        redshirtStatus: pVal?.redshirtStatus ?? false,
      }
    })

    const futureCapitalScore = isDynasty ? computeFutureCapitalScore(rosterPlayersForCapital) : 0
    const portfolioProjection = projectPortfolioFromPercentiles(
      portfolioRaw,
      allPortfolioCurrentValues,
      allPortfolioYear3Values,
      allPortfolioYear5Values,
    )

    const activeWeightProfile = resolveWeightProfile(weightConfig, phase, isDynasty)
    const adaptedProfile = learnedParams
      ? applyLearnedParamsToProfile(activeWeightProfile, learnedParams)
      : activeWeightProfile

    const finalProfile = adaptiveComponentWeights
      ? applyAdaptiveComponentWeights(adaptedProfile, adaptiveComponentWeights)
      : adaptedProfile
    const composite = computeCompositeFromWeights(winScore, powerScore, luckScore, marketValueScore, managerSkillScore, draftGainP, phase, isDynasty, futureCapitalScore, finalProfile)
    const streak = computeStreak(weeklyPts, weeklyOppPts)

    const starterPer = robustPercentileRank(rosterValues.starterValue, allStarterValues)
    const benchPer = robustPercentileRank(rosterValues.benchValue, allBenchValues)
    const marketPer = robustPercentileRank(ageAdjustedTotal, allAgeAdjustedTotals)

    const rWins = roster.settings.wins ?? 0
    const rLosses = roster.settings.losses ?? 0
    const rTies = roster.settings.ties ?? 0

    const driverCtx: DriverContext = {
      winScore,
      powerScore,
      luckScore,
      marketValueScore,
      managerSkillScore,
      composite,
      record: { wins: rWins, losses: rLosses, ties: rTies },
      pointsFor: ptsFor,
      pointsAgainst: ptsAgainst,
      expectedWins,
      streak,
      starterValue: rosterValues.starterValue,
      benchValue: rosterValues.benchValue,
      totalRosterValue: rosterValues.totalValue,
      positionValues: rosterValues.positionValues,
      weeklyPts,
      weeklyOppPts,
      tradeEff,
      allTeamCount: rosters.length,
      starterPercentile: starterPer,
      benchPercentile: benchPer,
      marketPercentile: marketPer,
      ldiData,
      isDynasty,
    }

    const explanation = buildRankExplanation(driverCtx, leagueId, ldiSampleCount)

    const rosterExposure: Record<string, number> = {}
    const totalVal = rosterValues.totalValue || 1
    for (const [pos, pv] of Object.entries(rosterValues.positionValues)) {
      rosterExposure[pos] = Math.round((pv.total / totalVal) * 10000) / 100
    }

    let marketAdj = 0
    for (const [pos, expPct] of Object.entries(rosterExposure)) {
      const posLdi = ldiData?.[pos.toUpperCase()]?.ldi ?? 50
      const posBoost = 0.85 + 0.30 * (posLdi / 100)
      marketAdj += (expPct / 100) * posBoost
    }
    marketAdj = Math.round(marketAdj * 10000) / 10000

    const totalGames2 = rWins + rLosses
    const shouldBeWins = Math.round(expectedWins)
    const shouldBeLosses = Math.max(0, totalGames2 - shouldBeWins)
    const bounceBackIndex = computeBounceBackIndex(powerScore, luckDelta, streak)
    const motivationalFrame = computeMotivationalFrame(
      luckDelta, powerScore, winScore, luckScore, streak,
      { wins: rWins, losses: rLosses },
    )

    const dataQuality = computeTeamDataQuality(
      roster, valueMap, rosterInjuryImpact, dbInjuryMap, analyticsMap,
      valuationCacheAgeMs, sleeperLastSyncMs, weeklyPts,
    )

    const dbRoster = dbRosterRecords?.get(roster.roster_id)
    const teamMeta = teamRoleMeta.get(roster.roster_id)
    const unownedLabel = roster.owner_id ? null : `Team ${roster.roster_id}`
    const resolvedUsername = user?.username || user?.display_name || dbRoster?.ownerName || unownedLabel || null
    const resolvedDisplayName = user?.display_name || user?.username || dbRoster?.ownerName || unownedLabel || null

    const snapshotMetrics: SnapshotMetrics = {
      starterValuePercentile: starterPer,
      expectedWins,
      injuryHealthRatio: rosterInjuryImpact.powerHealthRatio,
      tradeEffPremium: tradeEff.avgPremium,
      winScore,
      powerScore,
      luckScore,
      marketValueScore,
      managerSkillScore,
      futureCapitalScore,
      draftGainP,
      benchPercentile: benchPer,
      riskConcentration: rosterInjuryImpact.riskConcentration,
    }
    teamSnapshotMetrics.set(roster.roster_id, snapshotMetrics)

    rawTeams.push({
      rosterId: roster.roster_id,
      ownerId: roster.owner_id,
      username: resolvedUsername,
      displayName: resolvedDisplayName,
      avatar: user?.avatar || null,
      role: teamMeta?.role ?? null,
      isOrphan: teamMeta?.isOrphan === true,

      winScore,
      powerScore,
      luckScore,
      marketValueScore,
      managerSkillScore,
      futureCapitalScore,
      composite,
      portfolioProjection,

      record: { wins: rWins, losses: rLosses, ties: rTies },
      pointsFor: ptsFor,
      pointsAgainst: ptsAgainst,
      strengthOfSchedule: sos,
      expectedWins,
      luckDelta: Math.round(luckDelta * 10) / 10,
      shouldBeRecord: { wins: shouldBeWins, losses: shouldBeLosses },
      bounceBackIndex,
      motivationalFrame,
      positionValues: rosterValues.positionValues,
      rosterExposure,
      marketAdj,
      streak,

      starterValue: rosterValues.starterValue,
      benchValue: rosterValues.benchValue,
      totalRosterValue: rosterValues.totalValue,
      pickValue: 0,

      phase,
      explanation,
      dataQuality,
    })
  }

  rawTeams.sort((a, b) => b.composite - a.composite)

  const allTeamsForOdds = rawTeams.map(t => ({
    rosterId: t.rosterId,
    weeklyPts: weeklyPointsByRoster.get(t.rosterId) ?? [],
    record: t.record,
  }))
  const forwardOddsMap = computeAllForwardOdds(allTeamsForOdds, rosters.length)

  const antiGamingInputs: AntiGamingInput[] = rawTeams.map((t, idx) => ({
    rosterId: t.rosterId,
    currentRank: idx + 1,
    composite: t.composite,
    metrics: teamSnapshotMetrics.get(t.rosterId) || {
      starterValuePercentile: 0,
      expectedWins: t.expectedWins,
      injuryHealthRatio: 1,
      tradeEffPremium: 0,
    },
  }))

  const antiGamingResults = applyAntiGamingConstraints(antiGamingInputs, previousSnapshots)
  const antiGamingMap = new Map(antiGamingResults.map(r => [r.rosterId, r]))

  const sortedByAdjustedRank = rawTeams
    .map((t, idx) => ({ team: t, originalRank: idx + 1 }))
    .sort((a, b) => {
      const aAdj = antiGamingMap.get(a.team.rosterId)?.adjustedRank ?? a.originalRank
      const bAdj = antiGamingMap.get(b.team.rosterId)?.adjustedRank ?? b.originalRank
      if (aAdj !== bAdj) return aAdj - bAdj
      return b.team.composite - a.team.composite
    })

  const teams: TeamScore[] = sortedByAdjustedRank.map((entry, idx) => {
    const t = entry.team
    const agResult = antiGamingMap.get(t.rosterId)
    const prevSnap = previousSnapshots.get(String(t.rosterId))
    const badges = generateBadges(t, rawTeams)
    const finalRank = idx + 1

    const rawMetrics = teamSnapshotMetrics.get(t.rosterId) ?? null
    const prevMetrics = prevSnap?.metrics ?? null

    const rankChangeDrivers = buildRankChangeDrivers(
      t.explanation.drivers,
      prevMetrics,
      rawMetrics,
    )

    const forwardOdds = forwardOddsMap.get(t.rosterId) ?? { playoffPct: 0, top3Pct: 0, titlePct: 0, simCount: 0 }

    const confidenceBadge = buildConfidenceBadge(t.dataQuality)

    const rankSparkline = sparklineMap.get(String(t.rosterId)) ?? []

    return {
      ...t,
      rank: finalRank,
      prevRank: prevSnap?.rank ?? null,
      rankDelta: prevSnap ? prevSnap.rank - finalRank : null,
      badges,
      antiGaming: agResult ? {
        constrained: agResult.constrained,
        originalRank: agResult.originalRank,
        justifications: agResult.justifications,
        failedMetrics: agResult.failedMetrics,
      } : null,
      rankChangeDrivers,
      forwardOdds,
      confidenceBadge,
      rankSparkline,
      _snapshotMetrics: rawMetrics,
    }
  })

  const weeklyPointsDistribution = rosters.map(r => ({
    rosterId: r.roster_id,
    weeklyPoints: weeklyPointsByRoster.get(r.roster_id) || [],
  }))

  const marketInsights: MarketInsight[] = []
  if (ldiData) {
    for (const [pos, entry] of Object.entries(ldiData)) {
      if (entry && typeof entry.meanPremiumPct === 'number' && (entry.sample ?? 0) >= 3) {
        const pct = Math.round(entry.meanPremiumPct * 100)
        const direction = pct >= 0 ? '+' : ''
        marketInsights.push({
          position: pos,
          premiumPct: pct,
          sample: entry.sample ?? 0,
          label: `${pos} premium is ${direction}${pct}% in your league (${entry.sample} trades)`,
        })
      }
    }
    marketInsights.sort((a, b) => Math.abs(b.premiumPct) - Math.abs(a.premiumPct))
  }

  const ldiChips: LDIChip[] = []
  if (ldiData) {
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const entry = ldiData[pos]
      if (!entry) continue
      const ldi = entry.ldi ?? 50
      if (ldi > 65) {
        ldiChips.push({ position: pos, ldi, label: `${pos} market`, type: 'hot' })
      } else if (ldi < 35) {
        ldiChips.push({ position: pos, ldi, label: `${pos} discount`, type: 'cold' })
      }
    }
  }

  const awardsWeek = resolveAwardsWeek({ maxWeek, weekStats, teamCount: rosters.length })
  const weeklyAwards = awardsWeek != null
    ? computeWeeklyAwards({ week: awardsWeek, weekStats, weeklyPointsByRoster, weeklyOpponentPointsByRoster })
    : null

  const { partnerTendencies, partnerPosCounts } = await computePartnerTendencies(leagueId, Number(season) || 2025)

  const ldiByPosFlat: Record<string, number> = {}
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    ldiByPosFlat[pos] = Math.round(ldiData?.[pos]?.ldi ?? 50)
  }
  const rawShortcuts = computeTradeHubShortcuts({ leagueId, seasonYear: Number(season) || 2025, teams, ldiByPos: ldiByPosFlat, ldiSampleTotal: ldiSampleCount, partnerPosCounts })
  const tradeHubShortcuts = attachProposalTargetsToShortcuts({ shortcuts: rawShortcuts, partnerTendencies, partnerPosCounts })

  const proposalTargets: LeagueRankingsV2Output['meta']['proposalTargets'] = []
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    for (const pt of partnerTendencies) {
      const posN = partnerPosCounts[pt.partnerName]?.[pos] ?? 0
      if (posN < 3) continue
      const ldi = pt.ldiByPos?.[pos]
      const mean = pt.meanPremiumPctByPos?.[pos]
      if (typeof ldi !== 'number' || typeof mean !== 'number') continue
      const s1 = 0.55 * (ldi / 100)
      const s2 = 0.30 * Math.max(0, Math.min(1, (mean + 0.20) / 0.40))
      const s3 = 0.15 * Math.max(0, Math.min(1, posN / 10))
      proposalTargets.push({
        position: pos,
        rosterId: pt.partnerName,
        name: pt.partnerName,
        score: Math.round((s1 + s2 + s3) * 100),
        ldiByPos: ldi,
        meanPremiumPct: mean,
        nByPos: posN,
        label: posN >= 5 ? 'Overpayer' : 'Learning',
      })
    }
  }
  proposalTargets.sort((a, b) => b.score - a.score)

  const ldiTrend: Record<string, number> = {}
  if (ldiData) {
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      ldiTrend[pos] = 0
    }
  }

  return {
    leagueId,
    leagueName,
    season,
    week,
    phase,
    isDynasty,
    isSuperFlex: isSF,
    isIdpLeague,
    isKickerLeague,
    teams,
    weeklyPointsDistribution,
    computedAt: Date.now(),
    marketInsights,
    ldiChips,
    weeklyAwards,
    tradeHubShortcuts,
    partnerTendencies,
    meta: {
      ldiByPos: ldiByPosFlat,
      partnerPosCounts,
      ldiSampleTotal: ldiSampleCount,
      ldiTrend,
      proposalTargets,
      weightVersion: weightConfig.version,
      weightCalibratedAt: weightConfig.calibratedAt,
      learnedParams: learnedParams ?? undefined,
      adaptiveWeights: adaptiveComponentWeights ?? undefined,
      segmentKey,
      modelConfidence: computeModelConfidence(teams),
      dataFreshness: computeDataFreshness(teams),
    },
  }
}
