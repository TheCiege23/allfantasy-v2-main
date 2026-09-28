import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { runPECR } from '@/lib/ai/pecr'
import {
  buildFaabSteps,
  buildScarcityNotes,
  clampNegotiationToAllowed,
} from '@/lib/trade-finder/negotiation-helpers'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { consumeRateLimit } from '@/lib/rate-limit'
import { checkAiRateLimit, getCachedResponse, setCachedResponse, buildCacheKey, getAiActionConfig } from '@/lib/ai-protection'
import { buildHistoricalTradeContext, getDataInfo, calculateTradeConfidence, computeDualModeGrades } from '@/lib/historical-values'
import { pricePlayer, pricePick, compositeScore, compositeTotal, idpCeilingCompositeBand, isEvidencedPrice, ValuationContext, type PricedAsset } from '@/lib/hybrid-valuation'
import { computeLineupDelta, computeLineupFairness, computeValueFairness, type LineupPlayer, type RosterSlots, type LineupDelta } from '@/lib/lineup-optimizer'
import { parseSleeperRosterPositions } from '@/lib/trade-engine/sleeper-converter'
import { computeTradeDrivers } from '@/lib/trade-engine/trade-engine'
import { getTotalIdpStarterSlots, canFieldLegalIdpLineup } from '@/lib/trade-engine/idp-lineup-check'
import { loadLeagueTradeValues } from '@/lib/league-values/leagueTradeValues'
import { normalizedFaabValue } from '@/lib/trade-value/faabValue'
import { resolveSuperflex } from '@/lib/trade-value/superflexResolution'
import { identifyDevyAssets } from '@/lib/devy/devyTradeVerdict'
import { buildNegotiationToolkit, negotiationToolkitToLegacy } from '@/lib/trade-engine/negotiation-builder'
import { buildNegotiationGptContract, buildNegotiationGptUserPrompt, validateNegotiationGptOutput, shouldSkipNegotiationGpt, NEGOTIATION_GPT_SYSTEM_PROMPT } from '@/lib/trade-engine/negotiation-gpt-contract'
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
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { resolveTradeEvaluatorInternalLeagueId } from '@/lib/trades/resolveTradeEvaluatorInternalLeagueId'
import { evaluateTrade, type EvaluateTradeDeps, type TradeEvaluationReceipt } from '@/lib/decision-os/trade/evaluateTrade'
import { NOT_YOUR_LEAGUE_REASON, resolveEvaluationLeagueId } from '@/lib/decision-os/trade/evaluationLeague'
import { priceEvaluatorDevy } from '@/lib/decision-os/trade/leagueAssetPolicy'
import { loadTradeKeeperCosts, type TradeKeeperCosts } from '@/lib/keeper/tradeKeeperCosts'
import { receiptGradeFields, structuredEvaluationFromExplanation } from '@/lib/decision-os/trade/receiptViews'
import { explainTrade } from '@/lib/decision-os/trade/explainTrade'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import { resolveTradePlayerAssets } from '@/lib/trades/tradePlayerIdentityResolver'
import {
  buildNormalizedTradeContext,
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

/*
 * 🛑 `year` AND `round` WERE BARE `z.number()`, WHICH ACCEPTS ANYTHING NUMERIC.
 * `{ year: 1776, round: 0 }` and `{ round: -3 }` and `{ round: 2.7 }` all validated and went
 * straight to `pricePick`. Round 0 and every negative round are the dangerous ones: they do
 * not error downstream, they become a FIRST-ROUND PICK, because `pickRoundShare` in
 * lib/pick-curve.ts clamps with `Math.max(1, Math.round(round))`.
 *
 * Bounds match `lib/parsePickLabel.ts` so the string and object forms of the same asset
 * cannot disagree about what is acceptable. The year window is the parser's own `20\d{2}`.
 */
const PickInputSchema = z.object({
  year: z.number().int().min(2000).max(2099),
  round: z.number().int().min(1).max(25),
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
  /*
   * 🛑 THE `.default('sf')` HERE WAS A SILENT, GRADE-CHANGING ASSUMPTION.
   *
   * Superflex is the aggressive read: it is what tells FantasyCalc to quote `numQbs: 2`, and a
   * superflex board prices quarterbacks far above a 1QB one. A caller that simply omitted the
   * field — a script, an integration, anything that is not the trade page — had every QB in the
   * trade priced on a superflex board, and nothing in the response said so.
   *
   * Worse, zod's default is applied BEFORE the route sees the value, so `data.league.qb_format`
   * was never `undefined` and "the caller told us superflex" could not be distinguished from
   * "the caller told us nothing". Dropping the default is what makes the difference visible;
   * `resolveSuperflex` below decides what to do about it.
   */
  qb_format: z.enum(['1qb', 'sf']).optional(),
  idp_enabled: z.boolean().optional().default(false),
  roster_requirements: z.string().optional(),
  /**
   * Team count, for a caller that is NOT handing us a `league_id` we can look up.
   *
   * 🛑 ADDED BECAUSE THE PRICING CONTEXT BELOW HARDCODED 12. That constant is what goes to
   * FantasyCalc as `numTeams`, so every 10-, 14- or 32-team league was being graded against
   * twelve-team market prices. A Sleeper league's `total_rosters` answers this on its own; an
   * imported Yahoo/ESPN/MFL/Fantrax caller has nothing else to say it with, which is exactly the
   * Sleeper-centricity that made the hardcode invisible.
   */
  team_count: z.number().int().positive().optional(),
  waiver_type: z.string().optional(),
  /**
   * The league's FULL season FAAB budget — not a manager's remaining balance, which is
   * `faab_remaining` on each team. Used to price `gives_faab` against the budget it comes out of.
   * Absent ⇒ `FAAB_DEFAULT_BUDGET`.
   */
  waiver_budget: z.number().positive().optional(),
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

/**
 * Every pick label in the trade that `parsePickLabel` cannot read.
 *
 * Runs BEFORE the entitlement gate so an unreadable pick costs the user nothing. The existing
 * refusals further down (UNPRICED_ASSETS, AMBIGUOUS_PLAYER, DEVY_SCALE) all return after the
 * gate has already spent tokens and only the catch block refunds — a separate defect, not one
 * to inherit.
 */
function unreadablePickLabels(picks: readonly unknown[]): string[] {
  return picks.filter((p): p is string => typeof p === 'string' && parsePickLabel(p) === null)
}

function resolvePickData(p: string | { year: number; round: number; projected_range?: string }) {
  if (typeof p === 'string') {
    const parsed = parsePickLabel(p)
    /*
     * 🛑 THIS WAS `year: parsed?.year ?? 2025, round: parsed?.round ?? 1`.
     *
     * So every string the parser rejected — a typo, an empty field, a format it did not know —
     * was silently priced as a 2025 FIRST-ROUND PICK, the most valuable asset on the curve.
     * Nothing logged it and nothing in the response said the label had not been understood;
     * the grade just came back confident and wrong, in the side's favour.
     *
     * `unreadablePickLabels` refuses the request before this point, so reaching here with an
     * unreadable label means that guard was bypassed. Throwing fails closed into the catch
     * (500 + token refund) rather than resurrecting the default.
     */
    if (!parsed) {
      throw new Error(`unparseable pick label reached pricing: ${JSON.stringify(p)}`)
    }
    return {
      year: parsed.year,
      round: parsed.round,
      tier: parsed.bucket,
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

    /*
     * 🛑 REFUSE AN UNREADABLE PICK BEFORE ANYTHING IS SPENT OR GRADED.
     *
     * A draft pick is the most valuable asset class this route prices, and until now an
     * unreadable label became a 2025 first-round pick (see `resolvePickData`). The grade came
     * back confident, lopsided in favour of whoever sent the garbage, and nothing in the
     * response admitted the label had not been understood.
     *
     * Deliberately placed here — after auth and the league-membership check, BEFORE the rate
     * limiter and the entitlement gate — so a typo costs the user neither a token nor a slice
     * of their rate-limit window. The object form is already bounded by `PickInputSchema`, so
     * only strings need reading.
     *
     * Naming the offending label is the point: "2026 3th" is a fixable typo and "Kittens" is
     * not, and the manager can only tell which he sent if we say what we could not read.
     */
    const unreadablePicks = [
      ...unreadablePickLabels(data.sender.gives_picks ?? []),
      ...unreadablePickLabels(data.receiver.gives_picks ?? []),
    ]
    if (unreadablePicks.length > 0) {
      const shown = Array.from(new Set(unreadablePicks.map((l) => l.trim() || '(empty)')))
      return NextResponse.json(
        {
          error: 'UNREADABLE_PICK',
          message:
            shown.length === 1
              ? `"${shown[0]}" is not a pick label we can read, so this trade cannot be graded. Use a form like "2027 1st", "2027 Early 2nd" or "2027 Round 3".`
              : `These are not pick labels we can read, so this trade cannot be graded: ${shown.map((s) => `"${s}"`).join(', ')}. Use a form like "2027 1st", "2027 Early 2nd" or "2027 Round 3".`,
          unreadablePicks: shown,
        },
        { status: 422 },
      )
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

    /*
     * What the CALLER said, which is not yet an answer. `isSF` is resolved after the league is
     * fetched, because the league's own roster positions outrank anything a client asserts.
     */
    const declaredQbFormat = data.league?.qb_format ?? null
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
          /*
           * 🛑 THE FORMAT BELONGS IN THE KEY, AND WAS NOT IN IT.
           *
           * `leagueId` separates league-linked trades, but a league-LESS trade keyed on player
           * names alone: the same two players in a 1QB league and a superflex one produced the
           * same key, so whichever was graded first was served to the other. A superflex grade
           * handed to a 1QB manager is exactly the QB inflation this commit removes, arriving
           * by a different route.
           *
           * Keyed on what the CALLER supplied rather than the resolved `isSF`, because this
           * runs before the league fetch — and that is sufficient: anything the league itself
           * decides is already separated by `leagueId`.
           */
          qbFormat: data.league?.qb_format ?? '',
          leagueFormat: data.league?.format ?? '',
          sport: leagueSportSlug,
          idp: data.league?.idp_enabled ?? false,
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
    let sleeperLeagueForConfig: Awaited<ReturnType<typeof getLeagueInfo>> = null
    if (data.league_id) {
      try {
        sleeperLeagueForConfig = await getLeagueInfo(data.league_id)
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

    /*
     * The league's own roster slots outrank the client flag. See `resolveSuperflex` for why —
     * it carries the full account, and it is a pure function so the rule is testable without a
     * database, which this route's grading path is not.
     */
    const { isSuperflex: isSF, basis: qbFormatBasis } = resolveSuperflex({
      leagueRoster: rosterConfigForVorp
        ? { superflex: rosterConfigForVorp.superflex, startingQB: rosterConfigForVorp.startingQB }
        : null,
      declared: declaredQbFormat,
    })

    /*
     * This league's own defenders, priced by its own scoring.
     *
     * 🛑 WITHOUT THIS, EVERY DEFENDER IN EVERY TRADE GRADE WAS A FLAT POSITION
     * CONSTANT — `IDP_KICKER_BASELINE_VALUES` in lib/hybrid-valuation.ts, where the
     * best linebacker in the league and a rookie backup both price at 800. And it
     * was worse than that in practice: the constant is keyed on POSITION, which
     * `pricePlayer` reads off the FantasyCalc row, and FantasyCalc carries no
     * defenders at all — so the position resolved to 'UNKNOWN', the baseline branch
     * never fired, and defenders fell through to an analytics lifetime value or came
     * back `unpriced`. The board below is keyed by NAME for exactly that reason: it
     * does not depend on a position lookup that cannot succeed for a defender.
     *
     * Deliberately NOT gated on `data.league.idp_enabled` — that flag is client-
     * supplied and optional, so trusting it would silently skip pricing for any
     * caller that omits it. `loadLeagueIdpVorp` decides from the league's OWN
     * scoring settings, which is the authority, and returns empty for the ~100 of
     * 110 leagues that do not genuinely score IDP.
     *
     * Reuses the league info and player index already fetched above rather than
     * paying for them twice.
     */
    const leagueValues = data.league_id
      ? await loadLeagueTradeValues({
          prisma,
          platformLeagueId: data.league_id,
          isDynasty: (data.league?.format ?? 'dynasty') !== 'redraft',
          prefetched: {
            rosterPositions: sleeperLeagueForConfig?.roster_positions ?? null,
            numTeams: sleeperLeagueForConfig?.total_rosters ?? null,
            players: Object.keys(leaguePlayers).length > 0 ? leaguePlayers : null,
          },
        }).catch(() => null)
      : null

    /*
     * 🛑 THIS WAS THE LITERAL `12`, AND IT IS NOT A LABEL — IT IS THE MARKET REQUEST.
     * `labelCtx.numTeams` reaches `getFantasyCalcPlayers` in lib/hybrid-valuation.ts, which sends
     * it to FantasyCalc as the league size and CACHES the result under it. So a 32-team league's
     * every player price came back from a 12-team market, and `buildRosterConfig` derived its
     * replacement level from twelve teams too. The real count was already sitting in
     * `rosterConfigForVorp` twenty lines above, resolved from `total_rosters`.
     *
     * Order: the caller's explicit `team_count` (the only thing a non-Sleeper import can supply),
     * then the Sleeper league's own `total_rosters`, then 12 — which stays as the last resort
     * because `ValuationContext.numTeams` feeds a market profile that must be SOME size, and 12
     * is what every downstream `?? 12` already assumes. It is now reached only when nobody knows.
     */
    const resolvedNumTeams = data.league?.team_count ?? sleeperLeagueForConfig?.total_rosters ?? 12

    /*
     * The budget a traded FAAB amount is a fraction OF. Caller first, then the Sleeper league's
     * own `settings.waiver_budget` (the key `lib/sleeper-sync.ts` already reads), then undefined —
     * which lets `normalizedFaabValue` apply `FAAB_DEFAULT_BUDGET` rather than this route
     * inventing a second fallback.
     */
    const sleeperWaiverBudget = Number((sleeperLeagueForConfig?.settings as Record<string, unknown> | undefined)?.waiver_budget)
    const faabBudget = data.league?.waiver_budget
      ?? (Number.isFinite(sleeperWaiverBudget) && sleeperWaiverBudget > 0 ? sleeperWaiverBudget : undefined)

    /**
     * A side's FAAB, on the same 0–10000 scale as the players it is being weighed against.
     *
     * 🛑 THIS USED TO BE THE RAW DOLLAR FIGURE ADDED STRAIGHT TO A COMPOSITE TOTAL. A composite
     * player price here runs into the thousands, so `+ 25` for $25 of FAAB was arithmetically
     * present and practically zero — this route graded FAAB as worthless while the console priced
     * the same $25 at 700 and the canonical engine at 450. One converter now serves all three.
     */
    const faabValue = (amount: number | null | undefined) => normalizedFaabValue(amount, faabBudget)

    const labelCtx: ValuationContext = {
      asOfDate: data.asOfDate || new Date().toISOString().split('T')[0],
      isSuperFlex: isSF,
      numTeams: resolvedNumTeams,
      rosterConfig: rosterConfigForVorp,
      ...(leagueValues && leagueValues.byNameLower.size > 0 && { leagueValueByNameLower: leagueValues.byNameLower }),
      leagueUnpricedReasonByNameLower: leagueValues?.unpricedReasonByNameLower,
    }

    /*
     * The league this trade is graded in — membership-checked (owner or claimed team) — resolved ONCE
     * and shared by the devy pass below and the one grade further down, so both read the same league.
     */
    const evaluationLeagueIdPromise = resolveEvaluationLeagueId({ suppliedLeagueId: data.league_id, userId })
    evaluationLeagueIdPromise.catch(() => undefined)

    const [rawSenderPlayerPrices, rawReceiverPlayerPrices, senderPickPrices, receiverPickPrices] = await Promise.all([
      Promise.all(senderPlayerNames.map(name => pricePlayer(name, labelCtx))),
      Promise.all(receiverPlayerNames.map(name => pricePlayer(name, labelCtx))),
      Promise.all(senderPicksData.map(p => pricePick({ year: p.year, round: p.round, tier: p.tier || null }, labelCtx))),
      Promise.all(receiverPicksData.map(p => pricePick({ year: p.year, round: p.round, tier: p.tier || null }, labelCtx))),
    ])

    /*
     * 🛑 A COLLEGE PLAYER THIS LEAGUE HOLDS IS PRICED, NOT REFUSED (2026-09-28).
     *
     * The market board prices no college player, so this pass used to leave every prospect unpriced
     * and the refusal below answered DEVY_SCALE — before the one grade, which prices prospects the
     * league holds devy rights on (`leagueAssetPolicy.priceDevy`), ever ran. A devy league's trade was
     * therefore always refused on this page. Now the same rule prices them here first
     * (`priceEvaluatorDevy` → `priceHeldDevyAssets`, the matcher and `devyOptionValue` the grade uses),
     * so this pass and the letter agree. A prospect the league does not hold, or cannot measure, stays
     * unpriced and DEVY_SCALE answers for him exactly as before.
     */
    const devyLeagueId =
      data.league_id && [...rawSenderPlayerPrices, ...rawReceiverPlayerPrices].some((p) => p.unpriced)
        ? await evaluationLeagueIdPromise.catch(() => null)
        : null
    const [senderDevyPass, receiverDevyPass] = devyLeagueId
      ? await Promise.all([
          priceEvaluatorDevy({ leagueId: devyLeagueId, prices: rawSenderPlayerPrices }),
          priceEvaluatorDevy({ leagueId: devyLeagueId, prices: rawReceiverPlayerPrices }),
        ])
      : [null, null]
    const senderPlayerPrices = senderDevyPass?.prices ?? rawSenderPlayerPrices
    const receiverPlayerPrices = receiverDevyPass?.prices ?? rawReceiverPlayerPrices

    /*
     * 🛑 REFUSE BEFORE GRADING. An asset nothing could price is not worth zero.
     *
     * pricePlayer's terminal branch returns `value: 0` for a name no source matched —
     * a misspelling, a player not on the board, a devy/college name, an IDP the feed
     * does not carry. Downstream that zero is arithmetic like any other, so a
     * something-for-nothing total came out lopsided and the grader turned it into a
     * confident letter: gradeFromPercentDiff maps 0% to "B" and 100% to "A+", and the
     * page renders whatever it is handed. The user could not tell "we priced this and
     * it is a fleecing" apart from "we could not price this at all".
     *
     * This repo already has the rule — a "C" grade means no data, and surfaces are
     * supposed to call hasNoSignal()/sideMath() before showing a letter. This path
     * never did. Naming the unpriced players is the difference between a dead end and
     * something the user can fix by correcting a spelling.
     */
    const allPlayerPrices = [...senderPlayerPrices, ...receiverPlayerPrices]
    const unpricedAssets = allPlayerPrices.filter((p) => p.unpriced)
    if (unpricedAssets.length > 0) {
      const names = Array.from(new Set(unpricedAssets.map((p) => p.name)))
      /*
       * ⚠ "THIS PLAYER IS NOT ON THE BOARD" AND "THE BOARD DID NOT LOAD" ARE DIFFERENT
       * FAILURES, AND TELLING THE USER TO CHECK THEIR SPELLING FOR THE SECOND IS WORSE
       * THAN SAYING NOTHING.
       *
       * getFantasyCalcPlayers swallows a load error and returns [] (lib/hybrid-valuation.ts),
       * so downstream an outage is indistinguishable from an empty board — every asset
       * comes back unpriced either way. If NOTHING could be priced, the board is the
       * likely culprit, not the names; a real trade of real players does not produce a
       * clean sweep of misses. Say so, and return 503 so it reads as our problem rather
       * than the user's typo.
       */
      /*
       * 🛑 A COLLEGE PLAYER IS NOT A TYPO, AND SAYING SO WAS ACTIVELY MISLEADING.
       *
       * Both branches below assume an unpriced name is either a misspelling or a board
       * outage. A devy asset is neither: he is correctly spelled, correctly identified, and
       * genuinely unpriced because NO MARKET PRICES COLLEGE PLAYERS — see
       * lib/trade-intel/devyOutlook.ts. Sent through the branches below, a devy-for-devy
       * trade returned 503 "this is on our side, try again shortly" (it is not, and retrying
       * will never help) and a mixed deal told the manager to check his spelling.
       *
       * `identifyDevyAssets` is the SAME implementation `/api/trade-value/analyze` uses, so
       * the two surfaces cannot drift into different answers about the same trade.
       */
      /*
       * 🛑 AN AMBIGUOUS NAME IS NOT A MISSING PLAYER, AND SAYING "CHECK THE SPELLING" IS THE
       * SAME WRONG ANSWER THIS ROUTE ALREADY GAVE COLLEGE PLAYERS.
       *
       * `loadLeagueTradeValues` refuses to price a defender whose name is shared with another
       * player rostered in the same league — pricing him would hand one player the other's
       * value. The name is spelled correctly and the player IS on the board; we simply will not
       * guess which one is meant. Telling the manager to check his spelling sends him looking
       * for a typo that does not exist.
       *
       * ⚠ IT IS ONE PLAYER, MEASURED, AND THAT IS WHY THIS IS A MESSAGE RATHER THAN A
       * RESOLUTION. Across all 10 IDP leagues: 2,564 priced defenders, 12 unreachable by name,
       * every one of them Byron Murphy (a corner and a lineman share the name) — 0.47%.
       * Threading player ids through the name-keyed pricing path to disambiguate one duplicate
       * would be a great deal of machinery aimed at a single collision. Naming the real cause
       * costs nothing and is what the manager actually needs.
       */
      const ambiguous = new Set(leagueValues?.idp.ambiguousNames ?? [])
      const ambiguousInTrade = names.filter((n) => ambiguous.has(n.toLowerCase().trim()))
      if (ambiguousInTrade.length > 0) {
        return NextResponse.json(
          {
            error: 'AMBIGUOUS_PLAYER',
            message:
              ambiguousInTrade.length === 1
                ? `Two players in this league are named ${ambiguousInTrade[0]}, so this trade cannot be graded — pricing one of them would risk using the other's value. This is a limitation on our side, not a mistake in what you entered.`
                : `More than one player in this league shares each of these names — ${ambiguousInTrade.join(', ')} — so this trade cannot be graded without risking the wrong player's value.`,
            ambiguousPlayers: ambiguousInTrade,
          },
          { status: 422 },
        )
      }

      const devy = await identifyDevyAssets({
        give: senderPlayerPrices.map((p) => ({ name: p.name, marketValue: p.unpriced ? null : p.value })),
        get: receiverPlayerPrices.map((p) => ({ name: p.name, marketValue: p.unpriced ? null : p.value })),
        season: new Date(data.asOfDate || Date.now()).getUTCFullYear(),
      }).catch(() => null)

      if (devy && devy.matched.length > 0) {
        const devyNames = new Set(devy.matched.map((m) => m.name.toLowerCase()))
        const stillUnexplained = names.filter((n) => !devyNames.has(n.toLowerCase()))
        return NextResponse.json(
          {
            error: 'DEVY_SCALE',
            message:
              devy.refusal ??
              devy.verdict ??
              'This trade is between college assets, which are ranked against each other rather than priced in market units.',
            /* The devy half of the answer, so the refusal is not a dead end. */
            devyAssets: devy.matched.map((m) => m.name),
            devyStandings: devy.standings,
            devyVerdict: devy.verdict,
            /* Names that are neither priced nor known college players really are suspect. */
            ...(stillUnexplained.length > 0 && { unpricedPlayers: stillUnexplained }),
          },
          { status: 422 },
        )
      }

      /*
       * ⚠ ONLY AN UNEXPLAINED MISS CAN MEAN AN OUTAGE. `pricePlayer` refuses with a reason when
       * it knows why — a fringe veteran the market board dropped, a defender with no league
       * board — and a trade made only of those is not our feed being down. Counting them here
       * would answer a Mixon-for-Hunt trade with "this is on our side, try again shortly",
       * which retrying can never fix.
       */
      const unexplained = unpricedAssets.filter((p) => !p.unpricedReason)
      if (allPlayerPrices.length > 0 && unexplained.length === allPlayerPrices.length) {
        return NextResponse.json(
          {
            error: 'VALUATION_UNAVAILABLE',
            message:
              'Player values are unavailable right now, so this trade cannot be graded. This is on our side — try again shortly.',
          },
          { status: 503 },
        )
      }
      const reasonByName = new Map(
        unpricedAssets.flatMap((p) => (p.unpricedReason ? [[p.name, p.unpricedReason.label] as const] : [])),
      )
      const explained = names.filter((n) => reasonByName.has(n))
      const unknown = names.filter((n) => !reasonByName.has(n))
      const sentences = [
        ...explained.map((n) => `${n}: ${reasonByName.get(n)}.`),
        ...(unknown.length === 1
          ? [`No value on file for ${unknown[0]} — check the spelling, or the player may not be on the dynasty board.`]
          : unknown.length > 1
            ? [`No values on file for ${unknown.join(', ')} — check the spellings, or those players may not be on the dynasty board.`]
            : []),
      ]
      return NextResponse.json(
        {
          error: 'UNPRICED_ASSETS',
          message: `This trade cannot be graded. ${sentences.join(' ')}`,
          unpricedPlayers: names,
          ...(explained.length > 0 && {
            unpricedReasons: explained.map((n) => ({ name: n, reason: reasonByName.get(n)! })),
          }),
        },
        { status: 422 },
      )
    }

    const senderGivenAssetsList = [...senderPlayerPrices, ...senderPickPrices]
    const senderReceivedAssetsList = [...receiverPlayerPrices, ...receiverPickPrices]

    const senderGivenComposite = compositeTotal(senderGivenAssetsList) + faabValue(data.sender.gives_faab)
    const senderReceivedComposite = compositeTotal(senderReceivedAssetsList) + faabValue(data.receiver.gives_faab)

    const senderGivenMarket = senderGivenAssetsList.reduce((s, p) => s + p.assetValue.marketValue, 0)
      + faabValue(data.sender.gives_faab)
    const senderReceivedMarket = senderReceivedAssetsList.reduce((s, p) => s + p.assetValue.marketValue, 0)
      + faabValue(data.receiver.gives_faab)

    const senderGivenTotal = senderGivenComposite
    const senderReceivedTotal = senderReceivedComposite

    const teamANetValue = senderReceivedComposite - senderGivenComposite

    /*
     * 🛑 THE LETTER IS THE ONE TRADE ENGINE'S (2026-09-26). This route never produced a letter of its
     * own: the page turned `percentDiff` into one in the browser (`gradeFromPercentDiff`), on a third
     * scale. `evaluateTrade()` now grades the deal from the SENDER's side on the league's own values
     * and returns a saved receipt; the page shows that letter, or the reason there is none.
     *
     * Started here and awaited at the response, so it overlaps the AI calls rather than adding to them.
     * ⚠ `viewerSide: false` — the caller is not proven to be the sender, so roster need is not priced.
     */
    const PICK_TIERS = ['early', 'mid', 'late'] as const
    const pickInput = (p: { year: number; round: number; tier?: string | null }): GradeInputs['assets'][number] => {
      const tier = PICK_TIERS.find((t) => t === p.tier)
      return { kind: 'pick', year: p.year, round: p.round, ...(tier ? { tier } : {}) }
    }
    const sideInputs = (names: string[], picks: Array<{ year: number; round: number; tier?: string | null }>, faab: number | null | undefined): GradeInputs => ({
      assets: [
        ...names.filter((n) => n.trim()).map((name) => ({ kind: 'player' as const, name: name.trim() })),
        ...picks.map(pickInput),
        ...(typeof faab === 'number' && faab > 0 ? [{ kind: 'faab' as const, amount: faab }] : []),
      ],
      unpriceable: names.filter((n) => !n.trim()).map(() => 'a player with no name'),
    })
    const evaluationReceiptPromise: Promise<TradeEvaluationReceipt> = (async () => {
      const evaluationLeagueId = await evaluationLeagueIdPromise
      const notYourLeague: Partial<EvaluateTradeDeps> =
        data.league_id && !evaluationLeagueId
          ? { grade: async () => ({ graded: false, reason: NOT_YOUR_LEAGUE_REASON, basis: null }) }
          : {}
      return evaluateTrade(
        {
          surface: 'trade-evaluator',
          leagueId: evaluationLeagueId,
          userId,
          give: sideInputs(senderPlayerNames, senderPicksData, data.sender.gives_faab),
          get: sideInputs(receiverPlayerNames, receiverPicksData, data.receiver.gives_faab),
          viewerSide: false,
        },
        notYourLeague,
      )
    })()
    const oneGradePayload = async () => {
      const receipt = await evaluationReceiptPromise
      return { tradeGrade: receiptGradeFields(receipt), evaluationReceipt: receipt }
    }

    /*
     * 🛑 KEEPER COST, BESIDE THE LETTER — NEVER IN IT (2026-09-28, Guap's call).
     *
     * In a keeper league a receiver kept at a 2nd and the same receiver kept at a 12th graded
     * identically: nothing on file said what either costs to keep. `loadTradeKeeperCosts` reads the
     * league's own drafts (the Sleeper keeper flag the draft sync now keeps), prices the cost only
     * where the league's rule is MEASURED, and prices the cost round on the grade's own chart. It
     * rides beside the grade, so the letter does not move until those costs are checked on real
     * leagues.
     *
     * ⚠ EACH PLAYER'S VALUE IS THE ONE GRADE'S, FROM ITS RECEIPT — not this route's first pricing
     * pass, which prices on the dynasty chart whatever the league. Since 2026-09-28 a keeper league
     * that carries little over grades on the REDRAFT chart (`pricesOnDynastyChart`), so the first
     * pass's number would set a player on one chart against a cost on another.
     *
     * Started here, awaited at the response, in the same membership-checked league the grade uses.
     */
    const candidateIdsByNameLower = new Map<string, string[]>()
    for (const [pid, p] of Object.entries(leaguePlayers)) {
      const n = String(p?.full_name ?? '').toLowerCase().trim()
      if (!n) continue
      const ids = candidateIdsByNameLower.get(n)
      if (ids) ids.push(pid)
      else candidateIdsByNameLower.set(n, [pid])
    }
    const keeperCostsPromise: Promise<TradeKeeperCosts> = (async () => {
      const leagueId = data.league_id ? await evaluationLeagueIdPromise.catch(() => null) : null
      if (!leagueId) return { applies: false }
      const receipt = await evaluationReceiptPromise.catch(() => null)
      const gradeValueByName = new Map(
        (receipt?.assets ?? [])
          .filter((a) => a.kind === 'player' && a.marketValue != null)
          .map((a) => [a.name.toLowerCase().trim(), a.marketValue as number] as const),
      )
      return loadTradeKeeperCosts({
        leagueId,
        players: allPlayerPrices
          .filter((p) => !p.unpriced)
          .map((p) => ({
            name: p.name,
            value: gradeValueByName.get(p.name.toLowerCase().trim()) ?? null,
            candidateIds: candidateIdsByNameLower.get(p.name.toLowerCase().trim()) ?? [],
          })),
      })
    })()
    keeperCostsPromise.catch(() => undefined)
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

    /*
     * 🛑 SAY SO WHEN THIS VERDICT IS RESTING ON THE ONE NUMBER NOBODY CAN MEASURE.
     *
     * Defenders are priced off the league's own board, but what the BEST defender is worth
     * against the offensive board — `IDP_CEILING_DYNASTY` — is a product decision with no
     * market behind it, and three routes to measuring it are closed. Replaying real
     * production trades across a plausible range of it moved one of them five grades, from
     * "major overpay" to "clear win", on the same two rosters.
     *
     * ⚠ THE CONDITION IS A FLIPPED WINNER, NOT A WIDE RANGE. Every IDP trade's number moves
     * a little; that is noise a manager cannot act on. What is worth interrupting them for
     * is the band spanning 50 — the point where the answer to "who wins this" changes
     * depending on a constant we picked. A trade with defenders on BOTH sides usually will
     * not trip it, and correctly so: the ceiling is a factor common to both sides there, so
     * it cancels out of the ratio almost entirely.
     */
    const idpCeilingBand = idpCeilingCompositeBand(
      senderReceivedAssetsList,
      senderGivenAssetsList,
      // Composite-scale offsets, per `idpCeilingCompositeBand`'s `extra` — so they convert too.
      { received: faabValue(data.receiver.gives_faab), gave: faabValue(data.sender.gives_faab) },
    )
    let idpCeilingCaveat: {
      lowFairness: number
      highFairness: number
      flipsWinner: boolean
      note: string
    } | null = null
    if (idpCeilingBand) {
      const lowFairness = computeValueFairness(idpCeilingBand.low.received, idpCeilingBand.low.gave)
      const highFairness = computeValueFairness(idpCeilingBand.high.received, idpCeilingBand.high.gave)
      const lo = Math.min(lowFairness, highFairness)
      const hi = Math.max(lowFairness, highFairness)
      const flipsWinner = lo < 50 && hi > 50
      if (flipsWinner) {
        idpCeilingCaveat = {
          lowFairness,
          highFairness,
          flipsWinner,
          note:
            'This trade sends defenders one way and offence the other, so the verdict rests on how ' +
            'much a defender is worth against an offensive player — a rate no market publishes and ' +
            'that we set ourselves. Move that rate within a defensible range and this trade scores ' +
            `anywhere from ${lo} to ${hi}, which changes who it favours. Treat it as close, and ` +
            'weigh what your lineup actually needs.',
        }
      }
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

      /*
       * ⚠ `found` FEEDS CONFIDENCE, SO IT MUST MEAN "PRICED BY EVIDENCE", NOT "NOT UNKNOWN".
       * This read `priced.source !== 'unknown'` and was right by accident: the IDP flat
       * baseline and the analytics lifetime-value fallback both reported 'unknown' too, so
       * both correctly failed the test. Once those became their own sources, the old
       * expression would have started counting a flat per-position constant as a found
       * player — `calculateTradeConfidence` adds up to 0.25 for the found ratio, so an IDP
       * trade priced entirely off the constant 800 would have reported HIGHER confidence
       * than before precisely because the pricing got more honest.
       */
      const playerResults = [
        ...senderPlayerPrices.map((priced, i) => ({ name: senderPlayerNames[i], found: isEvidencedPrice(priced) })),
        ...receiverPlayerPrices.map((priced, i) => ({ name: receiverPlayerNames[i], found: isEvidencedPrice(priced) })),
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
        // The RESOLVED format, not the raw flag — and how it was decided, so a caller can tell
        // a measured answer from an assumption.
        qbFormat: isSF ? 'sf' : '1qb',
        qbFormatBasis,
        idpEnabled: data.league?.idp_enabled || false,
        biasMode,
        ...(data.league?.scoring_summary && { scoringSummary: data.league.scoring_summary }),
        ...(data.league?.roster_requirements && { rosterRequirements: data.league.roster_requirements }),
      },
      analysisMode: {
        timeContext: data.asOfDate ? 'AS_OF_DATE' : 'CURRENT',
        ...(data.asOfDate && { asOfDate: data.asOfDate }),
      },
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

    /*
     * 🛑 ONE AI CALL, AND IT EXPLAINS THE RECEIPT (Phase 4, 2026-09-27). This used to be three: DeepSeek
     * returned its own fairness score, A-F risk grades and winner; Grok ran a web search and appended
     * "injury alerts" nobody checked; OpenAI synthesised both into a verdict, a confidence and
     * "better alternatives" with invented fit scores — and a narrative check whose result was never
     * read. Each could contradict the letter printed beside it. Now `explainTrade` sends the receipt
     * and nothing else, validates the answer against it (numbers, citations, grades, betting language),
     * retries once, and otherwise answers from the deterministic template.
     */
    const receiptForAI = await evaluationReceiptPromise
    const rosterNamesOf = (roster: unknown): string[] =>
      Array.isArray(roster)
        ? roster
            .map((r) => (typeof r === 'string' ? r : r && typeof r === 'object' ? (r as { name?: unknown }).name : null))
            .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
        : []
    const explanation = await explainTrade({
      receipt: receiptForAI,
      teamNames: { teamA: data.sender.manager_name, teamB: data.receiver.manager_name },
      rosterNames: { teamA: rosterNamesOf(data.sender.roster), teamB: rosterNamesOf(data.receiver.roster) },
    })
    const aiProviders: Record<string, 'ok' | 'error'> = explanation.provider
      ? { [explanation.provider]: explanation.source === 'ai' ? 'ok' : 'error' }
      : {}
    if (explanation.source === 'ai') {
      await logAiOutput({
        provider: explanation.provider ?? 'unknown',
        role: 'narrative',
        taskType: 'trade_eval',
        targetType: 'league',
        targetId: data.league_id || undefined,
        contentJson: explanation.verdict,
      })
    } else if (explanation.violations.length > 0) {
      console.warn('[trade-evaluator] explanation answered by the template:', explanation.templateReason, explanation.violations.slice(0, 5))
    }
    const evalData: Record<string, any> = structuredEvaluationFromExplanation(explanation, receiptForAI.grade, computedConfidenceScore)
    const tradeExplanation = {
      verdict: explanation.verdict,
      source: explanation.source,
      templateReason: explanation.templateReason,
      provider: explanation.provider,
      receiptId: explanation.receiptId,
    }

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
      ...(idpCeilingCaveat && { idpCeilingCaveat }),
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

    // The server's score is the only one left: no model now returns a confidence of its own.
    const triangulated = triangulateConfidence(computedConfidenceScore, null, null)
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
      ...(await oneGradePayload()),
      keeperCosts: await keeperCostsPromise.catch((): TradeKeeperCosts => ({ applies: false })),
      /*
       * The RESOLVED superflex answer and how it was reached.
       *
       * Surfaced to the client because "the league's roster positions say 1QB" and "nobody told
       * us, so we assumed 1QB" are different claims and only one of them is evidence. Until now
       * the response carried neither — `leagueSettings` lives on `structuredPayload`, which is
       * the AI prompt contract and is never returned.
       */
      leagueSettings: { qbFormat: isSF ? 'sf' : '1qb', qbFormatBasis },
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
      /*
       * The as-of-date VALUE comparison only (Trade OS, 2026-09-27). `computeDualModeGrades` also returns
       * its own A+..D letter and verdict per date — a scale of its own — which are not sent. The page
       * shows the one grade (today's league values) and this gap as a labelled number.
       */
      ...(dualModeGrades && {
        dualModeGrades: {
          atTheTime: { percentDiff: dualModeGrades.atTheTime.percentDiff, sideATotal: dualModeGrades.atTheTime.sideATotal, sideBTotal: dualModeGrades.atTheTime.sideBTotal },
          withHindsight: { percentDiff: dualModeGrades.withHindsight.percentDiff, sideATotal: dualModeGrades.withHindsight.sideATotal, sideBTotal: dualModeGrades.withHindsight.sideBTotal },
        },
      }),
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
      tradeExplanation,
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
