import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import { computeTradeVolatility, getVolatilityLabel } from '@/lib/volatility';
import { legacySessionUserId } from '@/lib/legacy/legacyOneGrade';
import { gradeLegacyCompletedTrades, type LegacyCompletedTrade } from '@/lib/legacy/legacyCompletedTradeGrades';
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade';
import type { GradeLetter } from '@/lib/trade-intel/gradeScale';
import {
  getLeagueTransactions,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueHistory,
  resolveSleeperUser,
  SleeperTransaction,
} from '@/lib/sleeper-client';
import { getCanonicalPlayerMapForSport } from '@/lib/canonical/getCanonicalPlayer';
import type { LegacyDataStatus } from '@/lib/legacy/dataStatus';
import { requireLegacyPlan } from '@/lib/legacy/legacyPlanGate';

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
/*
 * 🛑 EVERY LETTER AND VALUE HERE IS THE ONE COMPLETED-TRADE GRADE (2026-11-26).
 *
 * Until then each point's `deltaValue`, `grade` and `confidence` came from
 * `computeDualModeTradeDelta` (`lib/hybrid-valuation.ts`) — a second engine, on its own letter scale —
 * while the report card above this chart and `/api/legacy/trade-analytics` graded the same trades
 * through `oneGradeForCompletedTrade`. Now every trade goes through that same grade
 * (`gradeLegacyCompletedTrades`), on the signed-in user's verified AF league row, from the viewer's side:
 *   - `mode=atTime` reads the trade's frozen ORIGINAL; `mode=hindsight` today's re-grade beside it;
 *   - `deltaValue` is the league value that letter was taken on (received − sent), `result` the grade's
 *     own win/loss/even;
 *   - best/worst, total and average are aggregates of those numbers only.
 * A trade the grade withholds is not a point and counts in no total; it is listed in `notGraded` with
 * the grader's reason. `confidence` is null — it was the second engine's number and the one grade
 * does not produce one. `volatility` is the same asset-mix heuristic as before, read off the assets
 * and league values the grade was taken on.
 */

export interface PortfolioPoint {
  date: string;
  tradeId: string;
  deltaValue: number;
  cumulativeValue: number;
  tradeSummary: string;
  grade: GradeLetter;
  result: 'win' | 'loss' | 'even';
  volatility: string;
  confidence: null;
}

export interface PortfolioHistoryResponse {
  points: PortfolioPoint[];
  totalDelta: number;
  bestTrade: PortfolioPoint | null;
  worstTrade: PortfolioPoint | null;
  averageDelta: number;
  volatilityProfile: string;
  gradeSource: 'one_trade_engine';
  notGraded: Array<{ tradeId: string; date: string; tradeSummary: string; reason: string }>;
}

type PortfolioTrade = LegacyCompletedTrade & {
  parties: Array<LegacyCompletedTrade['parties'][number] & { teamName: string }>
}

const outcomeOf = (letter: GradeLetter): PortfolioPoint['result'] =>
  letter === 'A' || letter === 'B' ? 'win' : letter === 'D' || letter === 'F' ? 'loss' : 'even'

const namesOf = (p: LegacyCompletedTrade['parties'][number] | undefined) => [
  ...(p?.playersReceived ?? []).map((pl) => pl.name),
  ...(p?.picksReceived ?? []).map((pk) => `${pk.season} Round ${pk.round}`),
]

/** The grade's own reading of one trade, or the reason it was withheld. PURE. */
export function portfolioReading(
  trade: PortfolioTrade,
  view: TradeGradeView,
  viewerSleeperId: string,
  mode: 'atTime' | 'hindsight',
): { graded: true; letter: GradeLetter; delta: number; volatility: string; summary: string } | { graded: false; reason: string; summary: string } {
  const me = trade.parties.find((p) => p.userId === viewerSleeperId)
  const them = trade.parties.find((p) => p !== me)
  const summary = `Got ${namesOf(me).slice(0, 2).join(', ') || 'picks'} for ${namesOf(them).slice(0, 2).join(', ') || 'picks'}`
  if (!view.graded) return { graded: false, reason: view.reason, summary }
  const moment = mode === 'hindsight' && view.current ? view.current : view
  const assets = (view.lines ?? []).map((l) => ({
    name: l.name,
    type: l.assetKind === 'pick' ? 'pick' : 'player',
    value: Math.max(0, l.leagueValue ?? 0),
    details: {},
  })) as unknown as Parameters<typeof computeTradeVolatility>[0]
  return {
    graded: true,
    letter: moment.letter,
    delta: Math.round(moment.getValue - moment.giveValue),
    volatility: getVolatilityLabel(computeTradeVolatility(assets)),
    summary,
  }
}

async function fetchUserTrades(leagueId: string, sleeperUserId: string): Promise<PortfolioTrade[]> {
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
  const allTrades: PortfolioTrade[] = [];

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
      const parties: PortfolioTrade["parties"] = [];
      
      for (const rosterId of trade.roster_ids || []) {
        const rosterOwner = rosters.find((r: any) => r.roster_id === rosterId);
        const user = users.find((u: any) => u.user_id === rosterOwner?.owner_id);
        
        const playersReceived: { id: string; name: string; position?: string }[] = [];
        const picksReceived: { round: number; season: string; slot?: string }[] = [];

        if (trade.adds) {
          for (const [playerId, rId] of Object.entries(trade.adds)) {
            if (rId === rosterId && allPlayers[playerId]) {
              playersReceived.push({
                name: allPlayers[playerId].full_name || allPlayers[playerId].first_name + ' ' + allPlayers[playerId].last_name,
                position: allPlayers[playerId].position,
                id: playerId
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
  // Sign-in, then AF Legacy (Supreme inherits it), before any Sleeper read or grading (owner, 2026-11-28).
  const gate = await requireLegacyPlan('legacy_portfolio_history', 'your portfolio over time');
  if (!gate.ok) return gate.response;
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams?.get('leagueId');
    const userId = searchParams?.get('userId');
    const mode = (searchParams?.get('mode') || 'atTime') as 'atTime' | 'hindsight';

    if (!leagueId || !userId) {
      return NextResponse.json({ error: 'Missing leagueId or userId' }, { status: 400 });
    }

    const sleeperUser = await resolveSleeperUser(userId);
    if (!sleeperUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userTrades = await fetchUserTrades(leagueId, sleeperUser.userId);

    // THE grade of every trade, from your side. One league load, frozen originals read once.
    const isViewer = (p: { userId?: string }) => p.userId === sleeperUser.userId;
    const views = await gradeLegacyCompletedTrades({
      suppliedLeagueId: leagueId,
      userId: await legacySessionUserId(),
      trades: userTrades,
      isViewer,
    });

    let cumulative = 0;
    const points: PortfolioPoint[] = [];
    const notGraded: PortfolioHistoryResponse['notGraded'] = [];

    userTrades.forEach((trade, i) => {
      const date = new Date(trade.timestamp).toISOString().split('T')[0];
      const reading = portfolioReading(trade, views[i]!, sleeperUser.userId, mode);
      if (!reading.graded) {
        notGraded.push({ tradeId: trade.transactionId, date, tradeSummary: reading.summary, reason: reading.reason });
        return;
      }
      cumulative += reading.delta;
      points.push({
        date,
        tradeId: trade.transactionId,
        deltaValue: reading.delta,
        cumulativeValue: cumulative,
        tradeSummary: reading.summary,
        grade: reading.letter,
        result: outcomeOf(reading.letter),
        volatility: reading.volatility,
        confidence: null,
      });
    });

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
    // An empty portfolio has NO volatility profile — labeling zero trades "Conservative" was a
    // fabricated inference. Empty string keeps the field's type for existing clients.
    const volatilityProfile =
      points.length === 0
        ? ''
        : avgVolatility > 0.5 ? 'Aggressive' : avgVolatility > 0.25 ? 'Balanced' : 'Conservative';

    const response: PortfolioHistoryResponse = {
      points,
      totalDelta,
      bestTrade,
      worstTrade,
      averageDelta,
      volatilityProfile,
      gradeSource: 'one_trade_engine',
      notGraded,
    };

    const status: LegacyDataStatus =
      points.length === 0 && notGraded.length > 0
        ? {
            state: 'unavailable',
            confidence: 'high',
            source: 'derived',
            lastUpdatedAt: new Date().toISOString(),
            reasonCode: 'TRADES_NOT_GRADED',
            message: notGraded[0]!.reason,
            retryable: true,
          }
        : points.length === 0
        ? {
            state: 'unavailable',
            confidence: 'high',
            source: 'sleeper',
            lastUpdatedAt: null,
            reasonCode: 'NO_TRADES_IMPORTED',
            message: 'No completed trades were found in your imported Sleeper history for this league.',
            retryable: true,
          }
        : notGraded.length > 0
          ? {
              state: 'partial',
              confidence: 'medium',
              source: 'derived',
              lastUpdatedAt: new Date().toISOString(),
              reasonCode: 'SOME_TRADES_UNPRICEABLE',
              message: `${notGraded.length} trade(s) could not be graded and are not included.`,
              retryable: true,
            }
          : {
              state: 'available',
              confidence: 'high',
              source: 'derived',
              lastUpdatedAt: new Date().toISOString(),
              message: 'Trade portfolio computed from your imported Sleeper history.',
              retryable: false,
            };

    return NextResponse.json({ ...response, meta: { status } });
  } catch (error: any) {
    console.error('Portfolio history error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute portfolio history' }, { status: 500 });
  }
})

