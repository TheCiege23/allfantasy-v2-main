import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import { 
  compareTradeValues,
  getTopPlayers,
  getTrendingPlayers,
  FantasyCalcSettings
} from '@/lib/fantasycalc';
import { readFantasyCalcValuesFromDb } from '@/lib/fantasycalc-db';
import { resolveNflRedraftCanonicalFantasyValuation } from '@/lib/nfl-provider/nflRedraftProviderCertification';

export const GET = withApiUsage({ endpoint: "/api/fantasycalc", tool: "Fantasycalc" })(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    
    const isDynasty = searchParams?.get('isDynasty') !== 'false';
    const numQbs = searchParams?.get('numQbs') === '2' ? 2 : 1;
    const numTeams = parseInt(searchParams?.get('numTeams') || '12');
    const ppr = parseFloat(searchParams?.get('ppr') || '1') as 0 | 0.5 | 1;
    
    const action = searchParams?.get('action') || 'values';
    const playerName = searchParams?.get('player');
    const position = searchParams?.get('position');
    const limit = parseInt(searchParams?.get('limit') || '50');
    
    const settings: FantasyCalcSettings = { isDynasty, numQbs, numTeams, ppr };

    if (action === 'player' && playerName) {
      const canonical = await resolveNflRedraftCanonicalFantasyValuation({ playerName });
      if (canonical.unavailable) {
        return NextResponse.json({
          error: 'Player valuation unavailable',
          settings,
          canonical: {
            provider: canonical.source,
            freshnessStatus: canonical.freshnessStatus,
            fallbackUsed: canonical.fallbackUsed,
            cacheUsed: canonical.cacheUsed,
          },
        }, { status: 404 });
      }
      return NextResponse.json({
        player: canonical.fantasyValuation,
        intelligence: canonical.intelligence,
        settings,
        source: canonical.source,
        stale: canonical.freshnessStatus === 'stale',
        canonical: {
          provider: canonical.source,
          freshnessStatus: canonical.freshnessStatus,
          fallbackUsed: canonical.fallbackUsed,
          cacheUsed: canonical.cacheUsed,
        },
      });
    }
    
    const cached = await readFantasyCalcValuesFromDb(settings, { allowStale: true });
    const players = cached.players;

    if (!players.length) {
      return NextResponse.json(
        {
          error: 'FantasyCalc valuation cache is empty. Run sync-fantasycalc-valuations to ingest latest data.',
          settings,
        },
        { status: 503 }
      );
    }
    
    if (action === 'directory') {
      const byId = new Map<string, (typeof players)[number]['player']>();
      for (const item of players) {
        byId.set(String(item.player.id), item.player);
      }
      const directory = [...byId.values()];
      const filtered = position
        ? directory.filter(p => p.position.toUpperCase() === position.toUpperCase())
        : directory;
      return NextResponse.json({ 
        players: filtered.slice(0, limit), 
        total: filtered.length, 
        source: cached.stale ? 'fantasycalc-directory-db-stale' : 'fantasycalc-directory-db',
        stale: cached.stale,
        syncedAt: cached.syncedAt,
        expiresAt: cached.expiresAt,
      });
    }

    if (action === 'top') {
      const topPlayers = getTopPlayers(players, position || undefined, limit);
      return NextResponse.json({
        players: topPlayers,
        settings,
        source: cached.stale ? 'fantasycalc-db-stale' : 'fantasycalc-db',
        stale: cached.stale,
        syncedAt: cached.syncedAt,
        expiresAt: cached.expiresAt,
      });
    }
    
    if (action === 'trending') {
      const direction = searchParams?.get('direction') === 'down' ? 'down' : 'up';
      const trending = getTrendingPlayers(players, direction, limit);
      return NextResponse.json({
        players: trending,
        direction,
        settings,
        source: cached.stale ? 'fantasycalc-db-stale' : 'fantasycalc-db',
        stale: cached.stale,
        syncedAt: cached.syncedAt,
        expiresAt: cached.expiresAt,
      });
    }
    
    if (action === 'values') {
      const filtered = position 
        ? players.filter(p => p.player.position.toUpperCase() === position.toUpperCase())
        : players;
      return NextResponse.json({
        players: filtered.slice(0, limit),
        total: filtered.length,
        settings,
        source: cached.stale ? 'fantasycalc-db-stale' : 'fantasycalc-db',
        stale: cached.stale,
        syncedAt: cached.syncedAt,
        expiresAt: cached.expiresAt,
      });
    }
    
    return NextResponse.json({
      players: players.slice(0, limit),
      total: players.length,
      settings,
      source: cached.stale ? 'fantasycalc-db-stale' : 'fantasycalc-db',
      stale: cached.stale,
      syncedAt: cached.syncedAt,
      expiresAt: cached.expiresAt,
    });
    
  } catch (error) {
    console.error('FantasyCalc API error:', error);
    return NextResponse.json({ error: 'Failed to fetch FantasyCalc data' }, { status: 500 });
  }
})

export const POST = withApiUsage({ endpoint: "/api/fantasycalc", tool: "Fantasycalc" })(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { sideA, sideB, isDynasty = true, numQbs = 2, numTeams = 12, ppr = 1 } = body;
    
    if (!sideA || !sideB || !Array.isArray(sideA) || !Array.isArray(sideB)) {
      return NextResponse.json({ error: 'sideA and sideB arrays are required' }, { status: 400 });
    }
    
    const settings: FantasyCalcSettings = { 
      isDynasty, 
      numQbs: numQbs === 2 ? 2 : 1, 
      numTeams, 
      ppr 
    };
    
    const cached = await readFantasyCalcValuesFromDb(settings, { allowStale: true });
    const players = cached.players;
    if (!players.length) {
      return NextResponse.json(
        {
          error: 'FantasyCalc valuation cache is empty. Run sync-fantasycalc-valuations to ingest latest data.',
          settings,
        },
        { status: 503 }
      );
    }
    const comparison = compareTradeValues(players, sideA, sideB);
    
    return NextResponse.json({ 
      ...comparison, 
      settings,
      source: cached.stale ? 'FantasyCalc DB (stale)' : 'FantasyCalc DB',
      stale: cached.stale,
      syncedAt: cached.syncedAt,
      expiresAt: cached.expiresAt,
      note: 'Values based on ~1 million real fantasy football trades'
    });
    
  } catch (error) {
    console.error('FantasyCalc trade compare error:', error);
    return NextResponse.json({ error: 'Failed to compare trade values' }, { status: 500 });
  }
})

