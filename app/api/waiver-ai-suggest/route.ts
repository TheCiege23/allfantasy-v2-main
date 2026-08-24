import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client';
import { buildWaiverRecommendationContext } from '@/lib/ai/SportAwareRecommendationService';
import { resolveSportVariantContext } from '@/lib/league-defaults-orchestrator/SportVariantContextResolver';
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver';
import { z } from 'zod';

const requestSchema = z.object({
  leagueId: z.string().min(1),
  rosterWeakness: z.string().optional(),
});

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string };
  } | null;

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
  }

  const { leagueId, rosterWeakness } = parsed.data;

  try {
    const league = await (prisma as any).league.findFirst({
      where: {
        OR: [
          { id: leagueId, userId: session.user.id },
          { externalId: leagueId, userId: session.user.id },
        ],
      },
      include: {
        teams: {
          include: {
            performances: { orderBy: { week: 'desc' }, take: 3 },
          },
        },
      },
    });

    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const variantContext = resolveSportVariantContext(league.sport ?? 'NFL', league.leagueVariant ?? null);
    const userTeam = league.teams?.find((t: any) => t.isUserTeam) || league.teams?.[0];
    const rosterSummary = userTeam
      ? `Team: ${userTeam.name || 'My Team'}. Record: ${userTeam.wins ?? '?'}-${userTeam.losses ?? '?'}. Roster: ${(userTeam.roster || []).map((p: any) => `${p.name || p.player_name} (${p.position || p.pos})`).join(', ') || 'unknown'}`
      : 'No team data available';

    const leagueContext = buildWaiverRecommendationContext({
      sport: variantContext.sport,
      leagueName: league.name || leagueId,
      format: league.format || (league.isDynasty ? 'dynasty' : 'redraft'),
      numTeams: Array.isArray(league.teams) ? league.teams.length : undefined,
      superflex: Boolean(league.isSuperflex),
      idp: variantContext.isFootballIdp || variantContext.isNflIdp,
      strategyMode: 'balanced',
    });
    const leagueSummary = `Scoring: ${league.scoringType || 'standard'}. Variant: ${variantContext.displayLabel}.`;

    // Ground the model in the real player pool: exclude every player rostered in
    // this league (the route already loads all teams' rosters) and only allow
    // suggestions drawn from the DB-backed sport pool.
    const rosteredNames = new Set<string>();
    for (const team of league.teams ?? []) {
      for (const p of (team.roster || []) as any[]) {
        const n = String(p?.name || p?.player_name || '').trim().toLowerCase();
        if (n) rosteredNames.add(n);
      }
    }
    const pool = await getPlayerPoolForLeague(league.id, variantContext.sport, { limit: 220 }).catch(() => []);
    const availablePool = pool
      .filter((p) => p.full_name && !rosteredNames.has(p.full_name.trim().toLowerCase()))
      .slice(0, 120);
    const availableNames = new Set(availablePool.map((p) => p.full_name.trim().toLowerCase()));
    const poolBlock = availablePool.length
      ? `\nAVAILABLE PLAYERS — you may ONLY suggest players from this list, using these exact names:\n${availablePool
          .map((p) => `- ${p.full_name} (${p.position || '?'}${p.team_abbreviation ? `, ${p.team_abbreviation}` : ''})${p.injury_status ? ` [${p.injury_status}]` : ''}`)
          .join('\n')}\n`
      : '';

    const systemPrompt = `You are an expert fantasy sports waiver wire analyst for NFL, NHL, MLB, NBA, NCAA Football, NCAA Basketball, and Soccer.
Analyze league and team context to suggest realistic waiver wire pickups for the selected sport.
${availablePool.length ? 'Suggest ONLY players from the provided AVAILABLE PLAYERS list — never invent or substitute names.' : 'Focus on likely available players (not stars), recent role changes, usage trends, matchups, and roster needs.'}
Return ONLY valid JSON.`;

    const positionFocus = rosterWeakness ? `\nFOCUS: Prioritize ${rosterWeakness} suggestions - the user specifically needs help at this position.` : '';

    const userPrompt = `Based on this league and team context, suggest 5-8 waiver wire targets.

${leagueContext}
${leagueSummary}
${rosterSummary}${positionFocus}
${poolBlock}

Return JSON:
{
  "suggestions": [
    {
      "playerName": "string",
      "position": "sport-specific position code",
      "team": "team abbreviation or club short name",
      "reason": "1-2 sentence explanation of why to add this player",
      "priority": number 1-10 (10 = must add)
    }
  ]
}

Sort by priority descending. Be specific about matchups and usage trends. Only suggest realistic waiver adds, not rostered stars.`;

    const result = await openaiChatJson({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      maxTokens: 1500,
    });

    if (!result.ok) {
      console.error('[waiver-ai-suggest] AI error:', result.details);
      return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 });
    }

    const parsed = parseJsonContentFromChatCompletion(result.json);
    const rawSuggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    // Belt and braces: when a real pool was provided, drop any name the model
    // invented anyway — a hallucinated player must never reach a client.
    const suggestions = availableNames.size > 0
      ? rawSuggestions.filter((s: any) => availableNames.has(String(s?.playerName ?? '').trim().toLowerCase()))
      : rawSuggestions;

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error('[waiver-ai-suggest] Error:', err);
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 });
  }
}
