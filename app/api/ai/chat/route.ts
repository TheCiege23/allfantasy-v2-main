import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { buildUserTemporalContextForAI } from '@/lib/preferences/userTemporalContextForAI'
import { checkAiRateLimit } from '@/lib/ai-protection'
import { logAiFailure } from '@/lib/error-tracking'
import { openaiChatTextStream } from '@/lib/openai-client'
import { getUniversalAIContext } from '@/lib/ai-player-context'
import { getPlayerAnalyticsBatch, computeAthleticGrade, computeCollegeProductionGrade, type PlayerAnalytics } from '@/lib/player-analytics'
import { logUserEventByUsername } from '@/lib/user-events'
import { logAiOutput } from '@/lib/ai/output-logger'
import { buildSportContextString, resolveSportForAI } from '@/lib/ai/AISportContextResolver'
import { resolveSportVariantContext } from '@/lib/league-defaults-orchestrator/SportVariantContextResolver'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { isAIAssistantEnabled } from '@/lib/feature-toggle'
import { runCostControlledOpenAIText } from '@/lib/ai-cost-control'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'
import {
  chimmyContextEngine,
  classifyChimmyIntent,
  composeChimmyPrompt,
  selectProvidersForIntent,
} from '@/lib/chimmy-context'
import { shouldInjectChimmyContext } from '@/lib/chimmy-context/flags'
import { buildIntelligenceBundle } from '@/lib/chimmy-context/intel/intelligenceBundle'
import { recordChimmyContextRun } from '@/lib/chimmy-context/telemetry/recordRun'

const ContextScopeSchema = z.object({
  sleeper_username: z.string(),
  include_legacy: z.boolean().optional().default(true),
})

const ChatRequestSchema = z.object({
  context_scope: ContextScopeSchema,
  message: z.string().min(1).max(2000),
  confirmTokenSpend: z.boolean().optional().default(false),
  conversation_history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .optional()
    .default([]),
})

function extractPlayerNamesFromMessage(message: string, history: Array<{role: string, content: string}>): string[] {
  const text = [message, ...history.slice(-3).map(h => h.content)].join(' ')
  const matches = text.match(/[A-Z][a-z]+(?:\.\s?)?(?:[A-Z][a-z]+)+/g) || []
  const unique = [...new Set(matches)].slice(0, 10)
  return unique
}

function buildPlayerAnalyticsContext(analyticsMap: Map<string, PlayerAnalytics>): string {
  const entries: string[] = []
  for (const [, analytics] of analyticsMap) {
    const athletic = computeAthleticGrade(analytics)
    const college = computeCollegeProductionGrade(analytics)
    const parts: string[] = [`**${analytics.name}** (${analytics.position}, ${analytics.currentTeam || 'FA'})`]
    
    if (athletic.score > 0) parts.push(`Athletic: ${athletic.grade} (${athletic.label})`)
    if (college.score > 0) parts.push(`College: ${college.grade} (${college.label})`)
    if (analytics.college.breakoutAge) parts.push(`Breakout Age: ${analytics.college.breakoutAge}`)
    if (analytics.combine.fortyYardDash) parts.push(`40-yd: ${analytics.combine.fortyYardDash}s`)
    if (analytics.college.dominatorRating) parts.push(`Dominator: ${analytics.college.dominatorRating}%`)
    if (analytics.comparablePlayers.length > 0) parts.push(`Comps: ${analytics.comparablePlayers.slice(0, 3).join(', ')}`)
    if (analytics.fantasyPointsPerGame) parts.push(`FPts/G: ${analytics.fantasyPointsPerGame.toFixed(1)}`)
    if (analytics.weeklyVolatility) parts.push(`Volatility: ${analytics.weeklyVolatility.toFixed(2)}`)
    if (analytics.draft.draftPick) parts.push(`Draft Pick: #${analytics.draft.draftPick}`)
    
    entries.push(parts.join(' | '))
  }
  
  return `\n\n## PLAYER ANALYTICS DATA (from database)\nUse this data to provide specific, evidence-based advice about these players:\n${entries.join('\n')}\n\nCite specific metrics when discussing these players (e.g., "His breakout age of 19.5 is elite" or "His A+ athletic profile suggests high ceiling").`
}

async function getLegacyContext(sleeperUsername: string) {
  const user = await prisma.legacyUser.findUnique({
    where: { sleeperUsername: sleeperUsername.toLowerCase() },
    include: {
      leagues: { include: { rosters: true } },
      aiReports: {
        where: { reportType: 'legacy' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  if (!user) return null

  type LegacyLeague = (typeof user.leagues)[number]
  const allRosters = user.leagues.flatMap((l: LegacyLeague) => l.rosters)
  const totalWins = allRosters.reduce(
    (sum: number, r: { wins?: number | null }) => sum + (r.wins ?? 0),
    0
  )
  const totalLosses = allRosters.reduce(
    (sum: number, r: { losses?: number | null }) => sum + (r.losses ?? 0),
    0
  )
  const championships = allRosters.filter((r: { isChampion?: boolean | null }) => r.isChampion).length

  const aiReport = user.aiReports[0]
  const insights = (aiReport?.insights as Record<string, unknown> | null) ?? null

  const recentLeagues = user.leagues
    .slice()
    .sort((a: LegacyLeague, b: LegacyLeague) => b.season - a.season)
    .slice(0, 5)
    .map((l: LegacyLeague) => {
      const roster = l.rosters[0] as any
      return {
        name: l.name,
        season: l.season,
        record: roster ? `${roster.wins}-${roster.losses}` : 'N/A',
        champion: roster?.isChampion || false,
      }
    })

  return {
    display_name: user.displayName || user.sleeperUsername,
    total_leagues: user.leagues.length,
    total_seasons: Array.from(new Set(user.leagues.map((l: LegacyLeague) => l.season))).length,
    career_record: `${totalWins}-${totalLosses}`,
    win_percentage:
      totalWins + totalLosses > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0,
    championships,
    archetype: (insights?.archetype as string) || 'Unknown',
    rating: aiReport?.rating || null,
    title: aiReport?.title || null,
    strengths: (insights?.strengths as string[]) || [],
    weaknesses: (insights?.weaknesses as string[]) || [],
    recent_leagues: recentLeagues,
  }
}

async function resolveChatLeagueMeta(
  body: Record<string, unknown>,
  legacyContext: Awaited<ReturnType<typeof getLegacyContext>>,
  resolvedSport: string
) {
  const bodyLeague = body.league as Record<string, unknown> | undefined

  const variantRaw =
    (typeof body.leagueVariant === 'string' ? body.leagueVariant : null) ??
    (typeof body.league_variant === 'string' ? body.league_variant : null) ??
    (typeof bodyLeague?.leagueVariant === 'string' ? bodyLeague.leagueVariant : null) ??
    (typeof bodyLeague?.league_variant === 'string' ? bodyLeague.league_variant : null)
  const variantContext = resolveSportVariantContext(
    String(bodyLeague?.sport ?? resolvedSport),
    variantRaw
  )

  const formatRaw =
    (typeof bodyLeague?.format === 'string' ? bodyLeague.format : null) ??
    (typeof body.format === 'string' ? body.format : null)
  const format =
    formatRaw ??
    (Boolean(bodyLeague?.isDynasty) || Boolean(body.isDynasty) ? 'dynasty' : null) ??
    ((variantContext.isFootballIdp || variantContext.isNflIdp) ? variantContext.formatType : 'redraft')

  return {
    sport: variantContext.sport,
    leagueName:
      (typeof bodyLeague?.name === 'string' ? bodyLeague.name : null) ??
      legacyContext?.recent_leagues?.[0]?.name ??
      null,
    format,
    strategyMode:
      (typeof body.strategyMode === 'string' ? body.strategyMode : null) ??
      (typeof body.strategy_mode === 'string' ? body.strategy_mode : null) ??
      'balanced',
    superflex:
      Boolean((bodyLeague as Record<string, unknown> | undefined)?.superflex) ||
      Boolean(body.superflex),
    idp:
      variantContext.isFootballIdp ||
      variantContext.isNflIdp ||
      Boolean((bodyLeague as Record<string, unknown> | undefined)?.idp) ||
      Boolean(body.idp),
    tep:
      Boolean((bodyLeague as Record<string, unknown> | undefined)?.tep) ||
      Boolean(body.tep),
    numTeams:
      typeof bodyLeague?.numTeams === 'number'
        ? (bodyLeague.numTeams as number)
        : typeof body.numTeams === 'number'
          ? (body.numTeams as number)
          : undefined,
  }
}

function buildSystemPrompt(
  legacyContext: Awaited<ReturnType<typeof getLegacyContext>>,
  sportContext: string,
  playerAnalyticsContext?: string
) {
  let basePrompt = `You are THE ELITE AllFantasy AI Assistant - the #1 dynasty fantasy sports advisor.

${getUniversalAIContext()}

## SPORT CONTEXT
${sportContext}

## YOUR EXPERT KNOWLEDGE
You have encyclopedic knowledge of dynasty fantasy strategy:
- Trading: Buy-low/sell-high tactics, team status exploitation, value assessment
- Waivers: Value creation over points, tier system, contender vs rebuilder adds
- Drafting: Position scarcity, age curves, breakout indicators
- Roster construction: Starter strength, elite advantages, depth management

## TEAM CLASSIFICATION DECISION TREE
You can classify any team using this logic:
1. Does team have 6+ confident starters? If no → REBUILD
2. Has elite difference-maker (top QB/WR/TE)? If yes → CONTENDER
3. Has 2+ future 1sts or young unproductive assets? If yes → REBUILD, else → MIDDLE

## STRATEGY BY TEAM STATUS
- CONTENDERS: Buy points, sell uncertainty. Trade picks for proven starters. Win now.
- REBUILDERS: Sell points, buy value. Trade RBs for picks. Acquire young WRs/QBs.
- MIDDLE: Must choose a lane! Being stuck in the middle is the worst place.

## YOUR ROLE
- Answer questions with SPECIFIC, ACTIONABLE advice
- Use the user's career history to personalize recommendations
- Be honest about weaknesses - users respect directness
- Never make up statistics - only reference what's provided
- ALWAYS apply the tier system when discussing player values
- NEVER suggest unrealistic trades that violate tier rules
- Do NOT call any external APIs - all data comes from the database snapshot provided`

  if (legacyContext) {
    const winPct = legacyContext.win_percentage
    const statusGuess = winPct >= 55 && legacyContext.championships > 0 ? 'CONTENDER' :
                        winPct < 45 ? 'REBUILDER' : 'MIDDLE or TRANSITIONAL'
    
    basePrompt += `

## USER LEGACY CONTEXT (from database)
- Name: ${legacyContext.display_name}
- Career Record: ${legacyContext.career_record} (${winPct}% win rate)
- Championships: ${legacyContext.championships}
- Total Leagues: ${legacyContext.total_leagues} across ${legacyContext.total_seasons} seasons
- Archetype: ${legacyContext.archetype}
- Legacy Rating: ${legacyContext.rating || 'Not yet rated'}/100
- Title: ${legacyContext.title || 'Not assigned'}
- Estimated Status: ${statusGuess}

Strengths: ${legacyContext.strengths.join(', ') || 'Not identified'}
Areas to improve: ${legacyContext.weaknesses.join(', ') || 'Not identified'}

Recent League History:
${legacyContext.recent_leagues
  .map(
    (l: { name: string; season: number; record: string; champion: boolean }) =>
      `- ${l.name} (${l.season}): ${l.record}${l.champion ? ' - CHAMPION' : ''}`
  )
  .join('\n')}

Use this context to personalize your responses. Tailor advice to their estimated team status.
Reference their history and patterns when giving recommendations.`
  }

  if (playerAnalyticsContext) {
    basePrompt += playerAnalyticsContext
  }

  return basePrompt
}

export const POST = withApiUsage({ endpoint: "/api/ai/chat", tool: "AiChat" })(async (request: NextRequest) => {
  let userId: string | null = null
  let tokenFallbackLedgerId: string | null = null
  try {
    if (!(await isAIAssistantEnabled())) {
      return NextResponse.json(
        { error: 'AI assistant is temporarily disabled by platform configuration.' },
        { status: 503 }
      )
    }

    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    userId = session.user.id

    const body = await request.json()
    const parseResult = ChatRequestSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request format', details: parseResult.error.errors },
        { status: 400 }
      )
    }

    const { context_scope, message, conversation_history } = parseResult.data
    // Identity is always derived from the authenticated session's own linked LegacyUser, never
    // from the client-supplied context_scope.sleeper_username — trusting that field let one
    // account pull another user's legacy career context into their own Chimmy conversation.
    const sessionAppUser = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { legacyUser: { select: { sleeperUsername: true } } },
    })
    const sleeperUsername = sessionAppUser?.legacyUser?.sleeperUsername?.trim()?.toLowerCase()
    const resolvedSport = resolveSportForAI(body as Record<string, unknown>)
    const leagueId =
      (typeof (body as Record<string, unknown>).league_id === 'string'
        ? ((body as Record<string, unknown>).league_id as string)
        : null) ??
      (typeof (body as Record<string, unknown>).league === 'object' &&
      (body as Record<string, unknown>).league !== null &&
      typeof ((body as Record<string, unknown>).league as Record<string, unknown>).id === 'string'
        ? (((body as Record<string, unknown>).league as Record<string, unknown>).id as string)
        : null)

    if (!sleeperUsername) {
      return NextResponse.json({ error: 'Missing sleeper_username' }, { status: 400 })
    }

    if (leagueId) {
      try {
        await assertLeagueMember(leagueId, session.user.id)
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = checkAiRateLimit(request, 'chat', { sleeperUsername, includeIpInKey: true })

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

    let legacyContext: any = null
    if (context_scope.include_legacy) {
      legacyContext = await getLegacyContext(sleeperUsername)
    }

    if (!legacyContext) {
      return NextResponse.json({ error: 'User not found. Please import your Sleeper data first.' }, { status: 404 })
    }

    const mentionedPlayers = extractPlayerNamesFromMessage(message, conversation_history)
    let playerAnalyticsContext = ''
    if (mentionedPlayers.length > 0) {
      try {
        const analyticsMap = await getPlayerAnalyticsBatch(mentionedPlayers)
        if (analyticsMap.size > 0) {
          playerAnalyticsContext = buildPlayerAnalyticsContext(analyticsMap)
        }
      } catch {
      }
    }

    const chatLeagueMeta = await resolveChatLeagueMeta(
      body as Record<string, unknown>,
      legacyContext,
      resolvedSport
    )
    const sportContext = buildSportContextString(chatLeagueMeta)

    const profileClock = await prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true, preferredLanguage: true },
    })
    const userClock = buildUserTemporalContextForAI({
      timezone: profileClock?.timezone,
      preferredLanguage: profileClock?.preferredLanguage,
    })

    const systemPrompt =
      buildSystemPrompt(legacyContext, sportContext, playerAnalyticsContext) +
      `\n\n## USER DATE & TIME (authoritative)\n${userClock.promptLine}\nUse this for "today", schedules, and day-count questions; do not assume a different calendar date.`

    // Phase 2B — optional Chimmy Context Engine injection (feature-flagged).
    // When `CHIMMY_CONTEXT_ENGINE_INJECT=1`, classify the user intent, load
    // only the relevant providers, compose a budgeted context block, and
    // append it to the system prompt. All failures here are non-fatal — the
    // base chat behavior must keep working unchanged.
    let chimmyContextMeta:
      | {
          intent: string
          approxTokens: number
          durationMs: number
          providers: Array<{ name: string; ok: boolean; cached: boolean; durationMs: number }>
          sections: Array<{ id: string; rendered: boolean; dropped: boolean; truncated: boolean }>
        }
      | null = null
    let composedSystemPrompt = systemPrompt
    const canaryDecision = shouldInjectChimmyContext({
      userId,
      userEmail: session.user.email ?? null,
    })
    if (canaryDecision.eligible) {
      const canaryStartedAt = Date.now()
      try {
        const classification = classifyChimmyIntent({
          message,
          history: conversation_history,
        })
        const providers = selectProvidersForIntent(classification.intent)
        const bundle = await chimmyContextEngine.loadContext(
          {
            userId,
            userEmail: session.user.email ?? null,
            leagueId: leagueId ?? null,
            sport: resolvedSport,
          },
          { onlyProviders: providers }
        )
        const composed = composeChimmyPrompt(bundle, { intent: classification.intent })
        if (composed.contextBlock.length > 0) {
          composedSystemPrompt = `${systemPrompt}\n\n${composed.contextBlock}`
        }
        const providerMeta = bundle.meta.providers.map((p) => ({
          name: p.name,
          ok: p.ok,
          cached: p.cached,
          durationMs: p.durationMs,
        }))
        const sectionMeta = composed.sections.map((s) => ({
          id: s.id,
          rendered: s.rendered,
          dropped: s.dropped,
          truncated: s.truncated,
        }))
        chimmyContextMeta = {
          intent: classification.intent,
          approxTokens: composed.approxTokens,
          durationMs: bundle.meta.durationMs,
          providers: providerMeta,
          sections: sectionMeta,
        }

        // Derive intelligence snapshot for telemetry — never throws.
        let urgencyLevel: string | null = null
        let recommendationSeverity: string | null = null
        let riskComposite: number | null = null
        let topRisk: string | null = null
        try {
          const intel = buildIntelligenceBundle(bundle)
          urgencyLevel = intel?.urgencyLevel ?? null
          recommendationSeverity = intel?.recommendationSeverity ?? null
          riskComposite =
            typeof intel?.strategicRiskScores?.composite === 'number'
              ? intel.strategicRiskScores.composite
              : null
          topRisk = intel?.topRisks?.[0]?.dimension ?? null
        } catch {
          // Intelligence derivation is best-effort; ignore failures.
        }

        // Fire-and-forget telemetry. Never awaited.
        void recordChimmyContextRun({
          userId,
          surface: 'chat',
          leagueId: leagueId ?? null,
          intent: classification.intent,
          durationMs: Date.now() - canaryStartedAt,
          approxPromptChars: composed.contextBlock.length,
          canaryReason: canaryDecision.reason,
          rolloutBucket: canaryDecision.rolloutBucket,
          urgencyLevel,
          recommendationSeverity,
          riskComposite,
          topRisk,
          providers: providerMeta,
          sections: sectionMeta,
        })
      } catch (err) {
        // Never fail the chat request because of context injection.
        logAiFailure(err, {
          tool: 'AiChat',
          endpoint: '/api/ai/chat',
          provider: 'chimmy-context-engine',
        })
        const errorMessage =
          err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown_error'
        // Fire-and-forget telemetry on the failure path too.
        void recordChimmyContextRun({
          userId,
          surface: 'chat',
          leagueId: leagueId ?? null,
          durationMs: Date.now() - canaryStartedAt,
          canaryReason: canaryDecision.reason,
          rolloutBucket: canaryDecision.rolloutBucket,
          errorMessage,
        })
      }
    }

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: composedSystemPrompt },
      ...conversation_history.slice(-10),
      { role: 'user', content: message },
    ]

    const streamRequested =
      request.nextUrl.searchParams?.get('stream') === '1' ||
      (typeof (body as Record<string, unknown>).stream === 'boolean' &&
        (body as Record<string, unknown>).stream === true)

    const gate = await requireFeatureEntitlement({
      userId,
      userEmail: session?.user?.email,
      featureId: 'ai_chat',
      allowTokenFallback: true,
      confirmTokenSpend: Boolean((body as Record<string, unknown>).confirmTokenSpend),
      tokenRuleCode: 'ai_chimmy_chat_message',
      tokenSourceType: 'ai_chat_message',
      tokenSourceId: `${leagueId ?? sleeperUsername}:${Date.now()}`,
      tokenDescription: 'AI chat message',
      tokenMetadata: {
        leagueId: leagueId ?? null,
        sport: resolvedSport,
        streamRequested,
      },
    })
    if (!gate.ok) return gate.response
    if (gate.tokenSpend) tokenFallbackLedgerId = gate.tokenSpend.id

    const refundTokenFallbackIfNeeded = async (sourceType: string) => {
      if (!tokenFallbackLedgerId || !userId) return
      await new TokenSpendService()
        .refundSpendByLedger({
          userId,
          spendLedgerId: tokenFallbackLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType,
          sourceId: tokenFallbackLedgerId,
          idempotencyKey: `refund:ai_chat:${tokenFallbackLedgerId}`,
          description: 'Auto refund after failed AI chat request.',
          metadata: {
            sleeperUsername,
            leagueId: leagueId ?? null,
          },
        })
        .catch(() => null)
    }

    if (streamRequested) {
      const streamResult = await openaiChatTextStream({
        messages,
        temperature: 0.7,
        maxTokens: 1000,
      })
      if (!streamResult.ok) {
        await refundTokenFallbackIfNeeded('ai_chat_stream_bootstrap_refund')
        return NextResponse.json(
          { error: 'Failed to process chat', details: streamResult.details },
          { status: 500 }
        )
      }

      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const writeEvent = (event: string, payload: Record<string, unknown>) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
            )
          }

          let responseText = ''
          try {
            writeEvent('start', { provider: 'openai', model: streamResult.model })
            for await (const chunk of streamResult.stream) {
              responseText += chunk
              writeEvent('chunk', { delta: chunk })
            }

            if (!responseText.trim()) {
              await refundTokenFallbackIfNeeded('ai_chat_stream_empty_refund')
              writeEvent('error', { error: 'No response from AI' })
              controller.close()
              return
            }

            logUserEventByUsername(sleeperUsername, 'ai_chat_used', {
              hasLegacyContext: !!legacyContext,
            })
            await logAiOutput({
              provider: 'openai',
              role: 'narrative',
              taskType: 'ai_chat',
              targetType: 'user',
              targetId: sleeperUsername,
              model: streamResult.model,
              contentText: responseText,
              meta: {
                hasLegacyContext: !!legacyContext,
              },
            })

            writeEvent('done', {
              success: true,
              response: responseText,
              tokenSpend: gate.tokenSpend
                ? {
                    ruleCode: gate.tokenPreview?.ruleCode ?? 'ai_chimmy_chat_message',
                    tokenCost: gate.tokenPreview?.tokenCost ?? null,
                    balanceAfter: gate.tokenSpend.balanceAfter,
                    ledgerId: gate.tokenSpend.id,
                  }
                : null,
              legacy_context: {
                included: true,
                display_name: legacyContext.display_name,
                archetype: legacyContext.archetype,
              },
              chimmy_context: chimmyContextMeta,
              rate_limit: { remaining: rl.remaining, retryAfterSec: rl.retryAfterSec },
            })
            controller.close()
          } catch (streamError) {
            await refundTokenFallbackIfNeeded('ai_chat_stream_execution_refund')
            writeEvent('error', {
              error: streamError instanceof Error ? streamError.message : 'Streaming failed',
            })
            controller.close()
          }
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    const completion = await runCostControlledOpenAIText({
      feature: 'ai_chat',
      enableAI: true,
      fallbackText: null,
      messages,
      temperature: 0.7,
      maxTokens: 1000,
      cacheTtlMs: 30_000,
      repeatCooldownMs: 6_000,
      cacheContext: {
        sleeperUsername,
        resolvedSport,
        leagueId: leagueId ?? null,
      },
    })
    const responseText = completion.text

    if (!completion.ok || !responseText?.trim()) {
      await refundTokenFallbackIfNeeded('ai_chat_completion_refund')
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }

    logUserEventByUsername(sleeperUsername, 'ai_chat_used', {
      hasLegacyContext: !!legacyContext,
    })

    await logAiOutput({
      provider: 'openai',
      role: 'narrative',
      taskType: 'ai_chat',
      targetType: 'user',
      targetId: sleeperUsername,
      model: completion.model,
      contentText: responseText,
      meta: {
        hasLegacyContext: !!legacyContext,
      },
    })

    return NextResponse.json({
      success: true,
      response: responseText,
      tokenSpend: gate.tokenSpend
        ? {
            ruleCode: gate.tokenPreview?.ruleCode ?? 'ai_chimmy_chat_message',
            tokenCost: gate.tokenPreview?.tokenCost ?? null,
            balanceAfter: gate.tokenSpend.balanceAfter,
            ledgerId: gate.tokenSpend.id,
          }
        : null,
      legacy_context: {
        included: true,
        display_name: legacyContext.display_name,
        archetype: legacyContext.archetype,
      },
      chimmy_context: chimmyContextMeta,
      rate_limit: { remaining: rl.remaining, retryAfterSec: rl.retryAfterSec },
    })
  } catch (error) {
    if (tokenFallbackLedgerId && userId) {
      await new TokenSpendService()
        .refundSpendByLedger({
          userId,
          spendLedgerId: tokenFallbackLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'ai_chat_uncaught_refund',
          sourceId: tokenFallbackLedgerId,
          idempotencyKey: `refund:ai_chat:${tokenFallbackLedgerId}`,
          description: 'Auto refund after failed AI chat request.',
          metadata: {},
        })
        .catch(() => null)
    }
    logAiFailure(error, { tool: 'AiChat', endpoint: '/api/ai/chat', provider: 'openai' })
    return NextResponse.json({ error: 'Failed to process chat', details: String(error) }, { status: 500 })
  }
})

