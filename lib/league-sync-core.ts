import { prisma } from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/league-auth-crypto';
import {
  clearDeadYahooCredentials,
  isTerminalGrantFailure,
  parseOAuthErrorCode,
  YAHOO_RECONNECT_MESSAGE,
} from '@/lib/league-import/yahoo/yahooOAuthRecovery';
import { XMLParser } from 'fast-xml-parser';

export interface LeaguePayload {
  name: string;
  leagueSize: number;
  scoring: string;
  isDynasty: boolean;
  settings: any;
  /** Season year for this league row (required for DB uniqueness). */
  season: number;
  rosters: {
    platformUserId: string;
    playerData: string[];
    faabRemaining: number | null;
  }[];
}

export interface SyncResult {
  success: boolean;
  leagueId: string;
  leagueName: string;
  platform: string;
  rostersSync: number;
  scoring: string;
  isDynasty: boolean;
  lastSyncedAt: Date;
}

function detectScoring(leagueData: any): string {
  const rec = leagueData.scoring_settings?.rec;
  if (rec === 1) return 'ppr';
  if (rec === 0.5) return 'half';
  return 'standard';
}

function detectDynasty(leagueData: any): boolean {
  return leagueData.settings?.type === 2 || leagueData.settings?.type === 'dynasty';
}

export async function fetchSleeperLeague(platformLeagueId: string): Promise<LeaguePayload> {
  const [leagueRes, rostersRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${platformLeagueId}`),
    fetch(`https://api.sleeper.app/v1/league/${platformLeagueId}/rosters`),
  ]);

  if (!leagueRes.ok) throw new Error('Failed to fetch league from Sleeper');
  if (!rostersRes.ok) throw new Error('Failed to fetch rosters from Sleeper');

  const leagueData = await leagueRes.json();
  const rostersData = await rostersRes.json();

  const season =
    leagueData.season != null && leagueData.season !== ''
      ? Number(leagueData.season)
      : new Date().getFullYear();

  return {
    name: leagueData.name || 'Unknown League',
    leagueSize: leagueData.total_rosters || 12,
    scoring: detectScoring(leagueData),
    isDynasty: detectDynasty(leagueData),
    settings: leagueData.settings || {},
    season: Number.isFinite(season) ? season : new Date().getFullYear(),
    rosters: (Array.isArray(rostersData) ? rostersData : [])
      .filter((r: any) => !!r.owner_id)
      .map((r: any) => ({
        platformUserId: r.owner_id,
        playerData: r.players || [],
        faabRemaining: r.settings?.waiver_budget_used != null
          ? Math.max(0, 100 - r.settings.waiver_budget_used)
          : null,
      })),
  };
}

export async function fetchMflLeague(platformLeagueId: string, apiKey: string): Promise<LeaguePayload> {
  const year = new Date().getFullYear();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

  const [leagueRes, rostersRes] = await Promise.all([
    fetch(`https://api.myfantasyleague.com/${year}/export?TYPE=league&L=${platformLeagueId}&APIKEY=${apiKey}&JSON=1`),
    fetch(`https://api.myfantasyleague.com/${year}/export?TYPE=rosters&L=${platformLeagueId}&APIKEY=${apiKey}&JSON=1`),
  ]);

  if (!leagueRes.ok) throw new Error('Failed to fetch league from MFL — check your API key');

  const leagueText = await leagueRes.text();
  let leagueData: any;

  try {
    leagueData = JSON.parse(leagueText);
  } catch {
    leagueData = parser.parse(leagueText);
  }

  const league = leagueData?.league || leagueData;
  const franchises = league?.franchises?.franchise || [];
  const franchiseList = Array.isArray(franchises) ? franchises : [franchises];

  let rosters: LeaguePayload['rosters'] = [];
  if (rostersRes.ok) {
    const rostersText = await rostersRes.text();
    try {
      const rostersData = JSON.parse(rostersText);
      const rosterList = rostersData?.rosters?.franchise || [];
      const rosterArray = Array.isArray(rosterList) ? rosterList : [rosterList];

      rosters = rosterArray
        .filter((r: any) => r.id)
        .map((r: any) => {
          const players = r.player || [];
          const playerArray = Array.isArray(players) ? players : [players];
          return {
            platformUserId: r.id,
            playerData: playerArray.map((p: any) => p.id || p).filter(Boolean),
            faabRemaining: null,
          };
        });
    } catch {
      rosters = [];
    }
  }

  const scoringType = league?.scoring_type || '';
  let scoring = 'standard';
  if (scoringType.toLowerCase().includes('ppr')) scoring = 'ppr';
  else if (scoringType.toLowerCase().includes('half')) scoring = 'half';

  return {
    name: league?.name || 'MFL League',
    leagueSize: franchiseList.length || 12,
    scoring,
    isDynasty: league?.keeper === 'yes' || league?.type === 'dynasty' || false,
    settings: league,
    season: year,
    rosters,
  };
}

export async function fetchEspnLeague(platformLeagueId: string, swid: string, s2: string): Promise<LeaguePayload> {
  const year = new Date().getFullYear();
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${platformLeagueId}?view=mRoster&view=mTeam&view=mSettings`;

  const res = await fetch(url, {
    headers: {
      Cookie: `SWID=${swid}; espn_s2=${s2}`,
    },
  });

  if (!res.ok) throw new Error('Failed to fetch ESPN league — check your SWID and ESPN_S2 cookies');

  const data = await res.json();
  const settings = data.settings || {};
  const teams = data.teams || [];

  const scoringId = settings.scoringSettings?.scoringType;
  let scoring = 'standard';
  if (scoringId === 'PPR' || scoringId === 1) scoring = 'ppr';
  else if (scoringId === 'HALF_PPR') scoring = 'half';

  return {
    name: settings.name || 'ESPN League',
    leagueSize: settings.size || teams.length || 12,
    scoring,
    isDynasty: settings.keeperCount > 0 || settings.draftSettings?.keeperCount > 0 || false,
    settings: settings,
    season: year,
    rosters: teams.map((t: any) => {
      const players = (t.roster?.entries || []).map((e: any) =>
        String(e.playerId || e.playerPoolEntry?.id || '')
      ).filter(Boolean);

      return {
        platformUserId: String(t.id),
        playerData: players,
        faabRemaining: t.waiverBudgetRemaining ?? null,
      };
    }),
  };
}

async function refreshYahooToken(userId: string, refreshToken: string): Promise<string> {
  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Yahoo OAuth not configured on server');

  const res = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    /*
     * This path already had the right MESSAGE and still left the user stuck.
     * `invalid_grant` is terminal — only re-consent recovers it — but the dead
     * credential stayed in the database, so every "is Yahoo connected?" check
     * kept saying yes, the surface never offered a reconnect, and this same
     * error repeated forever. Clearing it is what puts the Connect button back.
     *
     * Only on invalid_grant: a 5xx here is transient and must not cost a working
     * connection. See lib/league-import/yahoo/yahooOAuthRecovery.ts — shared,
     * because the other refresh implementation had drifted from this one.
     */
    if (isTerminalGrantFailure(errText)) {
      await clearDeadYahooCredentials(userId);
      throw new Error(YAHOO_RECONNECT_MESSAGE);
    }
    // Code and status only. The raw body is vendor free-text and this is a log.
    console.error(
      '[Yahoo Refresh] failed status=%d error=%s',
      res.status,
      parseOAuthErrorCode(errText) ?? 'unrecognised',
    );
    throw new Error('Yahoo token refresh failed — please re-connect Yahoo in League Sync.');
  }

  const tokens = await res.json();

  await (prisma as any).leagueAuth.update({
    where: { userId_platform: { userId, platform: 'yahoo' } },
    data: {
      oauthToken: encrypt(tokens.access_token),
      oauthSecret: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
      updatedAt: new Date(),
    },
  });

  return tokens.access_token;
}

class YahooApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Yahoo API error (${status}): ${body}`);
    this.status = status;
  }
}

async function yahooApiFetch(url: string, accessToken: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new YahooApiError(res.status, errText);
  }

  return res.json();
}

export async function fetchYahooLeague(
  platformLeagueId: string,
  accessToken: string,
  userId?: string,
  refreshToken?: string
): Promise<LeaguePayload> {
  let token = accessToken;

  const leagueUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${platformLeagueId}?format=json`;
  let leagueData: any;
  try {
    leagueData = await yahooApiFetch(leagueUrl, token);
  } catch (err: any) {
    if (err instanceof YahooApiError && err.status === 401 && userId && refreshToken) {
      token = await refreshYahooToken(userId, refreshToken);
      leagueData = await yahooApiFetch(leagueUrl, token);
    } else {
      throw err;
    }
  }

  const league = leagueData?.fantasy_content?.league?.[0] || leagueData?.fantasy_content?.league;
  if (!league) throw new Error('Could not parse Yahoo league data');

  const leagueName = league.name || 'Yahoo League';
  const numTeams = parseInt(league.num_teams) || 12;
  const scoringType = league.scoring_type || '';
  const isDynasty = scoringType.toLowerCase().includes('keeper') || scoringType.toLowerCase().includes('dynasty');

  let scoring = 'standard';
  try {
    const settingsUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${platformLeagueId}/settings?format=json`;
    const settingsData = await yahooApiFetch(settingsUrl, token);
    const statMods = settingsData?.fantasy_content?.league?.[1]?.settings?.[0]?.stat_modifiers?.stats;
    if (Array.isArray(statMods)) {
      const recMod = statMods.find((s: any) => s.stat?.stat_id === '21');
      const recValue = parseFloat(recMod?.stat?.value || '0');
      if (recValue >= 1) scoring = 'ppr';
      else if (recValue >= 0.5) scoring = 'half';
    }
  } catch {
    // fall back to standard
  }

  const rostersUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${platformLeagueId}/teams/roster?format=json`;
  let rostersData: any;
  try {
    rostersData = await yahooApiFetch(rostersUrl, token);
  } catch {
    rostersData = null;
  }

  const rosters: LeaguePayload['rosters'] = [];

  const teamsObj = rostersData?.fantasy_content?.league?.[1]?.teams;
  if (teamsObj) {
    for (const teamKey of Object.keys(teamsObj)) {
      if (teamKey === 'count') continue;
      const teamArr = teamsObj[teamKey]?.team;
      if (!Array.isArray(teamArr)) continue;

      const teamInfo: Record<string, any> = {};
      for (const item of teamArr[0] || []) {
        if (typeof item === 'object' && !Array.isArray(item)) {
          Object.assign(teamInfo, item);
        }
      }

      const rosterSection = teamArr[1]?.roster?.['0']?.players || teamArr[1]?.roster;
      const playerIds: string[] = [];

      if (rosterSection) {
        for (const pk of Object.keys(rosterSection)) {
          if (pk === 'count') continue;
          const playerArr = rosterSection[pk]?.player?.[0];
          if (!Array.isArray(playerArr)) continue;
          for (const pItem of playerArr) {
            if (typeof pItem === 'object' && pItem.player_key) {
              playerIds.push(pItem.player_key);
            } else if (typeof pItem === 'object' && pItem.player_id) {
              playerIds.push(String(pItem.player_id));
            }
          }
        }
      }

      rosters.push({
        platformUserId: teamInfo.team_key || teamKey,
        playerData: playerIds,
        faabRemaining: teamInfo.faab_balance ? parseInt(teamInfo.faab_balance) : null,
      });
    }
  }

  const season =
    parseInt(String(league.season ?? ''), 10) || new Date().getFullYear();

  return {
    name: leagueName,
    leagueSize: numTeams,
    scoring,
    isDynasty,
    settings: { scoringType, season: league.season },
    season,
    rosters,
  };
}

export async function fetchFantraxLeague(_platformLeagueId: string): Promise<LeaguePayload> {
  throw new Error('Fantrax sync is under development — check back soon.');
}

export async function getDecryptedAuth(userId: string, platform: string) {
  const auth = await (prisma as any).leagueAuth.findUnique({
    where: { userId_platform: { userId, platform } },
  });

  if (!auth) return null;

  return {
    apiKey: auth.apiKey ? decrypt(auth.apiKey) : null,
    oauthToken: auth.oauthToken ? decrypt(auth.oauthToken) : null,
    oauthSecret: auth.oauthSecret ? decrypt(auth.oauthSecret) : null,
    espnSwid: auth.espnSwid ? decrypt(auth.espnSwid) : null,
    espnS2: auth.espnS2 ? decrypt(auth.espnS2) : null,
  };
}

export async function fetchLeaguePayload(
  userId: string,
  platform: string,
  platformLeagueId: string
): Promise<LeaguePayload> {
  switch (platform) {
    case 'sleeper':
      return fetchSleeperLeague(platformLeagueId);

    case 'mfl': {
      const auth = await getDecryptedAuth(userId, 'mfl');
      if (!auth?.apiKey) throw new Error('MFL API key not found');
      return fetchMflLeague(platformLeagueId, auth.apiKey);
    }

    case 'espn': {
      const auth = await getDecryptedAuth(userId, 'espn');
      if (!auth?.espnSwid || !auth?.espnS2) throw new Error('ESPN cookies not found');
      return fetchEspnLeague(platformLeagueId, auth.espnSwid, auth.espnS2);
    }

    case 'yahoo': {
      const auth = await getDecryptedAuth(userId, 'yahoo');
      if (!auth?.oauthToken) throw new Error('Yahoo OAuth not connected — click "Connect Yahoo" in League Sync first.');
      return fetchYahooLeague(platformLeagueId, auth.oauthToken, userId, auth.oauthSecret || undefined);
    }

    case 'fantrax':
      return fetchFantraxLeague(platformLeagueId);

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export async function syncLeague(
  userId: string,
  platform: string,
  platformLeagueId: string
): Promise<SyncResult> {
  const leaguePayload = await fetchLeaguePayload(userId, platform, platformLeagueId);
  const season = leaguePayload.season;

  const league = await (prisma as any).league.upsert({
    where: {
      userId_platform_platformLeagueId_season: {
        userId,
        platform,
        platformLeagueId,
        season,
      },
    },
    update: {
      name: leaguePayload.name,
      leagueSize: leaguePayload.leagueSize,
      scoring: leaguePayload.scoring,
      isDynasty: leaguePayload.isDynasty,
      settings: leaguePayload.settings,
      season,
      lastSyncedAt: new Date(),
      syncStatus: 'success',
      syncError: null,
      updatedAt: new Date(),
    },
    create: {
      platform,
      platformLeagueId,
      userId,
      season,
      name: leaguePayload.name,
      leagueSize: leaguePayload.leagueSize,
      scoring: leaguePayload.scoring,
      isDynasty: leaguePayload.isDynasty,
      settings: leaguePayload.settings,
      lastSyncedAt: new Date(),
      syncStatus: 'success',
    },
  });

  let rosterCount = 0;
  for (const roster of leaguePayload.rosters) {
    await (prisma as any).roster.upsert({
      where: {
        leagueId_platformUserId: { leagueId: league.id, platformUserId: roster.platformUserId },
      },
      update: {
        playerData: roster.playerData,
        faabRemaining: roster.faabRemaining,
        updatedAt: new Date(),
      },
      create: {
        leagueId: league.id,
        platformUserId: roster.platformUserId,
        playerData: roster.playerData,
        faabRemaining: roster.faabRemaining,
      },
    });
    rosterCount++;
  }

  return {
    success: true,
    leagueId: league.id,
    leagueName: league.name,
    platform,
    rostersSync: rosterCount,
    scoring: leaguePayload.scoring,
    isDynasty: leaguePayload.isDynasty,
    lastSyncedAt: league.lastSyncedAt,
  };
}
