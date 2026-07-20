import { NextResponse } from 'next/server';
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { assertLeagueMember, type LeagueAccessResult } from '@/lib/league-access';
import { z } from 'zod';
import { isToolRankingsEnabled } from '@/lib/feature-toggle';
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'

const openai = getOpenAIRouteClient()

const bodySchema = z.object({
  leagueId: z.string(),
});

export async function POST(req: Request) {
  try {
    if (!(await isToolRankingsEnabled())) {
      return NextResponse.json(
        { error: 'Rankings tool is temporarily disabled by platform configuration.' },
        { status: 503 }
      );
    }

    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string };
    } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const json = await req.json();
    const { leagueId } = bodySchema.parse(json);

    // Authentication alone left this open: `leagueId` is body-supplied, so any signed-in user could
    // read any league's teams and performances. This route is the modern uuid id space
    // (prisma.league / League.id), so assertLeagueMember is the correct guard — it THROWS with
    // err.status = 403 rather than returning a result, hence the try/catch.
    let access: LeagueAccessResult;
    try {
      access = await assertLeagueMember(leagueId, session.user.id);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // assertLeagueMember already loaded this league row (it selects sport alongside userId) to
    // resolve membership, so its result is reused rather than issuing a second identical
    // findUnique. Past the guard the league is guaranteed to exist, so the old `?? 'NFL'`
    // fallback for a null row is no longer reachable.
    const leagueSport = access.leagueSport
    const playerSport = String(leagueSport).toLowerCase()

    const teams = await (prisma as any).leagueTeam.findMany({
      where: { leagueId },
      include: { performances: { orderBy: { week: 'asc' } } },
      orderBy: { pointsFor: 'desc' },
    });

    if (teams.length === 0) {
      return NextResponse.json({ error: 'No teams found' }, { status: 404 });
    }

    const cachedPlayers = await (prisma as any).sportsPlayer.findMany({
      where: { sport: playerSport },
      take: 30,
      orderBy: { fetchedAt: 'desc' },
    });

    const prompt = `You are an elite fantasy football GM with 15+ years experience.
Use ONLY the following real data to evaluate these teams. Do not hallucinate or invent data.

Teams:
${teams.map((t: any) => {
  const weeklyPoints = t.performances?.map((p: any) => p.points) || [];
  const trend = weeklyPoints.length > 0 ? weeklyPoints.join(', ') : 'no weekly data';
  const recentAvg = weeklyPoints.length >= 3
    ? (weeklyPoints.slice(-3).reduce((a: number, b: number) => a + b, 0) / 3).toFixed(1)
    : 'N/A';
  return `- ${t.teamName} (${t.ownerName}): Record ${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}, Total PF: ${t.pointsFor.toFixed(1)}, PA: ${t.pointsAgainst.toFixed(1)}, Weekly trend: [${trend}], Last 3 avg: ${recentAvg}`;
}).join('\n')}

${cachedPlayers.length > 0 ? `\nRecent ${leagueSport} players in database: ${cachedPlayers.slice(0, 15).map((p: any) => `${p.name} (${p.position || '?'}, ${p.team || '?'})`).join(', ')}` : ''}

For each team, analyze:
1. Scoring consistency and trajectory (trending up, down, or steady)
2. Record quality relative to points scored (lucky or unlucky)
3. Rest-of-season outlook based on recent performance
4. Key competitive advantages and vulnerabilities

Return a JSON object with a "teams" array. Each entry must have:
- "externalId": string (the team's external ID)
- "adjustedPowerScore": number 0-100 (weight recent performance heavily)
- "projectedWins": number (projected total wins for the season)
- "strength": string (one concise phrase about their key advantage)
- "risk": string (one concise phrase about their biggest vulnerability)
- "confidence": number 0-100 (how confident you are in this assessment)

Team external IDs: ${teams.map((t: any) => `${t.teamName}=${t.externalId}`).join(', ')}`;

    const stableTeamsInput = teams.map((t: any) => ({
      externalId: String(t.externalId ?? ''),
      teamName: String(t.teamName ?? ''),
      ownerName: String(t.ownerName ?? ''),
      wins: Number(t.wins ?? 0),
      losses: Number(t.losses ?? 0),
      ties: Number(t.ties ?? 0),
      pointsFor: Number(t.pointsFor ?? 0),
      pointsAgainst: Number(t.pointsAgainst ?? 0),
      weeklyPoints: Array.isArray(t.performances)
        ? t.performances.map((p: any) => Number(p.points ?? 0))
        : [],
    }))
    const stablePlayersInput = cachedPlayers
      .map((p: any) => ({
        name: String(p.name ?? ''),
        position: String(p.position ?? ''),
        team: String(p.team ?? ''),
      }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
      .slice(0, 15)

    const aiPayload = {
      featureName: 'rankings',
      sport: playerSport,
      season: null,
      scoringFormat: null,
      leagueId,
      week: null,
      promptVersion: 'v1',
      teams: stableTeamsInput,
      players: stablePlayersInput,
      options: {
        model: 'gpt-4o-mini',
        responseFormat: 'json_object',
      },
    }

    const aiResult = await getOrCreateAiResult({
      feature: 'rankings-power-scores',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'openai',
      model: 'gpt-4o-mini',
      payload: aiPayload,
      ttlSeconds: 4 * 60 * 60,
      onCacheMiss: async () => {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        })
        const content = completion.choices[0]?.message?.content || '{}'
        const parsed = JSON.parse(content)
        return {
          resultText: content,
          resultJson: parsed,
          tokenPrompt: completion.usage?.prompt_tokens ?? null,
          tokenOutput: completion.usage?.completion_tokens ?? null,
        }
      },
    })

    if (aiResult.cacheHit) {
      console.log(`[rankings] AI cache hit { leagueId: '${leagueId}' }`)
    } else {
      console.log(`[rankings] AI cache miss { leagueId: '${leagueId}', modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
      console.log(`[rankings] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
    }

    const result =
      aiResult.row.resultJson && typeof aiResult.row.resultJson === 'object'
        ? (aiResult.row.resultJson as Record<string, unknown>)
        : JSON.parse(aiResult.row.resultText || '{}')
    const updates = Array.isArray((result as any).teams) ? (result as any).teams : [];

    await Promise.all(
      updates.map(async (u: any) => {
        await (prisma as any).leagueTeam.updateMany({
          where: { externalId: u.externalId, leagueId },
          data: {
            aiPowerScore: u.adjustedPowerScore,
            projectedWins: u.projectedWins,
            strengthNotes: u.strength,
            riskNotes: u.risk,
          },
        });
      })
    );

    return NextResponse.json({ success: true, updated: updates.length });
  } catch (error) {
    console.error('[Rankings API]', error);
    return NextResponse.json({ error: 'Failed to compute rankings' }, { status: 500 });
  }
}
