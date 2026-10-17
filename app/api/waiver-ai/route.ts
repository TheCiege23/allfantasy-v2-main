import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  WaiverRequestSchema,
  WaiverResponseSchema,
  buildWaiverAiSystemPrompt,
  buildWaiverUserPrompt,
} from "@/lib/waiver-ai-prompt"
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit"
import { openaiChatJson, parseJsonContentFromChatCompletion } from "@/lib/openai-client"
import { xaiChatJson, parseTextFromXaiChatCompletion } from "@/lib/xai-client"
import { deepseekQuantAnalysis } from "@/lib/deepseek-client"
import { trackLegacyToolUsage } from "@/lib/analytics-server"
import { enrichRawWaiverSuggestionsWithGrok } from "@/lib/waiver-engine/waiver-grok-adapter"
import { logAiOutput } from "@/lib/ai/output-logger"
import { buildSportContextString } from "@/lib/ai/AISportContextResolver"
import { buildWaiverRecommendationContext } from "@/lib/ai/SportAwareRecommendationService"
import { resolveSportVariantContext } from "@/lib/league-defaults-orchestrator/SportVariantContextResolver"
import {
  buildWaiverEnvelope,
  getMandatorySystemPromptSuffix,
  normalizeToContract,
} from "@/lib/ai-context-envelope"
import {
  buildDeepSeekMetaContext,
  buildGrokMetaContext,
  buildOpenAIMetaContext,
  resolveAIMetaContextWithWindow,
  type AIMetaContextPayload,
} from "@/lib/meta-insights"

type AnyObj = Record<string, any>

type StrategyMode =
  | 'conservative'
  | 'aggressive'
  | 'win_now'
  | 'rebuild'
  | 'playoff_lock'
  | 'chaos'

interface WaiverQuantResult {
  playerScores?: Array<{
    playerName: string
    expectedValueAdd: number
    faabRecommendation: number
    ceilingScore: number
    floorScore: number
    winProbabilityImpact: number
    riskGrade: 'A' | 'B' | 'C' | 'D' | 'F'
    confidencePct: number
  }>
  topPickByExpectedValue?: string
  overallFaabBudgetAdvice?: string
  error?: string
}

interface WaiverTrendResult {
  playerSignals?: Array<{
    playerName: string
    signal: 'breakout' | 'injury' | 'depth_change' | 'snap_spike' | 'target_share' | 'none'
    severity: 'critical' | 'moderate' | 'low'
    note: string
  }>
  mustAddAlerts?: string[]
  injuryAlerts?: string[]
  trendingAdds?: string[]
  avoidList?: string[]
  rawInsight?: string
  error?: string
}

interface TripleAIWaiverResult {
  quantResult: WaiverQuantResult | null
  trendResult: WaiverTrendResult | null
  providers: {
    deepseek: 'ok' | 'error' | 'skipped'
    grok: 'ok' | 'error' | 'skipped'
    openai: 'ok' | 'error' | 'skipped'
  }
}

const DEEPSEEK_TEMP = 0.1
const GROK_TEMP = 0.3
const OPENAI_TEMP = 0.4

const DEEPSEEK_TOKENS = 900
const GROK_TOKENS = 500
const OPENAI_TOKENS = 1200

const RATE_LIMIT_ANON = 10
const RATE_LIMIT_AUTH = 25
const RATE_LIMIT_PRO = 60

const STRATEGY_MODE_CONTEXT: Record<StrategyMode, string> = {
  conservative: 'Prioritize floor, proven roles, and minimal risk.',
  aggressive: 'Maximize upside. Accept volatility for ceiling plays.',
  win_now: 'Immediate impact only. Short-term rentals are acceptable.',
  rebuild: 'Target youth and long-term upside. Avoid aging veterans.',
  playoff_lock: 'Balance floor and matchup-specific adds.',
  chaos: 'High-variance picks only. Swing for the fences.',
}

const DEEPSEEK_WAIVER_SYSTEM = `You are a quantitative fantasy sports waiver wire engine.
Analyze player add candidates with statistical modeling.
Always respond in valid JSON only. No markdown outside JSON.

Output format:
{
  "playerScores": [
    {
      "playerName": string,
      "expectedValueAdd": number,
      "faabRecommendation": number (0-100),
      "ceilingScore": number,
      "floorScore": number,
      "winProbabilityImpact": number (-10 to +10),
      "riskGrade": "A|B|C|D|F",
      "confidencePct": number (0-100)
    }
  ],
  "topPickByExpectedValue": string,
  "overallFaabBudgetAdvice": string
}`

const GROK_WAIVER_SYSTEM = `You are a real-time fantasy sports intelligence engine.
Detect breaking trends, injury signals, and momentum shifts for waiver wire players.
Always respond in valid JSON only.

Output format:
{
  "playerSignals": [
    {
      "playerName": string,
      "signal": "breakout|injury|depth_change|snap_spike|target_share|none",
      "severity": "critical|moderate|low",
      "note": string
    }
  ],
  "mustAddAlerts": string[],
  "injuryAlerts": string[],
  "trendingAdds": string[],
  "avoidList": string[],
  "rawInsight": string
}`

function safeBool(v: any): boolean {
  return !!v
}

function safeStr(v: any): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function extractLeagueMeta(body: AnyObj) {
  const league = body?.league ?? body?.context?.league ?? body?.settings?.league ?? {}

  const sportRaw =
    safeStr(league?.sport) ||
    safeStr(body?.sport) ||
    undefined

  const leagueVariant =
    safeStr(league?.leagueVariant) ||
    safeStr(league?.league_variant) ||
    safeStr(body?.leagueVariant) ||
    safeStr(body?.league_variant) ||
    safeStr(body?.variant) ||
    undefined
  const variantCtx = resolveSportVariantContext(sportRaw ?? 'NFL', leagueVariant)

  const leagueName =
    safeStr(league?.name) ||
    safeStr(body?.league_name) ||
    safeStr(body?.leagueName) ||
    undefined

  const format =
    safeStr(league?.format) ||
    safeStr(body?.format) ||
    safeStr(body?.league_format) ||
    variantCtx.formatType

  const superflex =
    safeBool(league?.superflex) ||
    safeBool(body?.superflex) ||
    safeBool(body?.is_superflex)

  const tep =
    safeBool(league?.tep) ||
    safeBool(body?.tep) ||
    safeBool(body?.is_tep)

  const idp =
    safeBool(league?.idp) ||
    safeBool(body?.idp) ||
    safeBool(body?.is_idp) ||
    variantCtx.isFootballIdp ||
    variantCtx.isNflIdp

  const strategyMode =
    safeStr(body?.strategy_mode) ||
    safeStr(body?.strategyMode) ||
    safeStr(league?.strategy_mode) ||
    undefined

  const numTeams =
    typeof body?.num_teams === 'number' ? body.num_teams :
    typeof league?.num_teams === 'number' ? league.num_teams : 12

  const faabBudget =
    typeof body?.faab_budget === 'number' ? body.faab_budget :
    typeof league?.faab_budget === 'number' ? league.faab_budget : 100

  const currentWeek =
    typeof body?.current_week === 'number' ? body.current_week :
    typeof body?.week === 'number' ? body.week : undefined

  return {
    sport: variantCtx.sport,
    sportDisplayLabel: variantCtx.displayLabel,
    leagueVariant: variantCtx.variant,
    leagueName,
    format,
    superflex,
    tep,
    idp,
    strategyMode: strategyMode as StrategyMode | undefined,
    numTeams,
    faabBudget,
    currentWeek,
  }
}

function buildTeamContextNotes(body: AnyObj): string[] {
  const notes: string[] = []
  const prefs = body?.preferences ?? body?.prefs ?? {}

  const intent = safeStr(prefs?.intent) || safeStr(body?.intent)
  if (intent) notes.push(`Team intent: ${intent}.`)

  const style = safeStr(prefs?.style) || safeStr(body?.style)
  if (style) notes.push(`Preference: ${style}.`)

  const leagueMeta = extractLeagueMeta(body)
  if (leagueMeta.strategyMode && STRATEGY_MODE_CONTEXT[leagueMeta.strategyMode]) {
    notes.push(`Strategy: ${STRATEGY_MODE_CONTEXT[leagueMeta.strategyMode]}`)
  }

  if (!notes.length) {
    notes.push('Prioritize weekly floor and depth where the roster is thin.')
    notes.push('Avoid short-term rentals unless the team is clearly contending.')
  }

  return notes.slice(0, 4)
}

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

async function checkWaiverRateLimit(
  req: NextRequest,
  userId: string | null,
  sleeperUsername: string | undefined,
  isPro: boolean,
  ip: string
): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }> {
  const limit = isPro ? RATE_LIMIT_PRO : userId ? RATE_LIMIT_AUTH : RATE_LIMIT_ANON

  try {
    const rl = await Promise.resolve(
      consumeRateLimit({
        scope: 'ai',
        action: 'waiver',
        sleeperUsername: sleeperUsername ?? (userId ? `user_${userId}` : 'anonymous'),
        ip,
        maxRequests: limit,
        windowMs: 60_000,
        includeIpInKey: !userId,
      })
    )

    return {
      allowed: rl.success,
      remaining: rl.remaining ?? 0,
      retryAfterSec: rl.retryAfterSec ?? 0,
    }
  } catch (e) {
    console.error('[waiver-ai] Rate limit check failed:', e)
    return { allowed: true, remaining: 3, retryAfterSec: 0 }
  }
}

async function runTripleAIWaiverAnalysis(
  candidateNames: string[],
  userPrompt: string,
  leagueMeta: ReturnType<typeof extractLeagueMeta>,
  teamContextNotes: string[],
  aiMetaContext: AIMetaContextPayload | null
): Promise<TripleAIWaiverResult> {
  const providers: TripleAIWaiverResult['providers'] = {
    deepseek: 'skipped',
    grok: 'skipped',
    openai: 'skipped',
  }

  const strategyContext = leagueMeta.strategyMode
    ? `\nSTRATEGY MODE: ${leagueMeta.strategyMode.toUpperCase()} — ${STRATEGY_MODE_CONTEXT[leagueMeta.strategyMode]}`
    : ''

  const sharedSportContext = buildWaiverRecommendationContext(leagueMeta)
  const deepSeekMetaContext = aiMetaContext ? buildDeepSeekMetaContext(aiMetaContext) : ''
  const grokMetaContext = aiMetaContext ? buildGrokMetaContext(aiMetaContext) : ''
  const sharedContext = `
SPORT CONTEXT: ${sharedSportContext}
SPORT LABEL: ${leagueMeta.sportDisplayLabel ?? leagueMeta.sport}
LEAGUE VARIANT: ${leagueMeta.leagueVariant ?? 'STANDARD'}
WAIVER CANDIDATES: ${candidateNames.join(', ')}
LEAGUE: ${leagueMeta.format ?? 'standard'} | ${leagueMeta.superflex ? 'SuperFlex' : '1QB'} | ${leagueMeta.numTeams} teams
FAAB BUDGET: $${leagueMeta.faabBudget}
WEEK: ${leagueMeta.currentWeek ?? 'unknown'}
TEAM NOTES: ${teamContextNotes.join(' ')}
${strategyContext}
  `.trim()

  const [deepseekRaw, grokRaw] = await Promise.allSettled([
    deepseekQuantAnalysis(
      `${DEEPSEEK_WAIVER_SYSTEM}\n\nAnalyze these waiver candidates:\n${sharedContext}${
        deepSeekMetaContext ? `\n\nPLATFORM META FOR QUANT MODEL:\n${deepSeekMetaContext}` : ''
      }`
    ).catch((e: any) => {
      console.warn('[waiver-ai] DeepSeek failed:', e?.message)
      return { json: null, raw: '', error: e?.message }
    }),

    xaiChatJson({
      messages: [
        { role: 'system', content: GROK_WAIVER_SYSTEM },
        {
          role: 'user',
          content: `Analyze real-time signals for these waiver candidates:\n${sharedContext}${
            grokMetaContext ? `\n\nPLATFORM META NARRATIVE CONTEXT:\n${grokMetaContext}` : ''
          }`,
        },
      ],
      tools: [{ type: 'web_search', user_location_country: 'US' }],
      temperature: GROK_TEMP,
      maxTokens: GROK_TOKENS,
    }).catch((e: any) => {
      console.warn('[waiver-ai] Grok failed:', e?.message)
      return null
    }),
  ])

  let quantResult: WaiverQuantResult | null = null
  if (deepseekRaw.status === 'fulfilled' && deepseekRaw.value?.json) {
    quantResult = deepseekRaw.value.json as WaiverQuantResult
    providers.deepseek = 'ok'
    await logAiOutput({
      provider: 'deepseek',
      role: 'quantitative',
      taskType: 'waiver_eval',
      targetType: 'league',
      targetId: leagueMeta.leagueName || undefined,
      model: 'deepseek',
      contentJson: quantResult,
    })
  } else {
    providers.deepseek = 'error'
    const reason = deepseekRaw.status === 'rejected'
      ? deepseekRaw.reason
      : (deepseekRaw.status === 'fulfilled' ? (deepseekRaw.value as any)?.error : undefined)
    if (reason) console.error('[waiver-ai] DeepSeek result:', reason)
  }

  let trendResult: WaiverTrendResult | null = null
  if (grokRaw.status === 'fulfilled' && grokRaw.value) {
    const gVal = grokRaw.value as any
    if (gVal.ok) {
      const grokText = parseTextFromXaiChatCompletion(gVal.json) ?? ''
      const parsed = parseJsonSafe(grokText)
      if (parsed) {
        trendResult = parsed as WaiverTrendResult
        providers.grok = 'ok'
        await logAiOutput({
          provider: 'grok',
          role: 'realtime',
          taskType: 'waiver_eval',
          targetType: 'league',
          targetId: leagueMeta.leagueName || undefined,
          model: 'grok',
          contentJson: trendResult,
        })
      } else {
        providers.grok = 'error'
        console.warn('[waiver-ai] Grok JSON parse failed')
      }
    } else {
      providers.grok = 'error'
    }
  } else {
    providers.grok = 'error'
  }

  return { quantResult, trendResult, providers }
}

function buildEnrichedWaiverPrompt(
  basePrompt: string,
  quantResult: WaiverQuantResult | null,
  trendResult: WaiverTrendResult | null,
  strategyMode?: StrategyMode,
  openAIMetaContext?: string
): string {
  const sections: string[] = [basePrompt]

  if (quantResult && !quantResult.error) {
    sections.push(`QUANTITATIVE ANALYSIS (DeepSeek):
Top pick by expected value: ${quantResult.topPickByExpectedValue ?? 'N/A'}
FAAB advice: ${quantResult.overallFaabBudgetAdvice ?? 'N/A'}
Player scores:
${(quantResult.playerScores ?? [])
  .map(p =>
    `- ${p.playerName}: EV+${p.expectedValueAdd}, FAAB $${p.faabRecommendation}, ` +
    `Risk ${p.riskGrade}, Confidence ${p.confidencePct}%`
  )
  .join('\n')}`.trim())
  }

  if (trendResult && !trendResult.error) {
    const alerts = [
      ...(trendResult.mustAddAlerts ?? []),
      ...(trendResult.injuryAlerts ?? []),
    ].slice(0, 3)

    if (alerts.length > 0) {
      sections.push(`REAL-TIME SIGNALS (Grok):
Must-add alerts: ${trendResult.mustAddAlerts?.join(', ') ?? 'none'}
Injury alerts: ${trendResult.injuryAlerts?.join(', ') ?? 'none'}
Trending adds: ${trendResult.trendingAdds?.join(', ') ?? 'none'}
Avoid: ${trendResult.avoidList?.join(', ') ?? 'none'}
${trendResult.rawInsight ? `Insight: ${trendResult.rawInsight}` : ''}`.trim())
    }
  }

  if (strategyMode) {
    sections.push(
      `STRATEGY MODE: ${strategyMode.toUpperCase()} — ${STRATEGY_MODE_CONTEXT[strategyMode]}`
    )
  }

  if (openAIMetaContext) {
    sections.push(`PLATFORM META CONTEXT (OpenAI):\n${openAIMetaContext}`)
  }

  return sections.join('\n\n---\n\n')
}

function mergeQuantIntoResponse(
  validatedData: AnyObj,
  quantResult: WaiverQuantResult | null,
  trendResult: WaiverTrendResult | null
): AnyObj {
  if (!validatedData.top_adds || !Array.isArray(validatedData.top_adds)) {
    return validatedData
  }

  const enriched = validatedData.top_adds.map((add: AnyObj) => {
    const name: string = add.player_name ?? add.name ?? ''

    const quantPlayer = quantResult?.playerScores?.find(
      p => p.playerName.toLowerCase().includes(name.toLowerCase()) ||
           name.toLowerCase().includes(p.playerName.toLowerCase())
    )

    const trendSignal = trendResult?.playerSignals?.find(
      p => p.playerName.toLowerCase().includes(name.toLowerCase()) ||
           name.toLowerCase().includes(p.playerName.toLowerCase())
    )

    return {
      ...add,
      ...(quantPlayer && {
        expected_value_add: quantPlayer.expectedValueAdd,
        faab_recommendation: quantPlayer.faabRecommendation,
        ceiling_score: quantPlayer.ceilingScore,
        floor_score: quantPlayer.floorScore,
        win_probability_impact: quantPlayer.winProbabilityImpact,
        risk_grade: quantPlayer.riskGrade,
        confidence_pct: quantPlayer.confidencePct,
      }),
      ...(trendSignal && trendSignal.signal !== 'none' && {
        trend_signal: trendSignal.signal,
        trend_severity: trendSignal.severity,
        trend_note: trendSignal.note,
      }),
      is_must_add: trendResult?.mustAddAlerts?.some(
        alert => alert.toLowerCase().includes(name.toLowerCase())
      ) ?? false,
    }
  })

  const hasQuantData = enriched.some((a: AnyObj) => a.expected_value_add != null)
  if (hasQuantData) {
    enriched.sort((a: AnyObj, b: AnyObj) =>
      (b.expected_value_add ?? 0) - (a.expected_value_add ?? 0)
    )
  }

  return { ...validatedData, top_adds: enriched }
}

export const POST = withApiUsage({
  endpoint: '/api/waiver-ai',
  tool: 'WaiverAi',
})(async (request: NextRequest) => {
  const startMs = Date.now()

  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string; isPro?: boolean } } | null
  const userId = session?.user?.id ?? null
  const isPro = session?.user?.isPro ?? false

  const ip = getClientIp(request) || 'unknown'

  let rawBody: AnyObj
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 }
    )
  }

  const sleeperUsername = safeStr(rawBody?.sleeper_username)

  const rateLimit = await checkWaiverRateLimit(
    request,
    userId,
    sleeperUsername,
    isPro,
    ip
  )

  let remaining = rateLimit.remaining
  let retryAfterSec = rateLimit.retryAfterSec

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Rate limit exceeded. Please try again later.',
        retryAfterSec,
        remaining,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSec) },
      }
    )
  }

  const parsedReq = WaiverRequestSchema.safeParse(rawBody)
  if (!parsedReq.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Request validation failed.',
        issues: parsedReq.error.issues,
      },
      { status: 400 }
    )
  }

  const body = parsedReq.data
  const bodyAny = body as AnyObj

  const leagueMeta = extractLeagueMeta(bodyAny)
  const teamContextNotes = buildTeamContextNotes(bodyAny)

  const candidateNames: string[] = (
    (bodyAny?.available_players ?? bodyAny?.candidates ?? []) as AnyObj[]
  )
    .map(p => safeStr(p?.name) ?? safeStr(p?.player_name) ?? '')
    .filter(Boolean)
    .slice(0, 20)

  try {
    const aiMetaContext = await resolveAIMetaContextWithWindow(leagueMeta.sport, '7d').catch(() => null)
    const { quantResult, trendResult, providers } = await runTripleAIWaiverAnalysis(
      candidateNames,
      buildWaiverUserPrompt(body),
      leagueMeta,
      teamContextNotes,
      aiMetaContext
    )

    const enrichedPrompt = buildEnrichedWaiverPrompt(
      buildWaiverUserPrompt(body),
      quantResult,
      trendResult,
      leagueMeta.strategyMode,
      aiMetaContext ? buildOpenAIMetaContext(aiMetaContext) : undefined
    )
    const sportContext = buildWaiverRecommendationContext(leagueMeta) || buildSportContextString(leagueMeta)
    const userMessage = `${sportContext}\n\n${enrichedPrompt}`

    const quantNames = new Set(
      (quantResult?.playerScores ?? []).map((p: { playerName: string }) => p.playerName?.trim?.() ?? '')
    )
    const missingQuantCandidates = candidateNames.filter((n) => !quantNames.has(n.trim()))
    const envelope = buildWaiverEnvelope({
      sport: leagueMeta.sport ?? undefined,
      leagueId: safeStr(bodyAny?.league_id) || safeStr(bodyAny?.league?.league_id) || undefined,
      userId: session?.user?.id ?? undefined,
      candidateCount: candidateNames.length,
      hasQuantResult: (quantResult?.playerScores?.length ?? 0) > 0,
      hasTrendResult: (trendResult?.playerSignals?.length ?? 0) > 0,
      missingQuantCandidates: missingQuantCandidates.length > 0 ? missingQuantCandidates.slice(0, 10) : undefined,
      strategyMode: leagueMeta.strategyMode,
    })
    const mandatorySuffix = getMandatorySystemPromptSuffix(envelope)
    const systemPrompt = [buildWaiverAiSystemPrompt({ sport: leagueMeta.sport }), mandatorySuffix].filter(Boolean).join('\n\n')

    const completion = await openaiChatJson({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: OPENAI_TEMP,
      maxTokens: OPENAI_TOKENS,
    })

    providers.openai = completion.ok ? 'ok' : 'error'
    if (completion.ok) {
      const parsed = parseJsonContentFromChatCompletion(completion.json)
      await logAiOutput({
        provider: 'openai',
        role: 'narrative',
        taskType: 'waiver_eval',
        targetType: 'league',
        targetId: leagueMeta.leagueName || undefined,
        model: (completion as any)?.json?.model ?? undefined,
        contentJson: parsed ?? null,
      })
    }

    if (!completion.ok) {
      return NextResponse.json(
        {
          success: false,
          error: 'Waiver AI analysis failed.',
          validated: false,
          providers,
          rate_limit: { remaining, retryAfterSec },
        },
        { status: 500 }
      )
    }

    const responseData = parseJsonContentFromChatCompletion(completion.json)

    const parsedRes = WaiverResponseSchema.safeParse(responseData)
    if (!parsedRes.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Waiver AI response validation failed.',
          validated: false,
          issues: parsedRes.error.issues,
          rate_limit: { remaining, retryAfterSec },
        },
        { status: 500 }
      )
    }

    let validatedData = parsedRes.data as AnyObj

    validatedData = mergeQuantIntoResponse(validatedData, quantResult, trendResult)

    if (validatedData.top_adds && Array.isArray(validatedData.top_adds)) {
      try {
        const enriched = await enrichRawWaiverSuggestionsWithGrok(
          validatedData.top_adds,
          {
            enabled: process.env.GROK_ENRICH_WAIVERS_ENABLED !== 'false',
            leagueMeta: {
              leagueName: leagueMeta.leagueName,
              format: leagueMeta.format,
              superflex: leagueMeta.superflex,
              tep: leagueMeta.tep,
              idp: leagueMeta.idp,
            },
            teamContextNotes,
            maxSuggestions: validatedData.top_adds.length,
            concurrency: 3,
          }
        )
        validatedData.top_adds = enriched.suggestions
      } catch (e) {
        console.error('[waiver-ai] Grok enrichment adapter failed:', e)
      }
    }

    trackLegacyToolUsage('waiver_ai', null, null, {
      sleeperUsername,
      leagueId:
        safeStr(bodyAny?.league_id) ||
        safeStr(bodyAny?.league?.league_id),
      topAddCount: validatedData.top_adds?.length ?? 0,
      providers: JSON.stringify(providers),
      strategyMode: leagueMeta.strategyMode,
      processingMs: Date.now() - startMs,
    })

    const primaryAnswer =
      validatedData.summary ?? validatedData.recommendation ?? (validatedData.top_adds?.[0]?.name ? `Top add: ${validatedData.top_adds[0].name}` : 'See top adds below.')
    const keyEvidence: string[] = []
    if (quantResult?.topPickByExpectedValue)
      keyEvidence.push(`Top by expected value: ${quantResult.topPickByExpectedValue}`)
    if (trendResult?.mustAddAlerts?.length) keyEvidence.push(`Must-add alerts: ${trendResult.mustAddAlerts!.slice(0, 2).join(', ')}`)
    const normalizedOutput = normalizeToContract(
      {
        primaryAnswer,
        verdict: validatedData.verdict ?? primaryAnswer,
        keyEvidence: keyEvidence.length ? keyEvidence : undefined,
        confidencePct: envelope.confidence?.scorePct,
        confidenceLabel: envelope.confidence?.label,
        risksCaveats: envelope.uncertainty?.items?.length ? ['Some candidates lacked quantitative data; priority is partially estimated.'] : undefined,
        suggestedNextAction: validatedData.suggested_next_action ?? validatedData.next_action,
      },
      envelope,
      { includeTrace: false, traceProvider: 'openai' }
    )

    return NextResponse.json({
      success: true,
      data: validatedData,
      validated: true,
      providers,
      normalizedOutput,
      metaContext: aiMetaContext
        ? {
            sport: aiMetaContext.sport,
            topTrends: aiMetaContext.topTrends?.slice(0, 3) ?? [],
          }
        : undefined,
      rate_limit: { remaining, retryAfterSec },
      ...(process.env.NODE_ENV === 'development' && {
        _debug: {
          quantResult,
          trendResult,
          aiMetaContext,
          processingMs: Date.now() - startMs,
        },
      }),
    })
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'Unknown error'
    return NextResponse.json(
      {
        success: false,
        error: 'Waiver AI request failed.',
        message: msg,
        validated: false,
        rate_limit: { remaining, retryAfterSec },
      },
      { status: 500 }
    )
  }
})
