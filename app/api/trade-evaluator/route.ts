import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { runPECR } from '@/lib/ai/pecr'
import {
  STRUCTURED_TRADE_EVAL_SYSTEM_PROMPT,
  StructuredTradeEvalResponseSchema,
  NEGOTIATION_USER_INSTRUCTION,
} from '@/lib/trade-evaluator-prompt'
import {
  buildFaabSteps,
  buildScarcityNotes,
  clampNegotiationToAllowed,
} from '@/lib/trade-finder/negotiation-helpers'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { xaiChatJson, parseTextFromXaiChatCompletion } from '@/lib/xai-client'
import { deepseekQuantAnalysis } from '@/lib/deepseek-client'
import { consumeRateLimit } from '@/lib/rate-limit'
import { checkAiRateLimit, getCachedResponse, setCachedResponse, buildCacheKey, getAiActionConfig } from '@/lib/ai-protection'
import { buildHistoricalTradeContext, getDataInfo, calculateTradeConfidence, computeDualModeGrades } from '@/lib/historical-values'
import { pricePlayer, pricePick, compositeScore, compositeTotal, ValuationContext, type PricedAsset } from '@/lib/hybrid-valuation'
import { computeLineupDelta, computeLineupFairness, computeValueFairness, type LineupPlayer, type RosterSlots, type LineupDelta } from '@/lib/lineup-optimizer'
import { parseSleeperRosterPositions } from '@/lib/trade-engine/sleeper-converter'
import { computeTradeDrivers } from '@/lib/trade-engine/trade-engine'
import { getTotalIdpStarterSlots, canFieldLegalIdpLineup } from '@/lib/trade-engine/idp-lineup-check'
import { buildNegotiationToolkit, negotiationToolkitToLegacy } from '@/lib/trade-engine/negotiation-builder'
import { buildNegotiationGptContract, buildNegotiationGptUserPrompt, validateNegotiationGptOutput, shouldSkipNegotiationGpt, NEGOTIATION_GPT_SYSTEM_PROMPT } from '@/lib/trade-engine/negotiation-gpt-contract'
import { buildGptInputContract, buildGptUserPrompt, validateGptNarrativeOutput, shouldSkipGpt, AI_OUTPUT_INVALID_FALLBACK, GPT_NARRATIVE_SYSTEM_PROMPT } from '@/lib/trade-engine/gpt-input-contract'
import type { Asset } from '@/lib/trade-engine/types'
import { getCalibratedWeights } from '@/lib/trade-engine/accept-calibration'
import { parsePickLabel } from '@/lib/parsePickLabel'
import { logTradeOfferEvent } from '@/lib/trade-engine/trade-event-logger'
import { logNarrativeValidation } from '@/lib/trade-engine/narrative-validation-logger'
import { checkBehaviorRules, logRuleViolations } from '@/lib/ai/behavior-rules'
import { detectTradeLabels, getPositiveLabels, getWarningLabels, TradeAsset } from '@/lib/trade-labels'
import { evaluateVeto } from '@/lib/trade-veto'
import { buildLeagueDecisionContext, summarizeLeagueDecisionContext, LeagueDecisionContext } from '@/lib/league-decision-context'
import { buildUnifiedTradeContext, type LegacyAssetInput } from '@/lib/trade-engine/unified-context'
import { computeDataCoverageTier } from '@/lib/trade-engine/trade-decision-context'
import type { TradeDecisionContextV1 } from '@/lib/trade-engine/trade-decision-context'
import { getLeagueInfo, getLeagueRosters, getTradedDraftPicks, getPlayersBySport } from '@/lib/sleeper-client'
import { attachPlayerMediaBatch } from '@/lib/player-media'
import { logAiOutput } from '@/lib/ai/output-logger'
import { logAiFailure } from '@/lib/error-tracking'
import { isToolTradeAnalyzerEnabled } from '@/lib/feature-toggle'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { prisma } from '@/lib/prisma'
import { buildLeagueContext } from '@/lib/league/buildLeagueContext'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'
import { getPlayerValuesContext } from '@/lib/player-values/playerValuesLoader'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { resolveTradeEvaluatorInternalLeagueId } from '@/lib/trades/resolveTradeEvaluatorInternalLeagueId'
import { resolveTradePlayerAssets } from '@/lib/trades/tradePlayerIdentityResolver'
import {
  buildNormalizedTradeContext,
  buildNormalizedTradeEvidencePrompt,
  type BuildNormalizedTradeContextResult,
} from '@/lib/trades/buildNormalizedTradeContext'

const PlayerInputSchema = z.object({
  name: z.string(),
  position: z.string().optional(),
  team: z.string().optional(),
  age: z.number().optional(),
  value_notes: z.string().optional(),
  playerId: z.string().optional(),
  sportsPlayerId: z.string().optional(),
  sports_player_id: z.string().optional(),
  player_id: z.string().optional(),
  internalPlayerId: z.string().optional(),
  sleeperPlayerId: z.string().optional(),
  sleeper_id: z.string().optional(),
  externalSourceId: z.string().optional(),
  external_source_id: z.string().optional(),
  providerPlayerId: z.string().optional(),
  provider_player_id: z.string().optional(),
})

const PickInputSchema = z.object({
  year: z.number(),
  round: z.number(),
  projected_range: z.enum(['early', 'mid', 'late', 'unknown']).optional(),
})

const TeamInputSchema = z.object({
  team_id: z.string().optional(),
  manager_name: z.string(),
  is_af_pro: z.boolean().optional().default(false),
  record_or_rank: z.string().optional(),
  roster: z.array(z.any()).optional(),
  picks_owned: z.array(PickInputSchema).optional(),
  faab_remaining: z.number().optional(),
  gives_players: z.array(z.union([z.string(), PlayerInputSchema])),
  gives_picks: z.array(z.union([z.string(), PickInputSchema])).optional().default([]),
  gives_faab: z.number().optional().default(0),
})

const LeagueContextSchema = z.object({
  format: z.enum(['redraft', 'dynasty', 'keeper', 'best_ball']).optional(),
  sport: z.string().optional(),
  scoring_summary: z.string().optional(),
  qb_format: z.enum(['1qb', 'sf']).optional().default('sf'),
  idp_enabled: z.boolean().optional().default(false),
  roster_requirements: z.string().optional(),
  waiver_type: z.string().optional(),
  trade_deadline: z.string().optional(),
  playoff_weeks: z.string().optional(),
  standings_summary: z.string().optional(),
  contender_notes: z.string().optional(),
  scarcity_notes: z.string().optional(),
  market_notes: z.string().optional(),
})

const SleeperUserSchema = z.object({
  username: z.string().min(1),
  userId: z.string().optional().default(''),
})

const TradeRequestSchema = z.object({
  trade_id: z.string().optional(),
  league_id: z.string().optional(),
  leagueId: z.string().optional(),
  confirmTokenSpend: z.boolean().optional().default(false),
  sleeperUser: SleeperUserSchema.optional(),
  sender: TeamInputSchema,
  receiver: TeamInputSchema,
  league: LeagueContextSchema.optional(),
  asOfDate: z.string().optional().nullable(),
}).transform(d => ({
  ...d,
  league_id: d.leagueId || d.league_id,
}))

const CONFIDENCE_DRIFT_THRESHOLD = 25

function triangulateConfidence(
  serverScore: number,
  gptScore: number | null,
  quantScore: number | null
): {
  finalScore: number
  overrideApplied: boolean
  auditLog: string[]
} {
  const auditLog: string[] = []
  const scores: number[] = [serverScore]

  if (gptScore != null) scores.push(gptScore)
  if (quantScore != null) scores.push(quantScore)

  const maxDrift = Math.max(...scores) - Math.min(...scores)

  if (maxDrift > CONFIDENCE_DRIFT_THRESHOLD) {
    auditLog.push(
      `Confidence drift detected: ${maxDrift.toFixed(1)} pts across models. ` +
      `Scores: server=${serverScore}, gpt=${gptScore ?? 'N/A'}, quant=${quantScore ?? 'N/A'}. ` +
      `Server score applied.`
    )
    return { finalScore: serverScore, overrideApplied: true, auditLog }
  }

  const weights = { server: 0.40, quant: 0.35, gpt: 0.25 }
  let weighted = serverScore * weights.server
  let weightUsed = weights.server

  if (quantScore != null) {
    weighted += quantScore * weights.quant
    weightUsed += weights.quant
  }
  if (gptScore != null) {
    weighted += gptScore * weights.gpt
    weightUsed += weights.gpt
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(weighted / weightUsed)))
  auditLog.push(`Triangulated confidence: ${finalScore} (drift: ${maxDrift.toFixed(1)} pts, models: ${scores.length})`)

  return { finalScore, overrideApplied: false, auditLog }
}

const DEEPSEEK_TRADE_SYSTEM = `You are a quantitative fantasy sports trade analysis engine.
Analyze trade fairness using statistical modeling.
Always respond in valid JSON only. No markdown outside JSON.

Output format:
{
  "fairnessScore": 0-100,
  "netValueDelta": number,
  "projectionDeltaA": number,
  "projectionDeltaB": number,
  "expectedWeeklyGainA": number,
  "expectedWeeklyGainB": number,
  "playoffImpactA": 0-100,
  "playoffImpactB": 0-100,
  "riskGradeA": "A|B|C|D|F",
  "riskGradeB": "A|B|C|D|F",
  "ceilingA": number,
  "floorA": number,
  "ceilingB": number,
  "floorB": number,
  "varianceScore": 0-100,
  "confidencePct": 0-100,
  "winnerSide": "A|B|even",
  "quantReasoning": "Brief statistical explanation"
}`

const GROK_TRADE_SYSTEM = `You are a real-time fantasy sports intelligence engine.
Analyze trade assets for breaking news, injury risk, and momentum signals.
Always respond in valid JSON only.

Output format:
{
  "playerSignals": [
    {
      "playerName": string,
      "signal": "injury|breakout|decline|depth_change|contract|rumor|none",
      "severity": "critical|moderate|low",
      "note": string
    }
  ],
  "overallRiskFlag": "high|moderate|low|none",
  "trendingPlayers": string[],
  "injuryAlerts": string[],
  "momentumShifts": string[],
  "marketSentiment": "bullish|bearish|neutral",
  "rawInsight": string
}`

function parseJsonSafe(raw: string): Record<string, any> | null {
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    return JSON.parse(cleaned)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      try { return JSON.parse(match[0]) } catch {}
    }
    return null
  }
}

type TradeEvaluatorQualityGate = {
  passed: boolean
  reasons?: string[]
}

type TradeEvaluatorPECRInput = {
  payload: Record<string, unknown>
  recommendation: string | null
  valueDelta: number
  qualityGate: TradeEvaluatorQualityGate | null
}

function resolveTradeRecommendation(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null

  const explanation = (value as Record<string, unknown>).explanation
  if (!explanation || typeof explanation !== 'object') return null

  const summary = (explanation as Record<string, unknown>).summary
  return typeof summary === 'string' && summary.trim().length > 0 ? summary : null
}

function extractTradeQualityGate(value: unknown): TradeEvaluatorQualityGate | null {
  if (!value || typeof value !== 'object') return null

  const qualityGate = (value as Record<string, unknown>).qualityGate
  if (!qualityGate || typeof qualityGate !== 'object') return null

  const passed = (qualityGate as Record<string, unknown>).passed
  if (typeof passed !== 'boolean') return null

  const reasonsValue = (qualityGate as Record<string, unknown>).reasons
  const reasons = Array.isArray(reasonsValue)
    ? reasonsValue.filter((reason): reason is string => typeof reason === 'string')
    : undefined

  return {
    passed,
    reasons,
  }
}

async function runTradeEvaluatorPECR(input: TradeEvaluatorPECRInput): Promise<Record<string, unknown>> {
  const result = await runPECR(input, {
    feature: 'trade',
    plan: async () => ({
      intent: 'trade-evaluator',
      steps: ['build evaluation payload', 'validate recommendation', 'verify output'],
      context: {
        hasQualityGate: Boolean(input.qualityGate),
      },
      refineHints: [],
    }),
    execute: async (_plan, currentInput) => currentInput,
    check: (output) => {
      const failures: string[] = []

      if (!output.recommendation || output.recommendation.trim().length === 0) {
        failures.push('missing recommendation')
      }

      if (typeof output.valueDelta !== 'number' || !Number.isFinite(output.valueDelta)) {
        failures.push('valueDelta is missing or not finite')
      }

      if (output.qualityGate && !output.qualityGate.passed) {
        failures.push(...(output.qualityGate.reasons ?? []))
      }

      return {
        passed: failures.length === 0,
        failures,
      }
    },
  })

  return result.output.payload
}

const valueToTier = (value: number): string => {
  if (value >= 9000) return 'Tier0_Untouchable'
  if (value >= 7500) return 'Tier1_Cornerstone'
  if (value >= 5500) return 'Tier2_HighEnd'
  if (value >= 3500) return 'Tier3_Starter'
  if (value >= 1500) return 'Tier4_Depth'
  return 'Tier5_Filler'
}

function resolvePlayerName(p: string | { name: string }): string {
  return typeof p === 'string' ? p : p.name
}

function resolvePickData(p: string | { year: number; round: number; projected_range?: string }) {
  if (typeof p === 'string') {
    const parsed = parsePickLabel(p)
    return {
      year: parsed?.year ?? 2025,
      round: parsed?.round ?? 1,
      tier: parsed?.bucket as 'early' | 'mid' | 'late' | undefined,
      label: p,
    }
  }
  return {
    year: p.year,
    round: p.round,
    tier: (p.projected_range === 'unknown' ? undefined : p.projected_range) as 'early' | 'mid' | 'late' | undefined,
    label: `${p.year} Round ${p.round}${p.projected_range ? ` (${p.projected_range})` : ''}`,
  }
}

export const POST = withApiUsage({ endpoint: "/api/trade-evaluator", tool: "TradeEvaluator" })(async (request: NextRequest) => {
  let userId: string | null = null
  let tokenFallbackLedgerId: string | null = null
  try {
    if (!(await isToolTradeAnalyzerEnabled())) {
      return NextResponse.json(
        { error: 'Trade analyzer is temporarily disabled by platform configuration.' },
        { status: 503 }
      )
    }

    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    userId = session?.user?.id ?? null
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = TradeRequestSchema.parse(body)

    if (data.league_id) {
      try {
        await assertLeagueMember(data.league_id, userId)
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const sId = (data.sender.team_id || data.sender.manager_name || '').trim().toLowerCase()
    const rId = (data.receiver.team_id || data.receiver.manager_name || '').trim().toLowerCase()
    const evalPair = [sId, rId].sort()
    const leaguePart = data.league_id ? `:${data.league_id.trim()}` : ''
    const evalKey = `trade_eval${leaguePart}:${evalPair[0]}:${evalPair[1]}`

    const config = getAiActionConfig('trade_eval')
    const rl = checkAiRateLimit(request, 'trade_eval', {
      sleeperUsername: evalKey,
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      includeIpInKey: true,
    })

    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Please try again later.',
          retryAfterSec: rl.retryAfterSec,
          remaining: rl.remaining,
          useDeterministicFallback: true,
        },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const gate = await requireFeatureEntitlement({
      userId,
      userEmail: session?.user?.email,
      featureId: 'trade_analyzer',
      allowTokenFallback: true,
      confirmTokenSpend: Boolean(data.confirmTokenSpend),
      tokenRuleCode: 'ai_trade_analyzer_full_review',
      tokenSourceType: 'trade_evaluator',
      tokenSourceId: `${data.league_id ?? 'trade'}:${Date.now()}`,
      tokenDescription: 'Trade evaluator full review',
      tokenMetadata: {
        leagueId: data.league_id ?? null,
        sport: data.league?.sport ?? null,
        format: data.league?.format ?? null,
      },
    })
    if (!gate.ok) return gate.response
    if (gate.tokenSpend) tokenFallbackLedgerId = gate.tokenSpend.id

    const isSF = data.league?.qb_format === 'sf'
    const leagueSport = normalizeToSupportedSport(String(data.league?.sport || 'nfl'))
    const leagueSportSlug = String(leagueSport).toLowerCase()
    const biasMode = data.sender.is_af_pro && data.receiver.is_af_pro ? 'neutral' : 'protect_receiver'

    const senderPlayerNames = data.sender.gives_players.map(resolvePlayerName)
    const receiverPlayerNames = data.receiver.gives_players.map(resolvePlayerName)
    const senderPicksData = (data.sender.gives_picks as any[]).map(resolvePickData)
    const receiverPicksData = (data.receiver.gives_picks as any[]).map(resolvePickData)

    let leaguePlayers: Record<string, any> = {}
    const playerNameToId: Record<string, string> = {}
    if (data.league_id) {
      try {
        const allP = await getPlayersBySport(leagueSportSlug)
        leaguePlayers = allP
        for (const [pid, p] of Object.entries(allP)) {
          if (p?.full_name) {
            playerNameToId[p.full_name.toLowerCase()] = pid
          }
        }
      } catch { /* non-critical */ }
    }

    let normalizedTradeBundle: BuildNormalizedTradeContextResult | null = null
    const tradePlayerAssets = [...data.sender.gives_players, ...data.receiver.gives_players]
    const internalLeagueId =
      data.league_id && userId
        ? await resolveTradeEvaluatorInternalLeagueId(data.league_id, userId).catch(() => null)
        : null
    const identityResult = await resolveTradePlayerAssets({
      sport: leagueSportSlug,
      nameLowerToExternalPid: playerNameToId,
      assets: tradePlayerAssets,
    })
    if (internalLeagueId && identityResult.resolved.length > 0) {
      normalizedTradeBundle = await buildNormalizedTradeContext({
        internalLeagueId,
        sport: leagueSportSlug,
        playerIds: identityResult.resolved.map((r) => r.playerId),
        unresolved: identityResult.unresolved,
        totalAssetCount: tradePlayerAssets.length,
        includeProviderFallbackDiagnostics: process.env.NODE_ENV === 'development',
      })
    }
    if (process.env.NODE_ENV === 'development' && normalizedTradeBundle) {
      console.info('[trade normalized player context]', {
        leagueId: internalLeagueId,
        sport: leagueSportSlug,
        totalAssets: normalizedTradeBundle.summary.totalAssets,
        resolvedPlayers: normalizedTradeBundle.summary.resolvedPlayers,
        unresolvedPlayers: normalizedTradeBundle.summary.unresolvedPlayers,
        fallbackSources: normalizedTradeBundle.summary.fallbackSources,
        missingDomains: normalizedTradeBundle.summary.missingDomains,
      })
    }

    const cacheKey = config.cacheTtlMs
      ? buildCacheKey('/api/trade-evaluator', {
          leagueId: data.league_id ?? '',
          sender: data.sender.gives_players.map(resolvePlayerName).sort(),
          senderPicks: (data.sender.gives_picks ?? []).map((p: any) => ({ year: p.year, round: p.round })).sort((a: any, b: any) => a.round - b.round || a.year - b.year),
          receiver: data.receiver.gives_players.map(resolvePlayerName).sort(),
          receiverPicks: (data.receiver.gives_picks ?? []).map((p: any) => ({ year: p.year, round: p.round })).sort((a: any, b: any) => a.round - b.round || a.year - b.year),
          normalizedPlayerIds: identityResult.resolved.map((r) => r.playerId).sort(),
        })
      : null
    const cached = cacheKey ? getCachedResponse<Record<string, unknown>>(cacheKey) : null
    if (cached) {
      return NextResponse.json({
        ...cached,
        tokenSpend: gate.tokenSpend
          ? {
              ruleCode: gate.tokenPreview?.ruleCode ?? 'ai_trade_analyzer_full_review',
              tokenCost: gate.tokenPreview?.tokenCost ?? null,
              balanceAfter: gate.tokenSpend.balanceAfter,
              ledgerId: gate.tokenSpend.id,
            }
          : null,
      })
    }

    let rosterConfigForVorp: import('@/lib/vorp-engine').LeagueRosterConfig | undefined
    if (data.league_id) {
      try {
        const sleeperLeagueForConfig = await getLeagueInfo(data.league_id)
        if (sleeperLeagueForConfig?.roster_positions) {
          const parsed = parseSleeperRosterPositions(sleeperLeagueForConfig.roster_positions)
          rosterConfigForVorp = {
            numTeams: sleeperLeagueForConfig.total_rosters || 12,
            startingQB: parsed.startingQB,
            startingRB: parsed.startingRB,
            startingWR: parsed.startingWR,
            startingTE: parsed.startingTE,
            startingFlex: parsed.startingFlex,
            superflex: parsed.superflex,
          }
        }
      } catch { /* use defaults */ }
    }

    const labelCtx: ValuationContext = {
      asOfDate: data.asOfDate || new Date().toISOString().split('T')[0],
      isSuperFlex: isSF,
      numTeams: 12,
      rosterConfig: rosterConfigForVorp,
    }

    const [senderPlayerPrices, receiverPlayerPrices, senderPickPrices, receiverPickPrices] = await Promise.all([
      Promise.all(senderPlayerNames.map(name => pricePlayer(name, labelCtx))),
      Promise.all(receiverPlayerNames.map(name => pricePlayer(name, labelCtx))),
      Promise.all(senderPicksData.map(p => pricePick({ year: p.year, round: p.round, tier: p.tier || null }, labelCtx))),
      Promise.all(receiverPicksData.map(p => pricePick({ year: p.year, round: p.round, tier: p.tier || null }, labelCtx))),
    ])

    const senderGivenAssetsList = [...senderPlayerPrices, ...senderPickPrices]
    const senderReceivedAssetsList = [...receiverPlayerPrices, ...receiverPickPrices]

    const senderGivenComposite = compositeTotal(senderGivenAssetsList) + (data.sender.gives_faab ?? 0)
    const senderReceivedComposite = compositeTotal(senderReceivedAssetsList) + (data.receiver.gives_faab ?? 0)

    const senderGivenMarket = senderGivenAssetsList.reduce((s, p) => s + p.assetValue.marketValue, 0)
      + (data.sender.gives_faab ?? 0)
    const senderReceivedMarket = senderReceivedAssetsList.reduce((s, p) => s + p.assetValue.marketValue, 0)
      + (data.receiver.gives_faab ?? 0)

    const senderGivenTotal = senderGivenComposite
    const senderReceivedTotal = senderReceivedComposite

    const teamANetValue = senderReceivedComposite - senderGivenComposite
    const teamBNetValue = senderGivenComposite - senderReceivedComposite

    const allPlayerNames = [...senderPlayerNames, ...receiverPlayerNames]
    const playersToResolve = allPlayerNames
      .map(name => {
        const pid = playerNameToId[name.toLowerCase()]
        if (!pid) return null
        const team = leaguePlayers[pid]?.team || null
        return { playerId: pid, teamAbbr: team, sport: leagueSportSlug }
      })
      .filter((p): p is { playerId: string; teamAbbr: string | null; sport: string } => p !== null)

    const tradeMediaMap = playersToResolve.length > 0
      ? await attachPlayerMediaBatch(playersToResolve)
      : new Map()

    const buildAssetDetail = (
      name: string,
      priced: { value: number; source: string; assetValue: { marketValue: number; impactValue: number; vorpValue: number; volatility: number } },
      position?: string,
      age?: number
    ) => {
      const pid = playerNameToId[name.toLowerCase()] || null
      const resolved = pid ? tradeMediaMap.get(pid) : null
      const team = resolved?.teamAbbr || (pid && leaguePlayers[pid]?.team ? leaguePlayers[pid].team : null)
      return {
        name,
        value: compositeScore(priced.assetValue),
        marketValue: priced.assetValue.marketValue,
        assetValue: priced.assetValue,
        tier: valueToTier(priced.assetValue.marketValue),
        source: priced.source,
        ...(position && { position }),
        ...(age && { age }),
        playerId: pid,
        fullName: name,
        teamAbbr: team,
        sport: leagueSportSlug as string,
        media: resolved?.media || { headshotUrl: null, teamLogoUrl: null },
      }
    }

    const teamAGives = [
      ...senderPlayerNames.map((name, i) => {
        const p = data.sender.gives_players[i]
        const pos = typeof p === 'object' ? p.position : undefined
        const age = typeof p === 'object' ? p.age : undefined
        return buildAssetDetail(name, senderPlayerPrices[i], pos, age)
      }),
      ...senderPicksData.map((p, i) => ({
        name: p.label,
        value: senderPickPrices[i].value,
        tier: valueToTier(senderPickPrices[i].value),
        source: senderPickPrices[i].source,
        isPick: true,
      })),
    ]

    const teamAReceives = [
      ...receiverPlayerNames.map((name, i) => {
        const p = data.receiver.gives_players[i]
        const pos = typeof p === 'object' ? p.position : undefined
        const age = typeof p === 'object' ? p.age : undefined
        return buildAssetDetail(name, receiverPlayerPrices[i], pos, age)
      }),
      ...receiverPicksData.map((p, i) => ({
        name: p.label,
        value: receiverPickPrices[i].value,
        tier: valueToTier(receiverPickPrices[i].value),
        source: receiverPickPrices[i].source,
        isPick: true,
      })),
    ]

    const senderPlayerAssets: TradeAsset[] = senderPlayerNames.map((name, i) => {
      const p = data.sender.gives_players[i]
      return {
        name,
        isPick: false,
        value: compositeScore(senderPlayerPrices[i].assetValue),
        assetValue: senderPlayerPrices[i].assetValue,
        tier: valueToTier(senderPlayerPrices[i].assetValue.marketValue) as any,
        ...(typeof p === 'object' && p.position && { position: p.position }),
        ...(typeof p === 'object' && p.age && { age: p.age }),
      }
    })

    const receiverPlayerAssets: TradeAsset[] = receiverPlayerNames.map((name, i) => {
      const p = data.receiver.gives_players[i]
      return {
        name,
        isPick: false,
        value: compositeScore(receiverPlayerPrices[i].assetValue),
        assetValue: receiverPlayerPrices[i].assetValue,
        tier: valueToTier(receiverPlayerPrices[i].assetValue.marketValue) as any,
        ...(typeof p === 'object' && p.position && { position: p.position }),
        ...(typeof p === 'object' && p.age && { age: p.age }),
      }
    })

    const senderPickAssets: TradeAsset[] = senderPicksData.map((p, i) => ({
      name: p.label,
      isPick: true,
      pickRound: p.round,
      pickYear: p.year,
      value: compositeScore(senderPickPrices[i].assetValue),
      assetValue: senderPickPrices[i].assetValue,
    }))

    const receiverPickAssets: TradeAsset[] = receiverPicksData.map((p, i) => ({
      name: p.label,
      isPick: true,
      pickRound: p.round,
      pickYear: p.year,
      value: compositeScore(receiverPickPrices[i].assetValue),
      assetValue: receiverPickPrices[i].assetValue,
    }))

    const senderGivenAssets = [...senderPlayerAssets, ...senderPickAssets]
    const receiverGivenAssets = [...receiverPlayerAssets, ...receiverPickAssets]

    let fairnessScore: number
    let lineupDeltas: { sender: LineupDelta; receiver: LineupDelta } | null = null
    let fairnessMethod: 'lineup' | 'composite' = 'composite'

    const senderRoster = data.sender.roster || []
    const receiverRoster = data.receiver.roster || []
    const hasFullRosters = senderRoster.length >= 5 && receiverRoster.length >= 5

    if (hasFullRosters) {
      try {
        const rosterSlots: RosterSlots = rosterConfigForVorp
          ? {
              startingQB: rosterConfigForVorp.startingQB,
              startingRB: rosterConfigForVorp.startingRB,
              startingWR: rosterConfigForVorp.startingWR,
              startingTE: rosterConfigForVorp.startingTE,
              startingFlex: rosterConfigForVorp.startingFlex,
              superflex: rosterConfigForVorp.superflex,
            }
          : {
              startingQB: 1,
              startingRB: 2,
              startingWR: 2,
              startingTE: 1,
              startingFlex: isSF ? 3 : 2,
              superflex: isSF,
            }

        const senderRosterNames: string[] = senderRoster.map((r: any) =>
          typeof r === 'string' ? r : r.name || r.id || String(r)
        )
        const receiverRosterNames: string[] = receiverRoster.map((r: any) =>
          typeof r === 'string' ? r : r.name || r.id || String(r)
        )

        const [senderRosterPriced, receiverRosterPriced] = await Promise.all([
          Promise.all(senderRosterNames.map(name => pricePlayer(name, labelCtx))),
          Promise.all(receiverRosterNames.map(name => pricePlayer(name, labelCtx))),
        ])

        function pricedToLineup(names: string[], priced: PricedAsset[]): LineupPlayer[] {
          return names.map((name, i) => ({
            name: priced[i].name || name,
            position: priced[i].position || 'WR',
            impactValue: priced[i].assetValue.impactValue,
            vorpValue: priced[i].assetValue.vorpValue,
          }))
        }

        const senderLineupPlayers = pricedToLineup(senderRosterNames, senderRosterPriced)
        const receiverLineupPlayers = pricedToLineup(receiverRosterNames, receiverRosterPriced)

        const senderReceivesAsLineup: LineupPlayer[] = receiverPlayerNames.map((name, i) => {
          const p = data.receiver.gives_players[i]
          const pos = typeof p === 'object' ? p.position : receiverPlayerPrices[i].position
          return {
            name,
            position: pos || 'WR',
            impactValue: receiverPlayerPrices[i].assetValue.impactValue,
            vorpValue: receiverPlayerPrices[i].assetValue.vorpValue,
          }
        })
        const receiverReceivesAsLineup: LineupPlayer[] = senderPlayerNames.map((name, i) => {
          const p = data.sender.gives_players[i]
          const pos = typeof p === 'object' ? p.position : senderPlayerPrices[i].position
          return {
            name,
            position: pos || 'WR',
            impactValue: senderPlayerPrices[i].assetValue.impactValue,
            vorpValue: senderPlayerPrices[i].assetValue.vorpValue,
          }
        })

        const deltaSender = computeLineupDelta(
          senderLineupPlayers,
          senderPlayerNames,
          senderReceivesAsLineup,
          rosterSlots
        )
        const deltaReceiver = computeLineupDelta(
          receiverLineupPlayers,
          receiverPlayerNames,
          receiverReceivesAsLineup,
          rosterSlots
        )

        lineupDeltas = { sender: deltaSender, receiver: deltaReceiver }
        fairnessScore = computeLineupFairness(deltaSender, deltaReceiver)
        fairnessMethod = 'lineup'
      } catch (lineupErr) {
        console.warn('[TradeEval] Lineup optimization failed, falling back to composite:', (lineupErr as Error)?.message)
        fairnessScore = computeValueFairness(senderReceivedComposite, senderGivenComposite)
      }
    } else {
      fairnessScore = computeValueFairness(senderReceivedComposite, senderGivenComposite)
    }

    let idpLineupWarning: string | null = null
    if (data.league?.idp_enabled && data.league_id && hasFullRosters) {
      try {
        const requiredIdp = await getTotalIdpStarterSlots(data.league_id)
        if (requiredIdp > 0) {
          const senderGiveSet = new Set(senderPlayerNames.map((n) => (n || '').toLowerCase()))
          const receiverGiveSet = new Set(receiverPlayerNames.map((n) => (n || '').toLowerCase()))
          const senderKeptPositions = senderRoster
            .filter((r: any) => !senderGiveSet.has((typeof r === 'string' ? r : r?.name || r?.id || String(r) || '').toLowerCase()))
            .map((r: any) => (typeof r === 'object' ? r?.position : null))
          const receiverGivenPositions = receiverPlayerNames.map((_, i) => (receiverPlayerPrices[i]?.position ?? (data.receiver.gives_players[i] as any)?.position))
          const senderPostTrade = [...senderKeptPositions, ...receiverGivenPositions]
          const receiverKeptPositions = receiverRoster
            .filter((r: any) => !receiverGiveSet.has((typeof r === 'string' ? r : r?.name || r?.id || String(r) || '').toLowerCase()))
            .map((r: any) => (typeof r === 'object' ? r?.position : null))
          const senderGivenPositions = senderPlayerNames.map((_, i) => (senderPlayerPrices[i]?.position ?? (data.sender.gives_players[i] as any)?.position))
          const receiverPostTrade = [...receiverKeptPositions, ...senderGivenPositions]
          const senderOk = canFieldLegalIdpLineup(senderPostTrade, requiredIdp)
          const receiverOk = canFieldLegalIdpLineup(receiverPostTrade, requiredIdp)
          if (!senderOk || !receiverOk) {
            const who: string[] = []
            if (!senderOk) who.push('Sender')
            if (!receiverOk) who.push('Receiver')
            idpLineupWarning = `After this trade, ${who.join(' and ')} would not have enough IDP-eligible players to field a legal lineup (${requiredIdp} IDP starter slots required).`
          }
        }
      } catch (_) { /* non-critical */ }
    }

    const tradeLabels = detectTradeLabels({
      givenAssets: senderGivenAssets,
      receivedAssets: receiverGivenAssets,
      fairnessScore,
      givenValue: senderGivenTotal,
      receivedValue: senderReceivedTotal,
    })

    const hasTierJump = tradeLabels.some(l => l.id === 'tier_jump_win')

    const vetoResult = evaluateVeto({
      givenAssets: senderGivenAssets,
      receivedAssets: receiverGivenAssets,
      fairnessScore,
      leagueType: isSF ? 'SF' : '1QB',
      hasTierJump,
    })

    let confidenceInfo: { confidence: number; confidenceLabel: string; explanation: string } | null = null
    let dualModeGrades: Awaited<ReturnType<typeof computeDualModeGrades>> | null = null
    let historicalData: any = null
    const dataInfo = getDataInfo()

    if (data.asOfDate && dataInfo.loaded) {
      const historicalContext = buildHistoricalTradeContext(
        {
          date: data.asOfDate,
          sideAPlayers: senderPlayerNames,
          sideBPlayers: receiverPlayerNames,
          sideAPicks: senderPicksData,
          sideBPicks: receiverPicksData,
        },
        isSF
      )

      const playerResults = [
        ...senderPlayerPrices.map((priced, i) => ({ name: senderPlayerNames[i], found: priced.source !== 'unknown' })),
        ...receiverPlayerPrices.map((priced, i) => ({ name: receiverPlayerNames[i], found: priced.source !== 'unknown' })),
      ]
      const pickResults = [
        ...senderPickPrices.map(priced => ({ wasAveraged: priced.source === 'curve' })),
        ...receiverPickPrices.map(priced => ({ wasAveraged: priced.source === 'curve' })),
      ]

      const confidence = calculateTradeConfidence(playerResults, pickResults, 'exact')
      confidenceInfo = {
        confidence: confidence.confidence,
        confidenceLabel: confidence.confidenceLabel,
        explanation: confidence.explanation,
      }

      historicalData = {
        hindsightVerdict: historicalContext.hindsightVerdict,
        sideA: historicalContext.sideAContext,
        sideB: historicalContext.sideBContext,
      }

      dualModeGrades = await computeDualModeGrades(
        {
          date: data.asOfDate,
          sideAPlayers: senderPlayerNames,
          sideBPlayers: receiverPlayerNames,
          sideAPicks: senderPicksData,
          sideBPicks: receiverPicksData,
        },
        isSF
      )
    }

    let leagueDecisionCtx: LeagueDecisionContext | null = null
    try {
      if (data.league_id) {
        const [sleeperLeague, sleeperRosters, sleeperTradedPicks] = await Promise.all([
          getLeagueInfo(data.league_id),
          getLeagueRosters(data.league_id),
          getTradedDraftPicks(data.league_id),
        ])
        if (sleeperLeague && sleeperRosters.length > 0) {
          const senderRosterId = data.sender.team_id ? parseInt(data.sender.team_id) : undefined
          leagueDecisionCtx = await buildLeagueDecisionContext({
            league: sleeperLeague,
            rosters: sleeperRosters,
            tradedPicks: sleeperTradedPicks as any,
            userRosterId: senderRosterId,
            isSuperFlex: isSF,
          })
        }
      }
    } catch (ldcErr) {
      console.warn('[TradeEval] League decision context build failed (non-blocking):', (ldcErr as Error)?.message)
    }

    let leagueHistoryContext = ''
    try {
      if (data.league_id && userId) {
        const afLeague = await prisma.league.findFirst({
          where: {
            userId,
            platform: 'sleeper',
            platformLeagueId: String(data.league_id),
          },
          orderBy: { season: 'desc' },
          select: { id: true },
        })
        if (afLeague) {
          leagueHistoryContext = await buildLeagueContext(afLeague.id, data.sender.manager_name)
        }
      }
    } catch (histErr) {
      console.warn('[TradeEval] League history context failed (non-blocking):', (histErr as Error)?.message)
    }

    const tierImpactA = teamAGives.map(a => `${a.name}: ${a.tier}`).join(', ')
    const tierImpactB = teamAReceives.map(a => `${a.name}: ${a.tier}`).join(', ')

    const positiveLabels = getPositiveLabels(tradeLabels).map(l => l.id)
    const warningLabelIds = getWarningLabels(tradeLabels).map(l => l.id)

    const structuredPayload: Record<string, any> = {
      trade: {
        teamA: {
          id: data.sender.team_id || data.sender.manager_name,
          managerName: data.sender.manager_name,
          gives: teamAGives,
          receives: teamAReceives,
          faabGiven: data.sender.gives_faab ?? 0,
          faabReceived: data.receiver.gives_faab ?? 0,
        },
        teamB: {
          id: data.receiver.team_id || data.receiver.manager_name,
          managerName: data.receiver.manager_name,
          gives: teamAReceives,
          receives: teamAGives,
          faabGiven: data.receiver.gives_faab ?? 0,
          faabReceived: data.sender.gives_faab ?? 0,
        },
      },
      valuationReport: {
        teamA: {
          totalGiven: senderGivenComposite,
          totalReceived: senderReceivedComposite,
          netValue: teamANetValue,
          fairnessScore,
          fairnessMethod,
          marketGiven: senderGivenMarket,
          marketReceived: senderReceivedMarket,
          tierImpact: tierImpactA,
          labels: positiveLabels,
          warnings: warningLabelIds,
          ...(lineupDeltas && { lineupDelta: lineupDeltas.sender }),
        },
        teamB: {
          totalGiven: senderReceivedComposite,
          totalReceived: senderGivenComposite,
          netValue: teamBNetValue,
          fairnessScore: 100 - fairnessScore,
          fairnessMethod,
          marketGiven: senderReceivedMarket,
          marketReceived: senderGivenMarket,
          tierImpact: tierImpactB,
          labels: [],
          warnings: [],
          ...(lineupDeltas && { lineupDelta: lineupDeltas.receiver }),
        },
      },
      vetoStatus: {
        vetoed: vetoResult.veto,
        vetoReason: vetoResult.vetoReason,
        warning: vetoResult.warning,
        warningText: vetoResult.warningText,
      },
      leagueSettings: {
        format: data.league?.format ?? 'redraft',
        leagueType: data.league?.format === 'best_ball' ? 'bestball' : 'standard',
        sport: leagueSportSlug,
        qbFormat: data.league?.qb_format || 'sf',
        idpEnabled: data.league?.idp_enabled || false,
        biasMode,
        ...(data.league?.scoring_summary && { scoringSummary: data.league.scoring_summary }),
        ...(data.league?.roster_requirements && { rosterRequirements: data.league.roster_requirements }),
      },
      analysisMode: {
        timeContext: data.asOfDate ? 'AS_OF_DATE' : 'CURRENT',
        ...(data.asOfDate && { asOfDate: data.asOfDate }),
      },
      ...(leagueHistoryContext && { leagueHistoryContext }),
      ...(normalizedTradeBundle && {
        providerEvidence: {
          summary: {
            totalAssets: normalizedTradeBundle.summary.totalAssets,
            resolvedPlayers: normalizedTradeBundle.summary.resolvedPlayers,
            unresolvedPlayers: normalizedTradeBundle.summary.unresolvedPlayers,
            fallbackSources: normalizedTradeBundle.summary.fallbackSources.slice(0, 15),
            missingDomains: normalizedTradeBundle.summary.missingDomains.slice(0, 15),
          },
          ...(normalizedTradeBundle.summary.unresolvedPlayers > 0 ||
          normalizedTradeBundle.summary.missingDomains.length > 0
            ? {
                missingDataNote:
                  'Some player data was unavailable from imported provider cache.',
              }
            : {}),
        },
      }),
    }

    if (leagueDecisionCtx) {
      structuredPayload.leagueDecisionContext = {
        summary: summarizeLeagueDecisionContext(leagueDecisionCtx),
        snapshotCompleteness: leagueDecisionCtx.metadata.snapshotCompleteness,
        market: leagueDecisionCtx.market,
        partnerFit: leagueDecisionCtx.partnerFit,
        senderTeam: data.sender.team_id ? leagueDecisionCtx.teams[data.sender.team_id] : undefined,
        receiverTeam: data.receiver.team_id ? leagueDecisionCtx.teams[data.receiver.team_id] : undefined,
      }
    }

    const confidenceInputs: Record<string, number> = { base: 50 }
    if (leagueDecisionCtx?.metadata.snapshotCompleteness === 'FULL') confidenceInputs.snapshotFull = 20
    if (leagueDecisionCtx?.metadata.snapshotCompleteness === 'PARTIAL') confidenceInputs.snapshotPartial = -10
    if (Math.abs(fairnessScore - 50) > 10) confidenceInputs.clearValueDelta = 20
    if (Math.abs(fairnessScore - 50) < 5) confidenceInputs.thinDelta = -10
    if (leagueDecisionCtx && data.sender.team_id && data.receiver.team_id) {
      const sTeam = leagueDecisionCtx.teams[data.sender.team_id]
      const rTeam = leagueDecisionCtx.teams[data.receiver.team_id]
      if (sTeam && rTeam && sTeam.competitiveWindow !== rTeam.competitiveWindow) {
        confidenceInputs.windowAlignment = 15
      }
    }
    if (!data.sender.roster?.length) confidenceInputs.missingRosterInfo = -20

    const computedConfidenceScore = Math.max(0, Math.min(100,
      Object.values(confidenceInputs).reduce((s, v) => s + v, 0)
    ))

    const giveDriverAssets: Asset[] = [
      ...senderPlayerNames.map((name, i) => {
        const p = data.sender.gives_players[i]
        const pos = typeof p === 'object' ? p.position : undefined
        const age = typeof p === 'object' ? p.age : undefined
        return {
          id: name,
          type: 'PLAYER' as const,
          value: compositeScore(senderPlayerPrices[i].assetValue),
          marketValue: senderPlayerPrices[i].assetValue.marketValue,
          impactValue: senderPlayerPrices[i].assetValue.impactValue,
          vorpValue: senderPlayerPrices[i].assetValue.vorpValue,
          volatility: senderPlayerPrices[i].assetValue.volatility,
          name,
          pos,
          age,
        }
      }),
      ...senderPicksData.map((p, i) => ({
        id: p.label,
        type: 'PICK' as const,
        value: compositeScore(senderPickPrices[i].assetValue),
        marketValue: senderPickPrices[i].assetValue.marketValue,
        impactValue: senderPickPrices[i].assetValue.impactValue,
        vorpValue: senderPickPrices[i].assetValue.vorpValue,
        volatility: senderPickPrices[i].assetValue.volatility,
        name: p.label,
        round: p.round as 1 | 2 | 3 | 4,
      })),
    ]
    const receiveDriverAssets: Asset[] = [
      ...receiverPlayerNames.map((name, i) => {
        const p = data.receiver.gives_players[i]
        const pos = typeof p === 'object' ? p.position : undefined
        const age = typeof p === 'object' ? p.age : undefined
        return {
          id: name,
          type: 'PLAYER' as const,
          value: compositeScore(receiverPlayerPrices[i].assetValue),
          marketValue: receiverPlayerPrices[i].assetValue.marketValue,
          impactValue: receiverPlayerPrices[i].assetValue.impactValue,
          vorpValue: receiverPlayerPrices[i].assetValue.vorpValue,
          volatility: receiverPlayerPrices[i].assetValue.volatility,
          name,
          pos,
          age,
        }
      }),
      ...receiverPicksData.map((p, i) => ({
        id: p.label,
        type: 'PICK' as const,
        value: compositeScore(receiverPickPrices[i].assetValue),
        marketValue: receiverPickPrices[i].assetValue.marketValue,
        impactValue: receiverPickPrices[i].assetValue.impactValue,
        vorpValue: receiverPickPrices[i].assetValue.vorpValue,
        volatility: receiverPickPrices[i].assetValue.volatility,
        name: p.label,
        round: p.round as 1 | 2 | 3 | 4,
      })),
    ]

    let canonicalContext: TradeDecisionContextV1 | null = null
    try {
      const mapToLegacyAsset = (
        names: string[],
        prices: PricedAsset[],
        players: any[],
        type: 'PLAYER' | 'PICK',
      ): LegacyAssetInput[] =>
        names.map((name, i) => {
          const p = typeof players[i] === 'object' ? players[i] : {}
          return {
            name,
            type,
            position: p.position || prices[i]?.position || 'UNKNOWN',
            age: p.age ?? null,
            team: p.team ?? null,
            value: compositeScore(prices[i].assetValue),
            impactValue: prices[i].assetValue.impactValue,
            vorpValue: prices[i].assetValue.vorpValue,
            volatility: prices[i].assetValue.volatility,
            valuedAt: new Date().toISOString(),
          }
        })

      const sideALegacyAssets: LegacyAssetInput[] = [
        ...mapToLegacyAsset(senderPlayerNames, senderPlayerPrices, data.sender.gives_players, 'PLAYER'),
        ...senderPicksData.map((p, i) => ({
          name: p.label,
          type: 'PICK' as const,
          position: 'PICK',
          value: compositeScore(senderPickPrices[i].assetValue),
          impactValue: senderPickPrices[i].assetValue.impactValue,
          vorpValue: senderPickPrices[i].assetValue.vorpValue,
          volatility: senderPickPrices[i].assetValue.volatility,
        })),
      ]

      const sideBLegacyAssets: LegacyAssetInput[] = [
        ...mapToLegacyAsset(receiverPlayerNames, receiverPlayerPrices, data.receiver.gives_players, 'PLAYER'),
        ...receiverPicksData.map((p, i) => ({
          name: p.label,
          type: 'PICK' as const,
          position: 'PICK',
          value: compositeScore(receiverPickPrices[i].assetValue),
          impactValue: receiverPickPrices[i].assetValue.impactValue,
          vorpValue: receiverPickPrices[i].assetValue.vorpValue,
          volatility: receiverPickPrices[i].assetValue.volatility,
        })),
      ]

      canonicalContext = buildUnifiedTradeContext({
        legacyContext: leagueDecisionCtx,
        sideATeamId: data.sender.team_id,
        sideBTeamId: data.receiver.team_id,
        sideAName: data.sender.manager_name,
        sideBName: data.receiver.manager_name,
        sideAAssets: sideALegacyAssets,
        sideBAssets: sideBLegacyAssets,
        leagueConfig: {
          leagueId: data.league_id,
          leagueName: data.league?.scoring_summary || 'League',
          scoringType: data.league?.scoring_summary || 'ppr',
          isSF,
          isTEP: data.league?.scoring_summary?.toLowerCase().includes('te premium') || false,
        },
        valuationFetchedAt: new Date().toISOString(),
      })
    } catch (ctxErr) {
      console.warn('[TradeEval] Canonical context build failed (non-blocking):', (ctxErr as Error)?.message)
    }

    const calWeights = await getCalibratedWeights()
    const isTEP = data.league?.scoring_summary?.toLowerCase().includes('te premium') || false

    let tradeDriverData: ReturnType<typeof computeTradeDrivers> | null = null
    try {
      tradeDriverData = computeTradeDrivers(
        giveDriverAssets, receiveDriverAssets, null, null,
        isSF, isTEP, undefined, undefined, undefined, undefined, undefined, calWeights,
      )
    } catch (e) {
      console.warn('[trade-evaluator] computeTradeDrivers failed, continuing without accept probability:', e)
    }

    const acceptDrivers = tradeDriverData?.acceptDrivers ?? []
    const confidenceDrivers = tradeDriverData?.confidenceDrivers ?? []

    if (tradeDriverData) {
      confidenceInputs.acceptProbModel = Math.round(tradeDriverData.acceptProbability * 100)
    }

    structuredPayload.confidenceInputs = {
      factors: confidenceInputs,
      computedScore: computedConfidenceScore,
    }

    if (historicalData) {
      structuredPayload.historicalContext = historicalData
    }

    const senderTeamId = data.sender.team_id || data.sender.manager_name
    const receiverTeamId = data.receiver.team_id || data.receiver.manager_name

    const senderTeamCtx = leagueDecisionCtx?.teams[data.sender.team_id || '']
    const receiverTeamCtx = leagueDecisionCtx?.teams[data.receiver.team_id || '']

    const youSendAssets = [
      ...senderPlayerNames.map((name, i) => ({
        id: name,
        label: name,
        kind: 'PLAYER' as const,
        tier: valueToTier(senderPlayerPrices[i].assetValue.marketValue),
        value: compositeScore(senderPlayerPrices[i].assetValue),
        assetValue: senderPlayerPrices[i].assetValue,
      })),
      ...senderPicksData.map((p, i) => ({
        id: p.label,
        label: p.label,
        kind: 'PICK' as const,
        tier: valueToTier(senderPickPrices[i].assetValue.marketValue),
        value: compositeScore(senderPickPrices[i].assetValue),
        assetValue: senderPickPrices[i].assetValue,
      })),
    ]

    const youReceiveAssets = [
      ...receiverPlayerNames.map((name, i) => ({
        id: name,
        label: name,
        kind: 'PLAYER' as const,
        tier: valueToTier(receiverPlayerPrices[i].assetValue.marketValue),
        value: compositeScore(receiverPlayerPrices[i].assetValue),
        assetValue: receiverPlayerPrices[i].assetValue,
      })),
      ...receiverPicksData.map((p, i) => ({
        id: p.label,
        label: p.label,
        kind: 'PICK' as const,
        tier: valueToTier(receiverPickPrices[i].assetValue.marketValue),
        value: compositeScore(receiverPickPrices[i].assetValue),
        assetValue: receiverPickPrices[i].assetValue,
      })),
    ]

    const userRoster = data.sender.roster || []
    const userRosterAllowed = userRoster.map((r: any) => ({
      id: typeof r === 'string' ? r : r.name || r.id || String(r),
      label: typeof r === 'string' ? r : r.name || r.id || String(r),
      kind: 'PLAYER' as const,
    }))
    const userPicksAllowed = (data.sender.picks_owned || []).map((p: any) => ({
      id: `${p.year} Round ${p.round}`,
      label: `${p.year} Round ${p.round}${p.projected_range ? ` (${p.projected_range})` : ''}`,
    }))
    const partnerPicksAllowed = (data.receiver.picks_owned || []).map((p: any) => ({
      id: `${p.year} Round ${p.round}`,
      label: `${p.year} Round ${p.round}${p.projected_range ? ` (${p.projected_range})` : ''}`,
    }))

    const fairnessBandPct = 15
    const latePicks = userPicksAllowed.filter((p: { id: string }) =>
      p.id.includes('Round 3') || p.id.includes('Round 4')
    ).map((p: { id: string }) => p.id)

    const negotiationInput: Record<string, unknown> = {
      negotiationRequest: {
        enabled: true,
        fairnessBandPct,
        maxDmMessages: 5,
        maxCounters: 4,
        maxSweeteners: 3,
        userObjective: senderTeamCtx?.competitiveWindow === 'WIN_NOW'
          ? 'WIN_NOW'
          : senderTeamCtx?.competitiveWindow === 'REBUILD'
            ? 'REBUILD'
            : 'BALANCED',
      },
      candidateTrade: {
        tradeId: data.trade_id || `eval_${Date.now()}`,
        teamAId: senderTeamId,
        teamBId: receiverTeamId,
        youSend: youSendAssets,
        youReceive: youReceiveAssets,
        partnerWindow: receiverTeamCtx?.competitiveWindow || 'MIDDLE',
        reasonCodes: [...positiveLabels, ...warningLabelIds],
      },
      allowedAssets: {
        userAssetsAllowed: [
          ...youSendAssets.map(a => ({ id: a.id, label: a.label, kind: a.kind })),
          ...userRosterAllowed,
        ],
        partnerAssetsAllowed: youReceiveAssets.map(a => ({ id: a.id, label: a.label, kind: a.kind })),
        userPicksAllowed,
        partnerPicksAllowed,
        userFaabRemaining: data.sender.faab_remaining,
        partnerFaabRemaining: data.receiver.faab_remaining,
      },
      fairnessConstraints: {
        currentFairnessScore: fairnessScore,
        bandMinPct: -fairnessBandPct,
        bandMaxPct: fairnessBandPct,
        suggestedFaabSteps: buildFaabSteps(data.sender.faab_remaining),
        suggestedPickSweeteners: latePicks.length > 0 ? latePicks : undefined,
      },
    }

    if (senderTeamCtx && receiverTeamCtx) {
      negotiationInput.leagueNegotiationContext = {
        userNeeds: senderTeamCtx.needs,
        partnerNeeds: receiverTeamCtx.needs,
        userSurpluses: senderTeamCtx.surpluses,
        partnerSurpluses: receiverTeamCtx.surpluses,
        scarcityNotes: buildScarcityNotes(leagueDecisionCtx?.market?.scarcityByPosition as Record<string, number> | undefined),
      }
    }

    structuredPayload.negotiationInput = negotiationInput

    const gptContract = tradeDriverData
      ? buildGptInputContract('TRADE_EVALUATOR', tradeDriverData)
      : null

    const skipGpt = gptContract ? shouldSkipGpt(gptContract) : 'INCOMPLETE_DRIVER_SET'

    let parsed: Record<string, any> | null = null
    let narrativeValid = false
    let deepseekQuantResult: Record<string, any> | null = null
    let grokTrendResult: Record<string, any> | null = null
    const aiProviders: { openai: string; deepseek: string; grok: string } = {
      openai: 'skipped',
      deepseek: 'skipped',
      grok: 'skipped',
    }

    const normalizedEvidencePrompt =
      normalizedTradeBundle &&
      (normalizedTradeBundle.players.length > 0 || normalizedTradeBundle.unresolvedPlayers.length > 0)
        ? buildNormalizedTradeEvidencePrompt(normalizedTradeBundle)
        : ''
    const providerMissingNote =
      normalizedTradeBundle &&
      (normalizedTradeBundle.summary.unresolvedPlayers > 0 ||
        normalizedTradeBundle.summary.missingDomains.length > 0)
        ? '\nNote: Some player data was unavailable from imported provider cache.'
        : ''

    const tradeContextForAI = `
TRADE DETAILS:
Team A (${data.sender.manager_name}) gives: ${senderPlayerNames.join(', ')}${senderPicksData.length ? ', ' + senderPicksData.map(p => p.label).join(', ') : ''}
Team B (${data.receiver.manager_name}) gives: ${receiverPlayerNames.join(', ')}${receiverPicksData.length ? ', ' + receiverPicksData.map(p => p.label).join(', ') : ''}

LEAGUE: ${data.league?.format || 'dynasty'} | ${data.league?.qb_format || 'sf'} | ${isSF ? 'Superflex' : '1QB'}
Team A total value: ${senderGivenComposite}
Team B total value: ${senderReceivedComposite}
Net delta: ${teamANetValue}
Fairness score: ${fairnessScore}/100
${normalizedEvidencePrompt ? `\nNORMALIZED PROVIDER EVIDENCE (supplemental — internal trade values above remain authoritative for fairness):\n${normalizedEvidencePrompt}${providerMissingNote}` : ''}
    `.trim()

    const [dsResult, grokResult] = await Promise.allSettled([
      deepseekQuantAnalysis(
        `${DEEPSEEK_TRADE_SYSTEM}\n\nAnalyze this trade:\n${tradeContextForAI}`
      ).catch((e: any) => {
        console.warn('[TradeEval] DeepSeek failed:', e?.message)
        return { json: null, raw: '', error: e?.message }
      }),

      xaiChatJson({
        messages: [
          { role: 'system', content: GROK_TRADE_SYSTEM },
          { role: 'user', content: `Analyze player signals for this trade:\n${tradeContextForAI}` },
        ],
        tools: [{ type: 'web_search', user_location_country: 'US' }],
        temperature: 0.3,
        maxTokens: 400,
      }).catch((e: any) => {
        console.warn('[TradeEval] Grok failed:', e?.message)
        return null
      }),
    ])

    if (dsResult.status === 'fulfilled' && dsResult.value?.json) {
      deepseekQuantResult = dsResult.value.json
      aiProviders.deepseek = 'ok'
      await logAiOutput({
        provider: 'deepseek',
        role: 'quantitative',
        taskType: 'trade_eval',
        targetType: 'league',
        targetId: data.league_id || undefined,
        model: 'deepseek',
        contentJson: deepseekQuantResult,
      })
    } else {
      aiProviders.deepseek = 'error'
      const reason = dsResult.status === 'rejected' ? dsResult.reason : (dsResult.status === 'fulfilled' ? dsResult.value?.error : undefined)
      if (reason) console.warn('[TradeEval] DeepSeek result:', reason)
    }

    if (grokResult.status === 'fulfilled' && grokResult.value) {
      const gVal = grokResult.value
      if (gVal.ok) {
        const grokText = parseTextFromXaiChatCompletion(gVal.json) ?? ''
        const grokParsed = parseJsonSafe(grokText)
        if (grokParsed) {
          grokTrendResult = grokParsed
          aiProviders.grok = 'ok'
          await logAiOutput({
            provider: 'grok',
            role: 'realtime',
            taskType: 'trade_eval',
            targetType: 'league',
            targetId: data.league_id || undefined,
            model: 'grok',
            contentJson: grokTrendResult,
          })
        } else {
          aiProviders.grok = 'error'
        }
      } else {
        aiProviders.grok = 'error'
      }
    } else {
      aiProviders.grok = 'error'
    }

    const gptPayload: Record<string, any> = {
      trade: structuredPayload.trade,
      vetoStatus: structuredPayload.vetoStatus,
      leagueSettings: structuredPayload.leagueSettings,
      analysisMode: structuredPayload.analysisMode,
      negotiationInput,
      ...(structuredPayload.leagueDecisionContext && {
        leagueDecisionContext: structuredPayload.leagueDecisionContext,
      }),
      ...(structuredPayload.confidenceInputs && {
        confidenceInputs: structuredPayload.confidenceInputs,
      }),
      ...(structuredPayload.historicalContext && {
        historicalContext: structuredPayload.historicalContext,
      }),
    }

    if (skipGpt !== 'ok') {
      console.warn(`[trade-evaluator] Skipping GPT: ${skipGpt}`)
    } else {
      const leagueSportNorm = normalizeToSupportedSport(String(data.league?.sport || 'nfl'))
      const lf = data.league?.format
      const formatForValues =
        lf === 'redraft' ? ('redraft' as const)
        : lf === 'dynasty' ? ('dynasty' as const)
        : lf === 'best_ball' ? ('bestball' as const)
        : undefined
      const playerValuesCtx = getPlayerValuesContext({
        sport: leagueSportNorm,
        ...(formatForValues ? { format: formatForValues } : {}),
      })
      const systemPrompt =
        STRUCTURED_TRADE_EVAL_SYSTEM_PROMPT +
        '\n\n' +
        GPT_NARRATIVE_SYSTEM_PROMPT +
        (leagueHistoryContext
          ? `\n\nLEAGUE HISTORY & MANAGER TIERS (use for negotiation leverage — do not contradict deterministic values):\n${leagueHistoryContext}`
          : '') +
        (playerValuesCtx
          ? `\n\n${playerValuesCtx}\n\nUse these player values when making recommendations, comparisons, and rankings. Prefer these values over your general training knowledge when they conflict.`
          : '')
      const narrativePrompt = gptContract ? buildGptUserPrompt(gptContract) : ''

      const enrichedPayloadStr = `${narrativePrompt}\n\n${JSON.stringify(gptPayload)}\n\n` +
        (normalizedEvidencePrompt
          ? `NORMALIZED PROVIDER EVIDENCE (supplemental — not trade value):\n${normalizedEvidencePrompt}${providerMissingNote}\n\n`
          : '') +
        `QUANTITATIVE ANALYSIS (DeepSeek):\n${deepseekQuantResult ? JSON.stringify(deepseekQuantResult, null, 2) : 'Unavailable'}\n\n` +
        `REAL-TIME SIGNALS (Grok):\n${grokTrendResult ? JSON.stringify(grokTrendResult, null, 2) : 'Unavailable'}\n\n` +
        `Synthesize all data into Chimmy's trade recommendation.\n\n${NEGOTIATION_USER_INSTRUCTION}`

      const result = await openaiChatJson({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: enrichedPayloadStr },
        ],
        temperature: 0.2,
        maxTokens: 6000,
      })

      if (result.ok === false) {
        console.error('Trade evaluator OpenAI error:', {
          status: result.status,
          details: result.details?.slice(0, 500),
        })
        aiProviders.openai = 'error'
      } else {
        aiProviders.openai = 'ok'
        parsed = parseJsonContentFromChatCompletion(result.json)
        await logAiOutput({
          provider: 'openai',
          role: 'narrative',
          taskType: 'trade_eval',
          targetType: 'league',
          targetId: data.league_id || undefined,
          model: (result as any)?.json?.model ?? undefined,
          contentJson: parsed ?? null,
        })

        if (parsed && gptContract) {
          const driverIds = gptContract.drivers.map(d => d.id)
          const confDriverIds = gptContract.confidenceDrivers.map(d => d.id)
          const narrativeProxy = {
            bullets: [
              parsed.explanation?.summary ? { text: parsed.explanation.summary, driverId: driverIds[0] || '' } : null,
              parsed.explanation?.teamAReasoning ? { text: parsed.explanation.teamAReasoning, driverId: driverIds[1] || driverIds[0] || '' } : null,
              parsed.explanation?.teamBReasoning ? { text: parsed.explanation.teamBReasoning, driverId: driverIds[2] || driverIds[0] || '' } : null,
            ].filter(Boolean),
            sensitivity: {
              text: parsed.explanation?.leagueContextNotes?.[0] || '',
              driverId: confDriverIds[0] || '',
            },
          }
          const validation = validateGptNarrativeOutput(narrativeProxy, gptContract)
          logNarrativeValidation({ mode: 'STRUCTURED', contractType: 'narrative', valid: validation.valid, violations: validation.violations }).catch(() => {})
          if (validation.violations.length > 0) {
            console.warn('[trade-evaluator] GPT narrative violations:', validation.violations)
          }
          narrativeValid = validation.valid
          if (!narrativeValid) {
            console.warn('[trade-evaluator] GPT narrative rejected — fail-closed')
          }
        }
      }
    }

    if (parsed && grokTrendResult?.injuryAlerts?.length) {
      parsed.riskFlags = [
        ...(parsed.riskFlags ?? []),
        ...grokTrendResult.injuryAlerts.slice(0, 2),
      ]
    }
    if (parsed && deepseekQuantResult?.quantReasoning && !parsed.keyInsight) {
      parsed.keyInsight = deepseekQuantResult.quantReasoning
    }
    if (parsed && grokTrendResult?.playerSignals?.length) {
      parsed.playerSignals = grokTrendResult.playerSignals
    }

    if (!parsed) {
      parsed = {
        verdict: { overall: 'FAIR', teamA: 'NEUTRAL', teamB: 'NEUTRAL' },
        explanation: {
          summary: AI_OUTPUT_INVALID_FALLBACK.fallback,
          teamAReasoning: AI_OUTPUT_INVALID_FALLBACK.fallback,
          teamBReasoning: AI_OUTPUT_INVALID_FALLBACK.fallback,
          leagueContextNotes: [],
        },
        confidence: {
          rating: tradeDriverData?.confidenceRating ?? 'LEARNING',
          score: computedConfidenceScore,
          drivers: [],
        },
        betterAlternatives: [],
        riskFlags: tradeDriverData?.riskFlags ?? [],
        _aiOutputInvalid: true,
      }
    }

    const structuredValidation = StructuredTradeEvalResponseSchema.safeParse(parsed)

    const tradeInsights = {
      fairnessScore,
      fairnessMethod,
      ...(lineupDeltas && { lineupDeltas }),
      netDeltaPct: senderGivenComposite > 0 ? Math.round(((senderReceivedComposite - senderGivenComposite) / senderGivenComposite) * 100) : 0,
      labels: getPositiveLabels(tradeLabels).map(l => ({ id: l.id, name: l.name, emoji: l.emoji, description: l.description })),
      warnings: getWarningLabels(tradeLabels).map(l => ({ id: l.id, name: l.name, emoji: l.emoji, description: l.description })),
      veto: vetoResult.veto,
      vetoReason: vetoResult.vetoReason,
      expertWarning: vetoResult.warning ? vetoResult.warningText : null,
      ...(idpLineupWarning && { idpLineupWarning }),
    }

    const acceptProbData = tradeDriverData ? {
      probability: tradeDriverData.acceptProbability,
      percentDisplay: `${Math.round(tradeDriverData.acceptProbability * 100)}%`,
      drivers: acceptDrivers,
      scores: {
        lineupImpact: Math.round(tradeDriverData.lineupImpactScore * 100) / 100,
        vorp: Math.round(tradeDriverData.vorpScore * 100) / 100,
        market: Math.round(tradeDriverData.marketScore * 100) / 100,
        behavior: Math.round(tradeDriverData.behaviorScore * 100) / 100,
      },
      verdict: tradeDriverData.verdict,
      lean: tradeDriverData.lean,
      fairnessDelta: tradeDriverData.fairnessDelta,
      confidenceDrivers,
      acceptBullets: tradeDriverData.acceptBullets,
      sensitivitySentence: tradeDriverData.sensitivitySentence,
    } : null

    if (!structuredValidation.success) {
      console.error('Structured AI response validation failed:', structuredValidation.error.errors)
      let partialCanonicalMeta: Record<string, any> | undefined
      if (canonicalContext) {
        const coverage = computeDataCoverageTier(
          canonicalContext.dataQuality,
          canonicalContext.missingData,
          canonicalContext.sourceFreshness,
        )
        partialCanonicalMeta = {
          contextId: canonicalContext.contextId,
          dataFreshness: canonicalContext.sourceFreshness ? {
            compositeGrade: canonicalContext.sourceFreshness.compositeGrade,
            compositeScore: canonicalContext.sourceFreshness.compositeScore,
            warnings: canonicalContext.sourceFreshness.warnings,
          } : null,
          dataCoverage: { tier: coverage.tier, score: coverage.score, badge: coverage.badge },
        }
      }

      const partialPayload = {
        success: true,
        evaluation: parsed,
        schemaValid: false,
        warning: 'Response partially validated — AI output did not match strict schema',
        rate_limit: { remaining: rl.remaining, retryAfterSec: rl.retryAfterSec },
        tokenSpend: gate.tokenSpend
          ? {
              ruleCode: gate.tokenPreview?.ruleCode ?? 'ai_trade_analyzer_full_review',
              tokenCost: gate.tokenPreview?.tokenCost ?? null,
              balanceAfter: gate.tokenSpend.balanceAfter,
              ledgerId: gate.tokenSpend.id,
            }
          : null,
        ...(structuredPayload.providerEvidence && {
          providerEvidence: structuredPayload.providerEvidence,
        }),
        ...(confidenceInfo && { historicalAnalysis: confidenceInfo }),
        ...(dualModeGrades && { dualModeGrades }),
        tradeInsights,
        valuationReport: structuredPayload.valuationReport,
        serverConfidence: {
          score: computedConfidenceScore,
          factors: confidenceInputs,
          triangulated: triangulateConfidence(
            computedConfidenceScore,
            parsed?.confidence?.score ?? null,
            deepseekQuantResult?.confidencePct ?? null
          ),
        },
        acceptProbability: acceptProbData,
        ...(partialCanonicalMeta && { canonicalContext: partialCanonicalMeta }),
        ...(deepseekQuantResult && { quantAnalysis: deepseekQuantResult }),
        ...(grokTrendResult && { trendIntelligence: grokTrendResult }),
        aiProviders,
      }

      return NextResponse.json(
        await runTradeEvaluatorPECR({
          payload: partialPayload,
          recommendation: resolveTradeRecommendation(parsed),
          valueDelta: teamANetValue,
          qualityGate: extractTradeQualityGate(parsed),
        })
      )
    }

    const evalData = structuredValidation.data

    let negotiationToolkit: import('@/lib/trade-engine/types').NegotiationToolkit | null = null
    if (tradeDriverData) {
      const benchAssets: Asset[] = (data.sender.roster || [])
        .filter((r: any) => {
          const name = typeof r === 'string' ? r : r.name || r.id || String(r)
          return !giveDriverAssets.some(g => g.id === name)
        })
        .map((r: any) => {
          const name = typeof r === 'string' ? r : r.name || r.id || String(r)
          const pos = typeof r === 'object' ? r.position : undefined
          const age = typeof r === 'object' ? r.age : undefined
          return { id: name, type: 'PLAYER' as const, value: 0, name, pos, age } as Asset
        })

      const pickInputs = (data.sender.picks_owned || [])
        .filter((p: any) => !giveDriverAssets.some(g => g.id === `${p.year} Round ${p.round}`))
        .map((p: any) => ({
          id: `${p.year} Round ${p.round}`,
          displayName: `${p.year} Round ${p.round}${p.projected_range ? ` (${p.projected_range})` : ''}`,
          round: p.round as number,
          season: p.year as number,
          value: p.round === 1 ? 5000 : p.round === 2 ? 2500 : p.round === 3 ? 1000 : 500,
        }))

      negotiationToolkit = buildNegotiationToolkit({
        drivers: tradeDriverData,
        give: giveDriverAssets,
        receive: receiveDriverAssets,
        availableBenchAssets: benchAssets,
        availablePicks: pickInputs,
        userFaabRemaining: data.sender.faab_remaining,
        partnerNeeds: senderTeamCtx ? receiverTeamCtx?.needs : undefined,
        userNeeds: senderTeamCtx?.needs,
      })

      const negContract = buildNegotiationGptContract(tradeDriverData)
      const negSkipCheck = shouldSkipNegotiationGpt(negContract)

      if (negSkipCheck === 'ok') {
        try {
          const negResult = await openaiChatJson({
            messages: [
              { role: 'system', content: NEGOTIATION_GPT_SYSTEM_PROMPT },
              { role: 'user', content: buildNegotiationGptUserPrompt(negContract) },
            ],
            temperature: 0.3,
            maxTokens: 500,
          })

          if (negResult.ok) {
            const negParsed = parseJsonContentFromChatCompletion(negResult.json)
            if (negParsed) {
              const negValidation = validateNegotiationGptOutput(negParsed, negContract)
              logNarrativeValidation({ mode: 'STRUCTURED', contractType: 'negotiation', valid: negValidation.valid, violations: negValidation.violations }).catch(() => {})
              if (negValidation.violations.length > 0) {
                console.warn('[trade-evaluator] Negotiation GPT violations:', negValidation.violations)
              }
              if (negValidation.valid && negValidation.cleaned) {
                if (negValidation.cleaned.opener || negValidation.cleaned.rationale || negValidation.cleaned.fallback) {
                  negotiationToolkit.dmMessages = {
                    opener: negValidation.cleaned.opener || negotiationToolkit.dmMessages.opener,
                    rationale: negValidation.cleaned.rationale || negotiationToolkit.dmMessages.rationale,
                    fallback: negValidation.cleaned.fallback || negotiationToolkit.dmMessages.fallback,
                  }
                }

                if (negValidation.cleaned.counters.length > 0) {
                  for (const gc of negValidation.cleaned.counters) {
                    const matchingCounter = negotiationToolkit.counters.find(c =>
                      c.expected.driverChanges.some(dc => gc.driverIds.includes(dc.driverId))
                    )
                    if (matchingCounter) {
                      matchingCounter.description = gc.description.replace(/\s*\([a-z_]+\)\s*$/, '')
                    }
                  }
                }
              } else {
                console.warn('[trade-evaluator] Negotiation GPT rejected — fail-closed')
              }
            }
          }
        } catch (negErr) {
          console.warn('[trade-evaluator] Negotiation GPT failed, using deterministic fallback')
        }
      } else {
        console.warn(`[trade-evaluator] Skipping negotiation GPT: ${negSkipCheck}`)
      }

      evalData.negotiation = negotiationToolkitToLegacy(negotiationToolkit) as any
    } else if (evalData.negotiation) {
      const userAllowedIds = new Set<string>([
        ...youSendAssets.map(a => a.id),
        ...userRosterAllowed.map((a: { id: string }) => a.id),
        ...userPicksAllowed.map((p: { id: string }) => p.id),
      ])
      const partnerAllowedIds = new Set<string>([
        ...youReceiveAssets.map(a => a.id),
        ...partnerPicksAllowed.map((p: { id: string }) => p.id),
      ])
      const safeNegotiation = clampNegotiationToAllowed({
        negotiation: evalData.negotiation,
        allowed: {
          userAllowedIds,
          partnerAllowedIds,
          userFaabRemaining: data.sender.faab_remaining,
        },
      })
      evalData.negotiation = safeNegotiation ?? { dmMessages: [], counters: [], sweeteners: [], redLines: [] }
    }

    const gptConfidence = evalData.confidence?.score ?? null
    const quantConfidence = deepseekQuantResult?.confidencePct ?? null
    const triangulated = triangulateConfidence(computedConfidenceScore, gptConfidence, quantConfidence)
    if (!evalData.confidence) {
      evalData.confidence = { score: triangulated.finalScore, rating: 'LEARNING', drivers: [] }
    }
    if (!Array.isArray(evalData.confidence.drivers)) {
      evalData.confidence.drivers = []
    }
    evalData.confidence.score = triangulated.finalScore
    if (triangulated.overrideApplied) {
      evalData.confidence.drivers.push(...triangulated.auditLog)
    }
    if (triangulated.finalScore >= 70) evalData.confidence.rating = 'HIGH'
    else if (triangulated.finalScore >= 40) evalData.confidence.rating = 'MEDIUM'
    else evalData.confidence.rating = 'LEARNING'

    logTradeOfferEvent({
      leagueId: data.league_id ?? null,
      senderUserId: data.sleeperUser?.userId ?? data.sender.team_id ?? null,
      opponentUserId: data.receiver.team_id ?? null,
      assetsGiven: senderGivenAssetsList.map(a => ({ name: a.name, value: compositeScore(a.assetValue), type: a.source })),
      assetsReceived: senderReceivedAssetsList.map(a => ({ name: a.name, value: compositeScore(a.assetValue), type: a.source })),
      features: tradeDriverData ? {
        lineupImpact: tradeDriverData.lineupImpactScore,
        vorp: tradeDriverData.vorpScore,
        market: tradeDriverData.marketScore,
        behavior: tradeDriverData.behaviorScore,
        weights: [0.40, 0.25, 0.20, 0.15],
      } : null,
      segmentParts: {
        isSuperflex: isSF,
        isTEPremium: isTEP,
        leagueSize: null,
        opponentTradeSampleSize: null,
      },
      acceptProb: tradeDriverData?.acceptProbability ?? null,
      verdict: tradeDriverData?.verdict ?? null,
      confidenceScore: computedConfidenceScore,
      driverSet: tradeDriverData?.acceptDrivers.map(d => ({ id: d.id, evidence: typeof d.evidence === 'string' ? d.evidence : JSON.stringify(d.evidence) })) ?? null,
      mode: 'STRUCTURED',
      isSuperFlex: isSF,
      leagueFormat: data.league?.format ?? null,
      scoringType: isTEP ? 'TEP' : 'PPR',
    }).catch(() => {})

    let canonicalContextMeta: Record<string, any> | undefined
    if (canonicalContext) {
      const coverage = computeDataCoverageTier(
        canonicalContext.dataQuality,
        canonicalContext.missingData,
        canonicalContext.sourceFreshness,
      )
      canonicalContextMeta = {
        contextId: canonicalContext.contextId,
        version: canonicalContext.version,
        dataFreshness: canonicalContext.sourceFreshness ? {
          compositeGrade: canonicalContext.sourceFreshness.compositeGrade,
          compositeScore: canonicalContext.sourceFreshness.compositeScore,
          sources: {
            rosters: { grade: canonicalContext.sourceFreshness.rosters.grade, age: canonicalContext.sourceFreshness.rosters.ageLabel },
            valuations: { grade: canonicalContext.sourceFreshness.valuations.grade, age: canonicalContext.sourceFreshness.valuations.ageLabel },
            injuries: { grade: canonicalContext.sourceFreshness.injuries.grade, age: canonicalContext.sourceFreshness.injuries.ageLabel },
            adp: { grade: canonicalContext.sourceFreshness.adp.grade, age: canonicalContext.sourceFreshness.adp.ageLabel },
            analytics: { grade: canonicalContext.sourceFreshness.analytics.grade, age: canonicalContext.sourceFreshness.analytics.ageLabel },
            tradeHistory: { grade: canonicalContext.sourceFreshness.tradeHistory.grade, age: canonicalContext.sourceFreshness.tradeHistory.ageLabel },
          },
          warnings: canonicalContext.sourceFreshness.warnings,
        } : null,
        dataCoverage: {
          tier: coverage.tier,
          score: coverage.score,
          badge: coverage.badge,
          dimensions: coverage.dimensions,
        },
        dataQuality: canonicalContext.dataQuality,
      }
    }

    const payload = {
      success: true,
      evaluation: evalData,
      schemaValid: true,
      rate_limit: { remaining: rl.remaining, retryAfterSec: rl.retryAfterSec },
      tokenSpend: gate.tokenSpend
        ? {
            ruleCode: gate.tokenPreview?.ruleCode ?? 'ai_trade_analyzer_full_review',
            tokenCost: gate.tokenPreview?.tokenCost ?? null,
            balanceAfter: gate.tokenSpend.balanceAfter,
            ledgerId: gate.tokenSpend.id,
          }
        : null,
      ...(structuredPayload.providerEvidence && {
        providerEvidence: structuredPayload.providerEvidence,
      }),
      ...(confidenceInfo && { historicalAnalysis: confidenceInfo }),
      ...(dualModeGrades && { dualModeGrades }),
      tradeInsights,
      valuationReport: structuredPayload.valuationReport,
      serverConfidence: {
        score: computedConfidenceScore,
        factors: confidenceInputs,
        triangulated,
      },
      acceptProbability: acceptProbData,
      ...(negotiationToolkit && { negotiationToolkit }),
      ...(canonicalContextMeta && { canonicalContext: canonicalContextMeta }),
      ...(deepseekQuantResult && { quantAnalysis: deepseekQuantResult }),
      ...(grokTrendResult && { trendIntelligence: grokTrendResult }),
      aiProviders,
    }
    const tradeRecommendation = resolveTradeRecommendation(evalData) ?? ''
    const tradeRuleCheck = checkBehaviorRules(tradeRecommendation, {
      input: JSON.stringify({ giving: senderPlayerNames, receiving: receiverPlayerNames }),
      featureName: 'trade',
    })
    logRuleViolations(userId ?? null, 'trade', tradeRuleCheck.violations, 1).catch(() => {})

    if (cacheKey && config.cacheTtlMs) {
      setCachedResponse(cacheKey, { ...payload, tokenSpend: null }, config.cacheTtlMs)
    }
    return NextResponse.json(
      await runTradeEvaluatorPECR({
        payload,
        recommendation: tradeRecommendation || null,
        valueDelta: teamANetValue,
        qualityGate: extractTradeQualityGate(evalData),
      })
    )
  } catch (error) {
    if (tokenFallbackLedgerId && userId) {
      await new TokenSpendService()
        .refundSpendByLedger({
          userId,
          spendLedgerId: tokenFallbackLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'trade_evaluator_refund',
          sourceId: tokenFallbackLedgerId,
          idempotencyKey: `refund:trade_evaluator:${tokenFallbackLedgerId}`,
          description: 'Auto refund after failed trade evaluator request.',
          metadata: {},
        })
        .catch(() => null)
    }
    logAiFailure(error, { tool: 'TradeEvaluator', endpoint: '/api/trade-evaluator' })
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request format', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to evaluate trade' }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/trade-evaluator", tool: "TradeEvaluator" })(async () => {
  return NextResponse.json({
    message: 'AllFantasy Trade Evaluator API v3 — Structured Decision Engine',
  })
})
