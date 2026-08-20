import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireAuthOrOrigin, forbiddenResponse } from '@/lib/api-auth'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { evaluateTrade, formatEvaluationForAI, TradeAsset as TierTradeAsset, LeagueSettings, detectIDPFromRosterPositions, detectSFFromRosterPositions } from '@/lib/dynasty-tiers'
import { getPlayerValuesForNames, formatValuesForPrompt, FantasyCalcSettings, calculateTradeBalance, getPickValue } from '@/lib/fantasycalc'
import { buildTradeHubIntelBlock, parseTradeIntelBlockMeta } from '@/lib/trade-engine/trade-analyzer-intel'
import { recordTradeSurfaceShadow } from '@/lib/decision-os/trade/surfaceShadow'
import {
  buildSurfaceParity,
  legacyVerdictToAdvantage,
} from '@/lib/decision-os/trade/legacyParity'
import { buildLegacyCanonicalGrade } from '@/lib/decision-os/trade/legacyCanonicalGrade'
import { fetchPlayerNewsFromGrok } from '@/lib/ai-gm-intelligence'
import { buildRuntimeConstraints, formatConstraintsForPrompt, DEFAULT_TRADE_CONSTRAINTS, getPickValueWithRange, getPickRange } from '@/lib/trade-constraints'
import { buildHistoricalTradeContext, getDataInfo } from '@/lib/historical-values'
import { autoLogDecision } from '@/lib/decision-log'
import { computeNewsValueAdjustments, applyNewsAdjustmentsToValueMap, formatNewsAdjustmentsForPrompt, type PlayerNewsData, type NewsValueAdjustment } from '@/lib/news-value-adjustment'
import { computeConfidenceRisk, getHistoricalHitRate, type AssetContext } from '@/lib/analytics/confidence-risk-engine'
import { buildTradeValuationEvidence, type TradeValuationEvidence } from '@/lib/legacy/intelligenceEvidence'
import { getCachedDNA, formatDNAForPrompt } from '@/lib/manager-dna'
import { getAllPlayers, getLeagueInfo, getLeagueRosters, getLeagueUsers } from '@/lib/sleeper-client'
import { lookupByNames, buildPlayerContextForAI, enrichWithValuation, type UnifiedPlayer } from '@/lib/unified-player-service'
import { computeTradeDrivers, type TradeDriverData } from '@/lib/trade-engine/trade-engine'
import type { Asset } from '@/lib/trade-engine/types'
import { computeDraftProjectionScore, devyAcceptanceAdjustment, applyTeamDirectionAdjustment } from '@/lib/devy-model'
import { extractAcceptanceFeatures, acceptanceProbabilityWithLiquidity } from '@/lib/acceptance-model'
import { computeLiquidity, liquidityTier, type LiquidityMetrics } from '@/lib/liquidity-model'
import { simulateMatchup, computeChampionshipDelta, type TeamProjection } from '@/lib/monte-carlo'
import { simulatePortfolio, type PortfolioAsset } from '@/lib/portfolio-simulator'
import { generateOptimalCounters, buildAvailableSweeteners, type TradeShape } from '@/lib/counter-builder'
import { prisma } from '@/lib/prisma'
import { getCalibratedWeights } from '@/lib/trade-engine/accept-calibration'
import { logTradeOfferEvent } from '@/lib/trade-engine/trade-event-logger'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { runTradeAnalysis } from '@/lib/engine/trade'
import type { TradeEngineRequest as EngineTradeReq, TradeAssetUnion } from '@/lib/engine/trade-types'
import { computeTradeFairnessScore, computeTradeRecommendationScore, normalizeScore } from '@/lib/legacy-tool/scoring'
import { fuseDecisionScore } from '@/lib/legacy-tool/fusion'
import { evaluateCommissionerAlert } from '@/lib/legacy-tool/fairness'
import { normalizeGrokSignalsToDeltaEvents, persistGrokDeltaEvents } from '@/lib/legacy-tool/grok-delta'
import { assertSleeperBoundaryForLeagueId } from '@/lib/legacy/sleeper-boundary'
import { getTheSportsDbApiKey } from '@/lib/env/sports-media-keys'
import {
  buildPrivateTradeCoachingNotification,
  buildLeagueTradeProcessedNotification,
  buildCommissionerFairnessNotification,
} from '@/lib/legacy-tool/notifications'

type Sport = 'nfl' | 'nba'
type RosterSlot = 'Starter' | 'Bench' | 'IR' | 'Taxi'

type SleeperUser = {
  user_id: string
  display_name?: string
  username?: string
}

type SleeperRoster = {
  roster_id: number
  owner_id: string | null
  players?: string[] | null
  starters?: string[] | null
  reserve?: string[] | null
  taxi?: string[] | null
}

type SleeperLeague = {
  league_id: string
  sport?: string
  name?: string
  season?: string
  status?: string
  settings?: any
  scoring_settings?: any
  roster_positions?: string[]
}

type SleeperPlayer = {
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  team?: string
}

type RosteredPlayer = {
  id: string
  name: string
  pos: string
  team?: string
  slot: RosterSlot
  isIdp?: boolean
}

type TradeAsset =
  | { type: 'player'; player: { id?: string; name: string; pos?: string; team?: string; slot?: RosterSlot; isIdp?: boolean } }
  | { type: 'pick'; pick: { year: number; round: 1 | 2 | 3 | 4; pickNumber?: number; originalRosterId?: number } }
  | { type: 'faab'; faab: { amount: number } }

const SleeperUserSchema = z.object({
  username: z.string(),
  userId: z.string(),
}).optional()

const LeagueContextSchema = z.object({
  season: z.number().optional(),
  week: z.number().optional(),
  phase: z.string().optional(),
  numTeams: z.number().optional(),
  settings: z.object({
    qbFormat: z.enum(['superflex', '2qb', '1qb']).optional(),
    tep: z.object({ enabled: z.boolean(), premiumPprBonus: z.number() }).optional(),
    ppr: z.number().optional(),
    ppCarry: z.number().optional(),
    ppCompletion: z.number().optional(),
    sixPtPassTd: z.boolean().optional(),
    idp: z.boolean().optional(),
  }).optional(),
  roster: z.object({
    slots: z.record(z.number()).optional(),
    limits: z.object({ maxRoster: z.number().optional() }).optional(),
  }).optional(),
  trade: z.object({
    vetoType: z.string().optional(),
    tradeDeadlineWeek: z.number().optional(),
    faabTradable: z.boolean().optional(),
  }).optional(),
}).optional()

const MarketContextSchema = z.object({
  ldi: z.record(z.number()).optional(),
  partnerTendencies: z.record(z.any()).optional(),
}).optional()

const NflContextSchema = z.object({
  asOf: z.string().optional(),
  players: z.record(z.any()).optional(),
}).optional()

const TradeAnalyzeRequestSchema = z.object({
  sport: z.literal('NFL'),
  format: z.enum(['redraft', 'dynasty', 'specialty']),
  leagueType: z.enum(['standard', 'bestball']).optional().default('standard'),
  idpEnabled: z.boolean().optional().default(true),

  league_id: z.string().optional().nullable(),

  user_roster_id: z.number().int().positive().nullable().optional(),
  partner_roster_id: z.number().int().positive().nullable().optional(),

  sleeper_username_a: z.string().min(1),
  sleeper_username_b: z.string().min(1),

  sleeperUserA: SleeperUserSchema,
  sleeperUserB: SleeperUserSchema,

  assetsA: z.array(z.any()).default([]),
  assetsB: z.array(z.any()).default([]),
  
  numTeams: z.number().int().positive().nullable().optional(),
  
  tradeGoal: z.string().optional().nullable(),
  
  tradeDate: z.string().optional().nullable(),

  leagueContext: LeagueContextSchema,
  marketContext: MarketContextSchema,
  nflContext: NflContextSchema,

  options: z.object({
    offlineSnapshotOk: z.boolean().optional(),
    explainLevel: z.enum(['brief', 'full']).optional(),
    counterCount: z.number().optional(),
  }).optional(),
  
  rosterA: z.array(z.any()).optional().default([]),
  rosterB: z.array(z.any()).optional().default([]),
})

const TradeAnalyzeResponseSchema = z.object({
  grade: z.enum(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']).optional(),
  verdict: z.enum(['Fair', 'Slightly favors A', 'Slightly favors B', 'Strongly favors A', 'Strongly favors B']),
  winProbabilityShift: z.number().optional(),
  
  teamAnalysis: z.object({
    teamAPhase: z.enum(['Contender', 'Middle', 'Rebuild']).optional(),
    teamBPhase: z.enum(['Contender', 'Middle', 'Rebuild']).optional(),
    teamAProblems: z.array(z.string()).optional(),
    teamBProblems: z.array(z.string()).optional(),
  }).optional(),
  
  assetBreakdown: z.object({
    teamAReceives: z.array(z.object({
      asset: z.string(),
      tier: z.string(),
      outlook: z.string(),
    })).optional(),
    teamBReceives: z.array(z.object({
      asset: z.string(),
      tier: z.string(),
      outlook: z.string(),
    })).optional(),
  }).optional(),
  
  lineupDelta: z.object({
    teamAChange: z.string().optional(),
    teamBChange: z.string().optional(),
    weeklyPointsImpactA: z.string().optional(),
    weeklyPointsImpactB: z.string().optional(),
  }).optional(),
  
  riskFlags: z.array(z.string()).optional(),
  
  expertAnalysis: z.string().optional(),
  
  whenThisBackfires: z.array(z.string()).optional(),
  
  counterOffers: z.array(z.object({
    description: z.string(),
    whyBetter: z.string(),
  })).optional(),
  
  tradePitch: z.string().optional(),

  leagueSizeImpact: z.array(z.string()).default([]),

  detailedAnalysis: z.object({
    playerBreakdowns: z.array(z.object({
      playerName: z.string(),
      position: z.string().optional(),
      team: z.string().optional(),
      injuryHistory: z.string().optional(),
      injuryRisk: z.enum(['Low', 'Moderate', 'High', 'Extreme']).optional(),
      situationalContext: z.string().optional(),
      qbSituation: z.string().optional(),
      offensiveLineRating: z.string().optional(),
      valueReasoning: z.string().optional(),
    })).optional(),
    leagueContextImpact: z.string().optional(),
    scoringFormatImpact: z.string().optional(),
    rosterConstructionNotes: z.string().optional(),
  }).optional(),

  // Legacy fields for backwards compatibility
  why: z.array(z.string()).default([]),
  teamImpactA: z.array(z.string()).default([]),
  teamImpactB: z.array(z.string()).default([]),

  betterPartners: z
    .array(
      z.object({
        managerUsername: z.string(),
        needs: z.array(z.string()).default([]),
        proposedTrade: z.string(),
        whyBetter: z.string(),
      })
    )
    .optional(),

  leverage: z
    .object({
      suggestedAsk: z.array(z.string()).default([]),
      suggestedCounters: z.array(z.string()).default([]),
      riskChecks: z.array(z.string()).default([]),
    })
    .optional(),

  notes: z.array(z.string()).default([]),
})

function normalizeName(s?: string) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 0 } })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, json, text }
}

function resolveRosterIdsFromLeague(opts: {
  userRosterId?: number | null
  partnerRosterId?: number | null
  users: any[]
  rosters: any[]
  sleeperA: string
  sleeperB: string
}): { userRosterId: number | null; partnerRosterId: number | null } {
  const { users, rosters, sleeperA, sleeperB } = opts

  let userRosterId = opts.userRosterId ?? null
  let partnerRosterId = opts.partnerRosterId ?? null

  const findUserIdByUsername = (username: string): string | null => {
    const target = (username || '').trim().toLowerCase()
    if (!target) return null
    const match = (users ?? []).find((u: any) =>
      (u?.username || '').toLowerCase() === target ||
      (u?.display_name || '').toLowerCase() === target
    )
    return match?.user_id ?? null
  }

  if (!userRosterId) {
    const userIdA = findUserIdByUsername(sleeperA)
    const rosterA = (rosters ?? []).find((r: any) => String(r?.owner_id || '') === String(userIdA || ''))
    userRosterId = rosterA?.roster_id ?? null
  }

  if (!partnerRosterId) {
    const userIdB = findUserIdByUsername(sleeperB)
    const rosterB = (rosters ?? []).find((r: any) => String(r?.owner_id || '') === String(userIdB || ''))
    partnerRosterId = rosterB?.roster_id ?? null
  }

  return { userRosterId, partnerRosterId }
}

function isIdpPos(pos?: string) {
  const p = (pos || '').toUpperCase()
  return p === 'DL' || p === 'LB' || p === 'DB' || p === 'EDGE' || p === 'IDP'
}

const playersCache: Record<Sport, { at: number; data: Record<string, SleeperPlayer> | null }> = {
  nfl: { at: 0, data: null },
  nba: { at: 0, data: null },
}
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

async function getSleeperPlayers(sport: Sport) {
  const now = Date.now()
  const cached = playersCache[sport]
  if (cached.data && now - cached.at < CACHE_TTL_MS) return cached.data

  // This route currently supports NFL-only analysis; reuse shared player loader.
  if (sport !== 'nfl') {
    playersCache[sport] = { at: now, data: {} }
    return playersCache[sport].data!
  }

  const players = await getAllPlayers()
  playersCache[sport] = { at: now, data: players as Record<string, SleeperPlayer> }
  return playersCache[sport].data!
}

function shapeRosteredPlayers(args: {
  sport: Sport
  roster: SleeperRoster
  dict: Record<string, SleeperPlayer>
}): RosteredPlayer[] {
  const { sport, roster, dict } = args
  const players = (roster.players || []).filter(Boolean)
  const starters = new Set((roster.starters || []).filter(Boolean))
  const reserve = new Set((roster.reserve || []).filter(Boolean))
  const taxi = new Set((roster.taxi || []).filter(Boolean))

  const out = players.map((pid) => {
    const meta = dict[pid] || {}
    const name =
      meta.full_name ||
      [meta.first_name, meta.last_name].filter(Boolean).join(' ') ||
      pid

    const pos = (meta.position || '').toUpperCase() || 'UNK'
    const team = (meta.team || '').toUpperCase() || undefined

    let slot: RosterSlot = 'Bench'
    if (starters.has(pid)) slot = 'Starter'
    else if (reserve.has(pid)) slot = 'IR'
    else if (taxi.has(pid)) slot = 'Taxi'

    return {
      id: pid,
      name,
      pos,
      team,
      slot,
      isIdp: sport === 'nfl' ? isIdpPos(pos) : false,
    }
  })

  const slotOrder: Record<RosterSlot, number> = { Starter: 1, Bench: 2, IR: 3, Taxi: 4 }
  out.sort((a, b) => {
    const s = slotOrder[a.slot] - slotOrder[b.slot]
    if (s !== 0) return s
    return a.name.localeCompare(b.name)
  })

  return out
}

function summarizeRoster(roster: RosteredPlayer[]) {
  const counts: Record<string, number> = {}
  for (const p of roster) counts[p.pos] = (counts[p.pos] || 0) + 1

  const starters = roster.filter((p) => p.slot === 'Starter')
  const starterCounts: Record<string, number> = {}
  for (const p of starters) starterCounts[p.pos] = (starterCounts[p.pos] || 0) + 1

  return {
    totalPlayers: roster.length,
    starters: starters.length,
    posCounts: counts,
    starterPosCounts: starterCounts,
    sampleStarters: starters.slice(0, 12).map((p) => `${p.name} (${p.pos}${p.isIdp ? ',IDP' : ''})`),
  }
}

async function lookupSportsDbPlayers(args: { sport: Sport; names: string[] }) {
  const apiKey = getTheSportsDbApiKey() || ''
  if (!apiKey) return { ok: false, reason: 'missing_api_key', players: [] as any[] }

  const uniq = Array.from(new Set(args.names.map((n) => n.trim()).filter(Boolean))).slice(0, 8)
  const sportLabel = args.sport === 'nba' ? 'Basketball' : 'American Football'

  const results: any[] = []
  for (const name of uniq) {
    const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/searchplayers.php?p=${encodeURIComponent(name)}`
    const r = await fetchJson(url)
    if (!r.ok) continue
    const arr = r.json?.player
    if (!Array.isArray(arr) || arr.length === 0) continue

    const best = arr.find((p: any) => String(p?.strSport || '').toLowerCase().includes(sportLabel.toLowerCase())) || arr[0]
    results.push({
      name: best?.strPlayer || name,
      sport: best?.strSport || sportLabel,
      team: best?.strTeam || null,
      position: best?.strPosition || null,
      born: best?.dateBorn || null,
      height: best?.strHeight || null,
      weight: best?.strWeight || null,
      description: best?.strDescriptionEN?.slice(0, 300) || null, // Player bio/situation
    })
  }

  return { ok: true, players: results }
}

// ESPN player search and stats lookup - enhanced version
async function lookupEspnPlayerStats(args: { sport: Sport; names: string[] }) {
  const sportPath = args.sport === 'nba' ? 'basketball/nba' : 'football/nfl'
  const uniq = Array.from(new Set(args.names.map((n) => n.trim()).filter(Boolean))).slice(0, 15)
  
  const results: any[] = []
  const errors: string[] = []
  
  // Fetch in parallel batches for speed
  const fetchPlayer = async (name: string) => {
    try {
      // Search for athlete
      const searchUrl = `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=5&type=player` // db-first-exception: ad-hoc player enrichment for on-demand trade analysis
      const searchRes = await fetchJson(searchUrl)
      
      if (!searchRes.ok || !searchRes.json?.items?.length) {
        errors.push(`${name}: Not found in ESPN`)
        return null
      }
      
      // Find best match for the sport
      const sportKey = args.sport === 'nba' ? 'nba' : 'nfl'
      const athlete = searchRes.json.items.find((item: any) => 
        item?.type === 'player' && 
        String(item?.league?.slug || '').toLowerCase() === sportKey
      ) || searchRes.json.items[0]
      
      if (!athlete?.id) {
        errors.push(`${name}: No athlete ID found`)
        return null
      }
      
      // Fetch athlete details with stats
      const athleteUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${sportPath}/athletes/${athlete.id}` // db-first-exception: ad-hoc player enrichment for on-demand trade analysis
      const athleteRes = await fetchJson(athleteUrl)
      
      if (!athleteRes.ok || !athleteRes.json) {
        errors.push(`${name}: Failed to fetch details`)
        return null
      }
      
      const data = athleteRes.json as any
      const statsCategories = data?.stats?.categories || []
      
      // Extract key stats based on sport and position
      const statsSummary: Record<string, any> = {}
      for (const cat of statsCategories) {
        const stats = cat?.stats || []
        for (const stat of stats.slice(0, 15)) {
          if (stat?.displayValue && stat?.abbreviation) {
            statsSummary[stat.abbreviation] = stat.displayValue
          }
        }
      }
      
      // Get injury details
      const injury = data?.injuries?.[0]
      const injuryInfo = injury ? {
        status: injury?.type?.description || 'Unknown',
        detail: injury?.details?.detail || null,
        returnDate: injury?.details?.returnDate || null,
      } : null
      
      return {
        name: data?.displayName || athlete?.displayName || name,
        team: data?.team?.displayName || data?.team?.abbreviation || null,
        position: data?.position?.abbreviation || null,
        age: data?.age || null,
        experience: data?.experience?.years || null,
        birthDate: data?.dateOfBirth || null,
        height: data?.height || null,
        weight: data?.weight || null,
        injury: injuryInfo,
        status: injury ? injuryInfo?.status : 'Active',
        depthChart: data?.depth?.position?.name || null,
        stats: Object.keys(statsSummary).length > 0 ? statsSummary : null,
        headshot: data?.headshot?.href || null,
        college: data?.college?.name || null,
        draftInfo: data?.draft ? `${data.draft.year} Round ${data.draft.round} Pick ${data.draft.selection}` : null,
      }
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : 'Unknown error'}`)
      return null
    }
  }
  
  // Process in parallel
  const playerResults = await Promise.all(uniq.map(fetchPlayer))
  for (const result of playerResults) {
    if (result) results.push(result)
  }
  
  return { 
    ok: results.length > 0, 
    players: results,
    errors: errors.length > 0 ? errors : undefined,
    fetchedCount: results.length,
    requestedCount: uniq.length,
  }
}

function inferPickNumberFromSlot(maybeSlot: unknown, numTeams: number): number | null {
  const nTeams = Number(numTeams)
  if (!Number.isFinite(nTeams) || nTeams < 2) return null

  const slotNum = typeof maybeSlot === 'string' && (maybeSlot as string).trim() === '' ? NaN : Number(maybeSlot)
  if (!Number.isFinite(slotNum)) return null

  const s = Math.floor(slotNum)
  if (s !== slotNum) return null

  if (s < 1 || s > nTeams) return null
  return s
}

type PickInferenceResult = {
  assets: TradeAsset[]
  notes: string[]
}

function formatAsset(a: any) {
  if (a?.type === 'player') {
    const p = a.player || {}
    return {
      type: 'player' as const,
      player: {
        id: p.id || undefined,
        name: String(p.name || '').trim(),
        pos: p.pos ? String(p.pos) : undefined,
        team: p.team ? String(p.team) : undefined,
        slot: p.slot ? (String(p.slot) as RosterSlot) : undefined,
        isIdp: Boolean(p.isIdp),
      },
    }
  }
  if (a?.type === 'pick') {
    const pick = a.pick || {}
    const rawPn = pick.pickNumber != null ? Number(pick.pickNumber) : undefined
    const pn = rawPn != null && Number.isFinite(rawPn) && rawPn >= 1 ? rawPn : undefined
    const rawRid = pick.originalRosterId != null ? Number(pick.originalRosterId) : undefined
    const rid = rawRid != null && Number.isFinite(rawRid) && rawRid >= 1 ? rawRid : undefined
    return {
      type: 'pick' as const,
      pick: {
        year: Number(pick.year),
        round: Number(pick.round) as 1 | 2 | 3 | 4,
        ...(pn != null ? { pickNumber: pn } : {}),
        ...(rid != null ? { originalRosterId: rid } : {}),
      },
    }
  }
  if (a?.type === 'faab') {
    const faab = a.faab || {}
    return {
      type: 'faab' as const,
      faab: { amount: Math.max(0, Math.floor(Number(faab.amount))) },
    }
  }
  return null
}

function buildLeagueSizePrompt(numTeams: number) {
  const N = Math.max(2, Math.floor(Number(numTeams) || 12))

  const earlyBound = Math.ceil(N / 3)
  const midBound = Math.ceil((N * 2) / 3)

  const tierLine = (round: number) =>
    `R${round}: Early 1–${earlyBound} | Mid ${earlyBound + 1}–${midBound} | Late ${midBound + 1}–${N}`

  const sizeBand =
    N <= 6
      ? 'TINY (4–6)'
      : N <= 10
      ? 'SMALL (8–10)'
      : N <= 14
      ? 'STANDARD (12–14)'
      : N <= 20
      ? 'LARGE (16–20)'
      : N <= 28
      ? 'HUGE (24–28)'
      : 'EXTREME (32)'

  const scarcityAnchors =
    N >= 24
      ? `Starter scarcity is EXTREME at ${N} teams.
Premium weekly starters (treat as high leverage assets if stable starters):
- QB: top-${Math.min(N, 24)} (QB1/QB2 scarcity matters a lot)
- RB: top-${Math.min(N * 2, 60)} (RB2 scarcity matters a lot)
- WR: top-${Math.min(N * 3, 96)} (WR3 scarcity matters a lot)
- TE: top-${Math.min(N, 24)} (TE1/TE2 scarcity matters a lot)`
      : N >= 16
      ? `Starter scarcity is HIGH at ${N} teams.
Premium weekly starters:
- QB: top-${Math.min(N, 16)}
- RB: top-${Math.min(N * 2, 48)}
- WR: top-${Math.min(N * 3, 72)}
- TE: top-${Math.min(N, 16)}`
      : `Starter scarcity is NORMAL at ${N} teams (but still apply scarcity logic for elite tiers).
Premium weekly starters:
- QB: top-${Math.min(N, 12)}
- RB: top-${Math.min(N * 2, 36)}
- WR: top-${Math.min(N * 3, 60)}
- TE: top-${Math.min(N, 12)}`

  const consolidationRule =
    N >= 16
      ? `Consolidation is MORE important in ${N}-team leagues: roster spots and waiver replacement are tighter.
- 2-for-1: favor the side receiving the best STARTER unless the 2 assets are BOTH startable (not just bench depth).
- 3-for-1 (or more): require a CLEAR overpay to justify the roster churn and consolidation disadvantage.
- Depth-only packages should be DISCOUNTED unless they include multiple true weekly starters.`
      : N <= 10
      ? `Consolidation is LESS important in ${N}-team leagues: replacement level is elite and waiver depth is strong.
- 2-for-1: do NOT automatically favor the "1" side; depth is easy to replace.
- Picks generally carry less impact than in large leagues.`
      : `Consolidation matters, but not as strongly as 16+ team leagues.
- 2-for-1: mild preference to the "1" side if the "1" is a true weekly starter.
- 3-for-1: needs an obvious value edge to be fair.`

  return `
=== LEAGUE SIZE CONTEXT (NFL) ===
This trade is in a ${N}-team league.
League size band: ${sizeBand}

Core scarcity truths (MUST apply):
- As league size increases (14/16/20/24/32), replacement level gets worse and waivers are thinner.
- Reliable weekly starters gain value as league size increases.
- Depth-only packages lose relative value as league size increases.
- In smaller leagues (4–10), replacement level is elite, depth is easy, and consolidation is less important.

=== PICK TIER MATH (DO NOT USE 12-TEAM DEFAULTS) ===
Pick tiers are based on pickNumber / ${N} (percentiles), NOT assumptions.
Use these exact boundaries when labeling picks:

Top third (Early): picks 1–${earlyBound}
Middle third (Mid): picks ${earlyBound + 1}–${midBound}
Bottom third (Late): picks ${midBound + 1}–${N}

Per-round tier map (repeat this logic for every round):
- ${tierLine(1)}
- ${tierLine(2)}
- ${tierLine(3)}
- ${tierLine(4)}

Examples (how you should talk about picks):
- "1.${String(earlyBound).padStart(2, '0')}" is the LAST Early 1st in a ${N}-team league.
- "1.${String(midBound).padStart(2, '0')}" is the LAST Mid 1st in a ${N}-team league.
- If you see a pick like 1.${String(Math.min(N, 3)).padStart(2, '0')}, that is a VERY early 1st in this league.

=== GENERIC PICK HANDLING (WHEN pickNumber IS MISSING) ===
When a pick has NO pickNumber (labeled "Generic" or tier "Unknown"):
- Default it to MID value (assume an average slot).
- Do NOT assume Early or Late.
- Clearly state: "Pick position unknown → valued as mid-range."
- If both sides have generic picks, they generally offset; do NOT invent tier advantages.

=== POSITION SCARCITY ANCHORS (NFL) ===
${scarcityAnchors}

=== CONSOLIDATION / ROSTER-SPOT COST (MANDATORY) ===
${consolidationRule}

=== VERDICT WEIGHTING BY LEAGUE SIZE ===
- You MUST explicitly adjust your fairness interpretation based on ${N} teams.
- Apply scarcityMultiplier (provided in trade data) to GUARANTEED weekly starters when judging "fairness," not just raw sums.
- You must explain how league size changes the risk/reward of the trade (starter scarcity vs replaceable depth).

=== REQUIRED OUTPUT: LEAGUE SIZE IMPACT ===
You MUST include a "leagueSizeImpact" field in your response (NOT optional).
In that field, include 2–4 bullets that reference:
1) how ${N}-team scarcity impacted starter vs depth valuation,
2) how pick tiers (Early/Mid/Late) were interpreted using the exact boundaries above,
3) whether consolidation penalty influenced the verdict.
If league size had no material impact, explicitly say: "League size did not materially change the verdict" (do not omit the field).
`.trim()
}

function buildSystemPrompt(numTeams: number) {
  return `
You are the AllFantasy Trade Analyzer — an ELITE fantasy sports trade evaluator for dynasty, redraft, and keeper leagues. You analyze trades like a front office war room, not ESPN hot takes.

Return ONLY valid JSON, no markdown, no commentary.

=== YOUR ANALYSIS FRAMEWORK ===

1. LEAGUE CONTEXT FIRST
- Format matters: Dynasty (asset management) vs Redraft (points now) vs Keeper (hybrid)
- Scoring matters: PPR/Half/Standard, TEP, Superflex (QB premium), IDP
- Roster size and starting requirements affect player value

${buildLeagueSizePrompt(numTeams)}

2. TEAM DIRECTION ANALYSIS
Classify each team into ONE phase:
- CONTENDER: maximize weekly points, buy aging stars cheap, pay future picks for elite production
- MIDDLE: 50/50 on win-now vs future, must decide to push in or pivot out
- REBUILD: convert points into value, trade RBs aggressively, target picks and young WRs

3. ASSET TIER SYSTEM (Dynasty)
- Tier 0 (Franchise): Elite young QBs (SF), elite young WRs who are top-5 producers
- Tier 1 (Cornerstone): Top QBs with runway, WR1s age 22-27, elite TEs with target share
- Tier 2 (Win-Now Stars): High-end vets producing elite points, young WRs on brink of WR1, RBs that swing leagues (short shelf)
- Tier 3 (Strong Starters): Solid QB2s in SF, WR2s with stability, RB1/2 types, TE1 range
- Tier 4 (Flex/Value): Boom/bust WR3s, committee RBs, aging vets
- Tier 5 (Lottery): Handcuffs, rookies, ambiguous roles

Pick Tiers: Early 1st = cornerstone-level | Mid 1st = strong starter | Late 1st = volatile upside | 2nds = flexibility | 3rds+ = darts

4. PLAYER-SPECIFIC ANALYSIS (CRITICAL)
- RETIREMENT RISK: QBs 38+ (Rodgers, Brady-types) = 1-2 year window max. Flag as major risk.
- DEPTH CHART: Backup RBs (Allgeier, Mattison) have CAPPED upside. "A bad QB > good RB2" in SF.
- AGE CURVES: WRs peak 25-29, RBs decline after 26, QBs can last to 40+
- DEPRECIATING ASSETS: RBs lose value with time. Picks gain value as draft approaches.
- USE STATS: Reference actual stats from espnPlayerStats (YDS, TD, REC, etc.) to justify value.
- INJURY HISTORY: Flag players with recurring injury issues (ACL tears, hamstring problems, concussions). Consider: How many games missed last 2 seasons? Is this a chronic issue? Does their play style increase injury risk?
- INJURY RISK LEVELS: Low (rarely injured, durable), Moderate (1-2 significant injuries, some concerns), High (frequent injuries, soft tissue issues), Extreme (major injuries, currently injured, chronic problems)
- QB SITUATION: For skill positions, evaluate their team's QB: Elite (Mahomes, Allen) = +value boost, Average = neutral, Bad/Rookie = -value discount. A WR with bad QB is worth less.
- OFFENSIVE LINE: RBs behind elite O-lines (49ers, Eagles, Lions) get +value. RBs behind bad O-lines (Giants, Panthers) get -value. Same for short-yardage TEs.

4.5 REAL-TIME NEWS (HIGHEST PRIORITY - SUPERSEDES STATIC VALUES)
- CHECK realTimePlayerNews FIRST before using static values from FantasyCalc
- RELEASED/CUT players: If a player was released or cut, their value drops SIGNIFICANTLY. Mention this in your analysis!
- INJURY UPDATES: Recent injury news supersedes historical injury data
- BREAKOUT PERFORMANCES: Playoff surges or recent big games may not be reflected in static values yet
- DEPTH CHART CHANGES: Promotions/demotions from the last 7 days are critical
- If sentiment is "bearish" for a player, flag this as a concern
- If sentiment is "bullish" for a player, acknowledge their rising stock
- ALWAYS mention relevant breaking news in expertAnalysis and playerBreakdowns

5. DRAFT CAPITAL ANALYSIS
- DIMINISHING RETURNS: If team has 3 1sts already, marginal value of 4th 1st is lower
- PICK CONCENTRATION: 3+ picks in same round = less roster flexibility
- TIMELINE FIT: Picks matter more for rebuilders; contenders need startable players NOW
- PICK APPRECIATION: Distant picks are discounted; value increases as draft approaches

6. LINEUP DELTA (The Key Metric)
Calculate: (New best starting lineup points) - (Old best starting lineup points)
- Trading two bench guys for one starter is only a win if it changes who you start
- Consolidation (2-for-1) favors the team getting the best player IF that player starts

7. WIN-NOW vs FUTURE VALUE
- Win-Now Score: Weekly points in starting lineup × scarcity × (1 - risk)
- Future Value: 3-year weighted expected value × age curve
- Weight by team direction: Contender (80/20 win-now), Middle (50/50), Rebuild (20/80 future)

=== AI AS NEGOTIATOR - YOUR PERSONALITY ===

You are the Trade Lab AI Negotiator. You judge trades and explain leverage.
You identify emotional mistakes and flag them directly.
You're conversational and honest - speak TO the user, not AT them.

Use phrases like:
- "This trade helps you long-term but hurts your 2025 ceiling."
- "You're overpaying because you value RB certainty too much."
- "If you send this, expect a counter."
- "I know you love this player, but the value isn't there."
- "This is a textbook panic sell. Don't do it."

=== VERDICT TONES ===

Assign ONE verdict_tone based on trade quality:
- 🟢 SMART: Good value, fits team direction, well-timed
- ⚠️ RISKY: Could work but has significant downside potential
- 🔥 BOLD: High risk/reward, makes sense for the right team
- ❌ DONT_DO_THIS: Bad value, wrong direction, or emotional mistake

=== STRUCTURED DRIVER CONSTRAINT ===
SCORING FORMULA: Verdict = 40% Lineup Impact + 25% Replacement/Scarcity (VORP) + 20% Market Value + 15% Manager/League Behavior.
When structuredDriverData is present in the input:
1. Your expertAnalysis MUST reference the dominantDriver (e.g. "lineup impact", "replacement value (VORP)", "market consensus", "manager/league behavior").
2. You MUST explain the fairnessScore using ALL four sub-scores (lineupImpact, vorp, market, behavior).
3. You MUST mention material risk flags from the driver data.
4. You MUST NOT invent scoring dimensions not present in structuredDriverData.
5. If scoringMode is "market_proxy", you MUST NOT claim you analyzed actual lineup impact from roster data. Instead say the score is based on market-estimated starter likelihood.
6. If hasBehaviorData is false, do NOT reference manager strategy, team direction, or contender/rebuild alignment. The behavior score is neutral (0.5) when no manager context exists.
7. If hasBehaviorData is true, reference how the trade aligns (or doesn't) with each team's competitive window and positional needs.
8. Use the driverNarrative as a starting point but expand with your football knowledge.

=== OUTPUT FORMAT ===
{
  "grade": "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D" | "F",
  "verdict": "Fair" | "Slightly favors A" | "Slightly favors B" | "Strongly favors A" | "Strongly favors B",
  "verdict_tone": "SMART" | "RISKY" | "BOLD" | "DONT_DO_THIS",
  "verdict_emoji": "🟢" | "⚠️" | "🔥" | "❌",
  "verdict_message": string (conversational verdict like "This trade helps you long-term but hurts your 2025 ceiling."),
  "winProbabilityShift": number (-30 to +30, how much this helps Team A's championship odds),
  
  "teamAnalysis": {
    "teamAPhase": "Contender" | "Middle" | "Rebuild",
    "teamBPhase": "Contender" | "Middle" | "Rebuild",
    "teamAWindowStatus": "READY_TO_COMPETE" | "REBUILDING" | "OVEREXTENDED" | "AGING_CORE" | "DIRECTION_NEEDED",
    "teamBWindowStatus": "READY_TO_COMPETE" | "REBUILDING" | "OVEREXTENDED" | "AGING_CORE" | "DIRECTION_NEEDED",
    "teamAProblems": string[],
    "teamBProblems": string[]
  },
  
  "assetBreakdown": {
    "teamAReceives": [{ "asset": string, "tier": string, "outlook": string }],
    "teamBReceives": [{ "asset": string, "tier": string, "outlook": string }]
  },
  
  "lineupDelta": {
    "teamAChange": string,
    "teamBChange": string,
    "weeklyPointsImpactA": string,
    "weeklyPointsImpactB": string
  },
  
  "riskFlags": string[],
  
  "emotional_flags": string[] (flag emotional mistakes like "You're overpaying because you want certainty at RB" or "This looks like a panic sell after one bad week"),
  
  "expertAnalysis": string (conversational, like talking to the manager),
  
  "value_now_vs_future": {
    "immediate_impact": string (what happens to your 2025 ceiling),
    "future_impact": string (what happens to your 2026+ outlook)
  },
  
  "who_benefits_and_why": string (clear explanation of who wins and why),
  
  "whenThisBackfires": string[],
  
  "counterOffers": [
    {
      "description": string,
      "whyBetter": string
    }
  ],
  
  "negotiation_tip": string (advice like "If you send this, expect a counter asking for your 2nd rounder"),
  
  "tradePitch": string,
  
  "betterPartners": [
    {
      "managerUsername": string,
      "needs": string[],
      "proposedTrade": string,
      "whyBetter": string
    }
  ] (optional),
  
  "leagueSizeImpact": string[] (2–5 bullets describing how league size changes scarcity and why that shifts the verdict. Header: "League Size Impact (N teams)"),

  "detailedAnalysis": {
    "playerBreakdowns": [
      {
        "playerName": string,
        "position": string,
        "team": string,
        "injuryHistory": string (e.g., "Missed 8 games in 2024 with hamstring issues, ACL tear in 2022"),
        "injuryRisk": "Low" | "Moderate" | "High" | "Extreme",
        "situationalContext": string (depth chart, contract, role),
        "qbSituation": string (e.g., "Elite - Josh Allen", "Concerning - Rookie QB"),
        "offensiveLineRating": string (e.g., "Top 5 - Eagles", "Bottom 10 - Giants"),
        "valueReasoning": string (why this player is valued this way)
      }
    ],
    "leagueContextImpact": string (how this specific league's settings affect the trade),
    "scoringFormatImpact": string (how PPR/SF/TEP affects the trade),
    "rosterConstructionNotes": string (how each team's roster construction affects the trade)
  },
  
  "notes": string[]
}

=== AI AS COMMENTATOR - LEAGUE PULSE ===

You narrate league sentiment. You detect trends and create drama.
When analyzing trades, consider how the LEAGUE will react.

League Pulse Phrases:
- "Your league thinks you should rebuild."
- "Most managers think this trade was unfair."
- "The league is split on this one."
- "This move didn't go unnoticed."
- "Expect some side-eye in the group chat."
- "This is the kind of trade that starts arguments."

Output for league_pulse:
- league_reaction: How the league will perceive this trade
- controversy_level: "None" | "Mild" | "Spicy" | "Heated"
- chat_prediction: What will be said in the league group chat

=== UNIFIED AI VOICE (USE EVERYWHERE) ===

You are THE AllFantasy AI - one consistent personality across the entire platform.
You have memory. You have opinions. You're grounded in data but speak like a trusted advisor.

Signature Phrases (use naturally throughout):
- "Here's the uncomfortable truth…"
- "This helps you now, but costs you later."
- "You're closer than you think."
- "Don't confuse activity with progress."
- "I've seen this pattern before..."
- "This is the move that separates good managers from great ones."

The Goal:
After 10 minutes, users should feel: "This AI understands my team and my league better than my league mates do."

=== FANTASYCALC VALUES ARE AUTHORITATIVE ===
The calculatedTradeBalance contains pre-computed values from FantasyCalc (crowdsourced from ~1 million real fantasy trades). These values are your PRIMARY source of truth:

VALUE INTERPRETATION:
- sideAValue = total value Team A RECEIVES
- sideBValue = total value Team B RECEIVES
- difference = sideAValue - sideBValue (positive = favors A, negative = favors B)
- percentDiff = how lopsided the trade is

GRADING RULES (MANDATORY):
- percentDiff < 5%: Fair trade (C to B- range)
- percentDiff 5-10%: Slight edge (B to B+ range) 
- percentDiff 10-20%: Clear winner (B+ to A- range)
- percentDiff 20-30%: Strong advantage (A to A range)
- percentDiff > 30%: Smash win (A+ if you're winning, F if you're losing)

YOUR VERDICT MUST ALIGN WITH THE CALCULATED VALUES. You can adjust by ±1 grade level based on:
- Team needs and context (rebuilder getting picks is better than contender)
- Injury concerns or situation changes not reflected in values
- Roster fit and positional scarcity

But you CANNOT flip the verdict direction. If calculatedTradeBalance says "Favors A", your verdict cannot be "Favors B" unless you have VERY strong justification.

=== CRITICAL RULES ===
- Be SPECIFIC. Reference actual player names, stats, and situations.
- Use the ESPN stats and TheSportsDB data provided to make concrete points.
- Reference FantasyCalc values explicitly: "According to market values, Player X (7,500) is worth more than Player Y (5,200)."
- Grade like Sleeper: A+ is a smash win, C is fair, F is getting fleeced.
- "expertAnalysis" should read like elite fantasy analysis, not generic advice.
- "tradePitch" should be a message Team A could send to sell this trade to their league.
- When you have 3+ 1sts, trading one for positional stability is SMART, not overpay.
- Backup RBs on other teams are DEAD VALUE. Trade them before they depreciate further.
- Young QBs in Superflex > almost any RB in dynasty value.
- If players show as "Not found in FantasyCalc", treat them as low-value depth players (value ~200).

=== INTERNAL GATEKEEPER VALIDATION (RUN BEFORE OUTPUT) ===
Before outputting your final JSON, run an internal validation step using these Gatekeeper rules. If any rule fails, adjust your analysis or flag the issue:

HARD FAIL CONDITIONS (must flag or reject):
1. FAIRNESS BAND VIOLATIONS:
   - Standard trades: ratio must be 0.92-1.08
   - CORNERSTONE TRADES: The side GIVING UP the cornerstone must receive 1.10-1.25 ratio (10-25% premium)
   - If cornerstone seller receives less than 1.10 ratio → TRADE IS INVALID, flag as "CORNERSTONE_UNDERPAID"
2. Trade contains "balance filler" players with no clear purpose: Remove from recommendations or flag
3. CORNERSTONE VIOLATION: If a cornerstone (elite TE, SF QB, top-3 positional player) is being traded:
   - 1-for-1 trades ONLY valid if return is also a cornerstone
   - Non-cornerstone returns MUST include +15-25% premium with MEANINGFUL assets (early 1st, elite player)
   - Single mid-tier player for cornerstone = INSTANT REJECT, flag as "CORNERSTONE_UNDERVALUED"
   - Late picks + filler for cornerstone = INSTANT REJECT
4. Trade violates league settings (Superflex QB value ignored, TEP ignored): Adjust analysis
5. Neither team benefits or has believable acceptance narrative: Flag as "NO_CLEAR_WINNER"

CORNERSTONE EXAMPLES (these require premium or cornerstone-for-cornerstone):
- Elite TEs: Kelce, Andrews, Bowers, LaPorta (positional scarcity + ceiling)
- Elite SF QBs: Mahomes, Allen, Hurts, Stroud, Caleb Williams
- Top-3 at position with youth (Justin Jefferson, Ja'Marr Chase, Puka Nacua)

REALISM CHECK (CRITICAL - RUN BEFORE OUTPUT):
Ask yourself: "Would a real dynasty manager reasonably send this offer without being insulted?"
- If the answer is NO → Discard or restructure the trade
- Avoid trades that rely solely on abstract value differences without human market logic
- Real managers don't send: random depth pieces for starters, filler packages for elite players, "technically fair" trades that look insulting
- Real managers DO: overpay slightly for players they love, package depth + picks for consolidation, accept slight losses for roster fit

RED FLAGS that fail the realism check:
- "I'll give you my backup RB for your WR2" (insulting regardless of values)
- "3 bench players for your starter" (screams desperation/lowball)
- "Late 2nd for your young breakout player" (will never be accepted)
- Any trade where one side clearly loses and has no narrative for why they'd accept

SURPLUS CLAIMS (DO NOT FABRICATE):
Do NOT claim a team has a "surplus" at a position unless you can PROVE it from roster data:
- They must roster multiple startable or elite options at that position (e.g., 3 startable RBs when only 2 start)
- OR they are explicitly marked as rebuilding and liquidating positional advantage

INVALID surplus claims (do not use these justifications):
- "Team A has RB depth" when they only have 2 RBs and both start
- "Team B can afford to trade a WR" when they'd be left thin at the position
- Any surplus claim not backed by visible roster data

If surplus cannot be proven from the roster provided, do NOT reference it in your trade justification.
Instead, focus on: team direction, value exchange, positional upgrades, or strategic fit.

If a trade fails the realism check, either:
1. Restructure it to be something a human would actually consider
2. Flag it in riskFlags as "UNREALISTIC_OFFER" with explanation

REPAIR RULES (apply if close to failing):
- If fairness is close but fails, suggest smallest adjustment in counterOffers (swap bench asset, adjust pick tier)
- Never exceed 3 assets per side in any counter-offer
- Replace filler with purposeful depth (handcuff, position need) when suggesting alternatives

VALIDATION CHECKLIST (run mentally before output):
[ ] Are all players in this trade from the tradeable_assets lists?
[ ] Is the value ratio between 0.92-1.08 (or 0.90-1.10 for rebuilders)?
[ ] Does each side have a clear "why they accept" narrative?
[ ] Are cornerstones protected or properly compensated?
[ ] Are pick values accurate (early/mid/late, not generic "1st")?
[ ] No more than 3 assets per side in main analysis?
[ ] REALISM: Would a real manager send this without being insulted? (If no, restructure!)

If validation fails, mention specific issues in riskFlags or notes.

Do not mention "policy", do not mention tool names. Output JSON only.
`.trim()
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n)
  if (!Number.isFinite(x)) return fallback
  const xi = Math.floor(x)
  return Math.max(min, Math.min(max, xi))
}

type PickTier = 'early' | 'mid' | 'late'

function getPickTierByPercentile(pickNumber: number | null | undefined, numTeams: number): PickTier {
  if (!pickNumber || pickNumber < 1) return 'mid'
  const n = Math.max(4, Math.min(32, Math.floor(numTeams)))
  const pct = pickNumber / n
  if (pct <= 1 / 3) return 'early'
  if (pct <= 2 / 3) return 'mid'
  return 'late'
}

function formatPickTierLabel(round: number, tier: PickTier) {
  const r = `${round}${round === 1 ? 'st' : round === 2 ? 'nd' : round === 3 ? 'rd' : 'th'}`
  if (tier === 'early') return `Early ${r}`
  if (tier === 'mid') return `Mid ${r}`
  return `Late ${r}`
}

function getScarcityMultiplier(numTeams: number): number {
  const curve: [number, number][] = [
    [4, 0.92], [6, 0.95], [8, 0.97], [10, 0.98],
    [12, 1.00], [14, 1.06], [16, 1.12], [20, 1.22],
    [24, 1.32], [32, 1.50],
  ]
  if (numTeams <= curve[0][0]) return curve[0][1]
  if (numTeams >= curve[curve.length - 1][0]) return curve[curve.length - 1][1]
  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i]
    const [x1, y1] = curve[i + 1]
    if (numTeams >= x0 && numTeams <= x1) {
      const t = (numTeams - x0) / (x1 - x0)
      return Math.round((y0 + t * (y1 - y0)) * 100) / 100
    }
  }
  return 1.0
}


function buildPickContext(assets: TradeAsset[], numTeams: number) {
  return assets
    .filter(a => a.type === 'pick')
    .map(a => {
      const pick = (a as { type: 'pick'; pick: { year: number; round: 1 | 2 | 3 | 4; pickNumber?: number } }).pick
      const pn = pick.pickNumber ?? null
      const isGeneric = pn == null || pn < 1
      const tier: PickTier | 'generic' = isGeneric ? 'generic' : getPickTierByPercentile(pn, numTeams)
      const percentile = isGeneric ? 0.5 : Math.round((pn / numTeams) * 100) / 100
      const slotStr = pn != null && pn >= 1 ? `${pick.round}.${String(pn).padStart(2, '0')}` : null
      const displayLabel = isGeneric
        ? `${pick.year} Generic ${formatPickTierLabel(pick.round, 'mid').replace('Mid ', '')} (tier defaults to mid)`
        : `${pick.year} ${formatPickTierLabel(pick.round, tier as PickTier)} (${slotStr} of ${numTeams})`
      return {
        year: pick.year,
        round: pick.round,
        pickNumber: pn,
        tier,
        percentile,
        label: isGeneric ? formatPickTierLabel(pick.round, 'mid') : formatPickTierLabel(pick.round, tier as PickTier),
        displayLabel,
      }
    })
}

function applyScarcityToPlayerValue(base: number, tier: 'elite' | 'starter' | 'depth', scarcityMultiplier: number) {
  if (!Number.isFinite(base)) return base
  if (tier === 'elite') return Math.round(base * (1 + (scarcityMultiplier - 1) * 0.9))
  if (tier === 'starter') return Math.round(base * (1 + (scarcityMultiplier - 1) * 0.6))
  return Math.round(base * (1 + (scarcityMultiplier - 1) * 0.15))
}

function classifyPlayerTier(value: number, pos: string): 'elite' | 'starter' | 'depth' {
  const p = pos.toUpperCase()
  if (p === 'QB') return value >= 6000 ? 'elite' : value >= 3000 ? 'starter' : 'depth'
  if (p === 'RB') return value >= 5000 ? 'elite' : value >= 2500 ? 'starter' : 'depth'
  if (p === 'WR') return value >= 6000 ? 'elite' : value >= 3000 ? 'starter' : 'depth'
  if (p === 'TE') return value >= 5000 ? 'elite' : value >= 2000 ? 'starter' : 'depth'
  return value >= 3000 ? 'starter' : 'depth'
}

function convertToTierAssets(assets: TradeAsset[], numTeams: number): TierTradeAsset[] {
  return assets.map(asset => {
    if (asset.type === 'player') {
      return {
        name: asset.player.name,
        position: asset.player.pos,
        isPick: false,
      }
    } else if (asset.type === 'pick') {
      const year = asset.pick.year
      const round = asset.pick.round
      const pickNum = asset.pick.pickNumber
      const pickSlot = getPickTierByPercentile(pickNum, numTeams)
      
      return {
        name: `${year} Round ${round}${pickNum ? ` (${round}.${String(pickNum).padStart(2, '0')})` : ''}`,
        isPick: true,
        pickYear: year,
        pickRound: round,
        pickSlot,
      }
    }
    return { name: 'FAAB', isPick: false }
  })
}

function buildUserPrompt(args: {
  sport: Sport
  format: 'redraft' | 'dynasty' | 'specialty'
  leagueType: 'standard' | 'bestball'
  idpEnabled: boolean
  league?: SleeperLeague | null
  numTeams: number

  sideA: { username: string; displayName?: string; rosterId?: number | null; roster?: RosteredPlayer[]; summary?: any }
  sideB: { username: string; displayName?: string; rosterId?: number | null; roster?: RosteredPlayer[]; summary?: any }

  otherManagers?: Array<{ username: string; roster_id?: number; summary: any }> | null

  assetsA: TradeAsset[]
  assetsB: TradeAsset[]

  sportsDb?: any
  espnStats?: any
  fantasyCalcValues?: string
  tradeBalance?: {
    sideAValue: number
    sideBValue: number
    difference: number
    percentDiff: number
    verdict: string
    breakdown: any
    unknownPlayers?: string[]
  }
  tradeDriverData?: TradeDriverData
  
  tierEvaluation?: string
  playerNews?: Array<{ playerName: string; sentiment: string; news: string[]; buzz: string }>
  tradeGoal?: string | null
  runtimeConstraints?: string
  historicalContext?: {
    tradeDate: string;
    sideAContext: { players: any[]; picks: any[]; totalValueAtTrade: number };
    sideBContext: { players: any[]; picks: any[]; totalValueAtTrade: number };
    hindsightVerdict: string;
    hindsightScore: number;
  } | null
  managerDnaContext?: string
  unifiedPlayerContext?: string
  newsValueAdjustments?: NewsValueAdjustment[]
}) {
  const { sport, format, leagueType, idpEnabled, league, numTeams, sideA, sideB, otherManagers, assetsA, assetsB, sportsDb, espnStats, fantasyCalcValues, tradeBalance, tradeDriverData, tierEvaluation, playerNews, tradeGoal, runtimeConstraints, historicalContext, managerDnaContext, unifiedPlayerContext, newsValueAdjustments } = args

  // Parse league settings for AI
  const rosterPositions = league?.roster_positions || []
  const scoringSettings = league?.scoring_settings || {}
  const leagueSettings = league?.settings || {}
  const taxiSlots = leagueSettings.taxi_slots || 0
  const benchSlots = rosterPositions.filter((p: string) => p === 'BN').length
  const starterSlots = rosterPositions.filter((p: string) => p !== 'BN' && p !== 'IR').length
  const isSF = rosterPositions.filter((p: string) => p === 'SUPER_FLEX' || p === 'QB').length >= 2
  const tepBonus = scoringSettings.bonus_rec_te || 0
  const isTEP = tepBonus > 0
  const pprValue = scoringSettings.rec === 1 ? 'PPR' : scoringSettings.rec === 0.5 ? 'Half PPR' : 'Standard'
  
  const leagueInfo = league
    ? {
        league_id: league.league_id,
        name: league.name || null,
        season: league.season || null,
        status: league.status || null,
        parsed_settings: {
          num_teams: numTeams,
          scoring_format: pprValue,
          is_superflex: isSF,
          is_tep: isTEP,
          tep_bonus: tepBonus,
          starter_slots: starterSlots,
          bench_slots: benchSlots,
          taxi_slots: taxiSlots,
          positions: rosterPositions.filter((p: string) => p !== 'BN' && p !== 'IR'),
        },
        scoring_settings: league.scoring_settings || null,
        settings: league.settings || null,
      }
    : null

  const scarcityIndex = Math.min(2.0, Math.max(0.6, numTeams / 12))
  const scarcityMultiplier = getScarcityMultiplier(numTeams)
  const leagueSizeGuidance = numTeams >= 24
    ? `Ultra-deep league (${numTeams} teams). Scarcity multiplier: ${scarcityMultiplier}x. Waivers are nearly irrelevant. Secure starters (QB, RB, TE) are worth ${Math.round((scarcityMultiplier - 1) * 100)}% more than in a 12-team league. Value guaranteed roles far above upside depth.`
    : numTeams >= 16
      ? `Deep league (${numTeams} teams). Scarcity multiplier: ${scarcityMultiplier}x. Starters matter significantly more. QB and TE scarcity increase. Depth pieces lose relative value.`
      : numTeams >= 14
        ? `Above-average league (${numTeams} teams). Scarcity multiplier: ${scarcityMultiplier}x. Slight premium on locked-in starters.`
        : numTeams <= 8
          ? `Shallow league (${numTeams} teams). Scarcity multiplier: ${scarcityMultiplier}x. Replacement level is elite. Depth is easy. Consolidation is less important. Picks are less valuable.`
          : `Standard league depth (${numTeams} teams). Scarcity multiplier: ${scarcityMultiplier}x.`

  return JSON.stringify(
    {
      sport,
      format,
      leagueType,
      idpEnabled: sport === 'nfl' ? idpEnabled : false,
      tradeGoal: tradeGoal || null,
      leagueSize: numTeams,
      leagueSizeGuidance,
      scarcityIndex,
      scarcityMultiplier,
      scarcityNote: `ScarcityIndex=${scarcityIndex.toFixed(2)}, Multiplier=${scarcityMultiplier}x. In ${numTeams}-team leagues, secure starters (especially QB, RB1, TE1) are worth ${scarcityMultiplier}x their 12-team value. Higher means starters are more valuable and waiver replacement is weaker.`,
      league: leagueInfo,

      sideA: {
        username: sideA.username,
        displayName: sideA.displayName || sideA.username,
        rosterId: sideA.rosterId ?? null,
        rosterSummary: sideA.summary || null,
        currentRoster: (sideA.roster || []).slice(0, 50),
        receives: assetsA,
        givesAway: assetsB,
      },
      sideB: {
        username: sideB.username,
        displayName: sideB.displayName || sideB.username,
        rosterId: sideB.rosterId ?? null,
        rosterSummary: sideB.summary || null,
        currentRoster: (sideB.roster || []).slice(0, 50),
        receives: assetsB,
        givesAway: assetsA,
      },

      otherManagers: otherManagers || null,

      sportsDbContext: sportsDb || null,
      
      espnPlayerStats: espnStats || null,
      
      fantasyCalcMarketValues: fantasyCalcValues || null,
      
      historicalValueContext: historicalContext ? {
        note: 'HISTORICAL VALUE INTELLIGENCE: This data shows what players were worth AT THE TIME of historical trades, enabling accurate hindsight analysis. Use this to understand value trajectory.',
        dataRange: '6+ years of daily KeepTradeCut values (2020-present)',
        tradeDate: historicalContext.tradeDate,
        sideAValuesAtTrade: historicalContext.sideAContext.players.map(p => ({
          player: p.name,
          valueAtTrade: p.valueAtTrade,
          currentValue: p.currentValue,
          percentChange: p.percentChange,
          trend: p.trend
        })),
        sideBValuesAtTrade: historicalContext.sideBContext.players.map(p => ({
          player: p.name,
          valueAtTrade: p.valueAtTrade,
          currentValue: p.currentValue,
          percentChange: p.percentChange,
          trend: p.trend
        })),
        sideAPicksAtTrade: historicalContext.sideAContext.picks,
        sideBPicksAtTrade: historicalContext.sideBContext.picks,
        totalValueAtTrade: {
          sideA: historicalContext.sideAContext.totalValueAtTrade,
          sideB: historicalContext.sideBContext.totalValueAtTrade
        },
        hindsightVerdict: historicalContext.hindsightVerdict,
        hindsightScore: historicalContext.hindsightScore,
        guidance: `For HISTORICAL trades, use valueAtTrade to grade the trade AS IT WAS at the time. The currentValue and trend show how it aged. hindsightVerdict gives retrospective analysis.`
      } : null,
      
      realTimePlayerNews: playerNews && playerNews.length > 0 ? {
        critical_note: 'THIS REAL-TIME NEWS FROM X/TWITTER SUPERSEDES STATIC VALUES. Adjust analysis accordingly.',
        players: playerNews.filter(p => p.news.length > 0 || p.buzz).map(p => ({
          playerName: p.playerName,
          sentiment: p.sentiment,
          sentimentEmoji: p.sentiment === 'bullish' ? '📈' : p.sentiment === 'bearish' ? '📉' : p.sentiment === 'injury_concern' ? '🚑' : '➡️',
          recentNews: p.news.slice(0, 3),
          socialBuzz: p.buzz || null,
        })),
      } : null,
      
      calculatedTradeBalance: tradeBalance ? {
        sideAValue: tradeBalance.sideAValue,
        sideBValue: tradeBalance.sideBValue,
        difference: tradeBalance.difference,
        percentDiff: tradeBalance.percentDiff,
        verdict: tradeBalance.verdict,
        breakdown: tradeBalance.breakdown,
        unknownPlayers: tradeBalance.unknownPlayers || [],
        guidance: `AUTHORITATIVE VALUE CALCULATION (from FantasyCalc - ~1M real trades):
• Team A RECEIVES: ${tradeBalance.sideAValue} total value
• Team B RECEIVES: ${tradeBalance.sideBValue} total value
• Value Gap: ${Math.abs(tradeBalance.difference)} (${tradeBalance.percentDiff}% difference)
• Initial Verdict: ${tradeBalance.verdict}
${tradeBalance.unknownPlayers && tradeBalance.unknownPlayers.length > 0 ? `• WARNING: ${tradeBalance.unknownPlayers.length} players not found in FantasyCalc (treated as depth ~200 value each): ${tradeBalance.unknownPlayers.join(', ')}` : ''}

YOUR GRADE MUST ALIGN WITH THESE VALUES. Adjust ±1 level for context, but DO NOT flip the winner.`
      } : null,

      structuredDriverData: tradeDriverData ? {
        scoringMode: tradeDriverData.scoringMode,
        dominantDriver: tradeDriverData.dominantDriver,
        scores: {
          lineupImpact: Math.round(tradeDriverData.lineupImpactScore * 100) / 100,
          vorp: Math.round(tradeDriverData.vorpScore * 100) / 100,
          market: Math.round(tradeDriverData.marketScore * 100) / 100,
          behavior: Math.round(tradeDriverData.behaviorScore * 100) / 100,
        },
        hasBehaviorData: tradeDriverData.hasBehaviorData,
        derived: {
          totalScore: tradeDriverData.totalScore,
          fairnessDelta: tradeDriverData.fairnessDelta,
          acceptProbability: tradeDriverData.acceptProbability,
          confidenceScore: tradeDriverData.confidenceScore,
          confidenceRating: tradeDriverData.confidenceRating,
        },
        verdict: tradeDriverData.verdict,
        lean: tradeDriverData.lean,
        labels: tradeDriverData.labels,
        lineupDelta: tradeDriverData.lineupDelta ?? null,
        marketDeltaPct: tradeDriverData.marketDeltaPct,
        vorpDelta: tradeDriverData.vorpDelta,
        confidenceFactors: tradeDriverData.confidenceFactors,
        starterLikelihoodDelta: tradeDriverData.starterLikelihoodDelta,
        volatilityAdj: Math.round(tradeDriverData.volatilityAdj * 100) / 100,
        consolidationPenalty: tradeDriverData.consolidationPenalty,
        positionScarcity: tradeDriverData.positionScarcity,
        riskFlags: tradeDriverData.riskFlags,
        driverNarrative: tradeDriverData.driverNarrative,
        constraint: 'CRITICAL: Your expertAnalysis, playerBreakdowns, and verdict_message MUST reference these specific scoring drivers. The scoring architecture: Four core scores (LineupImpact, VORP, Market, Behavior) combine into TotalScore, FairnessDelta, AcceptProbability, and ConfidenceScore. Formula: 40% Lineup Impact + 25% VORP + 20% Market + 15% Behavior. LineupImpact uses best-lineup PPG simulation when roster data is available (see lineupDelta: deltaYou/deltaThem show PPG change for each side). VORP uses delta-based scoring: vorpDelta.vorpDeltaYou/vorpDeltaThem show weekly PPG above replacement gained/lost by each side, normalized via vorpScore = 0.50 + 0.20 * tanh((vorpDeltaYou - vorpDeltaThem) / 5). This naturally adjusts for TE premium, Superflex QB inflation, and deep bench formats. Explain WHY the trade scored as it did using the dominant driver, VORP delta (weekly PPG above replacement), market delta, behavior fit, lineup PPG delta, and risk flags. Do NOT invent scoring dimensions not present in this data. If scoringMode is "market_proxy", do NOT claim you evaluated lineup impact from actual rosters. If hasBehaviorData is false, do NOT reference manager strategy or team direction fit.',
      } : null,

      requirementNotes: [
        'CRITICAL: sideA.receives = what Team A GETS, sideA.givesAway = what Team A LOSES. Same for sideB.',
        'Analyze trade impact: Does Team A improve after receiving these assets and losing their assets?',
        'Analyze trade impact: Does Team B improve after receiving these assets and losing their assets?',
        'Consider position scarcity, roster holes, and team needs when evaluating trade impact.',
        'If league context is missing, base evaluation on general player/pick value heuristics.',
        'If league context is present, evaluate team needs from starters/bench/IR/taxi and scarcity.',
        'Always include NFL IDP in analysis when enabled.',
        'Include "leverage" suggestions to help Side A negotiate a small edge (~10% average).',
        'PLAYER CONTEXT: For each player involved, consider: (1) Age/retirement risk for veterans 35+, (2) Depth chart status - starters vs backups, (3) Injury history if known, (4) Contract/situation concerns.',
        'DRAFT CAPITAL: When picks are involved, analyze: (1) How many picks the receiving team already has in that round/year, (2) Diminishing returns of multiple same-round picks, (3) Overall draft capital balance after trade. Specific pick slots (like 1.08 or 2.01) indicate pick value - early picks (1.01-1.04) are premium, mid (1.05-1.08) are solid, late (1.09-1.12) are lesser.',
        'FLAG CONCERNS: Include risk_flags for: retirement candidates (Rodgers, Brady-types), backup RBs with limited upside, aging WRs, multiple picks to a team already loaded with picks.',
        'USE ESPN STATS: espnPlayerStats contains real stats (YDS, TD, REC, etc), age, experience years, injury status, and depth chart position. Use these to inform your analysis.',
        'USE THESPORTSDB: sportsDbContext contains birth date (for age calculation), position, team, and player bio/description. Cross-reference with ESPN data.',
        'USE FANTASYCALC: fantasyCalcMarketValues contains crowdsourced trade values from ~1 million real fantasy trades. Use these to assess market value and price each side of the trade. 30-day trends show rising/falling players.',
        'USE HISTORICAL VALUES: historicalValueContext (when present) contains what players were actually worth at the time of a historical trade. For past trades, this is CRITICAL - grade the trade based on valueAtTrade (what it looked like THEN), not currentValue. The hindsightVerdict shows how it aged. This enables accurate grading of trades from months/years ago.',
        'USE CALCULATED BALANCE: calculatedTradeBalance contains the pre-calculated value totals for each side based on FantasyCalc data. Use this as your primary value reference. The verdict field gives initial guidance, but you should adjust based on team context and needs.',
        'BESTBALL LEAGUES: When leagueType is "bestball", apply Bestball-specific valuation: (1) Boom/bust players with high ceilings are MORE valuable, (2) Depth and quantity matter more than consolidating into one elite player, (3) Handcuffs and injury insurance matter less, (4) Weekly floor is less important than weekly ceiling, (5) High-variance WRs and RBs who can score 25+ any week are premium assets.',
        tierEvaluation ? 'TIER EVALUATION (MANDATORY): The deterministic tier system has pre-evaluated this trade. You MUST follow the grade cap and warnings. Do NOT override the tier system verdict.' : '',
        tradeGoal ? `USER TRADE GOAL: The user has specified their goal as "${tradeGoal}". Evaluate the trade in the context of this goal. Does the trade help them achieve it? Be specific about how this trade aligns or conflicts with their stated objective.` : '',
        'CRITICAL - REAL-TIME NEWS: realTimePlayerNews contains LIVE news from X/Twitter (last 7 days). If a player was RELEASED, CUT, INJURED, or had a BREAKOUT PERFORMANCE, this MUST be reflected in your analysis. Real-time news SUPERSEDES static FantasyCalc values. Always mention relevant breaking news in your expertAnalysis and playerBreakdowns.',
        newsValueAdjustments && newsValueAdjustments.length > 0 ? `NEWS VALUE ADJUSTMENTS APPLIED: The trade balance numbers above ALREADY include news-based value adjustments. ${formatNewsAdjustmentsForPrompt(newsValueAdjustments)}` : '',
      ].filter(Boolean),
      
      runtimeConstraints: runtimeConstraints || null,
      
      tierEvaluation: tierEvaluation || null,

      managerDNA: managerDnaContext || null,

      verifiedPlayerData: unifiedPlayerContext || null,
    },
    null,
    2
  )
}


type TradeProviderAudit = {
  providers: {
    openai: string
    grok: string
    deterministicEngine: string
  }
  sourceCoverage: {
    fantasyCalcPlayers: number
    newsItems: number
    normalizedSignalCount: number | null
    sourceWeighting: string[]
    partialData: boolean
  }
  disagreements: string[]
}

function buildTradeIntelReconciliationDirective(audit: TradeProviderAudit): string {
  const weighting = audit.sourceCoverage.sourceWeighting.length
    ? audit.sourceCoverage.sourceWeighting.join(' | ')
    : 'none'
  const disagreements = audit.disagreements.length ? audit.disagreements.join(' | ') : 'none'

  return [
    '--- INTELLIGENCE RECONCILIATION PROTOCOL ---',
    `Provider roles: OpenAI=${audit.providers.openai}; Grok=${audit.providers.grok}; Deterministic=${audit.providers.deterministicEngine}.`,
    `Source coverage: fantasyCalcPlayers=${audit.sourceCoverage.fantasyCalcPlayers}; newsItems=${audit.sourceCoverage.newsItems}; normalizedSignals=${audit.sourceCoverage.normalizedSignalCount ?? 'unknown'}; partialData=${audit.sourceCoverage.partialData}.`,
    `Source weighting summary: ${weighting}.`,
    `Disagreement flags: ${disagreements}.`,
    'Decision rules: when deterministic + market + normalized intel align, increase conviction; when signals conflict, preserve verdict direction but reduce certainty and surface explicit risks/counter paths.',
    '--- END INTELLIGENCE RECONCILIATION PROTOCOL ---',
  ].join('\n')
}
export const POST = withApiUsage({ endpoint: "/api/legacy/trade/analyze", tool: "LegacyTradeAnalyze" })(async (request: NextRequest) => {
  try {
    const auth = requireAuthOrOrigin(request)
    if (!auth.authenticated) {
      return forbiddenResponse(auth.error || 'Unauthorized')
    }

    const body = await request.json()
    const parsedReq = TradeAnalyzeRequestSchema.safeParse(body)
    if (!parsedReq.success) {
      return NextResponse.json(
        { error: 'Invalid request format', details: parsedReq.error.errors },
        { status: 400 }
      )
    }

    const reqData = parsedReq.data

    const sport: Sport = 'nfl'
    const format = reqData.format
    const leagueType = reqData.leagueType || 'standard'
    const idpEnabled = Boolean(reqData.idpEnabled ?? true)

    const leagueId = String(reqData.league_id || '').trim()
    const userRosterId = reqData.user_roster_id != null ? Number(reqData.user_roster_id) : null
    const partnerRosterId = reqData.partner_roster_id != null ? Number(reqData.partner_roster_id) : null
    const sleeperA = String(reqData.sleeper_username_a || '').trim()
    const sleeperB = String(reqData.sleeper_username_b || '').trim()

    const clientLeagueContext = reqData.leagueContext
    const clientMarketContext = reqData.marketContext
    const clientNflContext = reqData.nflContext

    console.log('[TradeAnalyze] incoming roster ids', {
      leagueId,
      sleeperA,
      sleeperB,
      userRosterId,
      partnerRosterId,
    })

    const assetsARaw = (reqData.assetsA || []).map((a: any) => formatAsset(a)).filter(Boolean) as TradeAsset[]
    const assetsBRaw = (reqData.assetsB || []).map((a: any) => formatAsset(a)).filter(Boolean) as TradeAsset[]

    const leagueMode = !!leagueId && leagueId.length > 0

    if (leagueMode) {
      const boundary = await assertSleeperBoundaryForLeagueId(leagueId)
      if (!boundary.ok) {
        return NextResponse.json({ error: boundary.message }, { status: boundary.status })
      }
    }

    if (assetsARaw.length === 0 || assetsBRaw.length === 0) {
      return NextResponse.json(
        { error: 'Both sides must have at least one asset.' },
        { status: 400 }
      )
    }

    const CURRENT_YEAR = 2026
    const maxRound = sport === 'nfl' ? 4 : 2
    const maxPickNumber = sport === 'nfl' ? 32 : 30

    function validateSideAssets(assets: TradeAsset[], label: string) {
      const playerIds = new Set<string>()
      const pickKeys = new Set<string>()
      let faabCount = 0

      for (const a of assets) {
        if (a.type === 'player') {
          if (!a.player.id || a.player.id === '') {
            return `${label}: Every player must have a stable identifier (id).`
          }
          if (!a.player.name || a.player.name.length < 2) {
            return `${label}: Every player must have a valid name (2+ chars).`
          }
          if (playerIds.has(a.player.id)) {
            return `${label}: Duplicate player "${a.player.name}" (${a.player.id}).`
          }
          playerIds.add(a.player.id)
        }
        if (a.type === 'pick') {
          if (a.pick.round < 1 || a.pick.round > maxRound) {
            return `${label}: Pick round must be 1–${maxRound} for ${sport.toUpperCase()}.`
          }
          if (a.pick.year < CURRENT_YEAR || a.pick.year > CURRENT_YEAR + 3) {
            return `${label}: Pick year must be ${CURRENT_YEAR}–${CURRENT_YEAR + 3}.`
          }
          if (a.pick.pickNumber != null && (a.pick.pickNumber < 1 || a.pick.pickNumber > maxPickNumber)) {
            return `${label}: Pick number must be 1–${maxPickNumber} for ${sport.toUpperCase()}.`
          }
          const pKey = `${a.pick.year}-${a.pick.round}-${a.pick.pickNumber ?? 'generic'}`
          if (pickKeys.has(pKey)) {
            return `${label}: Duplicate pick ${a.pick.year} round ${a.pick.round}${a.pick.pickNumber ? ` #${a.pick.pickNumber}` : ''}.`
          }
          pickKeys.add(pKey)
        }
        if (a.type === 'faab') {
          faabCount++
          if (faabCount > 1) {
            return `${label}: At most 1 FAAB entry per side (merge amounts instead).`
          }
        }
      }
      return null
    }

    const errA = validateSideAssets(assetsARaw, 'Side A')
    if (errA) return NextResponse.json({ error: errA }, { status: 400 })
    const errB = validateSideAssets(assetsBRaw, 'Side B')
    if (errB) return NextResponse.json({ error: errB }, { status: 400 })

    // Client-provided rosters (already prepared by frontend)
    const clientRosterA = (reqData.rosterA || []) as RosteredPlayer[]
    const clientRosterB = (reqData.rosterB || []) as RosteredPlayer[]

    let resolvedUserRosterId = userRosterId
    let resolvedPartnerRosterId = partnerRosterId

    if (leagueMode && (!resolvedUserRosterId || !resolvedPartnerRosterId) && (sleeperA || sleeperB)) {
      try {
        const [rosters, users] = await Promise.all([
          getLeagueRosters(leagueId),
          getLeagueUsers(leagueId),
        ])
        if (Array.isArray(rosters) && Array.isArray(users) && rosters.length > 0 && users.length > 0) {
          const resolved = resolveRosterIdsFromLeague({
            userRosterId: resolvedUserRosterId,
            partnerRosterId: resolvedPartnerRosterId,
            users,
            rosters,
            sleeperA,
            sleeperB,
          })
          resolvedUserRosterId = resolved.userRosterId
          resolvedPartnerRosterId = resolved.partnerRosterId
        }
      } catch (e) {
        console.warn('[TradeAnalyze] Failed to resolve roster IDs from Sleeper:', e)
      }
    }

    if (leagueMode) {
      if (!resolvedUserRosterId || !resolvedPartnerRosterId) {
        return NextResponse.json(
          { error: 'League mode requires both user_roster_id and partner_roster_id.' },
          { status: 400 }
        )
      }
      if (resolvedUserRosterId === resolvedPartnerRosterId) {
        return NextResponse.json(
          { error: 'user_roster_id and partner_roster_id cannot be the same.' },
          { status: 400 }
        )
      }
      if (!sleeperA || !sleeperB) {
        return NextResponse.json(
          { error: 'League mode requires both Sleeper usernames.' },
          { status: 400 }
        )
      }
      if (!Array.isArray(clientRosterA) || clientRosterA.length === 0) {
        return NextResponse.json(
          { error: 'League mode requires a non-empty roster for Side A.' },
          { status: 400 }
        )
      }
      if (!Array.isArray(clientRosterB) || clientRosterB.length === 0) {
        return NextResponse.json(
          { error: 'League mode requires a non-empty roster for Side B.' },
          { status: 400 }
        )
      }

      const rosterAIds = new Set(clientRosterA.map((p) => p.id))
      const rosterBIds = new Set(clientRosterB.map((p) => p.id))

      for (const a of assetsARaw) {
        if (a.type === 'player' && a.player.id && !rosterAIds.has(a.player.id)) {
          return NextResponse.json(
            { error: `Side A asset "${a.player.name}" (${a.player.id}) not found on Side A roster.` },
            { status: 400 }
          )
        }
      }

      for (const a of assetsBRaw) {
        if (a.type === 'player' && a.player.id && !rosterBIds.has(a.player.id)) {
          return NextResponse.json(
            { error: `Side B asset "${a.player.name}" (${a.player.id}) not found on Side B roster.` },
            { status: 400 }
          )
        }
      }
    }

    const ip = getClientIp(request)

    let bucketKey = ''
    if (leagueMode && resolvedUserRosterId && resolvedPartnerRosterId) {
      const pair = [String(resolvedUserRosterId), String(resolvedPartnerRosterId)].sort()
      bucketKey = `trade:${leagueId}:rid:${pair[0]}:${pair[1]}`
    } else {
      const pair = [normalizeName(sleeperA), normalizeName(sleeperB)].sort()
      const leaguePart = leagueId ? `:${leagueId}` : ''
      bucketKey = `trade${leaguePart}:u:${pair[0]}:${pair[1]}`
    }
    console.log('[TradeAnalyze] rate bucketKey', bucketKey)

    // Layer A: Pair-level (ignores IP) — stops IP rotation bypass
    const rlPair = consumeRateLimit({
      scope: 'ai',
      action: 'trade_analyze_pair',
      sleeperUsername: bucketKey,
      ip,
      maxRequests: 10,
      windowMs: 60_000,
      includeIpInKey: false,
    })

    if (!rlPair.success) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Please try again later.',
          retryAfterSec: rlPair.retryAfterSec,
          remaining: rlPair.remaining,
          rate_limit: { layer: 'pair', key: rlPair.key, retryAfterSec: rlPair.retryAfterSec, remaining: rlPair.remaining },
        },
        { status: 429, headers: { 'Retry-After': String(rlPair.retryAfterSec) } }
      )
    }

    // Layer B: IP-level (includes IP) — stops one-IP hammering
    const rlIp = consumeRateLimit({
      scope: 'ai',
      action: 'trade_analyze_ip',
      sleeperUsername: bucketKey,
      ip,
      maxRequests: 25,
      windowMs: 60_000,
      includeIpInKey: true,
    })

    if (!rlIp.success) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Please try again later.',
          retryAfterSec: rlIp.retryAfterSec,
          remaining: rlIp.remaining,
          rate_limit: { layer: 'ip', key: rlIp.key, retryAfterSec: rlIp.retryAfterSec, remaining: rlIp.remaining },
        },
        { status: 429, headers: { 'Retry-After': String(rlIp.retryAfterSec) } }
      )
    }

    let league: SleeperLeague | null = null
    let users: SleeperUser[] | null = null
    let rosters: SleeperRoster[] | null = null

    let sideARoster: RosteredPlayer[] | null = null
    let sideBRoster: RosteredPlayer[] | null = null
    let otherManagers: Array<{ username: string; summary: any }> | null = null

    if (leagueId) {
      const [leagueData, usersData, rostersData] = await Promise.all([
        getLeagueInfo(leagueId),
        getLeagueUsers(leagueId),
        getLeagueRosters(leagueId),
      ])

      if (leagueData) league = leagueData as SleeperLeague
      if (Array.isArray(usersData)) users = usersData as SleeperUser[]
      if (Array.isArray(rostersData)) rosters = rostersData as SleeperRoster[]

      if (!users || !rosters) {
        users = null
        rosters = null
      } else {
        const dict = await getSleeperPlayers(sport)

        const findUser = (uname: string) => {
          const target = normalizeName(uname)
          return users!.find(
            (u) => normalizeName(u.display_name) === target || normalizeName(u.username) === target
          )
        }

        const rosterById = new Map<number, SleeperRoster>()
        for (const r of rosters) rosterById.set(Number(r.roster_id), r)

        const rosterAById =
          resolvedUserRosterId != null && Number.isFinite(resolvedUserRosterId) ? rosterById.get(resolvedUserRosterId) : null
        const rosterBById =
          resolvedPartnerRosterId != null && Number.isFinite(resolvedPartnerRosterId) ? rosterById.get(resolvedPartnerRosterId) : null

        if (rosterAById) sideARoster = shapeRosteredPlayers({ sport, roster: rosterAById, dict })
        if (rosterBById) sideBRoster = shapeRosteredPlayers({ sport, roster: rosterBById, dict })

        if (!sideARoster) {
          const userA = findUser(sleeperA)
          if (userA?.user_id) {
            const r = rosters.find((x) => String(x.owner_id || '') === String(userA.user_id))
            if (r) sideARoster = shapeRosteredPlayers({ sport, roster: r, dict })
          }
        }

        if (!sideBRoster) {
          const userB = findUser(sleeperB)
          if (userB?.user_id) {
            const r = rosters.find((x) => String(x.owner_id || '') === String(userB.user_id))
            if (r) sideBRoster = shapeRosteredPlayers({ sport, roster: r, dict })
          }
        }

        const excludeRosterIds = new Set<number>()
        if (resolvedUserRosterId != null && Number.isFinite(resolvedUserRosterId)) excludeRosterIds.add(resolvedUserRosterId)
        if (resolvedPartnerRosterId != null && Number.isFinite(resolvedPartnerRosterId)) excludeRosterIds.add(resolvedPartnerRosterId)

        otherManagers = users
          .map((u) => {
            const uname = (u.display_name || u.username || '').trim()
            if (!uname) return null
            const r = rosters!.find((x) => String(x.owner_id || '') === String(u.user_id))
            if (!r) return null
            if (excludeRosterIds.size > 0 && excludeRosterIds.has(Number(r.roster_id))) return null

            const shaped = shapeRosteredPlayers({ sport, roster: r, dict })
            const summary = summarizeRoster(shaped)
            return { username: uname, summary }
          })
          .filter(Boolean) as Array<{ username: string; summary: any }>

        if (excludeRosterIds.size === 0) {
          otherManagers = otherManagers
            .filter(
              (m) =>
                normalizeName(m.username) !== normalizeName(sleeperA) &&
                normalizeName(m.username) !== normalizeName(sleeperB)
            )
        }

        otherManagers = otherManagers.slice(0, 11)
      }
    }

    console.log('[Trade] roster resolution', {
      leagueId,
      sleeperA,
      sleeperB,
      userRosterId: resolvedUserRosterId,
      partnerRosterId: resolvedPartnerRosterId,
      sideARosterPlayers: sideARoster?.length ?? 0,
      sideBRosterPlayers: sideBRoster?.length ?? 0,
    })

    let canonicalA = sleeperA
    let canonicalB = sleeperB
    if (users && rosters) {
      const rosterById = new Map<number, SleeperRoster>()
      for (const r of rosters) rosterById.set(Number(r.roster_id), r)

      if (resolvedUserRosterId != null) {
        const rA = rosterById.get(resolvedUserRosterId)
        if (rA?.owner_id) {
          const uA = users.find((u) => u.user_id === rA.owner_id)
          if (uA?.username) canonicalA = uA.username
        }
      }
      if (resolvedPartnerRosterId != null) {
        const rB = rosterById.get(resolvedPartnerRosterId)
        if (rB?.owner_id) {
          const uB = users.find((u) => u.user_id === rB.owner_id)
          if (uB?.username) canonicalB = uB.username
        }
      }
      console.log('[TradeAnalyze] canonical usernames', {
        original: { sleeperA, sleeperB },
        canonical: { canonicalA, canonicalB },
        rosterIds: { userRosterId: resolvedUserRosterId, partnerRosterId: resolvedPartnerRosterId },
      })
    }

    // Prefer client-provided rosters, fallback to API-fetched rosters
    const finalRosterA = clientRosterA.length > 0 ? clientRosterA : sideARoster
    const finalRosterB = clientRosterB.length > 0 ? clientRosterB : sideBRoster
    
    const summaryA = finalRosterA ? summarizeRoster(finalRosterA) : null
    const summaryB = finalRosterB ? summarizeRoster(finalRosterB) : null

    const involvedNames = [
      ...assetsARaw.filter((a) => a.type === 'player').map((a: any) => a.player?.name).filter(Boolean),
      ...assetsBRaw.filter((a) => a.type === 'player').map((a: any) => a.player?.name).filter(Boolean),
    ] as string[]

    const leagueNumTeamsFromSettings = typeof league?.settings?.num_teams === 'number' ? league.settings.num_teams : null
    const leagueNumTeamsFromRosters = rosters && Array.isArray(rosters) && rosters.length >= 4 ? rosters.length : null
    const leagueNumTeamsFromSleeper = leagueNumTeamsFromRosters ?? leagueNumTeamsFromSettings
    const reqNumTeams = reqData.numTeams != null ? Number(reqData.numTeams) : null
    let leagueSizeMismatchWarning: string | null = null
    let numTeams: number
    if (leagueMode && leagueNumTeamsFromSleeper != null) {
      numTeams = clampInt(leagueNumTeamsFromSleeper, 4, 32, 12)
      if (reqNumTeams != null && reqNumTeams !== numTeams) {
        leagueSizeMismatchWarning = `Client sent numTeams=${reqNumTeams} but Sleeper reports ${numTeams}. Using Sleeper value.`
        console.warn('[TradeAnalyze] league size mismatch:', leagueSizeMismatchWarning)
      }
    } else {
      numTeams = clampInt(leagueNumTeamsFromSleeper ?? reqNumTeams, 4, 32, 12)
    }
    console.log('[TradeAnalyze] unified numTeams:', { leagueNumTeamsFromSettings, leagueNumTeamsFromRosters, reqNumTeams, numTeams, leagueMode })

    function applyPickNumberInference(
      assets: TradeAsset[],
      sideLabel: string,
      nTeams: number
    ): PickInferenceResult {
      const notes: string[] = []

      const canInfer = Number.isFinite(nTeams) && nTeams >= 2

      const out = assets.map((a, idx) => {
        if (a.type !== 'pick') return a

        const pk = a.pick || ({} as any)

        if (pk.pickNumber != null) {
          const pn = Number(pk.pickNumber)
          const pnOk = Number.isFinite(pn) && Math.floor(pn) === pn && pn >= 1 && (!canInfer || pn <= nTeams)

          if (!pnOk) {
            notes.push(
              `${sideLabel} pick[${idx}] ${pk.year} R${pk.round}: invalid pickNumber=${pk.pickNumber} → removed (Generic/infer)`
            )
            const cleanedPick = { ...pk }
            delete (cleanedPick as any).pickNumber
            return { ...a, pick: cleanedPick }
          }

          if (pk.originalRosterId != null) {
            const rid = Number(pk.originalRosterId)
            if (Number.isFinite(rid) && Math.floor(rid) === rid && rid >= 1 && rid !== pn) {
              notes.push(
                `${sideLabel} pick[${idx}] ${pk.year} R${pk.round}: pickNumber=${pn} wins over originalRosterId=${pk.originalRosterId}`
              )
            }
          }

          return { ...a, pick: { ...pk, pickNumber: pn } }
        }

        if (!canInfer) {
          if (pk.originalRosterId != null) {
            notes.push(
              `${sideLabel} pick[${idx}] ${pk.year} R${pk.round}: numTeams invalid (${nTeams}) → cannot infer from originalRosterId=${pk.originalRosterId} (Generic)`
            )
          }
          return a
        }

        const slotHint = pk.originalRosterId
        if (slotHint == null) return a

        const inferred = inferPickNumberFromSlot(slotHint, nTeams)
        if (inferred == null) {
          notes.push(
            `${sideLabel} pick[${idx}] ${pk.year} R${pk.round}: originalRosterId=${slotHint} out of range [1..${nTeams}] → Generic`
          )
          return a
        }

        notes.push(
          `${sideLabel} pick[${idx}] ${pk.year} R${pk.round}: inferred pickNumber=${inferred} from originalRosterId=${slotHint}`
        )

        return { ...a, pick: { ...pk, pickNumber: inferred } }
      })

      return { assets: out, notes }
    }

    const infA = applyPickNumberInference(assetsARaw, 'SideA', numTeams)
    const infB = applyPickNumberInference(assetsBRaw, 'SideB', numTeams)

    const assetsA = infA.assets
    const assetsB = infB.assets

    const pickInferenceNotes = [...infA.notes, ...infB.notes]
    if (pickInferenceNotes.length > 0) {
      console.log('[TradeAnalyze] pick inference notes:', pickInferenceNotes)
    }

    const rosterPositions = league?.roster_positions || []
    const isSFForCalc = clientLeagueContext?.settings?.qbFormat === 'superflex' || clientLeagueContext?.settings?.qbFormat === '2qb' || detectSFFromRosterPositions(rosterPositions)
    const leaguePpr = clientLeagueContext?.settings?.ppr ?? (league?.scoring_settings?.rec === 1 ? 1 : (league?.scoring_settings?.rec === 0.5 ? 0.5 : 0))
    const calcSettings: FantasyCalcSettings = {
      isDynasty: format === 'dynasty',
      numQbs: isSFForCalc ? 2 : 1,
      numTeams,
      ppr: leaguePpr as 0 | 0.5 | 1,
    }

    // Fetch player context from TheSportsDB, ESPN, FantasyCalc, and real-time news in parallel
    const [sportsDb, espnStats, fantasyCalcMap, playerNews] = await Promise.all([
      lookupSportsDbPlayers({ sport, names: involvedNames }),
      lookupEspnPlayerStats({ sport, names: involvedNames }),
      sport === 'nfl' ? getPlayerValuesForNames(involvedNames, calcSettings) : Promise.resolve(new Map()),
      fetchPlayerNewsFromGrok(involvedNames, sport).catch((err) => {
        console.error('Player news fetch failed:', err);
        return [] as Array<{ playerName: string; sentiment: string; news: string[]; buzz: string }>;
      }),
    ])

    const grokDeltaEvents = normalizeGrokSignalsToDeltaEvents(playerNews || [])
    const grokDeltaCacheWrites = await persistGrokDeltaEvents(grokDeltaEvents).catch(() => 0)
    
    let newsValueAdjustments: NewsValueAdjustment[] = []
    let newsAdjustedCalcMap = fantasyCalcMap
    if (sport === 'nfl' && fantasyCalcMap.size > 0 && playerNews && playerNews.length > 0) {
      newsValueAdjustments = computeNewsValueAdjustments(
        playerNews as PlayerNewsData[],
        fantasyCalcMap as Map<string, { value: number }>
      )
      const { adjustedMap, appliedCount } = applyNewsAdjustmentsToValueMap(
        fantasyCalcMap as Map<string, { value: number }>,
        newsValueAdjustments
      )
      if (appliedCount > 0) {
        newsAdjustedCalcMap = adjustedMap
        console.log('[Trade] Applied news-based value adjustments:', newsValueAdjustments.filter(a => a.severity !== 'none').map(a => ({
          player: a.playerName,
          original: a.originalValue,
          adjusted: a.adjustedValue,
          reason: a.reason,
        })))
      }
    }

    const fantasyCalcValues = sport === 'nfl' && newsAdjustedCalcMap.size > 0
      ? formatValuesForPrompt(newsAdjustedCalcMap, involvedNames)
      : undefined

    let unifiedPlayerContext = ''
    if (sport === 'nfl' && involvedNames.length > 0) {
      try {
        const unifiedLookups = involvedNames.map(name => {
          const matchingAsset = [...assetsA, ...assetsB].find(
            (a: any) => a.type === 'player' && a.player?.name === name
          ) as any
          return {
            name,
            position: matchingAsset?.player?.pos,
            team: matchingAsset?.player?.team ? normalizeTeamAbbrev(matchingAsset.player.team) || undefined : undefined,
          }
        })
        const unifiedMap = await lookupByNames(unifiedLookups)
        const enrichedPlayers: UnifiedPlayer[] = []
        for (const [, player] of unifiedMap) {
          enrichedPlayers.push(await enrichWithValuation(player))
        }
        if (enrichedPlayers.length > 0) {
          unifiedPlayerContext = buildPlayerContextForAI(enrichedPlayers)
        }
      } catch (err) {
        console.error('[Trade] Unified player context failed (non-fatal):', err)
      }
    }

    // Calculate trade balance using NEWS-ADJUSTED FantasyCalc values
    // IMPORTANT: assetsA = what Team A RECEIVES from B, assetsB = what Team A GIVES to B (what B receives)
    let tradeBalance: ReturnType<typeof calculateTradeBalance> | undefined = undefined
    if (sport === 'nfl' && newsAdjustedCalcMap.size > 0) {
      // What Team A RECEIVES (from assetsA)
      const sideAReceivesPlayers = assetsA.filter(a => a.type === 'player').map((a: any) => a.player?.name).filter(Boolean) as string[]
      const sideAReceivesPicks = assetsA.filter(a => a.type === 'pick').map((a: any) => ({ year: a.pick.year, round: a.pick.round, pickNumber: a.pick.pickNumber }))
      
      // What Team B RECEIVES (from assetsB = what A gives away)
      const sideBReceivesPlayers = assetsB.filter(a => a.type === 'player').map((a: any) => a.player?.name).filter(Boolean) as string[]
      const sideBReceivesPicks = assetsB.filter(a => a.type === 'pick').map((a: any) => ({ year: a.pick.year, round: a.pick.round, pickNumber: a.pick.pickNumber }))
      
      tradeBalance = calculateTradeBalance(
        newsAdjustedCalcMap,
        sideAReceivesPlayers,  // Players that Team A RECEIVES
        sideBReceivesPlayers,  // Players that Team B RECEIVES (= what A gives)
        sideAReceivesPicks,    // Picks that Team A RECEIVES
        sideBReceivesPicks,    // Picks that Team B RECEIVES (= what A gives)
        format === 'dynasty',
        numTeams || clientLeagueContext?.numTeams || 12
      )

      const scarcityMult = getScarcityMultiplier(numTeams)

      if (scarcityMult !== 1.0) {
        const adjustSide = (players: { name: string; value: number; found: boolean }[]) => {
          let boost = 0
          for (const p of players) {
            if (!p.found || p.value <= 200) continue
            const lookup = newsAdjustedCalcMap.get(p.name.toLowerCase())
            const pos = (lookup as any)?.position?.toUpperCase() || ''
            const playerTier = classifyPlayerTier(p.value, pos)
            const adjusted = applyScarcityToPlayerValue(p.value, playerTier, scarcityMult)
            boost += adjusted - p.value
            p.value = adjusted
          }
          return boost
        }
        const boostA = adjustSide(tradeBalance.breakdown.sideA.players)
        const boostB = adjustSide(tradeBalance.breakdown.sideB.players)
        tradeBalance.breakdown.sideA.total += boostA
        tradeBalance.breakdown.sideB.total += boostB
        tradeBalance.sideAValue += boostA
        tradeBalance.sideBValue += boostB
        tradeBalance.difference = tradeBalance.sideAValue - tradeBalance.sideBValue
        const maxVal = Math.max(tradeBalance.sideAValue, tradeBalance.sideBValue, 1)
        tradeBalance.percentDiff = Math.round(Math.abs(tradeBalance.difference) / maxVal * 100)
        if (tradeBalance.percentDiff >= 25) {
          tradeBalance.verdict = tradeBalance.difference > 0 ? 'Strongly favors A' : 'Strongly favors B'
        } else if (tradeBalance.percentDiff >= 10) {
          tradeBalance.verdict = tradeBalance.difference > 0 ? 'Slightly favors A' : 'Slightly favors B'
        } else {
          tradeBalance.verdict = 'Fair'
        }
      }

      console.log('[Trade] Calculated balance:', {
        teamAReceives: tradeBalance.sideAValue,
        teamBReceives: tradeBalance.sideBValue,
        diff: tradeBalance.difference,
        verdict: tradeBalance.verdict,
        scarcityMult,
      })
    }

    // Deterministic tier evaluation (Dynasty NFL only)
    let tierEvaluationStr: string | undefined = undefined
    if (format === 'dynasty' && sport === 'nfl') {
      const tierAssetsA = convertToTierAssets(assetsA, numTeams)
      const tierAssetsB = convertToTierAssets(assetsB, numTeams)
      
      const tierRosterPositions = league?.roster_positions || []
      const isSF = clientLeagueContext?.settings?.qbFormat === 'superflex' || clientLeagueContext?.settings?.qbFormat === '2qb' || detectSFFromRosterPositions(tierRosterPositions) || true
      const idpStarterCount = detectIDPFromRosterPositions(tierRosterPositions)
      const isTEP = clientLeagueContext?.settings?.tep?.enabled ?? (league?.scoring_settings?.bonus_rec_te ? league.scoring_settings.bonus_rec_te > 0 : false)
      
      const leagueSettings: LeagueSettings = {
        isSF,
        isTEP,
        idpStarterCount,
      }
      
      const tierEvaluation = evaluateTrade(
        tierAssetsA, // What A gives to B
        tierAssetsB, // What B gives to A
        leagueSettings,
        'middle',
        'middle'
      )
      tierEvaluationStr = formatEvaluationForAI(tierEvaluation)
    }

    // Build runtime constraints for trade validation
    const rosterAForConstraints = (finalRosterA || clientRosterA || []).map((p: any) => ({
      name: p.name || p.full_name || '',
      pos: p.pos || p.position || '',
      slot: p.slot || 'Bench',
      isStarter: p.slot === 'Starter' || (!p.slot && p.isStarter),
      isInjured: p.slot === 'IR' || p.isInjured
    }))
    const rosterBForConstraints = (finalRosterB || clientRosterB || []).map((p: any) => ({
      name: p.name || p.full_name || '',
      pos: p.pos || p.position || '',
      slot: p.slot || 'Bench',
      isStarter: p.slot === 'Starter' || (!p.slot && p.isStarter),
      isInjured: p.slot === 'IR' || p.isInjured
    }))
    
    // Build player value map for cornerstone identification
    const playerValueMap: Record<string, number> = {}
    if (tradeBalance?.breakdown) {
      const addToMap = (items: any[]) => {
        items?.forEach((item: any) => {
          if (item.name && item.value) {
            playerValueMap[item.name.toLowerCase()] = item.value
          }
        })
      }
      addToMap(tradeBalance.breakdown.sideA?.players || [])
      addToMap(tradeBalance.breakdown.sideB?.players || [])
    }
    
    const runtimeConstraintsObj = buildRuntimeConstraints(
      rosterAForConstraints,
      rosterBForConstraints,
      playerValueMap
    )
    const constraintsPromptStr = formatConstraintsForPrompt(runtimeConstraintsObj)

    // Build historical context if trade date is provided (for grading historical trades)
    let historicalContext: {
      tradeDate: string;
      sideAContext: { players: any[]; picks: any[]; totalValueAtTrade: number };
      sideBContext: { players: any[]; picks: any[]; totalValueAtTrade: number };
      hindsightVerdict: string;
      hindsightScore: number;
    } | null = null
    
    if (reqData.tradeDate && sport === 'nfl') {
      try {
        const sideAPlayerNames = assetsA.filter((a: any) => a.type === 'player').map((a: any) => a.player?.name).filter(Boolean) as string[]
        const sideBPlayerNames = assetsB.filter((a: any) => a.type === 'player').map((a: any) => a.player?.name).filter(Boolean) as string[]
        const sideAPicks = assetsA.filter((a: any) => a.type === 'pick').map((a: any) => ({
          year: a.pick.year,
          round: a.pick.round,
          tier: 'mid' as const
        }))
        const sideBPicks = assetsB.filter((a: any) => a.type === 'pick').map((a: any) => ({
          year: a.pick.year,
          round: a.pick.round,
          tier: 'mid' as const
        }))
        
        const isSF = detectSFFromRosterPositions(league?.roster_positions || [])
        historicalContext = buildHistoricalTradeContext({
          date: reqData.tradeDate,
          sideAPlayers: sideAPlayerNames,
          sideBPlayers: sideBPlayerNames,
          sideAPicks,
          sideBPicks,
        }, isSF)
        
        console.log('[Trade] Historical context built for date:', reqData.tradeDate, {
          sideATotal: historicalContext.sideAContext.totalValueAtTrade,
          sideBTotal: historicalContext.sideBContext.totalValueAtTrade,
          hindsight: historicalContext.hindsightVerdict
        })
      } catch (err) {
        console.error('[Trade] Failed to build historical context:', err)
      }
    }

    let managerDnaContext = '';
    if (canonicalA) {
      try {
        const dna = await getCachedDNA(canonicalA);
        if (dna) {
          managerDnaContext = formatDNAForPrompt(dna);
        }
      } catch {}
    }

    const userADisplay = users?.find((u: any) => (u?.username || '').toLowerCase() === canonicalA.toLowerCase())
    const userBDisplay = users?.find((u: any) => (u?.username || '').toLowerCase() === canonicalB.toLowerCase())

    const tradeDriverAssets = (tradeAssets: any[], side: 'give' | 'receive'): Asset[] => {
      return tradeAssets.map((a: any) => {
        if (a.type === 'player') {
          const fcLookup = fantasyCalcMap.get((a.player?.name || '').toLowerCase())
          return {
            id: a.player?.name || '',
            type: 'PLAYER' as const,
            value: fcLookup?.value || 0,
            marketValue: fcLookup?.value || 0,
            name: a.player?.name,
            pos: a.player?.position || a.player?.pos,
            age: a.player?.age,
          }
        }
        const effectiveNumTeams = numTeams || clientLeagueContext?.numTeams || (league as any)?.total_rosters || 12
        return {
          id: `${a.pick?.year}_${a.pick?.round}`,
          type: 'PICK' as const,
          value: getPickValue(a.pick?.year, a.pick?.round, format === 'dynasty', a.pick?.pickNumber || undefined, effectiveNumTeams),
          marketValue: getPickValue(a.pick?.year, a.pick?.round, format === 'dynasty', a.pick?.pickNumber || undefined, effectiveNumTeams),
          round: a.pick?.round,
          pickSeason: a.pick?.year,
        }
      })
    }

    const giveDriverAssets = tradeDriverAssets(assetsB, 'give')
    const receiveDriverAssets = tradeDriverAssets(assetsA, 'receive')
    const rosterPositionsForSF = league?.roster_positions || []
    const isSFForDrivers = clientLeagueContext?.settings?.qbFormat === 'superflex' || clientLeagueContext?.settings?.qbFormat === '2qb' || rosterPositionsForSF.filter((p: string) => p === 'SUPER_FLEX' || p === 'QB').length >= 2
    const isTEPForDrivers = clientLeagueContext?.settings?.tep?.enabled ?? ((league?.scoring_settings?.bonus_rec_te || 0) > 0)

    const rosterToAssets = (roster: any[]): Asset[] => {
      if (!roster || roster.length === 0) return []
      return roster.map((p: any) => {
        const name = (p.name || p.full_name || '').toLowerCase()
        const fcLookup = fantasyCalcMap.get(name)
        return {
          id: p.id || p.player_id || name,
          type: 'PLAYER' as const,
          value: fcLookup?.value || 0,
          marketValue: fcLookup?.value || 0,
          name: p.name || p.full_name || '',
          pos: p.pos || p.position || '',
          age: p.age,
        }
      }).filter((a: Asset) => a.pos && a.name)
    }

    const yourRosterAssets = rosterToAssets(finalRosterA || [])
    const theirRosterAssets = rosterToAssets(finalRosterB || [])
    const rosterCtx = yourRosterAssets.length > 0 && rosterPositionsForSF.length > 0
      ? { yourRoster: yourRosterAssets, theirRoster: theirRosterAssets, rosterPositions: rosterPositionsForSF }
      : undefined

    const calWeights = await getCalibratedWeights()
    const tradeDriverData = computeTradeDrivers(giveDriverAssets, receiveDriverAssets, null, null, isSFForDrivers, isTEPForDrivers, rosterCtx, undefined, undefined, undefined, undefined, calWeights)

    let devyAcceptDelta = 0
    const allTradeAssets = [...(assetsA || []), ...(assetsB || [])]
    for (const asset of allTradeAssets) {
      if (asset.type === 'player') {
        try {
          const devyPlayer = await (prisma as any).player.findFirst({
            where: {
              name: asset.player.name,
              league: 'NCAA',
              devyEligible: true,
              graduatedToNFL: false,
            },
          })

          const projection = devyPlayer ? computeDraftProjectionScore(devyPlayer) : null
          // Null means not one signal backed a projection for him. Skipping the
          // devy adjustment entirely is the honest response: the alternative is
          // pricing a trade off a score we did not earn.
          if (devyPlayer && projection != null) {
            ;(asset.player as any).draftProjectionScore = projection
            ;(asset.player as any).adjustedValue =
              projection * 0.8 + (devyPlayer.devyAdp ?? 50) * 0.2

            const teamPhase = clientLeagueContext?.phase
            const teamDirection = teamPhase === 'Contender' ? 'CONTEND' : teamPhase === 'Rebuild' ? 'REBUILD' : ''
            if (teamDirection) {
              ;(asset.player as any).adjustedValue = applyTeamDirectionAdjustment(
                (asset.player as any).adjustedValue,
                teamDirection
              )
            }

            const delta = devyAcceptanceAdjustment(
              { ...devyPlayer, draftProjectionScore: projection },
              null
            )
            if (Math.abs(delta) > Math.abs(devyAcceptDelta)) {
              devyAcceptDelta = delta
            }
          }
        } catch {}
      }
    }

    if (devyAcceptDelta !== 0 && tradeDriverData) {
      ;(tradeDriverData as any).acceptProbability = Math.max(0, Math.min(1,
        (tradeDriverData.acceptProbability ?? 0.5) + devyAcceptDelta
      ))
    }

    const intelPlayerNames = [...assetsA, ...assetsB]
      .filter((a: any) => a.type === 'player' && a.player?.name)
      .map((a: any) => a.player.name)
    const intelTeamAbbrevs = [...assetsA, ...assetsB]
      .filter((a: any) => a.type === 'player' && a.player?.team)
      .map((a: any) => a.player.team)

    const externalIntel = await buildTradeHubIntelBlock({
      playerNames: intelPlayerNames,
      teamAbbrevs: intelTeamAbbrevs,
      numTeams,
      isSuperflex: /superflex|2qb/i.test(String(leagueType || '')),
    }).catch(() => '')

    const externalIntelMeta = parseTradeIntelBlockMeta(externalIntel)
    const providerAudit: TradeProviderAudit = {
      providers: {
        openai: 'Final synthesis, recommendation framing, and user-facing decision language',
        grok: 'Recent news scanning and sentiment extraction through fetchPlayerNewsFromGrok',
        deterministicEngine: 'Trade balance + driver model + constraints as hard guardrails',
      },
      sourceCoverage: {
        fantasyCalcPlayers: fantasyCalcMap.size,
        newsItems: externalIntelMeta.newsItems,
        normalizedSignalCount: externalIntelMeta.normalizedSignalCount,
        sourceWeighting: externalIntelMeta.sourceWeighting,
        partialData:
          fantasyCalcMap.size === 0 ||
          externalIntelMeta.normalizedSignalCount == null ||
          externalIntelMeta.normalizedSignalCount === 0,
      },
      disagreements: [
        ...(tradeDriverData?.riskFlags?.length
          ? ['Driver engine surfaced risk flags that may temper market conviction']
          : []),
        ...(newsValueAdjustments.some((a) => a.sentiment === 'bearish' || a.sentiment === 'injury_concern')
          ? ['Recent bearish/injury news may conflict with pure market valuation']
          : []),
        ...(!tradeDriverData?.hasBehaviorData
          ? ['Behavior signal missing; manager-fit confidence reduced']
          : []),
      ],
    }
    const reconciliationDirective = buildTradeIntelReconciliationDirective(providerAudit)

    const userPrompt = buildUserPrompt({
      sport,
      format,
      leagueType,
      idpEnabled,
      league,
      numTeams,
      sideA: {
        username: canonicalA,
        displayName: userADisplay?.display_name ?? canonicalA,
        rosterId: resolvedUserRosterId,
        roster: finalRosterA || undefined,
        summary: summaryA || undefined,
      },
      sideB: {
        username: canonicalB,
        displayName: userBDisplay?.display_name ?? canonicalB,
        rosterId: resolvedPartnerRosterId,
        roster: finalRosterB || undefined,
        summary: summaryB || undefined,
      },
      otherManagers: leagueId ? otherManagers : null,
      assetsA,
      assetsB,
      sportsDb: sportsDb.ok ? sportsDb.players : null,
      espnStats: espnStats.ok ? espnStats.players : null,
      fantasyCalcValues,
      tradeBalance,
      tradeDriverData,
      tierEvaluation: tierEvaluationStr,
      playerNews,
      tradeGoal: reqData.tradeGoal,
      runtimeConstraints: constraintsPromptStr,
      historicalContext,
      managerDnaContext,
      unifiedPlayerContext,
      newsValueAdjustments,
    })

    const enrichedUserPrompt = [userPrompt, externalIntel, reconciliationDirective]
      .filter((s) => typeof s === 'string' && s.trim().length > 0)
      .join('\n\n')

    const cachePayload = {
      feature: 'legacy-trade-analyze',
      leagueId: leagueId || null,
      userId: sleeperA || null,
      partnerId: sleeperB || null,
      sport,
      format,
      leagueType,
      idpEnabled,
      season: String((league as any)?.season || ''),
      week: Number((league as any)?.settings?.leg ?? 0),
      numTeams,
      scoringSettings: (league as any)?.scoring_settings || null,
      rosterPositions: (league as any)?.roster_positions || null,
      userRosterId: resolvedUserRosterId ?? null,
      partnerRosterId: resolvedPartnerRosterId ?? null,
      assetsA: assetsA.map((a: any) =>
        a.type === 'player'
          ? { type: 'player', id: a.player?.id || null, pos: a.player?.position || null }
          : a.type === 'pick'
            ? { type: 'pick', year: a.pick?.year ?? null, round: a.pick?.round ?? null, pickNumber: a.pick?.pickNumber ?? null }
            : { type: 'faab', amount: a.amount ?? null }
      ),
      assetsB: assetsB.map((a: any) =>
        a.type === 'player'
          ? { type: 'player', id: a.player?.id || null, pos: a.player?.position || null }
          : a.type === 'pick'
            ? { type: 'pick', year: a.pick?.year ?? null, round: a.pick?.round ?? null, pickNumber: a.pick?.pickNumber ?? null }
            : { type: 'faab', amount: a.amount ?? null }
      ),
      tradeGoal: reqData.tradeGoal || null,
      tradeBalance: tradeBalance
        ? {
            sideAValue: tradeBalance.sideAValue,
            sideBValue: tradeBalance.sideBValue,
            percentDiff: tradeBalance.percentDiff,
            verdict: tradeBalance.verdict,
          }
        : null,
      tradeDriverData: tradeDriverData
        ? {
            totalScore: tradeDriverData.totalScore,
            fairnessDelta: tradeDriverData.fairnessDelta,
            scoringMode: tradeDriverData.scoringMode,
            hasBehaviorData: tradeDriverData.hasBehaviorData,
          }
        : null,
      newsSignals: (playerNews || []).map((n: any) => ({
        id: n?.id || n?.playerId || n?.name || null,
        sentiment: n?.sentiment || null,
        updatedAt: n?.updatedAt || n?.timestamp || null,
      })),
      promptVersion: 'v1',
    }

    const aiResult = await getOrCreateAiResult({
      feature: 'legacy-trade-analyze',
      scopeType: 'league',
      scopeId: leagueId || `${normalizeName(sleeperA)}:${normalizeName(sleeperB)}`,
      provider: 'openai',
      model: 'gpt-4o',
      payload: cachePayload,
      ttlSeconds: 2 * 60 * 60,
      onCacheMiss: async () => {
        const result = await openaiChatJson({
          messages: [
            { role: 'system', content: buildSystemPrompt(numTeams) },
            { role: 'user', content: enrichedUserPrompt },
          ],
          temperature: 0.6,
          maxTokens: 2800,
        })

        if (!result.ok) {
          throw new Error(String(result.details || 'Failed to analyze trade').slice(0, 500))
        }

        return {
          resultText: null,
          resultJson: { completion: result.json },
          tokenPrompt: null,
          tokenOutput: null,
        }
      },
    })

    if (aiResult.cacheHit) {
      console.log(`[legacy-trade/analyze] AI cache hit { leagueId: '${leagueId || 'none'}', userA: '${sleeperA}', userB: '${sleeperB}' }`)
    } else {
      console.log(`[legacy-trade/analyze] AI cache miss { leagueId: '${leagueId || 'none'}', userA: '${sleeperA}', userB: '${sleeperB}', modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
      console.log(`[legacy-trade/analyze] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
    }

    const parsed = parseJsonContentFromChatCompletion((aiResult.row.resultJson as any)?.completion)
    if (!parsed) {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    const validated = TradeAnalyzeResponseSchema.safeParse(parsed)
    if (!validated.success) {
      console.error('Trade AI response validation failed:', validated.error)
      return NextResponse.json({
        success: true,
        data: parsed,
        validated: false,
        rate_limit: { remaining: rlPair.remaining, retryAfterSec: rlPair.retryAfterSec },
      })
    }

    const data = validated.data
    if (!data.leagueSizeImpact || data.leagueSizeImpact.length === 0) {
      data.leagueSizeImpact = [`This trade was evaluated in a ${numTeams}-team league context. League size scarcity adjustments were applied to player valuations.`]
    }
    const notes = Array.isArray(data.notes) ? data.notes : []
    const finalNotes = Array.from(
      new Set([
        ...notes,
        'Legacy Tool: No tier gating here.',
        'App Disclaimer: In the AllFantasy app, Trade Analyzer is available for AF Pro + AF Supreme.',
      ])
    )

    // Track tool usage
    trackLegacyToolUsage('trade_eval', null, null, { sport, format, validated: true })

    const tradeAssets: AssetContext[] = [...assetsA, ...assetsB].map((a: any) => {
      if (a.type === 'player') {
        return {
          type: 'player' as const,
          name: a.player?.name,
          position: a.player?.position || a.player?.pos,
          age: a.player?.age,
          value: a.player?.value,
        }
      }
      return {
        type: 'pick' as const,
        pickYear: a.pick?.year,
        pickRound: a.pick?.round,
      }
    })

    const hitRate = await getHistoricalHitRate(canonicalA, 'trade', leagueId || undefined).catch(() => null)

    // Honesty (Task 2): classify every valuation that entered the balance math. Players the
    // FantasyCalc lookup missed carry the flat ~200 fallback — that must reach the response as
    // 'fallback', in missingInputs, and as lowered confidence, never as a market observation.
    let valuationEvidence: TradeValuationEvidence | null = null
    if (tradeBalance) {
      valuationEvidence = buildTradeValuationEvidence({
        sideAPlayers: tradeBalance.breakdown.sideA.players,
        sideBPlayers: tradeBalance.breakdown.sideB.players,
        unknownPlayers: tradeBalance.unknownPlayers,
        foundValuesAdjusted: getScarcityMultiplier(numTeams) !== 1.0,
      })
    }

    // playerCoverage previously used the fantasyCalcMap SIZE as a proxy — the map can contain
    // uninvolved players, overstating coverage. When the balance breakdown exists, use the real
    // found-vs-involved ratio so fallback-heavy trades honestly lower confidence.
    const honestPlayerCoverage = valuationEvidence && valuationEvidence.players.length > 0
      ? valuationEvidence.marketBackedCount / valuationEvidence.players.length
      : involvedNames.length > 0 ? (fantasyCalcMap?.size || 0) / involvedNames.length : 1

    const crResult = computeConfidenceRisk({
      category: 'trade',
      userId: canonicalA || undefined,
      leagueId: leagueId || undefined,
      assets: tradeAssets,
      dataCompleteness: {
        hasHistoricalData: !!historicalContext,
        dataPointCount: fantasyCalcMap?.size || 0,
        playerCoverage: honestPlayerCoverage,
        isCommonScenario: true,
      },
      tradeContext: {
        valueDelta: tradeBalance?.difference,
        fairnessScore: tradeBalance ? (tradeBalance.sideAValue / Math.max(tradeBalance.sideBValue, 1)) : undefined,
        riskFlagCount: data.riskFlags?.length ?? 0,
        assetCount: assetsA.length + assetsB.length,
        winProbShift: data.winProbabilityShift,
      },
      historicalHitRate: hitRate,
    })

    if (canonicalA && leagueId) {
      autoLogDecision({
        userId: canonicalA,
        leagueId: leagueId || 'unknown',
        decisionType: 'trade',
        aiRecommendation: {
          summary: `Trade: ${data.verdict || 'analyzed'}`,
          grade: data.grade,
          verdict: data.verdict,
          format,
          sport,
        },
        confidenceScore: crResult.confidenceScore01,
        riskProfile: crResult.riskProfile,
        contextSnapshot: { format, sport, leagueId },
        confidenceRisk: crResult,
      })
    }

    const pickContextA = buildPickContext(assetsA, numTeams)
    const pickContextB = buildPickContext(assetsB, numTeams)
    const pickContextAll = [...pickContextA, ...pickContextB].map(pc => ({
      ...pc,
      roundLabel: pc.label,
      numTeams,
    }))

    const scarcityMultiplier = getScarcityMultiplier(numTeams)

    let analyticsEnhanced: any = null
    try {
      const liquidityMetrics: LiquidityMetrics = {
        tradesLast30: 0,
        activeManagers: 0,
        totalManagers: numTeams ?? 12,
        avgAssetsPerTrade: 3,
      }

      try {
        if (leagueId) {
          const thirtyDaysAgo = new Date()
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
          const recentTrades = await prisma.leagueTrade.findMany({
            where: {
              history: { sleeperLeagueId: leagueId },
              createdAt: { gte: thirtyDaysAgo },
            },
            select: { playersGiven: true, playersReceived: true, picksGiven: true, picksReceived: true, partnerRosterId: true },
          })
          liquidityMetrics.tradesLast30 = recentTrades.length
          const uniqueManagers = new Set(recentTrades.map((t: any) => t.partnerRosterId).filter(Boolean))
          liquidityMetrics.activeManagers = uniqueManagers.size
          if (recentTrades.length > 0) {
            const totalAssets = recentTrades.reduce((sum: number, t: any) => {
              const given = Array.isArray(t.playersGiven) ? t.playersGiven.length : 0
              const received = Array.isArray(t.playersReceived) ? t.playersReceived.length : 0
              const picksG = Array.isArray(t.picksGiven) ? t.picksGiven.length : 0
              const picksR = Array.isArray(t.picksReceived) ? t.picksReceived.length : 0
              return sum + given + received + picksG + picksR
            }, 0)
            liquidityMetrics.avgAssetsPerTrade = totalAssets / recentTrades.length
          }
        }
      } catch {}

      const liquidityScore = computeLiquidity(liquidityMetrics)
      const liqTier = liquidityTier(liquidityScore)

      let acceptModel = null
      if (tradeDriverData) {
        const features = extractAcceptanceFeatures(tradeDriverData as any)
        const result = acceptanceProbabilityWithLiquidity(features, liquidityScore)
        acceptModel = {
          probability: result.probability,
          liquidityAdjusted: result.liquidityAdjusted,
          counterRequired: result.counterRequired,
          // Slice 16 — how much of the model actually ran. Four of its six
          // features have no producer in this codebase, so this number is
          // built from fairness + volatility alone; consumers must be able to
          // see that rather than treating it as a full-confidence estimate.
          featureCoverage: result.featureCoverage,
          missingFeatures: result.missingFeatures,
          degraded: result.degraded,
        }
      }

      let championshipDelta = null
      if (tradeDriverData) {
        const meanA = (tradeDriverData.lineupImpactScore ?? 50) * 2
        const stdA = 20
        const meanDelta = (tradeDriverData.lineupDelta as any)?.deltaYou ?? 0

        const teams: TeamProjection[] = Array.from({ length: numTeams ?? 12 }, (_, i) => ({
          mean: i === 0 ? meanA : 100,
          stdDev: stdA,
        }))

        championshipDelta = computeChampionshipDelta(teams, 0, meanDelta, 0, 3000)
      }

      let portfolioProjection = null
      try {
        const rosterAssets: PortfolioAsset[] = []
        if (finalRosterA) {
          for (const p of finalRosterA) {
            rosterAssets.push({
              type: 'NFL',
              name: (p as any).name,
              position: (p as any).pos || 'WR',
              age: (p as any).age ?? 24,
              value: (p as any).value ?? 50,
            })
          }
        }
        if (rosterAssets.length > 0) {
          portfolioProjection = simulatePortfolio(rosterAssets)
        }
      } catch {}

      let optimizedCounters = null
      if (tradeDriverData && acceptModel && acceptModel.probability < 0.6) {
        try {
          const benchPlayers = (finalRosterA || [])
            .filter((p: any) => p.slot === 'Bench')
            .map((p: any) => ({ name: p.name, value: p.value ?? 30, position: p.pos || 'WR' }))
            .slice(0, 5)

          const sweeteners = buildAvailableSweeteners(benchPlayers, [], 0)
          if (sweeteners.length > 0) {
            const features = extractAcceptanceFeatures(tradeDriverData as any)
            const tradeShape: TradeShape = {
              features,
              sideAValue: tradeDriverData.totalScore ?? 50,
              sideBValue: 50,
            }
            optimizedCounters = generateOptimalCounters(tradeShape, sweeteners, {
              tradeTotal: Math.max(1, (tradeDriverData.totalScore ?? 100)),
              champDeltaEstimator: championshipDelta
                ? (v: number) => championshipDelta!.delta * (v / Math.max(1, tradeDriverData.totalScore ?? 100))
                : undefined,
            })
          }
        } catch {}
      }

      analyticsEnhanced = {
        liquidity: { score: liquidityScore, tier: liqTier },
        acceptModel,
        championshipDelta,
        portfolioProjection: portfolioProjection ? {
          year1: portfolioProjection.year1,
          year3: portfolioProjection.year3,
          year5: portfolioProjection.year5,
          volatilityBand: portfolioProjection.volatilityBand,
          assetBreakdown: portfolioProjection.assetBreakdown,
        } : null,
        optimizedCounters,
      }
    } catch (analyticsErr) {
      console.error('Analytics engines error (non-fatal):', analyticsErr)
    }

    const scoreToEdge = (score?: number | null): number => {
      if (typeof score !== 'number' || !Number.isFinite(score)) return 0
      if (score >= 0 && score <= 1) return (score - 0.5) * 200
      if (score >= 0 && score <= 100) return score - 50
      return 0
    }

    const sideAScore = tradeBalance?.sideAValue ?? 0
    const sideBScore = tradeBalance?.sideBValue ?? 0
    const maxSideScore = Math.max(sideAScore, sideBScore, 1)
    const fairnessScore = tradeBalance
      ? computeTradeFairnessScore({
          sideAScore,
          sideBScore,
          fairnessScale: 100 / maxSideScore,
        })
      : normalizeScore((tradeDriverData?.totalScore as number | undefined) ?? 50)

    const rawValueEdge = tradeBalance
      ? ((sideAScore - sideBScore) / maxSideScore) * 100
      : scoreToEdge((tradeDriverData?.marketScore as number | undefined) ?? 0.5)

    const teamFitEdge = scoreToEdge((tradeDriverData?.behaviorScore as number | undefined) ?? 0.5)
    const shortTermEdge = scoreToEdge((tradeDriverData?.lineupImpactScore as number | undefined) ?? 0.5)
    const longTermEdge = scoreToEdge((tradeDriverData?.vorpScore as number | undefined) ?? 0.5)
    const riskAdjustedEdge =
      (crResult?.confidenceScore01 ? crResult.confidenceScore01 * 100 - 50 : 0) -
      (crResult?.riskTags?.length || 0) * 2
    const playoffEdge = analyticsEnhanced?.championshipDelta?.delta
      ? analyticsEnhanced.championshipDelta.delta * 100
      : 0

    const tradeRecommendationScore = computeTradeRecommendationScore({
      rawValueEdge,
      teamFitEdge,
      shortTermEdge,
      longTermEdge,
      riskAdjustedEdge,
      playoffEdge,
    })

    const deepseekStructuredScore = normalizeScore(50 + tradeRecommendationScore)

    const grokOverlayRaw =
      newsValueAdjustments.length > 0
        ? newsValueAdjustments.reduce((sum, adj) => sum + ((adj.multiplier ?? 1) - 1) * 100, 0) /
          newsValueAdjustments.length
        : 0

    const dominantGrokEventType = grokDeltaEvents[0]?.event?.event_type ?? null
    const dominantGrokConfidence = grokDeltaEvents[0]?.event?.confidence ?? 0.7

    const fusedDecision = fuseDecisionScore({
      deepseekStructuredScore,
      grokLiveOverlayAdjustment: grokOverlayRaw,
      eventType: dominantGrokEventType,
      eventConfidence: dominantGrokConfidence,
    })

    const recommendationLabel: 'accept' | 'counter' | 'reject' =
      tradeRecommendationScore >= 15
        ? 'accept'
        : tradeRecommendationScore <= -15
          ? 'reject'
          : 'counter'

    const commissionerAlert = evaluateCommissionerAlert({
      tradeFairnessScore: fairnessScore,
      repeatedHighImbalanceBetweenSameManagers: false,
      packageContainsEliteAssetNoPremiumReturn: fairnessScore < 45 && Math.abs(rawValueEdge) > 20,
      inactiveManagerExtremeValueLoss: fairnessScore < 35,
    })

    const notifications = {
      private_dm: canonicalA
        ? buildPrivateTradeCoachingNotification({
            userId: canonicalA,
            recommendation: recommendationLabel,
            summary:
              recommendationLabel === 'accept'
                ? 'This profile grades as actionable; execute if roster fit holds.'
                : recommendationLabel === 'reject'
                  ? 'Risk profile is elevated; decline unless terms materially improve.'
                  : 'Value is close; counter with a smaller value swing.',
            confidence: crResult.confidenceScore01,
          })
        : null,
      league_chat: leagueId
        ? buildLeagueTradeProcessedNotification({
            leagueId,
            sideA: assetsA.map((a: any) => a.player?.name || String((a.pick?.year ?? '') + ' R' + (a.pick?.round ?? ''))),
            sideB: assetsB.map((a: any) => a.player?.name || String((a.pick?.year ?? '') + ' R' + (a.pick?.round ?? ''))),
          })
        : null,
      commissioner_alert:
        commissionerAlert.required && leagueId
          ? buildCommissionerFairnessNotification({
              leagueId,
              reasonCodes: commissionerAlert.reason_codes,
              severity: commissionerAlert.severity,
            })
          : null,
    }

    logTradeOfferEvent({
      leagueId: leagueId || null,
      senderUserId: canonicalA || null,
      assetsGiven: assetsA.map((a: any) => ({ name: a.player?.name || `${a.pick?.year} R${a.pick?.round}`, value: a.player?.value || a.pick?.value, type: a.type })),
      assetsReceived: assetsB.map((a: any) => ({ name: a.player?.name || `${a.pick?.year} R${a.pick?.round}`, value: a.player?.value || a.pick?.value, type: a.type })),
      features: tradeDriverData ? {
        lineupImpact: tradeDriverData.lineupImpactScore,
        vorp: tradeDriverData.vorpScore,
        market: tradeDriverData.marketScore,
        behavior: tradeDriverData.behaviorScore,
        weights: [0.40, 0.25, 0.20, 0.15],
      } : null,
      acceptProb: tradeDriverData?.acceptProbability ?? null,
      verdict: data.verdict || tradeDriverData?.verdict || null,
      grade: data.grade || null,
      confidenceScore: crResult.confidenceScore01,
      driverSet: tradeDriverData?.acceptDrivers?.map(d => ({ id: d.id, evidence: d.evidence?.note || d.evidence?.metric || '' })) ?? null,
      segmentParts: {
        isSuperflex: isSFForDrivers,
        isTEPremium: isTEPForDrivers,
        leagueSize: numTeams ?? null,
        opponentTradeSampleSize: null,
      },
      mode: 'TRADE_IDEAS',
      isSuperFlex: isSFForDrivers,
      leagueFormat: format || null,
    }).catch(() => {})

    let engineAnalysis: any = null
    let engineReqSaved: any = null
    try {
      const mapAssets = (assets: TradeAsset[]): TradeAssetUnion[] =>
        assets.map(a => {
          if (a.type === 'player') return { type: 'player' as const, player: { id: a.player.id || '', name: a.player.name, pos: a.player.pos, team: a.player.team } }
          if (a.type === 'pick') return { type: 'pick' as const, pick: { year: a.pick.year, round: a.pick.round, pickNumber: a.pick.pickNumber } }
          return { type: 'faab' as const, faab: { amount: (a as any).faab?.amount ?? 0 } }
        })

      const engineReq: EngineTradeReq = {
        sport: 'NFL',
        format: (format || 'dynasty') as any,
        leagueId: leagueId || undefined,
        sleeper_username_a: sleeperA,
        sleeper_username_b: sleeperB,
        sleeperUserA: body.sleeperUserA || undefined,
        sleeperUserB: body.sleeperUserB || undefined,
        leagueContext: body.leagueContext ? {
          leagueId: leagueId || '',
          sport: 'NFL',
          format: (format || 'dynasty') as any,
          season: body.leagueContext.season,
          week: body.leagueContext.week,
          phase: body.leagueContext.phase,
          numTeams: body.leagueContext.numTeams,
          scoring: body.leagueContext.settings ? {
            ppr: body.leagueContext.settings.ppr,
            ppCarry: body.leagueContext.settings.ppCarry,
            ppCompletion: body.leagueContext.settings.ppCompletion,
            sixPtPassTd: body.leagueContext.settings.sixPtPassTd,
            qbFormat: body.leagueContext.settings.qbFormat === 'superflex' ? 'superflex' : '1QB',
            tep: body.leagueContext.settings.tep,
          } : undefined,
          roster: body.leagueContext.roster,
          trade: body.leagueContext.trade,
        } : undefined,
        assetsA: mapAssets(assetsA),
        assetsB: mapAssets(assetsB),
        rosterA: (body.rosterA || []).map((p: any) => ({ id: p.id || '', name: p.name || '', pos: p.pos, team: p.team, age: p.age })),
        rosterB: (body.rosterB || []).map((p: any) => ({ id: p.id || '', name: p.name || '', pos: p.pos, team: p.team, age: p.age })),
        marketContext: body.marketContext ? {
          ldiByPos: body.marketContext.ldi,
          partnerTendencies: body.marketContext.partnerTendencies,
        } : undefined,
        nflContext: body.nflContext || undefined,
        numTeams: numTeams ?? undefined,
        tradeGoal: body.tradeGoal ?? undefined,
        newsAdjustments: newsValueAdjustments.length > 0
          ? Object.fromEntries(
              newsValueAdjustments
                .filter(a => a.severity !== 'none')
                .map(a => [a.playerName.toLowerCase(), { multiplier: a.multiplier, sentiment: a.sentiment, reason: a.reason }])
            )
          : undefined,
        options: { explainLevel: 'full', counterCount: 3 },
      }
      engineReqSaved = engineReq
      engineAnalysis = await runTradeAnalysis(engineReq)
    } catch {}

    // ─────────────────────────────────────────────────────────────────────────
    // Slice 13/14 — CANONICAL CONVERGENCE for the highest-traffic trade surface.
    //
    // Legacy's grade has always been an LLM output constrained by FantasyCalc.
    // Here we compute the CANONICAL grade for the same trade (the
    // buildTradeValueSnapshot → gradeTrade engine the Decision Registry names
    // authoritative), fed from the same real FantasyCalc values legacy already
    // loaded, via the market-value basis completed in slice 14.
    //
    //   • Always: record parity (canonical vs legacy) so divergence is measured.
    //   • DECISION_OS_TRADE_LIVE_LEGACY=true: the canonical grade/verdict is
    //     what the user sees. Default OFF — flipping is an env change.
    //   • NEVER override on insufficientData: if the canonical engine cannot
    //     grade, legacy's existing answer stands rather than blanking a working
    //     surface.
    // Fully guarded — convergence can never throw into the legacy response.
    let canonicalGradeApplied = false
    try {
      const canonical = buildLegacyCanonicalGrade({
        assetsA: assetsA as never[],
        assetsB: assetsB as never[],
        marketValueFor: (name: string) => {
          const row = newsAdjustedCalcMap.get(name.toLowerCase()) as { value?: number } | undefined
          return typeof row?.value === 'number' && Number.isFinite(row.value) ? row.value : null
        },
        sport: 'NFL',
        format: format || 'dynasty',
        currentSeason: new Date().getFullYear(),
      })

      const legacyAdvantage = legacyVerdictToAdvantage((data as { verdict?: string })?.verdict)
      const canonicalAdvantage = canonical.verdict ? legacyVerdictToAdvantage(canonical.verdict) : null

      recordTradeSurfaceShadow({
        surface: 'legacy',
        leagueId: leagueId || null,
        assetsGive: assetsB.length,
        assetsGet: assetsA.length,
        surfaceVerdict: (data as { verdict?: string })?.verdict ?? null,
        surfaceAnalysisMode: (data as { grade?: string })?.grade ?? 'llm_grade',
        comparison: buildSurfaceParity({
          surfaceAdvantage: legacyAdvantage,
          engineAdvantage: canonicalAdvantage,
          engineGrade: canonical.grade,
          engineFairnessScore: canonical.fairnessScore,
          engineConfidenceScore: canonical.confidenceScore,
          engineValueDifference: canonical.valueDifference,
        }),
      })

      const liveLegacy =
        String(process.env['DECISION_OS_TRADE_LIVE_LEGACY'] ?? '').trim().toLowerCase() === 'true'
      if (liveLegacy && !canonical.insufficientData && canonical.grade && canonical.verdict) {
        const target = data as Record<string, unknown>
        target.grade = canonical.grade
        target.verdict = canonical.verdict
        target.fairnessScore = canonical.fairnessScore
        target.confidenceScore = canonical.confidenceScore
        target.gradeSource = 'canonical_value_engine'
        canonicalGradeApplied = true
      }
    } catch {
      // Convergence must never break the legacy response.
    }

    const leagueStatus = league?.status || ''
    const isOffseason = leagueStatus === 'complete' || leagueStatus === 'pre_draft'
    const offseasonContext = isOffseason ? {
      offseason: true,
      offseasonBadge: leagueStatus === 'pre_draft' ? 'Pre-Draft Mode' : 'Offseason Mode',
      offseasonNote: leagueStatus === 'pre_draft'
        ? 'League is in pre-draft. Live matchup data and weekly projections are unavailable. Trade values use dynasty ADP and historical baselines.'
        : 'Season is complete. Rankings use end-of-season snapshots. Live scoring and matchup data are unavailable until next season.',
    } : null

    return NextResponse.json({
      success: true,
      result: {
        ...data,
        // Slice 14 — provenance: which engine produced the grade the user sees.
        gradeSource: canonicalGradeApplied ? 'canonical_value_engine' : 'legacy_llm_fantasycalc',
        notes: finalNotes,
        _leagueSize: numTeams,
        _scarcityMultiplier: scarcityMultiplier,
        _pickContext: pickContextAll,
        ...(leagueSizeMismatchWarning ? { _leagueSizeMismatchWarning: leagueSizeMismatchWarning } : {}),
        ...(pickInferenceNotes.length > 0 ? { _pickInferenceNotes: pickInferenceNotes } : {}),
      },
      data: { ...data, notes: finalNotes },
      leagueSize: numTeams,
      scarcityMultiplier,
      pickContext: pickContextAll,
      confidenceRisk: {
        confidence: crResult.numericConfidence,
        level: crResult.confidenceLevel,
        volatility: crResult.volatilityLevel,
        volatilityScore: crResult.volatilityScore,
        riskProfile: crResult.riskProfile,
        riskTags: crResult.riskTags,
        explanation: crResult.explanation,
      },
      ...(analyticsEnhanced ? { analytics: analyticsEnhanced } : {}),
      ...(valuationEvidence ? { valuationEvidence } : {}),
      intelligenceAudit: providerAudit,
      ...(engineAnalysis ? { engineAnalysis, engineRequest: engineReqSaved } : {}),
      ...(offseasonContext ? { offseasonContext } : {}),
      ...(newsValueAdjustments.length > 0 ? {
        newsAdjustments: newsValueAdjustments
          .filter(a => a.severity !== 'none')
          .map(a => ({
            playerName: a.playerName,
            originalValue: a.originalValue,
            adjustedValue: a.adjustedValue,
            multiplier: a.multiplier,
            sentiment: a.sentiment,
            severity: a.severity,
            reason: a.reason,
            headlines: a.newsHeadlines,
          })),
      } : {}),
      legacyDecision: {
        tradeFairnessScore: fairnessScore,
        tradeRecommendationScore,
        recommendation: recommendationLabel,
        deepseekStructuredScore,
        grokOverlayRaw,
        fusedScore: fusedDecision.finalScore,
        cappedGrokAdjustment: fusedDecision.cappedGrokAdjustment,
        grokAdjustmentCap: fusedDecision.grokCap,
        commissionerAlert,
        grokDeltaEventsApplied: grokDeltaCacheWrites,
      },
      notificationsPreview: notifications,
      validated: true,
      rate_limit: { remaining: rlPair.remaining, retryAfterSec: rlPair.retryAfterSec },
    })
  } catch (error) {
    console.error('Trade Analyze error:', error)
    return NextResponse.json(
      { error: 'Failed to analyze trade', details: String(error) },
      { status: 500 }
    )
  }
})


