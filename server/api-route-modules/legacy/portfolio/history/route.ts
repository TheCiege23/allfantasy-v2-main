import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import { computeDualModeTradeDelta, UserTrade, PricedAsset } from '@/lib/hybrid-valuation';
import { computeTradeVolatility, adjustConfidenceForVolatility, getVolatilityLabel } from '@/lib/volatility';
import {
  getLeagueTransactions,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueHistory,
  resolveSleeperUser,
  SleeperTransaction,
} from '@/lib/sleeper-client';
import { getCanonicalPlayerMapForSport } from '@/lib/canonical/getCanonicalPlayer';

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export interface PortfolioPoint {
  date: string;
  tradeId: string;
  deltaValue: number;
  cumulativeValue: number;
  tradeSummary: string;
  grade: string;
  volatility: string;
  confidence: number;
}

export interface PortfolioHistoryResponse {
  points: PortfolioPoint[];
  totalDelta: number;
  bestTrade: PortfolioPoint | null;
  worstTrade: PortfolioPoint | null;
  averageDelta: number;
  volatilityProfile: string;
}

async function fetchUserTrades(leagueId: string, sleeperUserId: string): Promise<UserTrade[]> {
  // Phase 3 batch 2 — canonical read path. Historical trade portfolio: renders trades that
  // already happened, so cache-only is correct; no live roster decision depends on this.
  // Reshaped to the `Record<sleeperId, {...}>` the code below already indexes.
  const [users, rosters, canonicalPlayers] = await Promise.all([
    getLeagueUsers(leagueId),
    getLeagueRosters(leagueId),
    getCanonicalPlayerMapForSport('NFL'),
  ]);

  const allPlayers: Record<
    string,
    { full_name: string; first_name: string; last_name: string; position: string }
  > = Object.fromEntries(
    [...canonicalPlayers].map(([sleeperId, p]) => {
      const [first = '', ...rest] = (p.name ?? '').split(' ');
      return [
        sleeperId,
        { full_name: p.name, first_name: first, last_name: rest.join(' '), position: p.position },
      ];
    }),
  );

  const userRoster = rosters.find((r: any) => r.owner_id === sleeperUserId);
  if (!userRoster) return [];

  const userRosterId = userRoster.roster_id;
  const seasons = await getLeagueHistory(leagueId);
  const allTrades: UserTrade[] = [];

  for (const season of seasons) {
    const seasonLeagueId = season.league_id;
    const allTransactions: SleeperTransaction[] = [];
    for (let week = 1; week <= 18; week++) {
      const weekTransactions = await getLeagueTransactions(seasonLeagueId, week);
      allTransactions.push(...weekTransactions);
    }
    
    const trades = allTransactions.filter(
      (t: SleeperTransaction) => 
        t.type === 'trade' && 
        t.roster_ids?.includes(userRosterId) &&
        t.status === 'complete'
    );

    for (const trade of trades) {
      const parties: UserTrade['parties'] = [];
      
      for (const rosterId of trade.roster_ids || []) {
        const rosterOwner = rosters.find((r: any) => r.roster_id === rosterId);
        const user = users.find((u: any) => u.user_id === rosterOwner?.owner_id);
        
        const playersReceived: { name: string; position?: string }[] = [];
        const picksReceived: { round: number; season: string; slot?: string }[] = [];

        if (trade.adds) {
          for (const [playerId, rId] of Object.entries(trade.adds)) {
            if (rId === rosterId && allPlayers[playerId]) {
              playersReceived.push({
                name: allPlayers[playerId].full_name || allPlayers[playerId].first_name + ' ' + allPlayers[playerId].last_name,
                position: allPlayers[playerId].position
              });
            }
          }
        }

        if (trade.draft_picks) {
          for (const pick of trade.draft_picks) {
            if (pick.owner_id === rosterId) {
              picksReceived.push({
                round: pick.round,
                season: pick.season,
                slot: pick.roster_id <= 4 ? 'early' : pick.roster_id <= 8 ? 'mid' : 'late'
              });
            }
          }
        }

        parties.push({
          userId: rosterOwner?.owner_id || '',
          teamName: user?.display_name || `Team ${rosterId}`,
          playersReceived,
          picksReceived
        });
      }

      allTrades.push({
        transactionId: trade.transaction_id,
        timestamp: trade.status_updated || trade.created,
        week: trade.leg || 0,
        parties
      });
    }
  }

  return allTrades.sort((a, b) => a.timestamp - b.timestamp);
}

export const GET = withApiUsage({ endpoint: "/api/legacy/portfolio/history", tool: "LegacyPortfolioHistory" })(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams?.get('leagueId');
    const userId = searchParams?.get('userId');
    const mode = (searchParams?.get('mode') || 'atTime') as 'atTime' | 'hindsight';
    const isSF = searchParams?.get('sf') === 'true';

    if (!leagueId || !userId) {
      return NextResponse.json({ error: 'Missing leagueId or userId' }, { status: 400 });
    }

    const sleeperUser = await resolveSleeperUser(userId);
    if (!sleeperUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userTrades = await fetchUserTrades(leagueId, sleeperUser.userId);
    
    let cumulative = 0;
    const points: PortfolioPoint[] = [];

    for (const trade of userTrades) {
      try {
        const dual = await computeDualModeTradeDelta(trade, sleeperUser.userId, isSF);
        const result = mode === 'hindsight' ? dual.withHindsight : dual.atTheTime;
        
        if (!result) continue;

        const allAssets: PricedAsset[] = [...result.receivedAssets, ...result.gaveAssets];
        const volatilityScore = computeTradeVolatility(allAssets);
        const volLabel = getVolatilityLabel(volatilityScore);
        
        const { adjustedConfidence } = adjustConfidenceForVolatility(
          result.confidence,
          volatilityScore,
          result.deltaValue
        );

        cumulative += result.deltaValue;

        const receivedNames = result.receivedAssets.map(a => a.name).slice(0, 2).join(', ');
        const gaveNames = result.gaveAssets.map(a => a.name).slice(0, 2).join(', ');
        const tradeSummary = `Got ${receivedNames || 'picks'} for ${gaveNames || 'picks'}`;

        points.push({
          date: new Date(trade.timestamp).toISOString().split('T')[0],
          tradeId: trade.transactionId,
          deltaValue: result.deltaValue,
          cumulativeValue: cumulative,
          tradeSummary,
          grade: result.grade,
          volatility: volLabel,
          confidence: adjustedConfidence
        });
      } catch (err) {
        console.error(`Error processing trade ${trade.transactionId}:`, err);
      }
    }

    const totalDelta = cumulative;
    const averageDelta = points.length > 0 ? totalDelta / points.length : 0;
    
    const bestTrade = points.length > 0 
      ? points.reduce((best, p) => p.deltaValue > best.deltaValue ? p : best, points[0])
      : null;
    const worstTrade = points.length > 0
      ? points.reduce((worst, p) => p.deltaValue < worst.deltaValue ? p : worst, points[0])
      : null;

    const avgVolatility = points.length > 0
      ? points.filter(p => p.volatility === 'High').length / points.length
      : 0;
    const volatilityProfile = avgVolatility > 0.5 ? 'Aggressive' : avgVolatility > 0.25 ? 'Balanced' : 'Conservative';

    const response: PortfolioHistoryResponse = {
      points,
      totalDelta,
      bestTrade,
      worstTrade,
      averageDelta,
      volatilityProfile
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Portfolio history error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute portfolio history' }, { status: 500 });
  }
})

