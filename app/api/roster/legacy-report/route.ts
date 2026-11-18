import { isRosterManagedBy } from '@/lib/league/rosterManager'
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id as string;
  const { leagueId } = await req.json().catch(() => ({}));

  try {
    const profile = await (prisma as any).userProfile.findUnique({
      where: { userId },
      select: { sleeperUserId: true, sleeperUsername: true },
    });

    const sleeperUserId = profile?.sleeperUserId;

    let league: any;
    if (leagueId) {
      league = await (prisma as any).league.findUnique({
        where: { id: leagueId, userId },
        include: { rosters: true },
      });
    } else {
      league = await (prisma as any).league.findFirst({
        where: { userId },
        orderBy: { lastSyncedAt: 'desc' },
        include: { rosters: true },
      });
    }

    if (!league) {
      return NextResponse.json({ overallScore: 0, insights: [], noLeague: true });
    }

    const roster = league.rosters.find((r: any) =>
      r.platformUserId === sleeperUserId ||
      r.platformUserId === userId
    ) ?? league.rosters.find((r: any) => isRosterManagedBy(r, userId));
    if (!roster) {
      return NextResponse.json({ overallScore: 0, insights: [], noRoster: true });
    }

    const players: any[] = roster.playerData || [];

    const starterScore = Math.min(90, 50 + (players.filter((p: any) => p.isStarter).length * 5));
    const depthScore = Math.min(85, 40 + (players.length - players.filter((p: any) => p.isStarter).length) * 4);

    const ages = players.map((p: any) => p.age || 27);
    const avgAge = ages.length > 0 ? ages.reduce((a: number, b: number) => a + b, 0) / ages.length : 27;
    let ageCurveScore = 70;
    if (league.isDynasty) {
      if (avgAge < 24) ageCurveScore = 95;
      else if (avgAge < 27) ageCurveScore = 85;
      else if (avgAge < 30) ageCurveScore = 70;
      else ageCurveScore = 50;
    } else {
      if (avgAge >= 25 && avgAge <= 29) ageCurveScore = 90;
      else if (avgAge >= 23 && avgAge <= 31) ageCurveScore = 75;
      else ageCurveScore = 55;
    }

    const futurePicks = players.filter((p: any) => p.isPick).length;
    const youngPlayers = players.filter((p: any) => p.age && p.age <= 25).length;
    const futureScore = Math.min(95, 40 + futurePicks * 10 + youngPlayers * 5);

    const overallScore = Math.round(
      (starterScore * 0.3) + (depthScore * 0.2) + (ageCurveScore * 0.25) + (futureScore * 0.25)
    );

    const insights = [
      {
        title: 'Starter Strength',
        description: `Your starters average ${Math.round(starterScore)}% of league market value.`,
        score: starterScore,
        iconName: 'Shield',
        color: starterScore >= 80 ? 'text-emerald-400' : starterScore >= 60 ? 'text-yellow-400' : 'text-red-400',
        recommendation: starterScore < 70 ? 'Target immediate upgrades via trade/waivers' : 'Solid core — protect with depth.',
      },
      {
        title: 'Bench Depth',
        description: `Bench quality supports ${depthScore}% of starter production.`,
        score: depthScore,
        iconName: 'Users',
        color: depthScore >= 75 ? 'text-emerald-400' : depthScore >= 50 ? 'text-yellow-400' : 'text-red-400',
        recommendation: depthScore < 60 ? 'Prioritize waiver stashes for injury cover' : 'Good insurance — consider trading excess.',
      },
      {
        title: 'Age Curve',
        description: `Average age: ${avgAge.toFixed(1)} — ${league.isDynasty ? 'dynasty outlook' : 'redraft contention'}.`,
        score: ageCurveScore,
        iconName: 'Clock',
        color: ageCurveScore >= 80 ? 'text-emerald-400' : ageCurveScore >= 65 ? 'text-yellow-400' : 'text-red-400',
        recommendation: ageCurveScore < 70 ? 'Shift toward younger assets if rebuilding' : 'Balanced for current window.',
      },
      {
        title: 'Future Value',
        description: `${futurePicks} picks + ${youngPlayers} young upside players.`,
        score: futureScore,
        iconName: 'TrendingUp',
        color: futureScore >= 80 ? 'text-emerald-400' : futureScore >= 60 ? 'text-yellow-400' : 'text-red-400',
        recommendation: futureScore > 80 ? 'Leverage picks for win-now moves' : 'Stockpile youth/picks for rebuild.',
      },
    ];

    return NextResponse.json({ overallScore, insights });
  } catch (error: any) {
    console.error('[Roster Legacy Report]', error);
    return NextResponse.json(
      { error: error.message || 'Analysis failed' },
      { status: 500 }
    );
  }
}
