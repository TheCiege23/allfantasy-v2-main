const SLEEPER_API_BASE = 'https://api.sleeper.app/v1'; // db-first-exception: centralized provider client used by ingestion and controlled wrappers

/**
 * Aug 2026 — every call in this module used a bare `fetch()` with no timeout.
 *
 * Node's undici applies no total-request deadline: its `headersTimeout`/`bodyTimeout` default to
 * 300s, and the body timer RESETS on each received chunk, so a peer that accepts the connection
 * and then trickles or stalls bytes holds the request open indefinitely. On a Vercel function
 * with `maxDuration = 300` the platform kills the invocation before undici ever gives up — and a
 * platform kill runs no user code, so `finally` blocks, catch handlers and telemetry writers
 * never execute. That is exactly how `cron-decision-os-activity-ingest` left six `SyncJobRun`
 * rows stuck in `running`: the per-league `try/catch` below can only fire once a fetch SETTLES.
 *
 * `lib/league-import/sleeper/SleeperLeagueFetchService.ts` already hardened its own copy of this
 * (12s timeout + retries), but that helper is module-private and the ingestion path never used
 * it. `SLEEPER_FETCH_TIMEOUT_MS` matches its 12s so the two agree.
 */
const SLEEPER_FETCH_TIMEOUT_MS = 12_000;
/** The `/players/{sport}` map is a multi-megabyte payload — it needs a wider window than 12s. */
const SLEEPER_PLAYER_MAP_TIMEOUT_MS = 45_000;

/**
 * `fetch` with a hard deadline. Rejects with a `TimeoutError` DOMException once `timeoutMs`
 * elapses, which each caller's existing `catch` turns into its documented empty/null value —
 * except for callers that opt into `strict` (see `unwrapStrict`), which need to tell "Sleeper
 * had no data" apart from "we could not reach Sleeper".
 */
function sleeperFetch(url: string, timeoutMs: number = SLEEPER_FETCH_TIMEOUT_MS): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Opt-in honesty for callers that record telemetry. The default behaviour of every getter here is
 * to swallow failures and return `[]`/`null`, which makes a timed-out league indistinguishable
 * from a genuinely empty one — a job that reports "processed 40 leagues, 0 rows" when in truth it
 * reached none of them. Passing `{ strict: true }` re-throws instead, so the caller can count the
 * league as failed rather than silently clean.
 */
export type SleeperReadOptions = { strict?: boolean };

class SleeperUnavailableError extends Error {
  constructor(label: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`sleeper_unavailable:${label}: ${detail}`);
    this.name = 'SleeperUnavailableError';
  }
}

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  sport: string;
  status: string;
  avatar?: string | null;
  total_rosters: number;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  settings: Record<string, unknown>;
  draft_id: string;
  previous_league_id: string | null;
}

export async function getLeagueHistory(leagueId: string, userIdentifier?: string): Promise<SleeperLeague[]> {
  const history: SleeperLeague[] = [];
  const seenLeagueIds = new Set<string>();
  let currentLeagueId: string | null = leagueId;
  
  // First, follow the previous_league_id chain
  while (currentLeagueId) {
    const league = await getLeagueInfo(currentLeagueId);
    if (!league) break;
    history.push(league);
    seenLeagueIds.add(league.league_id);
    currentLeagueId = league.previous_league_id;
  }
  
  // If we have a user identifier (username or numeric ID), try to find more history by name matching
  if (userIdentifier && history.length > 0) {
    const resolvedUser = await resolveSleeperUser(userIdentifier);
    
    if (resolvedUser?.userId) {
      const leagueName = history[0].name;
      const sport = history[0].sport || 'nfl';
      const currentYear = new Date().getFullYear();
      const oldestSeasonFound = Math.min(...history.map(h => parseInt(h.season)));
      
      // Search back up to 10 years for matching leagues
      for (let year = oldestSeasonFound - 1; year >= currentYear - 10; year--) {
        try {
          const userLeagues = await getUserLeagues(resolvedUser.userId, sport, year.toString());
          
          // Find leagues with similar names (exact match or contains the core name)
          const matchingLeague = userLeagues.find(l => {
            if (seenLeagueIds.has(l.league_id)) return false;
            const normalizedHistoryName = leagueName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normalizedLeagueName = l.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            return normalizedHistoryName === normalizedLeagueName || 
                   normalizedHistoryName.includes(normalizedLeagueName) ||
                   normalizedLeagueName.includes(normalizedHistoryName);
          });
          
          if (matchingLeague) {
            history.push(matchingLeague);
            seenLeagueIds.add(matchingLeague.league_id);
          }
        } catch {
          // Ignore errors for older seasons that may not exist
          break;
        }
      }
      
      // Sort by season descending
      history.sort((a, b) => parseInt(b.season) - parseInt(a.season));
    }
  }
  
  return history;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  co_owners?: string[];
  players: string[];
  starters: string[];
  reserve: string[];
  taxi: string[];
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal: number;
    fpts_against: number;
    fpts_against_decimal: number;
    ppts?: number;
    ppts_decimal?: number;
    rank?: number;
    final_rank?: number;
    playoff_seed?: number;
    seed?: number;
  };
}

export interface SleeperMatchup {
  matchup_id: number;
  roster_id: number;
  points: number;
  starters: string[];
  starters_points: number[];
  players: string[];
  players_points: Record<string, number>;
}

export interface SleeperPlayoffBracket {
  r: number;
  m: number;
  t1: number;
  t2: number;
  w: number;
  l: number;
  t1_from?: { w?: number; l?: number };
  t2_from?: { w?: number; l?: number };
}

export async function getSleeperUser(username: string): Promise<SleeperUser | null> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/user/${username}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Helper function that accepts either username or numeric user_id and returns both
// This ensures consistency across all legacy features
export async function resolveSleeperUser(userIdentifier: string): Promise<{ username: string; userId: string } | null> {
  try {
    // The Sleeper API accepts both username and user_id in the same endpoint
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/user/${userIdentifier}`);
    if (!response.ok) return null;
    const user = await response.json() as SleeperUser;
    if (!user?.user_id || !user?.username) return null;
    return {
      username: user.username,
      userId: user.user_id
    };
  } catch {
    return null;
  }
}

export async function getUserLeagues(
  userId: string,
  sport: string = 'nfl',
  season: string
): Promise<SleeperLeague[]> {
  const url = `${SLEEPER_API_BASE}/user/${userId}/leagues/${sport}/${season}`;
  const response = await sleeperFetch(url);

  if (!response.ok) {
    throw new Error(`Sleeper getUserLeagues failed (${response.status}) for ${sport} ${season}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Sleeper getUserLeagues invalid JSON for ${sport} ${season}`);
  }

  return data as SleeperLeague[];
}

export async function getLeagueRosters(leagueId: string, opts?: SleeperReadOptions): Promise<SleeperRoster[]> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/league/${leagueId}/rosters`);
    if (!response.ok) {
      if (opts?.strict && response.status !== 404) {
        throw new SleeperUnavailableError('rosters', new Error(`HTTP ${response.status}`));
      }
      return [];
    }
    return await response.json();
  } catch (error) {
    if (opts?.strict) throw error instanceof SleeperUnavailableError ? error : new SleeperUnavailableError('rosters', error);
    return [];
  }
}

export async function getLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/league/${leagueId}/users`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

export async function getLeagueMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/league/${leagueId}/matchups/${week}`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

export async function getPlayoffBracket(leagueId: string): Promise<SleeperPlayoffBracket[]> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/league/${leagueId}/winners_bracket`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

export async function getLosersBracket(leagueId: string): Promise<SleeperPlayoffBracket[]> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/league/${leagueId}/losers_bracket`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

export async function getLeagueInfo(leagueId: string): Promise<SleeperLeague | null> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/league/${leagueId}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function getScoringType(scoringSettings: Record<string, number>): string {
  const ppr = scoringSettings['rec'] || 0;
  if (ppr >= 1) return 'PPR';
  if (ppr >= 0.5) return 'Half PPR';
  return 'Standard';
}

export function getLeagueType(league: SleeperLeague): string {
  const settings = league.settings as Record<string, unknown>;
  if (settings['type'] === 2) return 'dynasty';
  if (settings['type'] === 1) return 'keeper';
  return 'redraft';
}

export interface SleeperDraftPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export async function getTradedDraftPicks(leagueId: string): Promise<SleeperDraftPick[]> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/league/${leagueId}/traded_picks`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

export async function getLeagueDrafts(leagueId: string, opts?: SleeperReadOptions): Promise<any[]> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/league/${leagueId}/drafts`);
    if (!response.ok) {
      if (opts?.strict && response.status !== 404) {
        throw new SleeperUnavailableError('drafts', new Error(`HTTP ${response.status}`));
      }
      return [];
    }
    return await response.json();
  } catch (error) {
    if (opts?.strict) throw error instanceof SleeperUnavailableError ? error : new SleeperUnavailableError('drafts', error);
    return [];
  }
}

export async function getDraftPicks(draftId: string, opts?: SleeperReadOptions): Promise<any[]> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/draft/${draftId}/picks`);
    if (!response.ok) {
      if (opts?.strict && response.status !== 404) {
        throw new SleeperUnavailableError('draft_picks', new Error(`HTTP ${response.status}`));
      }
      return [];
    }
    return await response.json();
  } catch (error) {
    if (opts?.strict) throw error instanceof SleeperUnavailableError ? error : new SleeperUnavailableError('draft_picks', error);
    return [];
  }
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  position: string;
  team: string | null;
  status: string;
  years_exp?: number;
  age?: number;
  college?: string;
}

let cachedPlayers: Record<string, SleeperPlayer> | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function getAllPlayers(): Promise<Record<string, SleeperPlayer>> {
  // Return cached data if still valid
  if (cachedPlayers && Date.now() - cacheTime < CACHE_TTL) {
    return cachedPlayers;
  }
  
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/players/nfl`, SLEEPER_PLAYER_MAP_TIMEOUT_MS);
    if (!response.ok) return cachedPlayers || {};
    const data = await response.json();
    cachedPlayers = data;
    cacheTime = Date.now();
    return data;
  } catch {
    return cachedPlayers || {};
  }
}

export async function getPlayersBySport(sport: string = 'nfl'): Promise<Record<string, SleeperPlayer>> {
  if (sport === 'nfl') {
    return getAllPlayers();
  }

  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/players/${sport}`, SLEEPER_PLAYER_MAP_TIMEOUT_MS);
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

export interface SleeperNflState {
  week?: number;
  season?: string;
  [key: string]: unknown;
}

export async function getNflState(): Promise<SleeperNflState | null> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/state/nfl`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function getPlayerName(players: Record<string, SleeperPlayer>, playerId: string): string {
  const player = players[playerId];
  if (!player) return playerId;
  return player.full_name || `${player.first_name} ${player.last_name}` || playerId;
}

export interface SleeperTransaction {
  type: 'trade' | 'waiver' | 'free_agent' | 'commissioner';
  transaction_id: string;
  status: string;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: Array<{
    season: string;
    round: number;
    roster_id: number;
    previous_owner_id: number;
    owner_id: number;
  }>;
  waiver_budget: Array<{
    sender: number;
    receiver: number;
    amount: number;
  }>;
  leg: number;
  created: number;
  creator: string;
  consenter_ids: number[];
  status_updated: number;
  metadata?: Record<string, unknown>;
}

export async function getLeagueTransactions(
  leagueId: string,
  week: number,
  opts?: SleeperReadOptions
): Promise<SleeperTransaction[]> {
  try {
    const response = await sleeperFetch(`${SLEEPER_API_BASE}/league/${leagueId}/transactions/${week}`);
    if (!response.ok) {
      if (opts?.strict && response.status !== 404) {
        throw new SleeperUnavailableError(`transactions_week_${week}`, new Error(`HTTP ${response.status}`));
      }
      return [];
    }
    return await response.json();
  } catch (error) {
    if (opts?.strict) {
      throw error instanceof SleeperUnavailableError ? error : new SleeperUnavailableError(`transactions_week_${week}`, error);
    }
    return [];
  }
}

// ── Trending Players ──

export interface SleeperTrendingPlayer {
  player_id: string;
  count: number;
}

export async function getTrendingPlayers(
  sport: string = 'nfl',
  type: 'add' | 'drop' = 'add',
  lookbackHours: number = 24,
  limit: number = 25,
): Promise<SleeperTrendingPlayer[]> {
  try {
    const response = await sleeperFetch(
      `${SLEEPER_API_BASE}/players/${sport}/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`,
    );
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

export async function getTrendingAdds(
  sport: string = 'nfl',
  lookbackHours: number = 24,
  limit: number = 50,
): Promise<SleeperTrendingPlayer[]> {
  return getTrendingPlayers(sport, 'add', lookbackHours, limit);
}

export async function getTrendingDrops(
  sport: string = 'nfl',
  lookbackHours: number = 24,
  limit: number = 50,
): Promise<SleeperTrendingPlayer[]> {
  return getTrendingPlayers(sport, 'drop', lookbackHours, limit);
}

export interface TrendingPlayerEnriched {
  sleeperId: string;
  name: string | null;
  position: string | null;
  team: string | null;
  addCount: number;
  dropCount: number;
  netTrend: number;
  addRank: number | null;
  dropRank: number | null;
  crowdSignal: 'hot_add' | 'hot_drop' | 'rising' | 'falling' | 'neutral';
  crowdScore: number;
  fetchedAt: Date;
}

let sleeperPlayersCache: { data: Record<string, { full_name: string; position: string; team: string }>; ts: number } | null = null;
const SLEEPER_PLAYERS_CACHE_TTL = 6 * 60 * 60 * 1000;

async function getCachedSleeperPlayersMap(sport: string = 'nfl'): Promise<Record<string, { full_name: string; position: string; team: string }> | null> {
  if (sleeperPlayersCache && Date.now() - sleeperPlayersCache.ts < SLEEPER_PLAYERS_CACHE_TTL) {
    return sleeperPlayersCache.data;
  }
  try {
    const res = await sleeperFetch(`${SLEEPER_API_BASE}/players/${sport}`, SLEEPER_PLAYER_MAP_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    sleeperPlayersCache = { data, ts: Date.now() };
    return data;
  } catch {
    return null;
  }
}

export async function getEnrichedTrendingPlayers(
  sport: string = 'nfl',
  lookbackHours: number = 24,
): Promise<TrendingPlayerEnriched[]> {
  const [adds, drops] = await Promise.all([
    getTrendingAdds(sport, lookbackHours, 50),
    getTrendingDrops(sport, lookbackHours, 50),
  ]);

  const addMap = new Map<string, { count: number; rank: number }>();
  adds.forEach((p, i) => addMap.set(p.player_id, { count: p.count, rank: i + 1 }));

  const dropMap = new Map<string, { count: number; rank: number }>();
  drops.forEach((p, i) => dropMap.set(p.player_id, { count: p.count, rank: i + 1 }));

  const allPlayerIds = new Set([...addMap.keys(), ...dropMap.keys()]);

  const playerMap = await getCachedSleeperPlayersMap(sport);

  const results: TrendingPlayerEnriched[] = [];
  const now = new Date();

  for (const pid of allPlayerIds) {
    const addData = addMap.get(pid);
    const dropData = dropMap.get(pid);
    const addCount = addData?.count || 0;
    const dropCount = dropData?.count || 0;
    const netTrend = addCount - dropCount;

    const maxAdd = adds[0]?.count || 1;
    const maxDrop = drops[0]?.count || 1;
    const addPct = addCount / maxAdd;
    const dropPct = dropCount / maxDrop;

    let crowdSignal: TrendingPlayerEnriched['crowdSignal'] = 'neutral';
    let crowdScore = 50;

    if (addPct >= 0.5 && dropPct < 0.2) {
      crowdSignal = 'hot_add';
      crowdScore = 75 + addPct * 25;
    } else if (dropPct >= 0.5 && addPct < 0.2) {
      crowdSignal = 'hot_drop';
      crowdScore = 25 - dropPct * 25;
    } else if (netTrend > 0) {
      crowdSignal = 'rising';
      crowdScore = 55 + Math.min(20, addPct * 30);
    } else if (netTrend < 0) {
      crowdSignal = 'falling';
      crowdScore = 45 - Math.min(20, dropPct * 30);
    }

    const pInfo = playerMap?.[pid];

    results.push({
      sleeperId: pid,
      name: pInfo?.full_name || null,
      position: pInfo?.position || null,
      team: pInfo?.team || null,
      addCount,
      dropCount,
      netTrend,
      addRank: addData?.rank || null,
      dropRank: dropData?.rank || null,
      crowdSignal,
      crowdScore: Math.round(Math.max(0, Math.min(100, crowdScore))),
      fetchedAt: now,
    });
  }

  results.sort((a, b) => b.crowdScore - a.crowdScore);
  return results;
}

export async function getAllLeagueTrades(
  leagueId: string,
  totalWeeks: number = 18
): Promise<SleeperTransaction[]> {
  const allTrades: SleeperTransaction[] = [];
  
  for (let week = 1; week <= totalWeeks; week++) {
    const transactions = await getLeagueTransactions(leagueId, week);
    const trades = transactions.filter(t => t.type === 'trade');
    allTrades.push(...trades);
  }
  
  return allTrades.sort((a, b) => b.created - a.created);
}
