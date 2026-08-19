import { prisma } from './prisma';
import { normalizeTeamAbbrev } from './team-abbrev';
import { recordProviderSync } from './provider-sync-logger';
import { getRollingInsightsConfigFromEnv } from './provider-config';
import { ROLLING_INSIGHTS_SPORTS } from './workers/api-config';
import { rollingInsightsProvider } from './workers/providers/rolling-insights';

interface RollingInsightsToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: RollingInsightsToken | null = null;

const ROLLING_INSIGHTS_BASE_URL =
  process.env.ROLLING_INSIGHTS_BASE_URL?.trim().replace(/\/+$/, '') ||
  process.env.ROLLING_INSIGHTS_API_BASE?.trim().replace(/\/+$/, '') ||
  'https://datafeeds.rolling-insights.com'
const AUTH_URL = `${ROLLING_INSIGHTS_BASE_URL}/auth/token`;
const GRAPHQL_URL = `${ROLLING_INSIGHTS_BASE_URL}/graphql`;

function asObj(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeRITeam(raw: unknown): RITeam | null {
  const obj = asObj(raw);
  if (!obj) return null;

  const id = asString(obj.id ?? obj.team_id ?? obj.teamId ?? obj.externalId);
  const teamName = asString(obj.team ?? obj.name ?? obj.full_name ?? obj.city_name);
  const abbrv = asString(obj.abbrv ?? obj.abbreviation ?? obj.team_abbr ?? obj.shortName);
  if (!id || !teamName || !abbrv) return null;

  return {
    id,
    team: teamName,
    abbrv,
    mascot: asString(obj.mascot) ?? '',
    img: asString(obj.img ?? obj.logo ?? obj.logo_url),
  };
}

function normalizeRIPlayer(raw: unknown): RIPlayer | null {
  const obj = asObj(raw);
  if (!obj) return null;

  const id = asString(obj.id ?? obj.player_id ?? obj.playerId ?? obj.externalId);
  const player = asString(obj.player ?? obj.full_name ?? obj.name);
  if (!id || !player) return null;

  const teamObj = asObj(obj.team);
  const teamAbbrv =
    asString(obj.team_abbr ?? obj.teamAbbr ?? obj.team_abbreviation) ??
    asString(teamObj?.abbrv ?? teamObj?.abbreviation);
  const teamId = asString(obj.team_id ?? obj.teamId) ?? asString(teamObj?.id);
  const teamName = asString(teamObj?.team ?? teamObj?.name ?? obj.team_name);
  const teamMascot = asString(teamObj?.mascot ?? obj.team_mascot);

  const seasonStatsObj = asObj(obj.season_stats) ?? asObj(obj.stats);
  const fantasyPoints = asNumber(
    seasonStatsObj?.DK_fantasy_points ?? seasonStatsObj?.fantasy_points
  );
  const fantasyPointsPerGame = asNumber(
    seasonStatsObj?.DK_fantasy_points_per_game ?? seasonStatsObj?.fantasy_points_per_game
  );
  const gamesPlayed = asNumber(seasonStatsObj?.games_played ?? seasonStatsObj?.gamesPlayed);
  const period = asString(seasonStatsObj?.period) ?? getCurrentNFLSeason();

  const regularSeason: RISeasonStats[] = seasonStatsObj
    ? [
        {
          period,
          passing_yards: asNumber(seasonStatsObj.passing_yards),
          passing_touchdowns: asNumber(seasonStatsObj.passing_touchdowns),
          passing_attempts: asNumber(seasonStatsObj.passing_attempts),
          completions: asNumber(seasonStatsObj.completions),
          interceptions: asNumber(seasonStatsObj.interceptions),
          passerRating: asNumber(seasonStatsObj.passerRating),
          rushing_yards: asNumber(seasonStatsObj.rushing_yards),
          rushing_touchdowns: asNumber(seasonStatsObj.rushing_touchdowns),
          rushing_attempts: asNumber(seasonStatsObj.rushing_attempts),
          receptions: asNumber(seasonStatsObj.receptions),
          receiving_yards: asNumber(seasonStatsObj.receiving_yards),
          receiving_touchdowns: asNumber(seasonStatsObj.receiving_touchdowns),
          targets: asNumber(seasonStatsObj.targets),
          sacks: asNumber(seasonStatsObj.sacks),
          tackles: asNumber(seasonStatsObj.tackles),
          fumbles: asNumber(seasonStatsObj.fumbles),
          fumbles_lost: asNumber(seasonStatsObj.fumbles_lost),
          DK_fantasy_points: fantasyPoints,
          DK_fantasy_points_per_game: fantasyPointsPerGame,
          games_played: gamesPlayed,
          snap_count_offense: asNumber(seasonStatsObj.snap_count_offense),
          snap_count_defense: asNumber(seasonStatsObj.snap_count_defense),
          field_goals_made: asNumber(seasonStatsObj.field_goals_made),
          field_goals_attempted: asNumber(seasonStatsObj.field_goals_attempted),
          extra_points_made: asNumber(seasonStatsObj.extra_points_made),
          extra_points_attempted: asNumber(seasonStatsObj.extra_points_attempted),
        },
      ]
    : [];

  return {
    id,
    player,
    team:
      teamAbbrv || teamId || teamName
        ? {
            id: teamId ?? teamAbbrv ?? 'UNK',
            team: teamName ?? teamAbbrv ?? 'Unknown Team',
            abbrv: teamAbbrv ?? teamName ?? 'UNK',
            mascot: teamMascot ?? '',
          }
        : null,
    number: asNumber(obj.number),
    position: asString(obj.position),
    height: asString(obj.height),
    weight: asNumber(obj.weight),
    college: asString(obj.college),
    dob: asString(obj.dob),
    img: asString(obj.img ?? obj.image ?? obj.headshot_url),
    positionCategory: asString(obj.positionCategory ?? obj.position_category),
    status: asString(obj.status),
    DK_salary: asNumber(obj.DK_salary ?? obj.dk_salary),
    regularSeason,
    postSeason: [],
  };
}

function normalizeRISchedule(raw: unknown): RIScheduleGame | null {
  const obj = asObj(raw);
  if (!obj) return null;

  const gameId = asString(obj.gameId ?? obj.game_ID ?? obj.id ?? obj.game_id ?? obj.externalId);
  const awayTeam = asString(
    obj.awayTeam ?? obj.away_team ?? obj.away_team_abbr ?? obj.away ?? obj.away_name
  );
  const homeTeam = asString(
    obj.homeTeam ?? obj.home_team ?? obj.home_team_abbr ?? obj.home ?? obj.home_name
  );
  if (!gameId || !awayTeam || !homeTeam) return null;

  const venueObj = asObj(obj.venue);
  const venueArena = asString(venueObj?.arena ?? obj.venue_name ?? obj.venue);
  const venueCity = asString(venueObj?.city ?? obj.city);
  const venueState = asString(venueObj?.state ?? obj.state);
  const venueDomeRaw = venueObj?.dome;
  const venueDome = typeof venueDomeRaw === 'boolean' ? venueDomeRaw : null;

  return {
    gameId,
    awayTeam,
    homeTeam,
    awayTeamId: asString(obj.awayTeamId ?? obj.away_team_ID ?? obj.away_team_id ?? obj.awayTeamID),
    homeTeamId: asString(obj.homeTeamId ?? obj.home_team_ID ?? obj.home_team_id ?? obj.homeTeamID),
    week: asNumber(obj.week ?? obj.weekNumber ?? obj.week_number ?? obj.period),
    date: asString(obj.date ?? obj.game_time ?? obj.start_time ?? obj.startTime) ?? new Date().toISOString(),
    status: asString(obj.status ?? obj.game_status) ?? 'scheduled',
    season: asString(obj.season) ?? getCurrentNFLSeason(),
    venue:
      venueArena || venueCity || venueState || venueDome !== null
        ? {
            arena: venueArena,
            city: venueCity,
            state: venueState,
            dome: venueDome,
          }
        : null,
  };
}

async function fetchRollingInsightsRest<T>(
  dataType: 'players' | 'teams' | 'schedule',
  options: Record<string, unknown>,
  mapFn: (value: unknown) => T | null
): Promise<T[] | null> {
  const result = await rollingInsightsProvider({
    sport: 'NFL',
    dataType,
    query: options,
  });

  if (!Array.isArray(result.data)) return null;
  const normalized: T[] = [];
  for (const row of result.data) {
    const mapped = mapFn(row);
    if (mapped) normalized.push(mapped);
  }
  return normalized;
}

function getEnabledRollingInsightsSports() {
  return {
    NFL: ROLLING_INSIGHTS_SPORTS.NFL,
    NHL: ROLLING_INSIGHTS_SPORTS.NHL,
    NBA: ROLLING_INSIGHTS_SPORTS.NBA,
    MLB: ROLLING_INSIGHTS_SPORTS.MLB,
    NCAAF: ROLLING_INSIGHTS_SPORTS.NCAAF,
    NCAAB: ROLLING_INSIGHTS_SPORTS.NCAAB,
    SOCCER: ROLLING_INSIGHTS_SPORTS.SOCCER,
  };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.accessToken;
  }

  const credentialPairs = [
    {
      clientId: process.env.ROLLING_INSIGHTS_CLIENT_ID?.trim() || '',
      clientSecret: process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim() || '',
    },
    {
      clientId: process.env.ROLLING_INSIGHTS_CLIENT_ID2?.trim() || '',
      clientSecret: process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim() || '',
    },
  ].filter((pair) => pair.clientId && pair.clientSecret)
  const directApiKey = process.env.ROLLING_INSIGHTS_API_KEY?.trim();

  if (!credentialPairs.length) {
    if (directApiKey) {
      return directApiKey;
    }
    throw new Error('Rolling Insights credentials not configured');
  }

  let lastStatus: number | null = null

  for (const { clientId, clientSecret } of credentialPairs) {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    lastStatus = response.status
    if (!response.ok) {
      continue
    }

    const data = await response.json();
    if (!data.access_token) {
      continue
    }

    cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };

    return cachedToken.accessToken;
  }

  if (directApiKey) {
    return directApiKey;
  }

  throw new Error(`Rolling Insights auth failed: ${lastStatus ?? 'unknown'}`);
}

/** Exported for `SportsDataService` / internal GraphQL gateway — same auth + endpoint as DataFeeds. */
export async function rollingInsightsGraphqlQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return graphqlQuery<T>(query, variables)
}

async function graphqlQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Rolling Insights GraphQL request failed: ${response.status}`);
  }

  const result = await response.json();

  if (result.errors?.length) {
    console.error('[RollingInsights] GraphQL errors:', JSON.stringify(result.errors));
    throw new Error(`GraphQL error: ${result.errors[0].message}`);
  }

  return result.data as T;
}

export interface RIPlayer {
  id: string;
  player: string;
  team: { id: string; team: string; abbrv: string; mascot: string } | null;
  number: number | null;
  position: string | null;
  height: string | null;
  weight: number | null;
  college: string | null;
  dob: string | null;
  img: string | null;
  positionCategory: string | null;
  status: string | null;
  DK_salary: number | null;
  regularSeason: RISeasonStats[];
  postSeason: RISeasonStats[];
}

export interface RISeasonStats {
  period: string;
  passing_yards: number | null;
  passing_touchdowns: number | null;
  passing_attempts: number | null;
  completions: number | null;
  interceptions: number | null;
  passerRating: number | null;
  rushing_yards: number | null;
  rushing_touchdowns: number | null;
  rushing_attempts: number | null;
  receptions: number | null;
  receiving_yards: number | null;
  receiving_touchdowns: number | null;
  targets: number | null;
  sacks: number | null;
  tackles: number | null;
  fumbles: number | null;
  fumbles_lost: number | null;
  DK_fantasy_points: number | null;
  DK_fantasy_points_per_game: number | null;
  games_played: number | null;
  snap_count_offense: number | null;
  snap_count_defense: number | null;
  field_goals_made: number | null;
  field_goals_attempted: number | null;
  extra_points_made: number | null;
  extra_points_attempted: number | null;
}

export interface RITeam {
  id: string;
  team: string;
  abbrv: string;
  mascot: string;
  img: string | null;
}

export interface RIScheduleGame {
  gameId: string;
  awayTeam: string;
  homeTeam: string;
  awayTeamId?: string | null;
  homeTeamId?: string | null;
  week?: number | null;
  date: string;
  status: string;
  season: string;
  venue: {
    arena: string | null;
    city: string | null;
    state: string | null;
    dome: boolean | null;
  } | null;
}

const PLAYER_FIELDS = `
  id player
  team { id team abbrv mascot }
  number position height weight college dob img
  positionCategory status DK_salary
  regularSeason {
    period passing_yards passing_touchdowns passing_attempts completions
    interceptions rushing_yards rushing_touchdowns rushing_attempts
    receptions receiving_yards receiving_touchdowns targets sacks tackles
    fumbles fumbles_lost DK_fantasy_points DK_fantasy_points_per_game
    games_played snap_count_offense snap_count_defense
    field_goals_made field_goals_attempted extra_points_made extra_points_attempted
  }
  postSeason {
    period passing_yards passing_touchdowns passing_attempts completions
    interceptions rushing_yards rushing_touchdowns rushing_attempts
    receptions receiving_yards receiving_touchdowns targets sacks tackles
    fumbles fumbles_lost DK_fantasy_points DK_fantasy_points_per_game
    games_played snap_count_offense snap_count_defense
    field_goals_made field_goals_attempted extra_points_made extra_points_attempted
  }
`;

/**
 * E.2.6 — quality gate for REST `player-info/NFL` responses.
 *
 * The Rolling Insights REST `player-info/NFL` endpoint can return a "historical"
 * dictionary of every NFL player ever (8k+ rows) with `team = null` and no
 * `regularSeason` blocks — clearly unusable for a current draft pool. When that
 * happens we want to fall through to the GraphQL `nflRoster` query, which returns
 * current rosters with DK_fantasy_points + rushing/receiving/passing splits.
 *
 * A REST payload is "useful" iff at least 25% of rows have a real team. Stats
 * coverage is tracked separately (see `withRegularSeason` / `withFantasyPoints`)
 * but does not gate the REST/GraphQL choice — Rolling Insights returns season
 * splits via a different endpoint (`player-stats/{year}/NFL`), not via the
 * roster query, so a stats-less roster can still drive identity-map + SportsPlayer
 * backfill. Empty REST → fall through (existing behavior). Historical REST
 * (team=null) → fall through (new behavior, the fix).
 *
 * Returns a small struct so audit / debug callers can see why the gate fired.
 */
export interface NFLRosterPayloadQuality {
  useful: boolean
  total: number
  withRealTeam: number
  withRegularSeason: number
  withFantasyPoints: number
  reason: string
}

export function isUsefulNFLRosterPayload(
  players: readonly RIPlayer[] | null | undefined,
): NFLRosterPayloadQuality {
  const total = Array.isArray(players) ? players.length : 0
  if (!total) {
    return {
      useful: false,
      total: 0,
      withRealTeam: 0,
      withRegularSeason: 0,
      withFantasyPoints: 0,
      reason: 'empty payload',
    }
  }

  let withRealTeam = 0
  let withRegularSeason = 0
  let withFantasyPoints = 0
  for (const p of players!) {
    const teamAbbr = (p.team?.abbrv ?? '').trim().toUpperCase()
    if (teamAbbr && teamAbbr !== 'UNK' && teamAbbr !== 'UNKNOWN' && teamAbbr !== 'FA') {
      withRealTeam++
    }
    const season = Array.isArray(p.regularSeason) ? p.regularSeason[0] : null
    if (season) {
      withRegularSeason++
      if (season.DK_fantasy_points != null) withFantasyPoints++
    }
  }

  // Threshold: want at least 25% of rows on a real current team. The historical
  // dump is essentially 0% — this comfortably distinguishes the two shapes
  // without false-rejecting trimmed valid rosters. Stats coverage is INFORMATIONAL
  // (audit surfaces it) — it does not gate REST↔GraphQL fallback.
  const teamRatio = withRealTeam / total
  const useful = teamRatio >= 0.25

  let reason = 'ok'
  if (useful && withRegularSeason === 0) {
    reason = `useful (current rosters) but no regularSeason blocks — stats live on a separate endpoint`
  } else if (!useful) {
    reason = `historical-shape: only ${withRealTeam}/${total} rows have a real team (need >=25%)`
  }

  return { useful, total, withRealTeam, withRegularSeason, withFantasyPoints, reason }
}

/** Last quality probe captured by `fetchNFLRoster`. Read by the audit script for diagnostics. */
export interface FetchNFLRosterAttempt {
  source: 'rest' | 'graphql'
  attempted: boolean
  returned: number
  quality?: NFLRosterPayloadQuality
}

export interface FetchNFLRosterTrace {
  rest: FetchNFLRosterAttempt
  graphql: FetchNFLRosterAttempt
  finalSource: 'rest' | 'graphql' | 'none'
}

let lastFetchNFLRosterTrace: FetchNFLRosterTrace | null = null

export function getLastFetchNFLRosterTrace(): FetchNFLRosterTrace | null {
  return lastFetchNFLRosterTrace
}

export async function fetchNFLRoster(options: {
  season?: string;
  playerName?: string;
  teamId?: string;
  limit?: number;
}): Promise<RIPlayer[]> {
  const trace: FetchNFLRosterTrace = {
    rest: { source: 'rest', attempted: true, returned: 0 },
    graphql: { source: 'graphql', attempted: false, returned: 0 },
    finalSource: 'none',
  }

  // E.2.6 — Default the season to RI's "YYYY-YYYY" format (e.g. "2025-2026"). The
  // GraphQL `nflRoster` query without a season returns the full ~9k historical
  // archive (every player ever) without team or stats; passing season filters
  // down to the current ~1.9k roster. Plain "2025" is rejected by RI (returns 0)
  // so we coerce to "2025-2026" automatically.
  const normalizedSeason =
    options.season && /^\d{4}$/.test(options.season.trim())
      ? `${options.season.trim()}-${Number(options.season.trim()) + 1}`
      : options.season ?? getCurrentNFLSeason()
  const effectiveOptions = { ...options, season: normalizedSeason }

  const restRoster = await fetchRollingInsightsRest('players', effectiveOptions, normalizeRIPlayer);
  trace.rest.returned = Array.isArray(restRoster) ? restRoster.length : 0

  if (Array.isArray(restRoster) && restRoster.length > 0) {
    const quality = isUsefulNFLRosterPayload(restRoster)
    trace.rest.quality = quality
    if (quality.useful) {
      trace.finalSource = 'rest'
      lastFetchNFLRosterTrace = trace
      return restRoster
    }
    console.warn(
      `[RollingInsights] REST NFL roster not useful (${quality.reason}); falling back to GraphQL`,
    )
  }

  const args: string[] = [];
  if (effectiveOptions.season) args.push(`season: "${effectiveOptions.season}"`);
  if (effectiveOptions.playerName) args.push(`playerName: "${effectiveOptions.playerName}"`);
  if (effectiveOptions.teamId) args.push(`teamId: "${effectiveOptions.teamId}"`);
  if (effectiveOptions.limit) args.push(`limit: ${effectiveOptions.limit}`);

  const argsStr = args.length ? `(${args.join(', ')})` : '';
  const query = `{ nflRoster${argsStr} { ${PLAYER_FIELDS} } }`;

  trace.graphql.attempted = true
  let gqlPlayers: RIPlayer[] = []
  try {
    const data = await graphqlQuery<{ nflRoster: RIPlayer[] }>(query);
    gqlPlayers = (data.nflRoster ?? []).map((raw) => normalizeRIPlayer(raw) ?? raw).filter(Boolean) as RIPlayer[]
  } catch (err) {
    console.warn(
      `[RollingInsights] GraphQL nflRoster failed:`,
      err instanceof Error ? err.message : err,
    )
  }
  trace.graphql.returned = gqlPlayers.length
  trace.graphql.quality = isUsefulNFLRosterPayload(gqlPlayers)
  trace.finalSource = gqlPlayers.length ? 'graphql' : 'none'
  lastFetchNFLRosterTrace = trace
  return gqlPlayers
}

export async function fetchNFLTeams(): Promise<RITeam[]> {
  const restTeams = await fetchRollingInsightsRest('teams', {}, normalizeRITeam);
  if (Array.isArray(restTeams) && restTeams.length > 0) {
    return restTeams;
  }

  const query = `{ nflTeams { id team abbrv mascot img } }`;
  const data = await graphqlQuery<{ nflTeams: RITeam[] }>(query);
  return data.nflTeams || [];
}

export async function fetchNFLSchedule(options: {
  season?: string;
  limit?: number;
}): Promise<RIScheduleGame[]> {
  const restSchedule = await fetchRollingInsightsRest('schedule', options, normalizeRISchedule);
  if (Array.isArray(restSchedule) && restSchedule.length > 0) {
    return restSchedule;
  }

  const args: string[] = [];
  if (options.season) args.push(`season: "${options.season}"`);
  if (options.limit) args.push(`limit: ${options.limit}`);

  const argsStr = args.length ? `(${args.join(', ')})` : '';
  const query = `{ nflSchedules${argsStr} { gameId awayTeam homeTeam date status season venue { arena city state dome } } }`;

  const data = await graphqlQuery<{ nflSchedules: RIScheduleGame[] }>(query);
  return data.nflSchedules || [];
}

export async function searchNFLPlayer(name: string): Promise<RIPlayer[]> {
  return fetchNFLRoster({ playerName: name, limit: 10 });
}

function getCurrentNFLSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 3) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

export async function syncNFLTeamsToDb(): Promise<number> {
  const teams = await fetchNFLTeams();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  let synced = 0;
  for (const team of teams) {
    await prisma.sportsTeam.upsert({
      where: {
        sport_externalId_source: {
          sport: 'NFL',
          externalId: team.id,
          source: 'rolling_insights',
        },
      },
      update: {
        name: team.team,
        shortName: team.abbrv,
        city: team.team.replace(` ${team.mascot}`, ''),
        logo: team.img,
        fetchedAt: new Date(),
        expiresAt,
      },
      create: {
        sport: 'NFL',
        externalId: team.id,
        name: team.team,
        shortName: team.abbrv,
        city: team.team.replace(` ${team.mascot}`, ''),
        logo: team.img,
        source: 'rolling_insights',
        fetchedAt: new Date(),
        expiresAt,
      },
    });
    synced++;
  }

  return synced;
}

export async function syncNFLPlayersToDb(options?: { season?: string }): Promise<number> {
  const season = options?.season || getCurrentNFLSeason();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const teams = await fetchNFLTeams();

  let synced = 0;

  const TEAM_BATCH_SIZE = 4;
  for (let i = 0; i < teams.length; i += TEAM_BATCH_SIZE) {
    const batch = teams.slice(i, i + TEAM_BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (team) => {
        let teamSynced = 0;
        try {
          const players = await fetchNFLRoster({ season, teamId: team.id });

          for (const player of players) {
            await prisma.sportsPlayer.upsert({
              where: {
                sport_externalId_source: {
                  sport: 'NFL',
                  externalId: player.id,
                  source: 'rolling_insights',
                },
              },
              update: {
                name: player.player,
                position: player.position,
                team: normalizeTeamAbbrev(player.team?.abbrv) || null,
                teamId: player.team?.id || null,
                number: player.number,
                height: player.height,
                weight: player.weight ? String(player.weight) : null,
                college: player.college,
                imageUrl: player.img || null,
                dob: player.dob || null,
                status: player.status || null,
                fetchedAt: new Date(),
                expiresAt,
              },
              create: {
                sport: 'NFL',
                externalId: player.id,
                name: player.player,
                position: player.position,
                team: normalizeTeamAbbrev(player.team?.abbrv) || null,
                teamId: player.team?.id || null,
                number: player.number,
                height: player.height,
                weight: player.weight ? String(player.weight) : null,
                college: player.college,
                imageUrl: player.img || null,
                dob: player.dob || null,
                status: player.status || null,
                source: 'rolling_insights',
                fetchedAt: new Date(),
                expiresAt,
              },
            });

            if (player.regularSeason?.length) {
              for (const stats of player.regularSeason) {
                await prisma.playerSeasonStats.upsert({
                  where: {
                    sport_playerId_season_seasonType_source: {
                      sport: 'NFL',
                      playerId: player.id,
                      season: stats.period,
                      seasonType: 'regular',
                      source: 'rolling_insights',
                    },
                  },
                  update: {
                    playerName: player.player,
                    position: player.position,
                    team: player.team?.abbrv || null,
                    stats: stats as unknown as object,
                    gamesPlayed: stats.games_played,
                    fantasyPoints: stats.DK_fantasy_points,
                    fantasyPointsPerGame: stats.DK_fantasy_points_per_game,
                    fetchedAt: new Date(),
                    expiresAt,
                  },
                  create: {
                    sport: 'NFL',
                    playerId: player.id,
                    playerName: player.player,
                    season: stats.period,
                    seasonType: 'regular',
                    position: player.position,
                    team: player.team?.abbrv || null,
                    stats: stats as unknown as object,
                    gamesPlayed: stats.games_played,
                    fantasyPoints: stats.DK_fantasy_points,
                    fantasyPointsPerGame: stats.DK_fantasy_points_per_game,
                    source: 'rolling_insights',
                    fetchedAt: new Date(),
                    expiresAt,
                  },
                });
              }
            }

            if (player.postSeason?.length) {
              for (const stats of player.postSeason) {
                await prisma.playerSeasonStats.upsert({
                  where: {
                    sport_playerId_season_seasonType_source: {
                      sport: 'NFL',
                      playerId: player.id,
                      season: stats.period,
                      seasonType: 'postseason',
                      source: 'rolling_insights',
                    },
                  },
                  update: {
                    playerName: player.player,
                    position: player.position,
                    team: player.team?.abbrv || null,
                    stats: stats as unknown as object,
                    gamesPlayed: stats.games_played,
                    fantasyPoints: stats.DK_fantasy_points,
                    fantasyPointsPerGame: stats.DK_fantasy_points_per_game,
                    fetchedAt: new Date(),
                    expiresAt,
                  },
                  create: {
                    sport: 'NFL',
                    playerId: player.id,
                    playerName: player.player,
                    season: stats.period,
                    seasonType: 'postseason',
                    position: player.position,
                    team: player.team?.abbrv || null,
                    stats: stats as unknown as object,
                    gamesPlayed: stats.games_played,
                    fantasyPoints: stats.DK_fantasy_points,
                    fantasyPointsPerGame: stats.DK_fantasy_points_per_game,
                    source: 'rolling_insights',
                    fetchedAt: new Date(),
                    expiresAt,
                  },
                });
              }
            }

            teamSynced++;
          }
        } catch (err) {
          console.error(`[RollingInsights] Failed to sync players for ${team.team}:`, err);
          }
          await recordProviderSync(
            { provider: 'rolling_insights', entityType: 'player', sport: 'NFL', key: team.id, sourcePriority: 0 },
            { recordsImported: teamSynced },
          );
          return teamSynced;
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') synced += result.value;
    }
  }

  return synced;
}

export async function syncNFLScheduleToDb(options?: { season?: string }): Promise<number> {
  const season = options?.season || getCurrentNFLSeason();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

  const games = await fetchNFLSchedule({ season });

  let synced = 0;
  for (const game of games) {
    await prisma.sportsGame.upsert({
      where: {
        sport_externalId_source: {
          sport: 'NFL',
          externalId: game.gameId,
          source: 'rolling_insights',
        },
      },
      update: {
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        status: game.status,
        startTime: game.date ? new Date(game.date) : null,
        venue: game.venue?.arena || null,
        season: parseInt(game.season.split('-')[0]),
        fetchedAt: new Date(),
        expiresAt,
      },
      create: {
        sport: 'NFL',
        externalId: game.gameId,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        status: game.status,
        startTime: game.date ? new Date(game.date) : null,
        venue: game.venue?.arena || null,
        season: parseInt(game.season.split('-')[0]),
        source: 'rolling_insights',
        fetchedAt: new Date(),
        expiresAt,
      },
    });
    synced++;
  }

  return synced;
}

// ── Depth Charts ──

export interface RIDepthChartPlayer {
  id: string;
  player: string;
  position: string | null;
  number: number | null;
  status: string | null;
  img: string | null;
}

export interface RIDepthChart {
  team: string;
  teamId: string;
  abbrv: string;
  positions: Record<string, RIDepthChartPlayer[]>;
}

export function normalizeRIDepthChartPlayers(
  position: string,
  players: unknown,
): RIDepthChartPlayer[] {
  if (!Array.isArray(players)) return [];

  const normalized: RIDepthChartPlayer[] = [];
  for (const raw of players) {
    const obj = asObj(raw);
    if (!obj) continue;

    const id = asString(obj.id ?? obj.player_id ?? obj.playerId);
    const player = asString(obj.player ?? obj.name ?? obj.full_name);
    if (!id || !player) continue;

    normalized.push({
      id,
      player,
      position: asString(obj.position) ?? position,
      number: asNumber(obj.number),
      status: asString(obj.status),
      img: asString(obj.img),
    });
  }

  return normalized;
}

const DEPTH_CHART_POSITIONS = [
  'QB', 'RB', 'WR', 'WR1', 'WR2', 'WR3', 'TE', 'K', 'P',
  'LT', 'LG', 'C', 'RG', 'RT', 'FB',
  'DE', 'DT', 'LB', 'CB', 'S', 'SS', 'FS',
  'EDGE', 'ILB', 'OLB', 'NT', 'DL',
  'KR', 'PR', 'LS',
];

const DEPTH_CHART_FIELDS = DEPTH_CHART_POSITIONS.map(
  (pos) => `${pos} { id player position number status img }`
).join('\n    ');

export async function fetchNFLDepthCharts(options?: {
  teamName?: string;
  season?: string;
}): Promise<RIDepthChart[]> {
  const args: string[] = [];
  if (options?.teamName) args.push(`teamName: "${options.teamName}"`);
  if (options?.season) args.push(`season: "${options.season}"`);

  const argsStr = args.length ? `(${args.join(', ')})` : '';

  const query = `{
    nflTeams${argsStr} {
      id team abbrv
      rosterByPosition {
        ${DEPTH_CHART_FIELDS}
      }
    }
  }`;

  const data = await graphqlQuery<{
    nflTeams: Array<{
      id: string;
      team: string;
      abbrv: string;
      rosterByPosition: Record<string, any[] | null> | null;
    }>;
  }>(query);

  return (data.nflTeams || []).flatMap((t) => {
    if (!t) return [];

    const positions: Record<string, RIDepthChartPlayer[]> = {};
    if (t.rosterByPosition) {
      for (const [pos, players] of Object.entries(t.rosterByPosition)) {
        const normalizedPlayers = normalizeRIDepthChartPlayers(pos, players);
        if (normalizedPlayers.length > 0) positions[pos] = normalizedPlayers;
      }
    }
    return [{ team: t.team, teamId: t.id, abbrv: t.abbrv, positions }];
  });
}

// ── Team Season Stats ──

export interface RITeamSeasonStats {
  period: string;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points: number | null;
  totalYards: number | null;
  passingYards: number | null;
  rushingYards: number | null;
  turnovers: number | null;
  sacks: number | null;
  firstDowns: number | null;
  penalties: number | null;
  penaltyYards: number | null;
  gamesPlayed: number | null;
  DK_fantasy_points: number | null;
  DK_fantasy_points_per_game: number | null;
  passingTouchdowns: number | null;
  rushingTouchdowns: number | null;
  defenseTouchdowns: number | null;
  defenseInterceptions: number | null;
  totalPassingYardsAllowed: number | null;
  totalRushingYardsAllowed: number | null;
  pointsAgainstDST: number | null;
}

export interface RITeamFull {
  id: string;
  team: string;
  abbrv: string;
  mascot: string;
  img: string | null;
  conf: string | null;
  city: string | null;
  state: string | null;
  arena: string | null;
  dome: boolean | null;
  bye: Array<{ period: string; value: number | null }>;
  injuries: Array<{
    injury: string | null;
    player: string | null;
    returns: string | null;
    playerId: string | null;
    date: string | null;
  }>;
  record: Array<{
    period: string;
    regular: { wins: number; losses: number; ties: number } | null;
    wildcard: { wins: number; losses: number; ties: number } | null;
  }>;
  regularSeason: RITeamSeasonStats[];
  postSeason: RITeamSeasonStats[];
}

const TEAM_SEASON_STATS_FIELDS = `
  period
  wins losses ties
  points total_yards passing_yards rushing_yards turnovers sacks
  first_downs penalties penalty_yards games_played
  DK_fantasy_points DK_fantasy_points_per_game
  passing_touchdowns rushing_touchdowns defense_touchdowns
  defense_interceptions total_passing_yards_allowed total_rushing_yards_allowed
  points_against_defense_special_teams
  offense_touchdowns receiving_touchdowns special_team_touchdowns
  safeties blocked_kicks blocked_punts
  kick_return_touchdowns punt_return_touchdowns
  interception_touchdowns fumble_return_touchdowns defense_fumble_recoveries
`;

export async function fetchNFLTeamsFull(options?: {
  teamName?: string;
  season?: string;
}): Promise<RITeamFull[]> {
  const args: string[] = [];
  if (options?.teamName) args.push(`teamName: "${options.teamName}"`);
  if (options?.season) args.push(`season: "${options.season}"`);

  const argsStr = args.length ? `(${args.join(', ')})` : '';

  const query = `{
    nflTeams${argsStr} {
      id team abbrv mascot img
      conf city state arena dome
      bye { period value }
      injuries { injury player returns playerId date }
      record { period regular { wins losses ties } wildcard { wins losses ties } }
      regularSeason { ${TEAM_SEASON_STATS_FIELDS} }
      postSeason { ${TEAM_SEASON_STATS_FIELDS} }
    }
  }`;

  const data = await graphqlQuery<{ nflTeams: any[] }>(query);

  return (data.nflTeams || []).map((t) => ({
    id: t.id,
    team: t.team,
    abbrv: t.abbrv,
    mascot: t.mascot,
    img: t.img,
    conf: t.conf ?? null,
    city: t.city ?? null,
    state: t.state ?? null,
    arena: t.arena ?? null,
    dome: t.dome ?? null,
    bye: t.bye || [],
    injuries: t.injuries || [],
    record: t.record || [],
    regularSeason: (t.regularSeason || []).map(mapTeamSeasonStats),
    postSeason: (t.postSeason || []).map(mapTeamSeasonStats),
  }));
}

function mapTeamSeasonStats(s: any): RITeamSeasonStats {
  return {
    period: s.period,
    wins: s.wins ?? null,
    losses: s.losses ?? null,
    ties: s.ties ?? null,
    points: s.points ?? null,
    totalYards: s.total_yards ?? null,
    passingYards: s.passing_yards ?? null,
    rushingYards: s.rushing_yards ?? null,
    turnovers: s.turnovers ?? null,
    sacks: s.sacks ?? null,
    firstDowns: s.first_downs ?? null,
    penalties: s.penalties ?? null,
    penaltyYards: s.penalty_yards ?? null,
    gamesPlayed: s.games_played ?? null,
    DK_fantasy_points: s.DK_fantasy_points ?? null,
    DK_fantasy_points_per_game: s.DK_fantasy_points_per_game ?? null,
    passingTouchdowns: s.passing_touchdowns ?? null,
    rushingTouchdowns: s.rushing_touchdowns ?? null,
    defenseTouchdowns: s.defense_touchdowns ?? null,
    defenseInterceptions: s.defense_interceptions ?? null,
    totalPassingYardsAllowed: s.total_passing_yards_allowed ?? null,
    totalRushingYardsAllowed: s.total_rushing_yards_allowed ?? null,
    pointsAgainstDST: s.points_against_defense_special_teams ?? null,
  };
}

// ── Enhanced Player Fields ──

export interface RIPlayerEnhanced extends RIPlayer {
  injury: {
    injury: string | null;
    returns: string | null;
    date: string | null;
  } | null;
  formerTeams: Array<{ period: string; teamNames: string[] }>;
  allStar: Array<{ period: string; count: number }>;
}

const PLAYER_ENHANCED_FIELDS = `
  id player
  team { id team abbrv mascot }
  number position height weight college dob img
  positionCategory status DK_salary
  injury { injury player returns date }
  formerTeams { period teamNames }
  allStar { period count }
  regularSeason {
    period passing_yards passing_touchdowns passing_attempts completions
    interceptions rushing_yards rushing_touchdowns rushing_attempts
    receptions receiving_yards receiving_touchdowns targets sacks tackles
    fumbles fumbles_lost DK_fantasy_points DK_fantasy_points_per_game
    games_played snap_count_offense snap_count_defense snap_count_special_teams
    field_goals_made field_goals_attempted extra_points_made extra_points_attempted
    punts punts_long punting_yards inside_20
    punt_returns punt_return_yards punt_return_touchdowns
    kick_return_touchdowns
  }
  postSeason {
    period passing_yards passing_touchdowns passing_attempts completions
    interceptions rushing_yards rushing_touchdowns rushing_attempts
    receptions receiving_yards receiving_touchdowns targets sacks tackles
    fumbles fumbles_lost DK_fantasy_points DK_fantasy_points_per_game
    games_played snap_count_offense snap_count_defense snap_count_special_teams
    field_goals_made field_goals_attempted extra_points_made extra_points_attempted
    punts punts_long punting_yards inside_20
    punt_returns punt_return_yards punt_return_touchdowns
    kick_return_touchdowns
  }
`;

export async function fetchNFLRosterEnhanced(options: {
  season?: string;
  playerName?: string;
  teamId?: string;
  limit?: number;
}): Promise<RIPlayerEnhanced[]> {
  const args: string[] = [];
  if (options.season) args.push(`season: "${options.season}"`);
  if (options.playerName) args.push(`playerName: "${options.playerName}"`);
  if (options.teamId) args.push(`teamId: "${options.teamId}"`);
  if (options.limit) args.push(`limit: ${options.limit}`);

  const argsStr = args.length ? `(${args.join(', ')})` : '';
  const query = `{ nflRoster${argsStr} { ${PLAYER_ENHANCED_FIELDS} } }`;

  const data = await graphqlQuery<{ nflRoster: RIPlayerEnhanced[] }>(query);
  return data.nflRoster || [];
}

// ── Sync Functions ──

export async function syncNFLDepthChartsToDb(options?: { season?: string }): Promise<number> {
  const season = options?.season || getCurrentNFLSeason();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

  let charts: RIDepthChart[];
  try {
    charts = await fetchNFLDepthCharts({ season });
  } catch (error) {
    console.error('[RollingInsights] Failed to fetch depth charts:', error);
    return 0;
  }

  let synced = 0;
  for (const chart of charts) {
    const team = normalizeTeamAbbrev(chart.abbrv) || chart.abbrv;

    for (const [position, players] of Object.entries(chart.positions)) {
      if (!players.length) continue;

      try {
        await prisma.depthChart.upsert({
          where: {
            sport_team_position_source: {
              sport: 'NFL',
              team,
              position,
              source: 'rolling_insights',
            },
          },
          update: {
            teamId: chart.teamId,
            players: players as unknown as object,
            season,
            fetchedAt: new Date(),
            expiresAt,
          },
          create: {
            sport: 'NFL',
            team,
            teamId: chart.teamId,
            position,
            players: players as unknown as object,
            source: 'rolling_insights',
            season,
            fetchedAt: new Date(),
            expiresAt,
          },
        });
        synced++;
      } catch (err) {
        console.error(`[RollingInsights] Failed to sync depth chart ${team}/${position}:`, err);
      }
    }
  }

  console.log(`[RollingInsights] Synced ${synced} depth chart entries`);
  return synced;
}

export async function syncNFLTeamStatsToDb(options?: { season?: string }): Promise<number> {
  const season = options?.season || getCurrentNFLSeason();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let teams: RITeamFull[];
  try {
    teams = await fetchNFLTeamsFull({ season });
  } catch (error) {
    console.error('[RollingInsights] Failed to fetch team stats:', error);
    return 0;
  }

  let synced = 0;
  for (const team of teams) {
    const abbrev = normalizeTeamAbbrev(team.abbrv) || team.abbrv;

    if (team.conf || team.dome !== null || team.arena) {
      try {
        await prisma.sportsTeam.updateMany({
          where: { sport: 'NFL', shortName: abbrev, source: 'rolling_insights' },
          data: {
            conference: team.conf || undefined,
          },
        });
      } catch {}
    }

    const allStats = [
      ...team.regularSeason.map((s) => ({ ...s, type: 'regular' as const })),
      ...team.postSeason.map((s) => ({ ...s, type: 'postseason' as const })),
    ];

    for (const stats of allStats) {
      try {
        await prisma.teamSeasonStats.upsert({
          where: {
            sport_team_season_seasonType_source: {
              sport: 'NFL',
              team: abbrev,
              season: stats.period,
              seasonType: stats.type,
              source: 'rolling_insights',
            },
          },
          update: {
            teamId: team.id,
            stats: stats as unknown as object,
            wins: stats.wins,
            losses: stats.losses,
            ties: stats.ties,
            pointsFor: stats.points,
            totalYards: stats.totalYards,
            passingYards: stats.passingYards,
            rushingYards: stats.rushingYards,
            turnovers: stats.turnovers,
            sacks: stats.sacks,
            fantasyPoints: stats.DK_fantasy_points,
            gamesPlayed: stats.gamesPlayed,
            fetchedAt: new Date(),
            expiresAt,
          },
          create: {
            sport: 'NFL',
            team: abbrev,
            teamId: team.id,
            season: stats.period,
            seasonType: stats.type,
            stats: stats as unknown as object,
            wins: stats.wins,
            losses: stats.losses,
            ties: stats.ties,
            pointsFor: stats.points,
            totalYards: stats.totalYards,
            passingYards: stats.passingYards,
            rushingYards: stats.rushingYards,
            turnovers: stats.turnovers,
            sacks: stats.sacks,
            fantasyPoints: stats.DK_fantasy_points,
            gamesPlayed: stats.gamesPlayed,
            source: 'rolling_insights',
            fetchedAt: new Date(),
            expiresAt,
          },
        });
        synced++;
      } catch (err) {
        console.error(`[RollingInsights] Failed to sync team stats ${abbrev}/${stats.period}:`, err);
      }
    }
  }

  console.log(`[RollingInsights] Synced ${synced} team season stats entries`);
  return synced;
}

export interface RollingInsightsHealthCheck {
  configured: boolean;
  available: boolean;
  latencyMs?: number;
  error?: string;
  authMode?: 'api_key' | 'client_credentials';
  enabledSports: ReturnType<typeof getEnabledRollingInsightsSports>;
}

export async function runRollingInsightsHealthCheck(): Promise<RollingInsightsHealthCheck> {
  const config = getRollingInsightsConfigFromEnv();
  const enabledSports = getEnabledRollingInsightsSports();

  if (!config) {
    return {
      configured: false,
      available: false,
      enabledSports,
    };
  }

  const startedAt = Date.now();
  try {
    await graphqlQuery<{ __schema: { queryType: { name: string } } }>(
      'query RollingInsightsHealth { __schema { queryType { name } } }'
    );

    return {
      configured: true,
      available: true,
      latencyMs: Date.now() - startedAt,
      authMode: config.authMode,
      enabledSports,
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      authMode: config.authMode,
      enabledSports,
    };
  }
}

export { getCurrentNFLSeason, getAccessToken as testAuth };

/**
 * E.2.7 — fetch NFL per-player season stats from Rolling Insights
 * REST `player-stats/{year}/NFL`. This is the endpoint that returns the rich
 * `regular_season` blocks that `nflRoster` does not — DK fantasy points,
 * passing/rushing/receiving splits, games_played, etc.
 *
 * Returns rows with the exact RI shape (`player_id`, `player`, `team`,
 * `team_id`, `regular_season`, `postseason`). No normalization here — the
 * caller writes `regular_season` directly to `PlayerSeasonStats.stats` so the
 * existing `parseRollingInsightsStatsJson` consumer keeps working.
 *
 * Reuses `rollingInsightsProvider` (which already handles auth, REST/GraphQL
 * probing, and the `projections` → `player-stats/{year}/NFL` path mapping).
 */
export interface RIPlayerSeasonStatsRow {
  player_id: number | string
  player: string
  team?: string | null
  team_id?: number | string | null
  regular_season?: Record<string, number | null | undefined> | null
  postseason?: Record<string, number | null | undefined> | null
}

export async function fetchNFLPlayerStats(options: {
  season?: string
}): Promise<RIPlayerSeasonStatsRow[]> {
  // Normalize season the same way fetchNFLRoster does — RI accepts either plain
  // year (e.g. "2024") or a "YYYY-YYYY" range. The path expects a plain year, so
  // strip a trailing "-YYYY" if present.
  const seasonRaw = options.season ?? String(new Date().getUTCFullYear())
  const seasonForPath = seasonRaw.includes('-') ? seasonRaw.split('-')[0] : seasonRaw

  /*
   * ⚠ `player_stats`, NOT `projections`. Rolling Insights has no projections
   * feed at all — vendor-confirmed, and the provider's own dataType map points
   * `projections` at four candidate paths that do not exist, so every call
   * returned HTTP 400 and this function returned [].
   *
   * That was not always true. `player-stats` used to be the first candidate
   * under `projections`, which made this work by accident while also letting a
   * historical stat line be labelled a forecast. Removing it was correct and
   * must stay — see the note in lib/workers/providers/rolling-insights.ts. What
   * was missed is that THIS caller kept asking for `projections` afterwards, so
   * it has been silently fetching nothing ever since.
   *
   * The function name says player stats and the consumer writes
   * PlayerSeasonStats, so `player_stats` is what it always meant to ask for.
   */
  const result = await rollingInsightsProvider({
    sport: 'NFL',
    dataType: 'player_stats',
    query: { season: seasonForPath },
  })
  if (!Array.isArray(result.data)) return []
  // Filter only rows that have an id and a name — anything else is unusable.
  return (result.data as unknown[])
    .filter((r): r is RIPlayerSeasonStatsRow => {
      if (!r || typeof r !== 'object') return false
      const o = r as Record<string, unknown>
      return o.player_id != null && typeof o.player === 'string' && o.player.length > 0
    })
}
