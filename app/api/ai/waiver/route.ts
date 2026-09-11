import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logUserEventByUsername } from '@/lib/user-events';
import { prisma } from '@/lib/prisma';
import { 
  WaiverRequestSchema, 
  WaiverResponseSchema,
  WAIVER_AI_SYSTEM_PROMPT,
  buildWaiverUserPrompt
} from '@/lib/waiver-ai-prompt';
import { runAiProtection } from '@/lib/ai-protection';
import { trackLegacyToolUsage } from '@/lib/analytics-server';
import { getComprehensiveLearningContext } from '@/lib/comprehensive-trade-learning';
import { buildOpenAIMetaContext, resolveAIMetaContextWithWindow } from '@/lib/meta-insights';
import { recordTrendSignalsByPlayerNames } from '@/lib/player-trend';
import { getInsightBundle } from '@/lib/ai-simulation-integration';
import { assertLeagueMember } from '@/lib/league-access';
import { getOpenAIConfig, openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client';
import { logAiOutput } from '@/lib/ai/output-logger';
import { isAIAssistantEnabled, isToolWaiverAIEnabled } from '@/lib/feature-toggle';

const ContextScopeSchema = z.object({
  sleeper_username: z.string().optional(),
  include_legacy: z.boolean().optional().default(true),
});

const ExtendedWaiverRequestSchema = WaiverRequestSchema.extend({
  context_scope: ContextScopeSchema.optional(),
});

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
  });

  if (!user) return null;

  const aiReport = user.aiReports[0];


  return {
    display_name: user.displayName,
    rating: aiReport?.rating || null,
  };
}

export const POST = withApiUsage({ endpoint: "/api/ai/waiver", tool: "AiWaiver" })(async (request: NextRequest) => {
  try {
    if (!(await isAIAssistantEnabled()) || !(await isToolWaiverAIEnabled())) {
      return NextResponse.json(
        { error: 'Waiver AI is temporarily disabled by platform configuration.' },
        { status: 503 }
      )
    }

    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limitRes = await runAiProtection(request, {
      action: 'waiver',
      getUserId: async () => session.user?.id ?? null,
    })
    if (limitRes) return limitRes

    const body = await request.json();
    const parseResult = ExtendedWaiverRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request format', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const waiverRequest = parseResult.data;

    try {
      await assertLeagueMember(waiverRequest.league.league_id, session.user.id)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const waiverUsername = waiverRequest.context_scope?.sleeper_username
    if (waiverUsername) {
      logUserEventByUsername(waiverUsername, 'waiver_analysis_started')
    }

    let legacyContext = null;
    if (waiverRequest.context_scope?.sleeper_username && waiverRequest.context_scope.include_legacy) {
      legacyContext = await getLegacyContext(waiverRequest.context_scope.sleeper_username);
    }

    let userPrompt = buildWaiverUserPrompt(waiverRequest);

    if (legacyContext) {
      const legacySection = `
LEGACY CONTEXT (from DB - do not call external APIs):
- Manager: ${legacyContext.display_name}
- Legacy Rating: ${legacyContext.rating || 'Not rated'}

Consider this manager's style when making recommendations.
`;
      userPrompt = legacySection + '\n' + userPrompt;
    }

    const [learningContext, aiMetaContext, insightBundle] = await Promise.all([
      getComprehensiveLearningContext(),
      resolveAIMetaContextWithWindow(waiverRequest.league?.sport ?? 'NFL', '7d').catch(() => null),
      waiverRequest.league?.league_id
        ? getInsightBundle(waiverRequest.league.league_id, 'waiver', {
            sport: waiverRequest.league?.sport,
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const openaiMetaContext = aiMetaContext ? buildOpenAIMetaContext(aiMetaContext) : ''
    if (insightBundle?.contextText) {
      userPrompt = `${userPrompt}\n\nSIMULATION/WAREHOUSE CONTEXT:\n${insightBundle.contextText}`
    }
    const enhancedSystemPrompt = [
      WAIVER_AI_SYSTEM_PROMPT,
      learningContext ?? '',
      openaiMetaContext ? `\nPLATFORM META (use for waiver recommendations):\n${openaiMetaContext}` : '',
      insightBundle
        ? `\nAI model responsibilities:\n- DeepSeek: ${insightBundle.modelResponsibilities.deepseek}\n- Grok: ${insightBundle.modelResponsibilities.grok}\n- OpenAI: ${insightBundle.modelResponsibilities.openai}`
        : '',
    ].filter(Boolean).join('\n');

    const completion = await openaiChatJson({
      messages: [
        { role: 'system', content: enhancedSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      maxTokens: 2000,
    })

    if (!completion.ok) {
      return NextResponse.json(
        { error: 'Failed to analyze waivers', details: completion.details },
        { status: completion.status || 502 }
      )
    }

    const aiResponse = parseJsonContentFromChatCompletion(completion.json)
    if (!aiResponse) {
      return NextResponse.json(
        { error: 'AI returned invalid JSON' },
        { status: 500 }
      );
    }
    const validatedResponse = WaiverResponseSchema.safeParse(aiResponse);
    const responseData = validatedResponse.success ? validatedResponse.data : aiResponse

    const { model } = getOpenAIConfig()
    await logAiOutput({
      provider: 'openai',
      role: 'narrative',
      taskType: 'waiver_suggestions',
      targetType: 'user',
      targetId: waiverRequest.context_scope?.sleeper_username || session.user.id,
      model: completion.json?.model || model,
      contentJson: responseData,
      meta: {
        leagueId: waiverRequest.league.league_id,
        validated: validatedResponse.success,
        hasLegacyContext: !!legacyContext,
      },
    })

    try {
      const topAdds = Array.isArray(responseData?.top_adds) ? responseData.top_adds : []
      const recommendedNames = topAdds
        .map((a: any) => (typeof a?.player_name === 'string' ? a.player_name.trim() : ''))
        .filter(Boolean)
      if (recommendedNames.length > 0) {
        await recordTrendSignalsByPlayerNames({
          playerNames: recommendedNames,
          sport: waiverRequest.league?.sport,
          signalType: 'ai_recommendation',
          leagueId: waiverRequest.league?.league_id,
          value: 1,
        })
      }
    } catch {
      // non-fatal
    }

    const sleeperUsername = waiverRequest.context_scope?.sleeper_username
    if (sleeperUsername) {
      trackLegacyToolUsage('waiver_ai', null, null, { sleeperUsername })
      logUserEventByUsername(sleeperUsername, 'waiver_analysis_completed')
    }

    return NextResponse.json({
      success: true,
      data: responseData,
      validated: validatedResponse.success,
      metaContext: aiMetaContext
        ? {
            sport: aiMetaContext.sport,
            topTrends: aiMetaContext.topTrends?.slice(0, 3) ?? [],
          }
        : undefined,
      legacy_context: legacyContext ? { included: true } : { included: false },
    });
  } catch (error) {
    console.error('Waiver AI error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze waivers', details: String(error) },
      { status: 500 }
    );
  }
})
