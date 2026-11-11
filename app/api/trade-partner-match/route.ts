import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware';
import { prisma } from '@/lib/prisma';
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client';
import { listReputationsByLeague } from '@/lib/reputation-engine/ManagerTrustQueryService';

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string };
  } | null;

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Trade partner matching runs OpenAI and is part of AF Legacy's Trade Finder (`legacy_trade_finder`).
  const plan = await requireFeatureEntitlement({
    userId: session.user.id,
    userEmail: (session.user as { email?: string | null }).email ?? null,
    featureId: 'legacy_trade_finder',
  });
  if (!plan.ok) return plan.response;

  const { searchParams } = new URL(req.url);
  const leagueId = searchParams?.get('leagueId');
  const strategy = searchParams?.get('strategy') || 'balanced';

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 });
  }

  try {
    const league = await (prisma as any).league.findFirst({
      where: {
        OR: [
          { id: leagueId, userId: session.user.id },
          { platformLeagueId: leagueId, userId: session.user.id },
        ],
      },
      include: {
        teams: {
          include: {
            legacyRoster: true,
          },
        },
      },
    });

    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const teams: any[] = league.teams || [];
    const sportFilter = String(league.sport ?? '').trim().toUpperCase();
    const reputationRows = await listReputationsByLeague(league.id, {
      ...(sportFilter ? { sport: sportFilter } : {}),
      season:
        typeof league.season === 'number' && Number.isFinite(league.season)
          ? league.season
          : undefined,
      limit: 300,
    }).catch(() => []);
    const reputationByManager = new Map(
      reputationRows.map((row) => [String(row.managerId ?? '').trim().toLowerCase(), row])
    );

    const userTeam = teams.find(
      (t: any) =>
        t.legacyRoster?.isOwner === true ||
        t.legacyRoster?.ownerId === session.user!.id
    );

    if (!userTeam) {
      return NextResponse.json({ error: 'Your team not found in this league' }, { status: 404 });
    }

    const positionCounts = (roster: any): Record<string, number> => {
      if (!roster?.players) return {};
      const players: any[] = Array.isArray(roster.players) ? roster.players : [];
      const counts: Record<string, number> = {};
      for (const p of players) {
        const pos = (p.position || p.pos || 'UNKNOWN').toUpperCase();
        counts[pos] = (counts[pos] || 0) + 1;
      }
      return counts;
    };

    const summarizeRoster = (roster: any): string => {
      if (!roster?.players) return 'No roster data';
      const players: any[] = Array.isArray(roster.players) ? roster.players : [];
      const byPos: Record<string, string[]> = {};
      for (const p of players) {
        const pos = (p.position || p.pos || 'UNKNOWN').toUpperCase();
        const name = p.name || p.fullName || p.playerName || 'Unknown';
        const age = p.age ? ` (${p.age})` : '';
        if (!byPos[pos]) byPos[pos] = [];
        byPos[pos].push(`${name}${age}`);
      }
      return Object.entries(byPos)
        .map(([pos, names]) => `${pos}: ${names.join(', ')}`)
        .join(' | ');
    };

    const detectNeeds = (counts: Record<string, number>): string[] => {
      const thresholds: Record<string, number> = { QB: 1, RB: 3, WR: 3, TE: 1, K: 1, DEF: 1 };
      const needs: string[] = [];
      for (const [pos, min] of Object.entries(thresholds)) {
        if ((counts[pos] || 0) < min) {
          needs.push(pos);
        }
      }
      return needs;
    };

    const detectStrengths = (counts: Record<string, number>): string[] => {
      const thresholds: Record<string, number> = { QB: 2, RB: 5, WR: 5, TE: 2, K: 2, DEF: 2 };
      const strengths: string[] = [];
      for (const [pos, surplus] of Object.entries(thresholds)) {
        if ((counts[pos] || 0) >= surplus) {
          strengths.push(pos);
        }
      }
      return strengths;
    };

    const userCounts = positionCounts(userTeam.legacyRoster);
    const userNeeds = detectNeeds(userCounts);
    const userStrengths = detectStrengths(userCounts);

    const otherTeams = teams.filter((t: any) => t.id !== userTeam.id);

    const deterministicMatches = otherTeams
      .map((team: any) => {
        const teamCounts = positionCounts(team.legacyRoster);
        const teamNeeds = detectNeeds(teamCounts);
        const teamStrengths = detectStrengths(teamCounts);

        const theyHaveWhatWeNeed = userNeeds.filter((pos) => teamStrengths.includes(pos));
        const weHaveWhatTheyNeed = teamNeeds.filter((pos) => userStrengths.includes(pos));

        const overlapScore = theyHaveWhatWeNeed.length + weHaveWhatTheyNeed.length;
        const matchScore = Math.min(100, 30 + overlapScore * 20);

        let yourOffer = weHaveWhatTheyNeed.length > 0
          ? `Your ${weHaveWhatTheyNeed.join(', ')} depth`
          : 'Young talent / draft picks';

        let theirOffer = theyHaveWhatWeNeed.length > 0
          ? `Their ${theyHaveWhatWeNeed.join(', ')} depth`
          : 'Depth pieces';
        const rep =
          reputationByManager.get(String(team.externalId ?? '').trim().toLowerCase()) ||
          reputationByManager.get(String(team.id ?? '').trim().toLowerCase()) ||
          reputationByManager.get(String(team.ownerName ?? '').trim().toLowerCase()) ||
          null;

        return {
          teamId: team.id,
          externalId: team.externalId,
          teamName: team.teamName || `${team.ownerName}'s Team`,
          managerName: team.ownerName || team.teamName || `Team ${team.externalId}`,
          record: `${team.wins}-${team.losses}${team.ties > 0 ? `-${team.ties}` : ''}`,
          needs: teamNeeds,
          strengths: teamStrengths,
          yourOffer,
          theirOffer,
          matchScore,
          role: team.role ?? 'member',
          isOrphan: team.isOrphan === true,
          rosterSummary: summarizeRoster(team.legacyRoster),
          reputation: rep
            ? {
                tier: rep.tier,
                overallScore: rep.overallScore,
                tradeFairnessScore: rep.tradeFairnessScore,
              }
            : null,
        };
      })
      .filter((m) => m.matchScore > 40)
      .sort((a, b) => b.matchScore - a.matchScore);

    const strategyDesc: Record<string, string> = {
      'win-now': 'User is in WIN NOW mode — prioritize acquiring proven weekly starters, aging vets with upside, and players on contending NFL teams.',
      'rebuild': 'User is REBUILDING — prioritize acquiring young players (24 and under), future draft picks, and high-upside prospects.',
      'balanced': 'User wants BALANCED improvements — mix of win-now pieces and future assets, no extreme moves.',
    };

    const userRosterSummary = summarizeRoster(userTeam.legacyRoster);

    const topCandidates = deterministicMatches.slice(0, 8);

    let aiEnriched: any[] = deterministicMatches;

    if (topCandidates.length > 0) {
      try {
        const prompt = `You are a fantasy football trade partner analyst.

User strategy: ${strategyDesc[strategy] || strategyDesc.balanced}
User roster: ${userRosterSummary}
User strengths: ${userStrengths.join(', ') || 'None detected'}
User needs: ${userNeeds.join(', ') || 'None detected'}

Below are candidate trade partners from the league with their rosters and deterministic match data.
Pick the best 4-6 partners. For each, provide:
- teamName (exact match from input)
- needs: what positions they need (string array)
- yourOffer: specific description of what the user could offer them
- theirOffer: specific description of what they could offer the user
- matchScore: 0-100 reflecting true trade compatibility
- tradeAngle: 1-2 sentence explanation of why this pairing works

Candidates:
${topCandidates.map(c => `${c.teamName} (${c.record}): Needs ${c.needs.join(', ') || 'unclear'}, Strengths: ${c.strengths.join(', ') || 'unclear'}, Roster: ${c.rosterSummary}`).join('\n')}

Return ONLY a JSON array of partner objects. No markdown, no commentary.`;

        const completion = await openaiChatJson({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
        });

        const parsed = parseJsonContentFromChatCompletion(completion);
        if (Array.isArray(parsed) && parsed.length > 0) {
          aiEnriched = parsed.map((p: any) => {
            const det = deterministicMatches.find(d => d.teamName === p.teamName);
            return {
              teamId: det?.teamId || '',
              externalId: det?.externalId || '',
              teamName: p.teamName || det?.teamName || 'Unknown',
              managerName: det?.managerName || det?.teamName || p.teamName || 'Manager',
              record: det?.record || '',
              needs: Array.isArray(p.needs) ? p.needs : det?.needs || [],
              strengths: det?.strengths || [],
              yourOffer: p.yourOffer || det?.yourOffer || '',
              theirOffer: p.theirOffer || det?.theirOffer || '',
              matchScore: typeof p.matchScore === 'number' ? p.matchScore : det?.matchScore || 50,
              tradeAngle: p.tradeAngle || '',
              role: det?.role || 'member',
              isOrphan: det?.isOrphan === true,
              reputation: det?.reputation || null,
            };
          }).sort((a: any, b: any) => b.matchScore - a.matchScore);
        }
      } catch (aiErr) {
        console.warn('[trade-partner-match] AI enrichment failed, using deterministic results:', aiErr);
      }
    }

    return NextResponse.json({
      userTeam: {
        name: userTeam.teamName || userTeam.ownerName,
        needs: userNeeds,
        strengths: userStrengths,
      },
      matches: aiEnriched.slice(0, 6),
    });
  } catch (err) {
    console.error('[trade-partner-match] Error:', err);
    return NextResponse.json({ error: 'Failed to find trade partners' }, { status: 500 });
  }
}

