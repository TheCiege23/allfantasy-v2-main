import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { type FantasyCalcPlayer, type FantasyCalcSettings } from '@/lib/fantasycalc';
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db';

interface RosterInsight {
  title: string;
  description: string;
  score: number;
  category: string;
}

function pprFromScoring(scoring: string | null): 0 | 0.5 | 1 {
  if (scoring === 'ppr') return 1;
  if (scoring === 'half') return 0.5;
  return 0;
}

function buildSleeperIdMap(players: FantasyCalcPlayer[]): Map<string, FantasyCalcPlayer> {
  const map = new Map<string, FantasyCalcPlayer>();
  for (const p of players) {
    if (p.player.sleeperId) {
      map.set(p.player.sleeperId, p);
    }
  }
  return map;
}

function analyzeRoster(
  rosterPlayerIds: string[],
  playerMap: Map<string, FantasyCalcPlayer>,
  isDynasty: boolean
): RosterInsight[] {
  const insights: RosterInsight[] = [];

  const matched = rosterPlayerIds
    .map(id => playerMap.get(id))
    .filter((p): p is FantasyCalcPlayer => !!p);

  if (matched.length === 0) {
    return [{
      title: 'No Data Available',
      description: 'Could not match your roster players to valuation data. Try re-syncing your league.',
      score: 0,
      category: 'info',
    }];
  }

  const values = matched.map(p => isDynasty ? p.value : p.redraftValue).filter(v => v > 0);
  const totalValue = values.reduce((s, v) => s + v, 0);

  const positions: Record<string, FantasyCalcPlayer[]> = {};
  for (const p of matched) {
    const pos = p.player.position || 'UNKNOWN';
    if (!positions[pos]) positions[pos] = [];
    positions[pos].push(p);
  }

  const qbs = positions['QB'] || [];
  const rbs = positions['RB'] || [];
  const wrs = positions['WR'] || [];
  const tes = positions['TE'] || [];

  const top5 = [...matched].sort((a, b) => (isDynasty ? b.value - a.value : b.redraftValue - a.redraftValue)).slice(0, 5);
  const top5Value = top5.reduce((s, p) => s + (isDynasty ? p.value : p.redraftValue), 0);
  const starPowerRatio = totalValue > 0 ? top5Value / totalValue : 0;
  const starPowerScore = Math.min(100, Math.round(starPowerRatio * 120));

  insights.push({
    title: 'Star Power',
    description: `Your top 5 assets (${top5.map(p => p.player.name).join(', ')}) account for ${Math.round(starPowerRatio * 100)}% of your total roster value. ${starPowerScore >= 70 ? 'Elite concentration — you have genuine difference-makers.' : 'Consider acquiring a true cornerstone player.'}`,
    score: starPowerScore,
    category: 'star_power',
  });

  const avgValue = values.length > 0 ? totalValue / values.length : 0;
  const maxPossibleAvg = 8000;
  const depthScore = Math.min(100, Math.round((avgValue / maxPossibleAvg) * 100));

  insights.push({
    title: 'Roster Depth',
    description: `Average player value: ${Math.round(avgValue).toLocaleString()}. ${depthScore >= 60 ? 'Strong depth across your roster — multiple viable starters.' : 'Some thin spots. Look at waiver wire or 2-for-1 trades to consolidate.'}`,
    score: depthScore,
    category: 'depth',
  });

  const youngPlayers = matched.filter(p => p.player.maybeAge !== null && p.player.maybeAge <= 25);
  const oldPlayers = matched.filter(p => p.player.maybeAge !== null && p.player.maybeAge >= 30);
  const youthRatio = matched.length > 0 ? youngPlayers.length / matched.length : 0;
  const ageScore = Math.min(100, Math.round(youthRatio * 150));

  insights.push({
    title: 'Youth & Longevity',
    description: `${youngPlayers.length} players aged 25 or under, ${oldPlayers.length} aged 30+. ${ageScore >= 60 ? 'Your roster has a strong youth core for sustained competitiveness.' : 'Consider targeting younger assets to extend your competitive window.'}`,
    score: isDynasty ? ageScore : Math.min(100, ageScore + 20),
    category: 'youth',
  });

  const rbValue = rbs.reduce((s, p) => s + (isDynasty ? p.value : p.redraftValue), 0);
  const wrValue = wrs.reduce((s, p) => s + (isDynasty ? p.value : p.redraftValue), 0);
  const qbValue = qbs.reduce((s, p) => s + (isDynasty ? p.value : p.redraftValue), 0);
  const teValue = tes.reduce((s, p) => s + (isDynasty ? p.value : p.redraftValue), 0);

  const posEntries = [
    { pos: 'QB', val: qbValue },
    { pos: 'RB', val: rbValue },
    { pos: 'WR', val: wrValue },
    { pos: 'TE', val: teValue },
  ];
  const posValues = posEntries.map(e => e.val).filter(v => v > 0);

  let balanceScore = 50;
  const strongest = [...posEntries].sort((a, b) => b.val - a.val);
  const weakest = [...posEntries].sort((a, b) => a.val - b.val);

  if (posValues.length >= 2) {
    const posAvg = posValues.reduce((s, v) => s + v, 0) / posValues.length;
    const maxDeviation = Math.max(...posValues.map(v => Math.abs(v - posAvg)));
    const balanceRatio = posAvg > 0 ? 1 - (maxDeviation / (posAvg * 2)) : 0;
    balanceScore = Math.min(100, Math.max(10, Math.round(balanceRatio * 100)));
  }

  insights.push({
    title: 'Position Balance',
    description: `Strongest: ${strongest[0]?.pos} (${Math.round(strongest[0]?.val).toLocaleString()} value). Weakest: ${weakest[0]?.pos} (${Math.round(weakest[0]?.val).toLocaleString()}). ${balanceScore >= 60 ? 'Well-rounded roster construction.' : `Consider upgrading ${weakest[0]?.pos} through trades.`}`,
    score: balanceScore,
    category: 'balance',
  });

  const trendingUp = matched.filter(p => p.trend30Day > 0);
  const trendingDown = matched.filter(p => p.trend30Day < 0);
  const netTrend = matched.reduce((s, p) => s + p.trend30Day, 0);
  const momentumScore = Math.min(100, Math.max(10, 50 + Math.round(netTrend / 50)));

  insights.push({
    title: 'Market Momentum',
    description: `${trendingUp.length} players trending up, ${trendingDown.length} trending down over the past 30 days. Net momentum: ${netTrend > 0 ? '+' : ''}${Math.round(netTrend).toLocaleString()}. ${momentumScore >= 60 ? 'Your roster value is on the rise.' : 'Some assets are losing value — consider selling high on declining players.'}`,
    score: momentumScore,
    category: 'momentum',
  });

  if (isDynasty) {
    const volatilePlayers = matched.filter(p =>
      p.maybeMovingStandardDeviationPerc !== null && p.maybeMovingStandardDeviationPerc > 15
    );
    const riskRatio = matched.length > 0 ? 1 - (volatilePlayers.length / matched.length) : 0.5;
    const stabilityScore = Math.min(100, Math.round(riskRatio * 100));

    insights.push({
      title: 'Value Stability',
      description: `${volatilePlayers.length} players with high value volatility (>15% standard deviation). ${stabilityScore >= 70 ? 'Your portfolio is relatively stable — low risk of sudden value drops.' : 'Some volatile assets on your roster. Consider diversifying to reduce risk.'}`,
      score: stabilityScore,
      category: 'stability',
    });
  }

  return insights;
}

export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { leagueId } = body;

    let league: any;
    if (leagueId) {
      league = await (prisma as any).league.findFirst({
        where: { id: leagueId, userId },
        include: { rosters: true },
      });
    } else {
      league = await (prisma as any).league.findFirst({
        where: { userId, syncStatus: 'success' },
        orderBy: { lastSyncedAt: 'desc' },
        include: { rosters: true },
      });
    }

    if (!league) {
      return NextResponse.json({
        insights: [],
        message: 'No synced league found. Sync a league first to get your Roster Legacy Report.',
      });
    }

    let userRoster: any = null;

    if (league.platform === 'sleeper') {
      const sleeperUserId = await getSleeperUserId(userId);
      if (sleeperUserId) {
        userRoster = league.rosters?.find((r: any) => r.platformUserId === sleeperUserId);
      }
    }

    if (!userRoster && league.rosters?.length === 1) {
      userRoster = league.rosters[0];
    }

    if (!userRoster && league.rosters?.length > 1) {
      return NextResponse.json({
        insights: [],
        message: 'Could not identify your roster in this league. Make sure your Sleeper account is connected in your profile.',
      });
    }

    if (!userRoster || !Array.isArray(userRoster.playerData) || userRoster.playerData.length === 0) {
      return NextResponse.json({
        insights: [],
        message: 'No roster data found. Re-sync your league to populate rosters.',
      });
    }

    const fcSettings: FantasyCalcSettings = {
      isDynasty: league.isDynasty ?? true,
      numQbs: 2,
      numTeams: league.leagueSize || 12,
      ppr: pprFromScoring(league.scoring),
    };

    const allPlayers = await getFantasyCalcValuesDbFirst(fcSettings);
    const playerMap = buildSleeperIdMap(allPlayers);

    const insights = analyzeRoster(
      userRoster.playerData as string[],
      playerMap,
      league.isDynasty ?? false
    );

    return NextResponse.json({
      insights,
      leagueId: league.id,
      leagueName: league.name,
      platform: league.platform,
      rosterSize: (userRoster.playerData as string[]).length,
      matchedPlayers: (userRoster.playerData as string[]).filter(id => playerMap.has(id)).length,
    });
  } catch (error: any) {
    console.error('[Roster Analyze]', error);
    return NextResponse.json({ error: error.message || 'Analysis failed' }, { status: 500 });
  }
}

async function getSleeperUserId(appUserId: string): Promise<string | null> {
  try {
    const user = await (prisma as any).userProfile.findUnique({
      where: { userId: appUserId },
      select: { sleeperUserId: true },
    });
    return user?.sleeperUserId || null;
  } catch {
    return null;
  }
}
