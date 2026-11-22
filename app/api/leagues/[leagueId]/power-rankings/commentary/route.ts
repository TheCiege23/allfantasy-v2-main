import { withPaidToolBilling, paidToolNotDelivered } from '@/lib/tokens/paidToolBilling'
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { assertLeagueMember } from '@/lib/league-access';
import { computePowerRankings } from '@/lib/league-power-rankings';
import { getPowerRankingsCommentary } from '@/lib/league-power-rankings/PowerRankingsCommentaryAI';
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware';

export const dynamic = 'force-dynamic';

async function buildCommentary(leagueId: string, week: number | undefined) {
  const result = await computePowerRankings(leagueId, week);
  if (!result || result.teams.length === 0) {
    return NextResponse.json(
      { error: 'No rankings data for commentary' },
      { status: 404 }
    );
  }
  const commentary = await getPowerRankingsCommentary(result);
  if (!commentary.formulaExplanation && !commentary.narrativeExplanation && !commentary.rankingSummary) paidToolNotDelivered();
  return NextResponse.json(commentary);
}

async function resolveSessionUserId() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null };
  } | null;
  return { userId: session?.user?.id ?? null, userEmail: session?.user?.email ?? null };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params;
  const weekParam = req.nextUrl.searchParams?.get('week');
  const week = weekParam ? parseInt(weekParam, 10) : undefined;

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 });
  }

  try {
    const { userId, userEmail } = await resolveSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
      await assertLeagueMember(leagueId, userId);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const gate = await requireFeatureEntitlement({
      userId,
      userEmail,
      featureId: 'league_rankings',
    });
    if (!gate.ok) {
      return gate.response;
    }
    return await buildCommentary(leagueId, week);
  } catch (e) {
    console.error('[power-rankings/commentary]', e);
    return NextResponse.json(
      { error: 'Failed to generate commentary' },
      { status: 500 }
    );
  }
}

async function paidToolPost(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params;
  const weekParam = req.nextUrl.searchParams?.get('week');
  const week = weekParam ? parseInt(weekParam, 10) : undefined;

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 });
  }

  try {
    const { userId, userEmail } = await resolveSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
      await assertLeagueMember(leagueId, userId);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const gate = await requireFeatureEntitlement({
      userId,
      userEmail,
      featureId: 'league_rankings',
      allowTokenFallback: true,
      confirmTokenSpend: body.confirmTokenSpend === true,
      tokenRuleCode: 'ai_league_rankings_explanation',
      tokenSourceType: 'league_rankings_commentary',
      tokenSourceId: `${leagueId}:${week ?? 'current'}:${Date.now()}`,
      tokenDescription: 'League rankings commentary generation',
      tokenMetadata: {
        leagueId,
        week: week ?? null,
      },
    });
    if (!gate.ok) {
      return gate.response;
    }

    const response = await buildCommentary(leagueId, week);
    if (!response.ok) return response;
    if (gate.tokenSpend) {
      const payload = await response.json().catch(() => ({}));
      return NextResponse.json({
        ...payload,
        tokenSpend: {
          ruleCode: gate.tokenPreview?.ruleCode ?? 'ai_league_rankings_explanation',
          tokenCost: gate.tokenPreview?.tokenCost ?? null,
          balanceAfter: gate.tokenSpend.balanceAfter,
          ledgerId: gate.tokenSpend.id,
        },
      });
    }
    return response;
  } catch (e) {
    console.error('[power-rankings/commentary POST]', e);
    return NextResponse.json(
      { error: 'Failed to generate commentary' },
      { status: 500 }
    );
  }
}

export const POST = withPaidToolBilling(paidToolPost)
