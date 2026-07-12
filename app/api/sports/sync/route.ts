import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import { syncNFLTeamsToDb, syncNFLPlayersToDb, syncNFLScheduleToDb, syncNFLDepthChartsToDb, syncNFLTeamStatsToDb } from '@/lib/rolling-insights';
import {
  clearAPISportsDiagnostics,
  getAPISportsDiagnostics,
  syncAPISportsTeamsToDb,
  syncAPISportsPlayersToIdentityMap,
  syncAPISportsStandingsToDb,
} from '@/lib/api-sports';
import {
  clearAPIFootballDiagnostics,
  getAPIFootballDiagnostics,
  syncAPIFootballFixturesToDb,
  syncAPIFootballPlayersToDb,
  syncAPIFootballStandingsToDb,
  syncAPIFootballTeamsToDb,
} from '@/lib/api-football'
import { syncClearSportsToDb } from '@/lib/clear-sports'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { syncNflRedraftCronCanonicalCache } from '@/lib/nfl-provider/nflRedraftCronCanonicalSync'
import {
  projectCanonicalNflInjuries,
  projectCanonicalNflScores,
} from '@/lib/nfl-provider/nflRedraftCanonicalScoreInjuryProjector'
import {
  syncLegacyNcaafInjuries,
  syncLegacyNcaafScores,
} from '@/lib/ncaaf-provider/legacyApiSportsIngestion'

export const POST = withApiUsage({ endpoint: "/api/sports/sync", tool: "SportsSync" })(async (request: NextRequest) => {
  /**
   * Request examples (Bearer ADMIN_PASSWORD required):
   *
   * NFL teams sync:
   * { "source": "api_sports", "type": "teams", "sport": "NFL", "season": "2025" }
   *
   * NCAAF games sync:
   * { "source": "api_sports", "type": "games", "sport": "NCAAF", "season": "2025" }
   *
   * NCAAF full sync (teams + games + injuries + standings + identity):
   * { "source": "api_sports", "type": "all", "sport": "NCAAF", "season": "2025" }
   */
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  try {
    const body = await request.json().catch(() => ({}));
    const syncType = (body as Record<string, string>).type || 'all';
    const season = (body as Record<string, string>).season;
    const source = (body as Record<string, string>).source || 'all';
    const requestedSport = String((body as Record<string, string>).sport || 'NFL').toUpperCase()
    const apiSportsSport: 'NFL' | 'NCAAF' = requestedSport === 'NCAAF' ? 'NCAAF' : 'NFL'

    const results: Record<string, unknown> = {};
  const diagnostics: Record<string, unknown> = {};
    const startTime = Date.now();

    if (source === 'all' || source === 'rolling_insights') {
      if (syncType === 'all' || syncType === 'teams') {
        const teamCount = await syncNFLTeamsToDb();
        results.ri_teams = { synced: teamCount };
      }

      if (syncType === 'all' || syncType === 'schedule') {
        const gameCount = await syncNFLScheduleToDb({ season });
        results.ri_schedule = { synced: gameCount };
      }

      if (syncType === 'all' || syncType === 'players') {
        const playerCount = await syncNFLPlayersToDb({ season });
        results.ri_players = { synced: playerCount };
      }

      if (syncType === 'all' || syncType === 'depth_charts') {
        const depthCount = await syncNFLDepthChartsToDb({ season });
        results.ri_depth_charts = { synced: depthCount };
      }

      if (syncType === 'all' || syncType === 'team_stats') {
        const statsCount = await syncNFLTeamStatsToDb({ season });
        results.ri_team_stats = { synced: statsCount };
      }
    }

    if (source === 'all' || source === 'api_sports') {
      const asKeyPrefix = apiSportsSport === 'NCAAF' ? 'as_ncaaf' : 'as'
      if (syncType === 'all' || syncType === 'teams') {
        clearAPISportsDiagnostics()
        const teamCount = await syncAPISportsTeamsToDb({ season, sport: apiSportsSport });
        results[`${asKeyPrefix}_teams`] = { synced: teamCount, sport: apiSportsSport };
        diagnostics[`${asKeyPrefix}_teams`] = getAPISportsDiagnostics()
      }

      if (syncType === 'all' || syncType === 'schedule' || syncType === 'games') {
        if (apiSportsSport === 'NFL') {
          let gameCount = 0
          const canonical = await syncNflRedraftCronCanonicalCache(
            { job: 'import-scores', sport: 'NFL', season },
            { afterCacheWrite: async ({ resolution }) => { gameCount = await projectCanonicalNflScores(resolution, prisma) } },
          )
          results[`${asKeyPrefix}_games`] = { synced: gameCount, sport: apiSportsSport, canonical }
        } else {
          clearAPISportsDiagnostics()
          const gameCount = await syncLegacyNcaafScores(season)
          results[`${asKeyPrefix}_games`] = { synced: gameCount, sport: apiSportsSport }
          diagnostics[`${asKeyPrefix}_games`] = getAPISportsDiagnostics()
        }
      }

      if (syncType === 'all' || syncType === 'injuries') {
        if (apiSportsSport === 'NFL') {
          let injuryCount = 0
          const canonical = await syncNflRedraftCronCanonicalCache(
            { job: 'import-injuries', sport: 'NFL', season },
            { afterCacheWrite: async ({ resolution }) => { injuryCount = await projectCanonicalNflInjuries(resolution, prisma) } },
          )
          results[`${asKeyPrefix}_injuries`] = { synced: injuryCount, sport: apiSportsSport, canonical }
        } else {
          clearAPISportsDiagnostics()
          const injuryCount = await syncLegacyNcaafInjuries(season)
          results[`${asKeyPrefix}_injuries`] = { synced: injuryCount, sport: apiSportsSport }
          diagnostics[`${asKeyPrefix}_injuries`] = getAPISportsDiagnostics()
        }
      }

      if (syncType === 'all' || syncType === 'standings') {
        clearAPISportsDiagnostics()
        const standingsCount = await syncAPISportsStandingsToDb({ season, sport: apiSportsSport });
        results[`${asKeyPrefix}_standings`] = { synced: standingsCount, sport: apiSportsSport };
        diagnostics[`${asKeyPrefix}_standings`] = getAPISportsDiagnostics()
      }

      if (syncType === 'all' || syncType === 'identity') {
        clearAPISportsDiagnostics()
        const identityResult = await syncAPISportsPlayersToIdentityMap({ season, sport: apiSportsSport });
        results[`${asKeyPrefix}_identity`] = { ...identityResult, sport: apiSportsSport };
        diagnostics[`${asKeyPrefix}_identity`] = getAPISportsDiagnostics()
      }
    }

    if (source === 'all' || source === 'api_football') {
      if (syncType === 'all' || syncType === 'teams') {
        clearAPIFootballDiagnostics()
        const teamCount = await syncAPIFootballTeamsToDb({ season })
        results.af_teams = { synced: teamCount }
        diagnostics.af_teams = getAPIFootballDiagnostics()
      }

      if (syncType === 'all' || syncType === 'schedule' || syncType === 'games') {
        clearAPIFootballDiagnostics()
        const fixtureCount = await syncAPIFootballFixturesToDb({ season })
        results.af_fixtures = { synced: fixtureCount }
        diagnostics.af_fixtures = getAPIFootballDiagnostics()
      }

      if (syncType === 'all' || syncType === 'standings') {
        clearAPIFootballDiagnostics()
        const standingsCount = await syncAPIFootballStandingsToDb({ season })
        results.af_standings = { synced: standingsCount }
        diagnostics.af_standings = getAPIFootballDiagnostics()
      }

      if (syncType === 'all' || syncType === 'players') {
        clearAPIFootballDiagnostics()
        const playerCount = await syncAPIFootballPlayersToDb({ season })
        results.af_players = { synced: playerCount }
        diagnostics.af_players = getAPIFootballDiagnostics()
      }
    }

    if (source === 'all' || source === 'espn') {
      if (syncType === 'all' || syncType === 'news') {
        const { syncFullNewsCoverage } = await import('@/app/api/sports/news/sync-helper');
        const newsResult = await syncFullNewsCoverage();
        results.news = { synced: newsResult.total, breakdown: newsResult.breakdown };
      }
    }

    if (source === 'all' || source === 'clear_sports' || source === 'clearsports') {
      const clearSports = await syncClearSportsToDb({ season, syncType })
      results.clear_sports = clearSports
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      syncType,
      source,
      sport: apiSportsSport,
      season: season || 'current',
      results,
      diagnostics,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[SportsSync] Error:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    );
  }
})

export const GET = withApiUsage({ endpoint: "/api/sports/sync", tool: "SportsSync" })(async (request: NextRequest) => {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  try {
    const { prisma } = await import('@/lib/prisma');

    const [
      riTeams, riPlayers, riGames, riStats,
      riDepthCharts, riTeamStats,
      asTeams, asGames, asInjuries,
      afTeams, afGames, afPlayers,
      csTeams, csGames, csPlayers, csInjuries, csNews,
      espnLiveGames, espnNews,
      trendingCount,
      cacheCount, identityCount, identityWithApiSports,
    ] = await Promise.all([
      prisma.sportsTeam.count({ where: { source: 'rolling_insights' } }),
      prisma.sportsPlayer.count({ where: { source: 'rolling_insights' } }),
      prisma.sportsGame.count({ where: { source: 'rolling_insights' } }),
      prisma.playerSeasonStats.count({ where: { source: 'rolling_insights' } }),
      prisma.depthChart.count({ where: { source: 'rolling_insights' } }),
      prisma.teamSeasonStats.count({ where: { source: 'rolling_insights' } }),
      prisma.sportsTeam.count({ where: { source: 'api_sports' } }),
      prisma.sportsGame.count({ where: { source: 'api_sports' } }),
      prisma.sportsInjury.count({ where: { source: 'api_sports' } }),
      prisma.sportsTeam.count({ where: { source: 'api_football' } }),
      prisma.sportsGame.count({ where: { source: 'api_football' } }),
      prisma.sportsPlayer.count({ where: { source: 'api_football' } }),
      prisma.sportsTeam.count({ where: { source: 'clear_sports' } }),
      prisma.sportsGame.count({ where: { source: 'clear_sports' } }),
      prisma.sportsPlayer.count({ where: { source: 'clear_sports' } }),
      prisma.sportsInjury.count({ where: { source: 'clear_sports' } }),
      prisma.sportsNews.count({ where: { source: 'clear_sports' } }),
      prisma.sportsGame.count({ where: { source: 'espn_live' } }),
      prisma.sportsNews.count({ where: { source: 'espn' } }),
      prisma.trendingPlayer.count(),
      prisma.sportsDataCache.count(),
      prisma.playerIdentityMap.count(),
      prisma.playerIdentityMap.count({ where: { apiSportsId: { not: null } } }),
    ]);

    const latestRISync = await prisma.sportsPlayer.findFirst({
      where: { source: 'rolling_insights' },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });

    const latestASSync = await prisma.sportsInjury.findFirst({
      where: { source: 'api_sports' },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });

    const latestAFSync = await prisma.sportsGame.findFirst({
      where: { source: 'api_football' },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });

    const latestLiveScore = await prisma.sportsGame.findFirst({
      where: { source: 'espn_live' },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });

    const latestCSSync = await prisma.sportsGame.findFirst({
      where: { source: 'clear_sports' },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    })

    const latestNewsSync = await prisma.sportsNews.findFirst({
      where: { source: 'espn' },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });

    return NextResponse.json({
      success: true,
      status: {
        rolling_insights: {
          teams: riTeams,
          players: riPlayers,
          games: riGames,
          seasonStats: riStats,
          depthCharts: riDepthCharts,
          teamStats: riTeamStats,
          lastSyncAt: latestRISync?.fetchedAt?.toISOString() || null,
        },
        api_sports: {
          teams: asTeams,
          games: asGames,
          injuries: asInjuries,
          standings: await prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: 'NFL:standings:' } } }),
          lastSyncAt: latestASSync?.fetchedAt?.toISOString() || null,
        },
        api_football: {
          teams: afTeams,
          games: afGames,
          players: afPlayers,
          standings: await prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: 'SOCCER:standings:' } } }),
          lastSyncAt: latestAFSync?.fetchedAt?.toISOString() || null,
        },
        clear_sports: {
          teams: csTeams,
          games: csGames,
          players: csPlayers,
          injuries: csInjuries,
          news: csNews,
          cachedPayloads: await prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: 'clearsports:' } } }),
          lastSyncAt: latestCSSync?.fetchedAt?.toISOString() || null,
        },
        sleeper: {
          trendingPlayers: trendingCount,
        },
        espn: {
          liveGames: espnLiveGames,
          news: espnNews,
          lastLiveScoreSync: latestLiveScore?.fetchedAt?.toISOString() || null,
          lastNewsSync: latestNewsSync?.fetchedAt?.toISOString() || null,
        },
        identity: {
          totalPlayers: identityCount,
          withApiSportsId: identityWithApiSports,
        },
        cacheEntries: cacheCount,
      },
    });
  } catch (error) {
    console.error('[SportsSync] Status check error:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status', details: String(error) },
      { status: 500 }
    );
  }
})
