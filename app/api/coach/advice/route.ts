import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { assertLeagueMember } from '@/lib/league-access';
import { logAiOutput } from '@/lib/ai/output-logger';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import { getAICoachResponse, normalizeAdviceType } from '@/lib/ai-coach';
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates';
import { CertifiedIntelligenceIntegrationService } from '@/lib/fantasy-os/sports-runtime/intelligenceIntegration';

export const dynamic = 'force-dynamic';

/**
 * Gated, informational-only certified sports grounding for Coach. It is attached to the response alongside the
 * coach's own reasoning — it NEVER feeds getAICoachResponse and NEVER alters the recommendation/explanation.
 * Off by default; wrapped so it can never fail the route. Injuries/projections/stats stay explicitly unavailable.
 */
async function coachSportsContext(sport: string | undefined, week: number | undefined) {
  if (!isSportsDataEnabled('coach')) return undefined;
  if (String(sport ?? 'NFL').toUpperCase() !== 'NFL') return undefined;
  try {
    return await new CertifiedIntelligenceIntegrationService().describeCoachSportsContext({
      season: String(new Date().getFullYear()),
      week: String(week ?? 1),
    });
  } catch {
    return undefined;
  }
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    type?: string;
    leagueId?: string;
    leagueName?: string;
    week?: number;
    teamName?: string;
    sport?: string;
    matchupData?: {
      opponentName?: string;
      opponentProjection?: number;
      teamProjection?: number;
      spread?: number;
      notes?: string;
    };
    leagueSettings?: {
      sport?: string;
      scoringFormat?: string;
      teamCount?: number;
      rosterSlots?: string[];
    };
    roster?: {
      playerName: string;
      position?: string;
      team?: string;
      projectedPoints?: number;
      slot?: string;
    }[];
    playerStats?: {
      playerName: string;
      position?: string;
      projectedPoints?: number;
    }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const type = normalizeAdviceType(body.type);

  if (body.leagueId) {
    try {
      await assertLeagueMember(body.leagueId, session.user.id);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    const result = await getAICoachResponse({
      type,
      leagueId: body.leagueId,
      week: body.week,
      teamName: body.teamName,
      leagueSettings: {
        ...body.leagueSettings,
        sport: body.sport ? normalizeToSupportedSport(body.sport) : body.leagueSettings?.sport,
      },
      matchupData: body.matchupData,
      roster: body.roster,
      playerStats: body.playerStats,
    });

    await logAiOutput({
      provider: result.explanation.source === 'ai' ? 'openai' : 'deterministic',
      role: 'narrative',
      taskType: `coach_${type}`,
      targetType: 'user',
      targetId: session.user.id,
      contentJson: result,
      meta: {
        leagueId: body.leagueId ?? null,
        type,
        explanationSource: result.explanation.source,
      },
    });

    const sportsContext = await coachSportsContext(body.sport ?? body.leagueSettings?.sport, body.week);

    // Backward-compatible top-level fields plus richer deterministic/AI split payload.
    return NextResponse.json({
      type: result.type,
      summary: result.explanation.summary,
      bullets: result.explanation.bullets,
      challenge: result.explanation.challenge,
      tone: result.explanation.tone,
      recommendation: result.recommendation,
      explanation: result.explanation,
      ...(sportsContext ? { sportsContext } : {}),
    });
  } catch (e) {
    console.error('[coach/advice]', e);
    return NextResponse.json(
      { error: 'Failed to get coach advice' },
      { status: 500 }
    );
  }
}
