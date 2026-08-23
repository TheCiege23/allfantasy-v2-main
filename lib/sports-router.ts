import { prisma } from './prisma';
import {
  fetchNFLRoster,
  fetchNFLTeams,
  fetchNFLSchedule,
  searchNFLPlayer,
  getCurrentNFLSeason,
  fetchNFLDepthCharts,
  fetchNFLTeamsFull,
  type RIPlayer,
  type RITeam,
  type RIScheduleGame,
} from './rolling-insights';
import {
  fetchAPISportsTeams,
  fetchAPISportsPlayerBySearch,
  fetchAPISportsGames,
  fetchAPISportsStandings,
  fetchAPISportsPlayerStatistics,
  getCurrentNFLSeasonForAPISports,
  teamNameToAbbrev as apiSportsTeamToAbbrev,
  type APISportsTeam,
  type APISportsPlayer,
  type APISportsGame,
  type APISportsStanding,
} from './api-sports';
import {
  fetchClearSportsTeams,
  fetchClearSportsPlayers,
  fetchClearSportsGames,
  normalizeClearSportsTeams,
  normalizeClearSportsPlayers,
  normalizeClearSportsGames,
  type ClearSportsSport,
} from './clear-sports';
import { normalizeTeamAbbrev } from './team-abbrev';
import { isClearSportsAvailable } from './provider-config';
import { normalizeToSupportedSport, type SupportedSport } from './sport-scope';
import { sanitizeProviderError } from './ai-orchestration/provider-utils';
import { logDiagnosticsEvent } from './provider-diagnostics';
import { fetchWithChain } from '@/lib/workers/api-chain';
import { isRollingInsightsEnabledForSport, legacySupportedSportToApiChain } from '@/lib/workers/api-config';
import { getPlayersBySport } from '@/lib/sleeper-client';
import { getTheSportsDbApiKeyOrFallback } from '@/lib/env/sports-media-keys';
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'

export type Sport = SupportedSport;
export type DataType = 'teams' | 'players' | 'games' | 'stats' | 'standings' | 'schedule' | 'depth_charts' | 'team_stats';

interface SportsDataRequest {
  sport: Sport;
  dataType: DataType;
  identifier?: string;
  dateRange?: { start?: Date; end?: Date };
  season?: string;
  forceRefresh?: boolean;
}

interface SportsDataResponse {
  data: unknown;
  source: string;
  cached: boolean;
  stale: boolean;
  fetchedAt: Date;
  attemptedSources?: string[];
}

const API_PRIORITY: Record<Sport, string[]> = {
  // Rolling Insights → API-Sports (TheSportsDB / “TheDataDb”-class API DB) → ClearSports → TheSportsDB → Sleeper → FantasyPros (reserved) → ESPN last.
  NFL: ['rolling_insights', 'api_sports', 'clear_sports', 'thesportsdb', 'sleeper', 'fantasypros', 'espn'],
  NHL: ['rolling_insights', 'api_sports', 'clear_sports', 'thesportsdb', 'sleeper', 'fantasypros', 'espn'],
  NBA: ['rolling_insights', 'api_sports', 'clear_sports', 'thesportsdb', 'sleeper', 'fantasypros', 'espn'],
  MLB: ['rolling_insights', 'api_sports', 'clear_sports', 'thesportsdb', 'sleeper', 'fantasypros', 'espn'],
  NCAAB: ['rolling_insights', 'api_sports', 'clear_sports', 'thesportsdb', 'sleeper', 'fantasypros', 'espn'],
  NCAAF: ['rolling_insights', 'api_sports', 'clear_sports', 'thesportsdb', 'sleeper', 'fantasypros', 'espn'],
  SOCCER: ['rolling_insights', 'api_sports', 'clear_sports', 'thesportsdb', 'sleeper', 'fantasypros', 'espn'],
};

const FRESHNESS_RULES: Record<DataType, number> = {
  teams: 7 * 24 * 60 * 60 * 1000,
  players: 24 * 60 * 60 * 1000,
  games: 60 * 1000,
  stats: 6 * 60 * 60 * 1000,
  standings: 6 * 60 * 60 * 1000,
  schedule: 12 * 60 * 60 * 1000,
  depth_charts: 12 * 60 * 60 * 1000,
  team_stats: 24 * 60 * 60 * 1000,
};

// ── In-Memory Cache ──
interface MemCacheEntry {
  data: SportsDataResponse;
  expiresAt: number;
  staleAt: number;
}

const memCache = new Map<string, MemCacheEntry>();
const MEM_CACHE_MAX_SIZE = 500;
const MEM_CACHE_STALE_RATIO = 0.8;

function memCacheGet(key: string): { entry: MemCacheEntry; fresh: boolean } | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return { entry, fresh: Date.now() < entry.staleAt };
}

function memCacheSet(key: string, data: SportsDataResponse, ttlMs: number) {
  if (memCache.size >= MEM_CACHE_MAX_SIZE) {
    const firstKey = memCache.keys().next().value;
    if (firstKey) memCache.delete(firstKey);
  }
  memCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    staleAt: Date.now() + ttlMs * MEM_CACHE_STALE_RATIO,
  });
}

// ── Request Deduplication ──
const inflightRequests = new Map<string, Promise<SportsDataResponse>>();

// ── Circuit Breaker ──
interface CircuitState {
  failures: number;
  lastFailure: number;
  openUntil: number;
}

const circuitBreakers = new Map<string, CircuitState>();
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 2 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 15000;

function isCircuitOpen(source: string): boolean {
  const state = circuitBreakers.get(source);
  if (!state) return false;
  if (state.failures < CIRCUIT_FAILURE_THRESHOLD) return false;
  if (Date.now() > state.openUntil) {
    state.failures = 0;
    state.lastFailure = 0;
    state.openUntil = 0;
    console.log(`[SportsRouter] Circuit RESET for ${source} (cooldown expired)`);
    return false;
  }
  return true;
}

function recordCircuitSuccess(source: string) {
  const state = circuitBreakers.get(source);
  if (state) {
    state.failures = Math.max(0, state.failures - 1);
    if (state.failures === 0) circuitBreakers.delete(source);
  }
}

function recordCircuitFailure(source: string) {
  const state = circuitBreakers.get(source) || { failures: 0, lastFailure: 0, openUntil: 0 };
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.warn(`[SportsRouter] Circuit OPEN for ${source} after ${state.failures} failures (cooldown ${CIRCUIT_COOLDOWN_MS / 1000}s)`);
  }
  circuitBreakers.set(source, state);
}

async function fetchWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number = SOURCE_TIMEOUT_MS): Promise<T | null> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return result;
  } catch {
    return null;
  }
}

const THESPORTSDB_LEAGUE_IDS: Partial<Record<Sport, string>> = {
  NFL: '4391',
  NHL: '4380',
  NBA: '4387',
  MLB: '4424',
  NCAAB: process.env.THESPORTSDB_NCAAM_LEAGUE_ID || '4607',
  NCAAF: process.env.THESPORTSDB_NCAAF_LEAGUE_ID || '',
  SOCCER: process.env.THESPORTSDB_SOCCER_LEAGUE_ID || '',
};

const ESPN_PATHS: Partial<Record<Sport, string>> = {
  NFL: 'football/nfl',
  NHL: 'hockey/nhl',
  NBA: 'basketball/nba',
  MLB: 'baseball/mlb',
  NCAAB: 'basketball/mens-college-basketball',
  NCAAF: 'football/college-football',
  SOCCER: process.env.ESPN_SOCCER_PATH || 'soccer/eng.1',
};

interface NormalizedTeam {
  id: string;
  name: string;
  shortName: string;
  mascot?: string;
  city?: string;
  logo?: string | null;
  source: string;
}

interface NormalizedPlayer {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  teamId: string | null;
  number: number | null;
  height: string | null;
  weight: number | null;
  college: string | null;
  dob: string | null;
  status: string | null;
  img: string | null;
  fantasyPoints: number | null;
  seasonStats: unknown[];
  source: string;
}

interface NormalizedGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  date: string | null;
  status: string | null;
  season: string | null;
  venue: string | null;
  source: string;
}

/** NFL-only depth charts / team detail — uses legacy GraphQL helpers. */
async function fetchFromRollingInsightsNflLegacy(
  dataType: DataType,
  identifier?: string,
  season?: string,
): Promise<unknown | null> {
  const clientId = process.env.ROLLING_INSIGHTS_CLIENT_ID;
  const clientSecret = process.env.ROLLING_INSIGHTS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const currentSeason = season || getCurrentNFLSeason();

    switch (dataType) {
      case 'teams': {
        const teams = await fetchNFLTeams();
        return teams.map((t: RITeam): NormalizedTeam => ({
          id: t.id,
          name: t.team,
          shortName: t.abbrv,
          mascot: t.mascot,
          city: t.team.replace(` ${t.mascot}`, ''),
          logo: t.img,
          source: 'rolling_insights',
        }));
      }
      case 'players': {
        if (!identifier) return null;
        const players = await searchNFLPlayer(identifier);
        return players.map((p: RIPlayer): NormalizedPlayer => ({
          id: p.id,
          name: p.player,
          position: p.position,
          team: normalizeTeamAbbrev(p.team?.abbrv) || null,
          teamId: p.team?.id || null,
          number: p.number,
          height: p.height,
          weight: p.weight,
          college: p.college,
          dob: p.dob,
          status: p.status,
          img: p.img,
          fantasyPoints: p.regularSeason?.find(s => s.period === currentSeason)?.DK_fantasy_points || null,
          seasonStats: p.regularSeason || [],
          source: 'rolling_insights',
        }));
      }
      case 'stats': {
        if (!identifier) return null;
        const players = await searchNFLPlayer(identifier);
        if (!players.length) return null;
        return players.map((p: RIPlayer) => ({
          id: p.id,
          name: p.player,
          position: p.position,
          team: p.team?.abbrv || null,
          regularSeason: p.regularSeason || [],
          postSeason: p.postSeason || [],
          source: 'rolling_insights',
        }));
      }
      case 'games':
      case 'schedule': {
        const games = await fetchNFLSchedule({ season: currentSeason });
        return games.map((g: RIScheduleGame): NormalizedGame => ({
          id: g.gameId,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          date: g.date,
          status: g.status,
          season: g.season,
          venue: g.venue?.arena || null,
          source: 'rolling_insights',
        }));
      }
      case 'standings':
        return null;
      case 'depth_charts': {
        const charts = await fetchNFLDepthCharts({
          season: currentSeason,
          teamName: identifier,
        });
        return charts.map(c => ({
          team: c.abbrv,
          teamName: c.team,
          positions: c.positions,
          source: 'rolling_insights',
        }));
      }
      case 'team_stats': {
        const teams = await fetchNFLTeamsFull({
          season: currentSeason,
          teamName: identifier,
        });
        return teams.map(t => ({
          team: t.abbrv,
          teamName: t.team,
          record: t.record,
          regularSeason: t.regularSeason,
          postSeason: t.postSeason,
          injuries: t.injuries,
          bye: t.bye,
          conference: t.conf,
          dome: t.dome,
          source: 'rolling_insights',
        }));
      }
      default:
        return null;
    }
  } catch (error) {
    console.error('[SportsRouter] Rolling Insights fetch failed:', sanitizeProviderError(error instanceof Error ? error.message : String(error)));
    return null;
  }
}

function mapRouterDataTypeToChain(dataType: DataType): string {
  switch (dataType) {
    case 'teams':
      return 'teams'
    case 'players':
      return 'players'
    case 'games':
      return 'games'
    case 'schedule':
      return 'schedule'
    case 'stats':
      return 'stats'
    case 'standings':
      return 'standings'
    case 'depth_charts':
      return 'depth_charts'
    case 'team_stats':
      return 'team_stats'
    default:
      return 'teams'
  }
}

function normalizeChainPayloadForRouter(sport: Sport, dataType: DataType, data: unknown): unknown {
  if (!Array.isArray(data)) return data
  switch (dataType) {
    case 'teams':
      return data.map((raw) => {
        const t = raw as Record<string, unknown>
        return {
          id: String(t.id ?? ''),
          name: String(t.name ?? t.team ?? ''),
          shortName:
            normalizeTeamAbbrev(String(t.shortName ?? t.abbrv ?? t.abbreviation ?? '')) ||
            String(t.shortName ?? t.abbrv ?? ''),
          mascot: t.mascot ?? '',
          city: t.city ?? '',
          logo: t.logo ?? t.img ?? '',
          source: 'rolling_insights',
        }
      })
    case 'players':
      return data.map((raw) => {
        const p = raw as Record<string, unknown>
        return {
          id: String(p.id ?? ''),
          name: String(p.name ?? p.player ?? p.full_name ?? ''),
          position: p.position ?? null,
          team: normalizeTeamAbbrev(String(p.team ?? p.team_abbr ?? '')) || null,
          teamId: p.teamId ?? null,
          number: p.number ?? null,
          height: p.height ?? null,
          weight: p.weight ?? null,
          college: p.college ?? null,
          dob: p.dob ?? null,
          status: p.status ?? null,
          img: p.imageUrl ?? p.img ?? null,
          fantasyPoints: null,
          seasonStats: Array.isArray(p.regularSeason) ? p.regularSeason : [],
          source: 'rolling_insights',
        }
      })
    case 'games':
    case 'schedule':
      return data.map((raw) => {
        const g = raw as Record<string, unknown>
        return {
          id: String(g.id ?? g.gameId ?? ''),
          homeTeam: String(g.homeTeam ?? g.home ?? ''),
          awayTeam: String(g.awayTeam ?? g.away ?? ''),
          date: g.date ?? g.startTime ?? null,
          status: g.status ?? null,
          season: g.season != null ? String(g.season) : null,
          venue: g.venue ?? null,
          source: 'rolling_insights',
        }
      })
    default:
      return data
  }
}

/**
 * Rolling Insights for all chain sports via DB-first `fetchWithChain` (same stack as workers).
 * NFL `depth_charts` / `team_stats` keep legacy specialized fetchers.
 */
async function fetchFromRollingInsightsViaChain(
  sport: Sport,
  dataType: DataType,
  identifier?: string,
  season?: string,
): Promise<unknown | null> {
  const chainSport = legacySupportedSportToApiChain(sport)
  if (!isRollingInsightsEnabledForSport(chainSport)) return null

  if (sport === 'NFL' && (dataType === 'depth_charts' || dataType === 'team_stats')) {
    return fetchFromRollingInsightsNflLegacy(dataType, identifier, season)
  }

  const chainDt = mapRouterDataTypeToChain(dataType)
  const query: Record<string, unknown> = {}
  if (identifier) {
    query.search = identifier
    query.playerName = identifier
    if (dataType === 'depth_charts' || dataType === 'team_stats') query.teamName = identifier
  }
  if (season) query.season = season

  const res = await fetchWithChain({
    sport: chainSport,
    dataType: chainDt,
    query,
  })
  if (res.data == null) return null
  return normalizeChainPayloadForRouter(sport, dataType, res.data)
}

async function fetchFromAPISports(
  dataType: DataType,
  identifier?: string,
  season?: string,
): Promise<unknown | null> {
  const apiKey = process.env.API_SPORTS_KEY;
  if (!apiKey) return null;

  try {
    const currentSeason = season || getCurrentNFLSeasonForAPISports();

    switch (dataType) {
      case 'teams': {
        const teams = await fetchAPISportsTeams();
        return teams.map((t: APISportsTeam): NormalizedTeam => ({
          id: String(t.id),
          name: t.name,
          shortName: apiSportsTeamToAbbrev(t.name) || t.name,
          city: t.city || undefined,
          logo: t.logo,
          source: 'api_sports',
        }));
      }
      case 'players': {
        if (!identifier) return null;
        const players = await fetchAPISportsPlayerBySearch(identifier, currentSeason);
        return players.map((p: APISportsPlayer): NormalizedPlayer => ({
          id: String(p.id),
          name: p.name,
          position: p.position || p.group || null,
          team: p.team ? apiSportsTeamToAbbrev(p.team.name) : null,
          teamId: p.team ? String(p.team.id) : null,
          number: p.number,
          height: p.height,
          weight: p.weight ? parseInt(p.weight) || null : null,
          college: p.college,
          dob: null,
          status: null,
          img: p.image,
          fantasyPoints: null,
          seasonStats: [],
          source: 'api_sports',
        }));
      }
      case 'games':
      case 'schedule': {
        const games = await fetchAPISportsGames(currentSeason);
        return games.map((g: APISportsGame): NormalizedGame => ({
          id: String(g.game.id),
          homeTeam: apiSportsTeamToAbbrev(g.teams.home.name) || g.teams.home.name,
          awayTeam: apiSportsTeamToAbbrev(g.teams.away.name) || g.teams.away.name,
          date: g.game.date.date,
          status: g.game.status.long,
          season: g.league.season,
          venue: g.game.venue?.name || null,
          source: 'api_sports',
        }));
      }
      case 'stats': {
        if (!identifier) return null;
        const players = await fetchAPISportsPlayerBySearch(identifier, currentSeason);
        if (!players.length) return null;
        const playerWithStats = [];
        for (const p of players.slice(0, 3)) {
          try {
            const stats = await fetchAPISportsPlayerStatistics(String(p.id), currentSeason);
            playerWithStats.push({
              id: String(p.id),
              name: p.name,
              position: p.position || p.group || null,
              team: p.team ? apiSportsTeamToAbbrev(p.team.name) : null,
              statistics: stats,
              source: 'api_sports',
            });
          } catch {
            playerWithStats.push({
              id: String(p.id),
              name: p.name,
              position: p.position || p.group || null,
              team: p.team ? apiSportsTeamToAbbrev(p.team.name) : null,
              statistics: [],
              source: 'api_sports',
            });
          }
        }
        return playerWithStats;
      }
      case 'standings': {
        const standings = await fetchAPISportsStandings(currentSeason);
        return standings.map((s: APISportsStanding) => ({
          team: apiSportsTeamToAbbrev(s.team.name),
          teamName: s.team.name,
          logo: s.team.logo,
          position: s.position,
          won: s.won,
          lost: s.lost,
          tied: s.tied,
          pointsFor: s.points.for,
          pointsAgainst: s.points.against,
          conference: s.group?.conference || null,
          division: s.group?.name || null,
          source: 'api_sports',
        }));
      }
      default:
        return null;
    }
  } catch (error) {
    console.error('[SportsRouter] API-Sports fetch failed:', sanitizeProviderError(error instanceof Error ? error.message : String(error)));
    return null;
  }
}

async function fetchFromClearSports(
  sport: Sport,
  dataType: DataType,
  identifier?: string,
  season?: string,
): Promise<unknown | null> {
  if (!isClearSportsAvailable()) return null;
  const csSport = sport as ClearSportsSport;

  try {
    switch (dataType) {
      case 'teams': {
        const teams = await fetchClearSportsTeams(csSport);
        return normalizeClearSportsTeams(teams, csSport);
      }
      case 'players': {
        if (!identifier) return null;
        const players = await fetchClearSportsPlayers(csSport, identifier);
        return normalizeClearSportsPlayers(players, csSport);
      }
      case 'games':
      case 'schedule': {
        const games = await fetchClearSportsGames(csSport, season);
        return normalizeClearSportsGames(games, csSport, season);
      }
      default:
        return null;
    }
  } catch (error) {
    console.error('[SportsRouter] ClearSports fetch failed:', sanitizeProviderError(error instanceof Error ? error.message : String(error)));
    return null;
  }
}

async function fetchFromTheSportsDB(sport: Sport, dataType: DataType, identifier?: string): Promise<unknown | null> {
  const apiKey = getTheSportsDbApiKeyOrFallback('3');
  const leagueId = THESPORTSDB_LEAGUE_IDS[sport];
  if (!leagueId) return null;

  let url = '';

  switch (dataType) {
    case 'teams':
      url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/lookup_all_teams.php?id=${leagueId}`;
      break;
    case 'players':
      if (identifier) {
        url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/searchplayers.php?t=${encodeURIComponent(identifier)}`;
      } else {
        return null;
      }
      break;
    case 'games':
    case 'schedule':
      url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsnextleague.php?id=${leagueId}`;
      break;
    case 'standings':
      url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/lookuptable.php?l=${leagueId}`;
      break;
    default:
      return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchFromESPN(sport: Sport, dataType: DataType, identifier?: string): Promise<unknown | null> {
  const path = ESPN_PATHS[sport];
  if (!path) return null;

  if (sport === 'NFL' && (dataType === 'players' || dataType === 'stats') && identifier) {
    try {
      const dbPlayers = await prisma.sportsPlayer.findMany({
        where: {
          sport: 'NFL',
          source: 'espn',
          name: { contains: identifier, mode: 'insensitive' },
        },
        take: 5,
      });

      if (dbPlayers.length > 0) {
        return dbPlayers.map((p): NormalizedPlayer => ({
          id: p.externalId,
          name: p.name,
          position: p.position,
          team: p.team,
          teamId: p.teamId,
          number: p.number,
          height: p.height,
          weight: p.weight ? parseInt(p.weight) || null : null,
          college: p.college,
          dob: p.dob,
          status: p.status,
          img: p.imageUrl,
          fantasyPoints: null,
          seasonStats: [],
          source: 'espn',
        }));
      }

      const { fetchESPNTeamRoster } = await import('./espn-data');
      const teamAbbrev = normalizeTeamAbbrev(identifier);
      if (teamAbbrev) {
        const roster = await fetchESPNTeamRoster(teamAbbrev);
        return roster.map((a): NormalizedPlayer => ({
          id: `espn-${a.id}`,
          name: a.fullName,
          position: a.position?.abbreviation || null,
          team: teamAbbrev,
          teamId: null,
          number: a.jersey ? parseInt(a.jersey) || null : null,
          height: a.height ? String(a.height) : null,
          weight: a.weight || null,
          college: a.college?.name || null,
          dob: a.dateOfBirth || null,
          status: a.status?.type?.name || null,
          img: a.headshot?.href || null,
          fantasyPoints: null,
          seasonStats: [],
          source: 'espn',
        }));
      }

      return null;
    } catch {
      return null;
    }
  }

  let url = '';

  switch (dataType) {
    case 'teams':
      url = `${ESPN_SITE_API_BASE}/${path}/teams`; // db-first-exception: provider router fallback pending DB-first news/schedule mirror
      break;
    case 'games':
    case 'schedule':
      url = `${ESPN_SITE_API_BASE}/${path}/scoreboard`; // db-first-exception: provider router fallback pending DB-first news/schedule mirror
      break;
    case 'standings':
      url = `${ESPN_SITE_API_BASE}/${path}/standings`; // db-first-exception: provider router fallback pending DB-first news/schedule mirror
      break;
    default:
      return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeTheSportsDBData(data: unknown, dataType: DataType): unknown {
  if (!data) return null;
  const d = data as Record<string, unknown>;
  if (dataType === 'teams' && d.teams) return d.teams;
  if (dataType === 'games' && d.events) return d.events;
  if (dataType === 'standings' && d.table) return d.table;
  if (dataType === 'players' && d.player) return d.player;
  if (dataType === 'schedule' && d.events) return d.events;
  return data;
}

function normalizeESPNData(data: unknown, dataType: DataType): unknown {
  if (!data) return null;
  const d = data as Record<string, unknown>;
  if (dataType === 'teams' && d.sports) {
    const sports = d.sports as Array<{ leagues?: Array<{ teams?: unknown[] }> }>;
    return sports[0]?.leagues?.[0]?.teams || [];
  }
  if ((dataType === 'games' || dataType === 'schedule') && d.events) return d.events;
  if (dataType === 'standings' && d.children) return d.children;
  return data;
}

/** Final fallback: Sleeper public NFL player map (search by name). */
async function fetchFromSleeper(
  sport: Sport,
  dataType: DataType,
  identifier?: string,
): Promise<unknown | null> {
  if (sport !== 'NFL' || dataType !== 'players') return null;
  const q = identifier?.trim().toLowerCase() ?? '';
  if (!q) return null;

  try {
    const players = await getPlayersBySport('nfl');
    if (!players || typeof players !== 'object') return null;

    const out: Array<Record<string, unknown>> = [];
    for (const [id, raw] of Object.entries(players)) {
      const p = raw as unknown as Record<string, unknown>;
      const name = String(p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim());
      if (!name.toLowerCase().includes(q)) continue;
      out.push({
        id,
        name,
        position: p.position ?? null,
        team: normalizeTeamAbbrev(String(p.team ?? '')) ?? p.team ?? null,
        number: p.number ?? null,
        height: p.height ?? null,
        weight: p.weight ?? null,
        college: p.college ?? null,
        dob: p.birth_date ?? null,
        status: p.injury_status ?? null,
        img: `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`,
        source: 'sleeper',
      });
      if (out.length >= 40) break;
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

async function fetchFromSource(
  source: string,
  sport: Sport,
  dataType: DataType,
  identifier?: string,
  season?: string,
): Promise<unknown | null> {
  if (isCircuitOpen(source)) {
    console.log(`[SportsRouter] Skipping ${source} (circuit open)`);
    return null;
  }

  const timeoutMs = dataType === 'games' ? 10000 : SOURCE_TIMEOUT_MS;

  const result = await fetchWithTimeout(async () => {
    switch (source) {
      case 'rolling_insights':
        return fetchFromRollingInsightsViaChain(sport, dataType, identifier, season);
      case 'api_sports':
        if (sport !== 'NFL') return null;
        return fetchFromAPISports(dataType, identifier, season);
      case 'clear_sports': {
        return fetchFromClearSports(sport, dataType, identifier, season);
      }
      case 'thesportsdb': {
        const raw = await fetchFromTheSportsDB(sport, dataType, identifier);
        return normalizeTheSportsDBData(raw, dataType);
      }
      case 'espn': {
        const raw = await fetchFromESPN(sport, dataType, identifier);
        if (dataType === 'players' || dataType === 'stats') return raw;
        return normalizeESPNData(raw, dataType);
      }
      case 'sleeper':
        return fetchFromSleeper(sport, dataType, identifier);
      case 'fantasypros':
        // Reserved slot in priority chain — wire `lib/fantasypros-*` fetcher when product adds FantasyPros REST coverage.
        return null;
      default:
        return null;
    }
  }, timeoutMs);

  if (result) {
    recordCircuitSuccess(source);
  } else {
    recordCircuitFailure(source);
  }

  return result;
}

async function tryNFLFromDb(dataType: DataType, identifier?: string): Promise<SportsDataResponse | null> {
  try {
    if (dataType === 'teams') {
      const teams = await getNFLTeamsFromDb();
      if (teams.length > 0) {
        return {
          data: teams,
          source: 'rolling_insights_db',
          cached: true,
          stale: false,
          fetchedAt: new Date(),
          attemptedSources: ['rolling_insights_db'],
        };
      }
    }

    if ((dataType === 'players' || dataType === 'stats') && identifier) {
      const player = await getNFLPlayerFromDb(identifier);
      if (player) {
        if (dataType === 'stats') {
          return {
            data: [{ id: player.id, name: player.name, position: player.position, team: player.team, regularSeason: player.seasonStats, postSeason: [], source: 'rolling_insights_db' }],
            source: 'rolling_insights_db',
            cached: true,
            stale: false,
            fetchedAt: new Date(),
            attemptedSources: ['rolling_insights_db'],
          };
        }
        return {
          data: [player],
          source: 'rolling_insights_db',
          cached: true,
          stale: false,
          fetchedAt: new Date(),
          attemptedSources: ['rolling_insights_db'],
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function getSportsData(request: SportsDataRequest): Promise<SportsDataResponse> {
  const sport = normalizeToSupportedSport(request.sport) as Sport;
  const { dataType, identifier, season, forceRefresh } = request;
  const cacheKey = identifier || 'all';
  const key = `${sport}:${dataType}:${cacheKey}`;

  if (!forceRefresh) {
    const mem = memCacheGet(key);
    if (mem?.fresh) return mem.entry.data;
    if (mem && !mem.fresh) {
      refreshInBackground(sport, dataType, identifier, season);
      return { ...mem.entry.data, stale: true };
    }
  }

  const inflight = inflightRequests.get(key);
  if (inflight && !forceRefresh) return inflight;

  const fetchPromise = getSportsDataInternal(key, sport, dataType, identifier, season, forceRefresh);
  inflightRequests.set(key, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    inflightRequests.delete(key);
  }
}

async function getSportsDataInternal(
  key: string,
  sport: Sport,
  dataType: DataType,
  identifier?: string,
  season?: string,
  forceRefresh?: boolean,
): Promise<SportsDataResponse> {
  const freshnessMs = FRESHNESS_RULES[dataType];

  if (!forceRefresh) {
    const cached = await (prisma.sportsDataCache as any).findUnique({
      where: { cacheKey: key },
    });

    if (cached && cached.expiresAt > new Date()) {
      const response: SportsDataResponse = {
        data: cached.data,
        source: 'cache',
        cached: true,
        stale: false,
        fetchedAt: cached.createdAt,
        attemptedSources: ['cache'],
      };
      memCacheSet(key, response, freshnessMs);
      return response;
    }

    if (cached) {
      const response: SportsDataResponse = {
        data: cached.data,
        source: 'cache',
        cached: true,
        stale: true,
        fetchedAt: cached.createdAt,
        attemptedSources: ['cache'],
      };
      memCacheSet(key, response, Math.min(freshnessMs, 60000));
      refreshInBackground(sport, dataType, identifier, season);
      return response;
    }
  }

  if (sport === 'NFL' && !forceRefresh) {
    const dbResult = await tryNFLFromDb(dataType, identifier);
    if (dbResult) {
      memCacheSet(key, dbResult, freshnessMs);
      return dbResult;
    }
  }

  const sources = API_PRIORITY[sport] || API_PRIORITY.NFL;
  let fetchedData: unknown = null;
  let usedSource = '';
  const attemptedSources: string[] = [];

  for (const source of sources) {
    attemptedSources.push(source);
    const data = await fetchFromSource(source, sport, dataType, identifier, season);
    if (data) {
      fetchedData = data;
      usedSource = source;
      break;
    }
  }

  if (!fetchedData) {
    throw new Error(`Failed to fetch ${dataType} for ${sport} from any source`);
  }

  const expiresAt = new Date(Date.now() + freshnessMs);

  await (prisma.sportsDataCache as any).upsert({
    where: { cacheKey: key },
    update: {
      data: fetchedData as object,
      expiresAt,
    },
    create: {
      cacheKey: key,
      data: fetchedData as object,
      expiresAt,
    },
  }).catch((err: Error) => console.error('[SportsRouter] Cache write failed:', err.message));

  const response: SportsDataResponse = {
    data: fetchedData,
    source: usedSource,
    cached: false,
    stale: false,
    fetchedAt: new Date(),
    attemptedSources,
  };
  if (attemptedSources.includes('clear_sports') && usedSource !== 'clear_sports') {
    logDiagnosticsEvent('fallback', 'clearsports', `used_${usedSource}`)
  }
  memCacheSet(key, response, freshnessMs);
  return response;
}

async function refreshInBackground(sport: Sport, dataType: DataType, identifier?: string, season?: string) {
  const cacheKey = identifier || 'all';
  const key = `${sport}:${dataType}:${cacheKey}`;
  const sources = API_PRIORITY[sport] || API_PRIORITY.NFL;

  for (const source of sources) {
    const data = await fetchFromSource(source, sport, dataType, identifier, season);
    if (data) {
      const freshnessMs = FRESHNESS_RULES[dataType];
      const expiresAt = new Date(Date.now() + freshnessMs);

      await (prisma.sportsDataCache as any).upsert({
        where: { cacheKey: key },
        update: {
          data: data as object,
          expiresAt,
        },
        create: {
          cacheKey: key,
          data: data as object,
          expiresAt,
        },
      });
      break;
    }
  }
}

export async function getTeams(sport: Sport) {
  return getSportsData({ sport, dataType: 'teams' });
}

export async function getGames(sport: Sport, options?: { season?: string }) {
  return getSportsData({ sport, dataType: 'games', season: options?.season });
}

export async function getStandings(sport: Sport) {
  return getSportsData({ sport, dataType: 'standings' });
}

export async function getPlayer(sport: Sport, searchTerm: string) {
  return getSportsData({ sport, dataType: 'players', identifier: searchTerm });
}

export async function getPlayerStats(sport: Sport, searchTerm: string) {
  return getSportsData({ sport, dataType: 'stats', identifier: searchTerm });
}

export async function getSchedule(sport: Sport, options?: { season?: string }) {
  return getSportsData({ sport, dataType: 'schedule', season: options?.season });
}

export async function getNFLPlayerFromDb(playerName: string): Promise<NormalizedPlayer | null> {
  const dbPlayer = await prisma.sportsPlayer.findFirst({
    where: {
      sport: 'NFL',
      name: { contains: playerName, mode: 'insensitive' },
      source: 'rolling_insights',
    },
  });

  if (!dbPlayer) return null;

  const stats = await prisma.playerSeasonStats.findMany({
    where: {
      sport: 'NFL',
      playerId: dbPlayer.externalId,
      source: 'rolling_insights',
    },
    orderBy: { season: 'desc' },
  });

  return {
    id: dbPlayer.externalId,
    name: dbPlayer.name,
    position: dbPlayer.position,
    team: dbPlayer.team,
    teamId: dbPlayer.teamId,
    number: dbPlayer.number,
    height: dbPlayer.height,
    weight: dbPlayer.weight ? parseInt(dbPlayer.weight) : null,
    college: dbPlayer.college,
    dob: null,
    status: null,
    img: null,
    fantasyPoints: stats[0]?.fantasyPoints || null,
    seasonStats: stats.map((s: { stats: unknown }) => s.stats),
    source: 'rolling_insights',
  };
}

export async function getNFLTeamsFromDb(): Promise<NormalizedTeam[]> {
  const teams = await prisma.sportsTeam.findMany({
    where: { sport: 'NFL', source: 'rolling_insights' },
    orderBy: { name: 'asc' },
  });

  return teams.map(t => ({
    id: t.externalId,
    name: t.name,
    shortName: t.shortName || '',
    city: t.city || undefined,
    logo: t.logo,
    source: 'rolling_insights',
  }));
}
