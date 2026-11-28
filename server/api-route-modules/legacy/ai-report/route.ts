import { NextResponse } from 'next/server';
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { aiCostGate } from '@/lib/ai-protection/costGate';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const openai = getOpenAIRouteClient()

const requestSchema = z.object({
  leagueId: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string };
    } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let leagueId: string | undefined;
    try {
      const body = await req.json();
      const parsed = requestSchema.parse(body);
      leagueId = parsed.leagueId;
    } catch {
      leagueId = undefined;
    }

    const appUser = await (prisma as any).appUser.findUnique({
      where: { id: session.user.id },
      select: { legacyUserId: true },
    });

    const legacyUserId = appUser?.legacyUserId || null;

    const whereClause: any = {};
    if (leagueId) {
      whereClause.id = leagueId;
      whereClause.userId = session.user.id;
    } else if (legacyUserId) {
      whereClause.legacyUserId = legacyUserId;
    } else {
      whereClause.userId = session.user.id;
    }

    const leagues = await (prisma as any).league.findMany({
      where: whereClause,
      include: {
        teams: {
          include: {
            performances: { orderBy: { week: 'asc' } },
          },
        },
      },
      take: 5,
      orderBy: { updatedAt: 'desc' },
    });

    if (leagues.length === 0) {
      return NextResponse.json(
        { error: 'No leagues found. Import a league first.' },
        { status: 404 }
      );
    }

    const cachedPlayers = await (prisma as any).sportsPlayer.findMany({
      where: { sport: 'nfl' },
      take: 40,
      orderBy: { fetchedAt: 'desc' },
    });

    const context = leagues.map((l: any) => {
      const teamsBlock = (l.teams || []).map((t: any) => {
        const weeklyPoints = (t.performances || []).map((p: any) => p.points);
        const trend = weeklyPoints.length > 0 ? weeklyPoints.join(', ') : 'N/A';
        return `  ${t.teamName} (${t.ownerName}) - Record: ${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}, PF: ${t.pointsFor.toFixed(1)}, Weekly: [${trend}]`;
      }).join('\n');

      return `League: ${l.name || 'Unknown'} (${l.season || 'Current'}, ${l.isDynasty ? 'Dynasty' : 'Redraft'}, ${l.scoring?.toUpperCase() || 'Standard'})
Teams:
${teamsBlock}`;
    }).join('\n\n');

    const playerContext = cachedPlayers.length > 0
      ? `\nNFL Player Cache: ${cachedPlayers.slice(0, 25).map((p: any) => `${p.name} (${p.position || '?'}, ${p.team || '?'}${p.age ? `, age ${p.age}` : ''})`).join(', ')}`
      : '';

    const prompt = `You are a dynasty fantasy football GM with 20+ years of experience.
Focus exclusively on long-term outlook, aging curves, rookie class strength, historical trade value, and dynasty sustainability.

Use ONLY the provided data. Do NOT hallucinate players, stats, or events not present.

Data:
${context}
${playerContext}

For the user's leagues, generate a concise dynasty report.
Output valid JSON only:

{
  "overallOutlook": "short paragraph summary of dynasty position across all leagues",
  "topDynastyAssets": [
    { "name": "player or team phrase", "reason": "why this is a top asset", "dynastyTier": "elite|strong|rising|hold" }
  ],
  "biggestRisks": [
    { "name": "player or situation", "reason": "why this is risky", "severity": "critical|moderate|minor" }
  ],
  "projected3YearRank": "estimated league rank range (e.g. Top 3 or 6-8)",
  "confidenceScore": number 0-100,
  "contenderOrRebuilder": "contender|fringe|rebuilder",
  "keyRecommendations": ["2-4 actionable dynasty moves or watches"],
  "windowStatus": "READY_TO_COMPETE|REBUILDING|OVEREXTENDED|AGING_CORE|DIRECTION_NEEDED",
  "shareText": "shareable summary under 280 chars"
}`;

    // Owner, 2026-11-28: every model call is signed in and capped. The daily cap, immediately before the call.
    const gated = await aiCostGate(req, 'legacy_ai_report', session.user.id);
    if (gated) return gated;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a dynasty fantasy football expert. Only use data provided. Output valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    });

    const report = JSON.parse(completion.choices[0].message.content || '{}');

    return NextResponse.json({ success: true, report });
  } catch (err) {
    console.error('[Legacy AI Report]', err);
    return NextResponse.json(
      { error: 'Failed to generate legacy report' },
      { status: 500 }
    );
  }
}
