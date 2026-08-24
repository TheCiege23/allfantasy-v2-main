import { prisma } from './prisma';
import { normalizeTeamAbbrev } from './team-abbrev';
import { recordProviderSync } from './provider-sync-logger';
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'
import {
  shouldIncludeInjuryInFanoutBatch,
  type InjurySyncFanoutRow,
} from '@/lib/realtime-events/injuryFanoutPolicy';

const SITE_API = `${ESPN_SITE_API_BASE}/football/nfl`; // db-first-exception: provider adapter layer
const CORE_API = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl'; // db-first-exception: provider adapter layer

const ESPN_TEAM_IDS: Record<string, number> = {
  ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3, CIN: 4, CLE: 5,
  DAL: 6, DEN: 7, DET: 8, GB: 9, HOU: 34, IND: 11, JAX: 30, KC: 12,
  LV: 13, LAC: 24, LAR: 14, MIA: 15, MIN: 16, NE: 17, NO: 18,
  NYG: 19, NYJ: 20, PHI: 21, PIT: 23, SEA: 26, SF: 25, TB: 27,
  TEN: 10, WAS: 28,
};

const ESPN_ID_TO_ABBREV: Record<number, string> = {};
for (const [abbrev, id] of Object.entries(ESPN_TEAM_IDS)) {
  ESPN_ID_TO_ABBREV[id] = abbrev;
}

async function espnFetch<T>(url: string, timeoutMs = 10000): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface ESPNAthlete {
  id: string;
  fullName: string;
  displayName: string;
  firstName: string;
  lastName: string;
  jersey?: string;
  position?: { abbreviation: string; name: string };
  team?: { $ref?: string };
  age?: number;
  height?: number;
  weight?: number;
  college?: { name?: string };
  headshot?: { href: string };
  status?: { type?: { name: string; description: string } };
  experience?: { years: number };
  dateOfBirth?: string;
}

export interface ESPNInjuryItem {
  athlete: {
    displayName: string;
    id: string;
    position?: { abbreviation: string };
    jersey?: string;
  };
  status: string;
  date: string;
  type?: { name: string; description: string };
  details?: { type: string; detail: string; side: string; returnDate: string };
  longComment?: string;
  shortComment?: string;
}

export interface ESPNTeamDetail {
  id: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  color?: string;
  logo?: string;
  record?: { items?: Array<{ summary: string; stats?: Array<{ name: string; value: number }> }> };
  athletes?: ESPNAthlete[];
  injuries?: ESPNInjuryItem[];
}

export interface ESPNGameSummary {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  week: number | null;
  season: number;
  boxScore: {
    players: ESPNBoxScorePlayer[];
  };
  drives: number;
  venue: string | null;
}

export interface ESPNBoxScorePlayer {
  athleteId: string;
  name: string;
  team: string;
  position: string;
  stats: Record<string, string | number>;
}

export async function fetchESPNTeamRoster(teamAbbrev: string): Promise<ESPNAthlete[]> {
  const espnId = ESPN_TEAM_IDS[teamAbbrev];
  if (!espnId) return [];

  const data = await espnFetch<any>(
    `${SITE_API}/teams/${espnId}?enable=roster`,
    12000
  );
  if (!data?.team?.athletes) return [];

  const athletes: ESPNAthlete[] = [];
  const rawAthletes = data.team.athletes;

  for (const entry of rawAthletes) {
    if (entry.items && Array.isArray(entry.items)) {
      for (const a of entry.items) {
        athletes.push(parseESPNAthlete(a));
      }
    } else if (entry.id && (entry.fullName || entry.displayName)) {
      athletes.push(parseESPNAthlete(entry));
    }
  }

  return athletes;
}

function parseESPNAthlete(a: any): ESPNAthlete {
  return {
    id: String(a.id),
    fullName: a.fullName || a.displayName || '',
    displayName: a.displayName || '',
    firstName: a.firstName || '',
    lastName: a.lastName || '',
    jersey: a.jersey,
    position: a.position ? { abbreviation: a.position.abbreviation, name: a.position.name } : undefined,
    age: a.age,
    height: a.height,
    weight: a.weight,
    college: typeof a.college === 'string' ? { name: a.college } : a.college,
    headshot: a.headshot,
    status: a.status,
    experience: a.experience,
    dateOfBirth: a.dateOfBirth,
  };
}

export async function fetchESPNTeamInjuries(teamAbbrev: string): Promise<ESPNInjuryItem[]> {
  const espnId = ESPN_TEAM_IDS[teamAbbrev];
  if (!espnId) return [];

  const data = await espnFetch<any>(
    `${SITE_API}/teams/${espnId}?enable=injuries`,
    10000
  );
  if (!data?.team?.injuries) return [];

  const items: ESPNInjuryItem[] = [];
  for (const injury of data.team.injuries) {
    for (const entry of injury.items || []) {
      const athlete = entry.athlete || {};
      items.push({
        athlete: {
          displayName: athlete.displayName || '',
          id: String(athlete.id || ''),
          position: athlete.position,
          jersey: athlete.jersey,
        },
        status: entry.status || 'Unknown',
        date: entry.date || '',
        type: entry.type,
        details: entry.details,
        longComment: entry.longComment,
        shortComment: entry.shortComment,
      });
    }
  }

  return items;
}

export async function fetchAllESPNInjuries(): Promise<{ team: string; injuries: ESPNInjuryItem[] }[]> {
  const teams = Object.keys(ESPN_TEAM_IDS);
  const results: { team: string; injuries: ESPNInjuryItem[] }[] = [];
  const BATCH_SIZE = 4;

  for (let i = 0; i < teams.length; i += BATCH_SIZE) {
    const batch = teams.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (abbrev) => {
        const injuries = await fetchESPNTeamInjuries(abbrev);
        return { team: abbrev, injuries };
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value.injuries.length > 0) {
        results.push(result.value);
      }
    }
  }

  return results;
}

export async function fetchESPNGameSummary(eventId: string): Promise<ESPNGameSummary | null> {
  const data = await espnFetch<any>(
    `${SITE_API}/summary?event=${eventId}`,
    15000
  );
  if (!data) return null;

  const header = data.header?.competitions?.[0];
  if (!header) return null;

  const homeComp = header.competitors?.find((c: any) => c.homeAway === 'home');
  const awayComp = header.competitors?.find((c: any) => c.homeAway === 'away');
  if (!homeComp || !awayComp) return null;

  const boxScorePlayers: ESPNBoxScorePlayer[] = [];

  const boxscore = data.boxscore;
  if (boxscore?.players) {
    for (const teamBox of boxscore.players) {
      const teamAbbrev = normalizeTeamAbbrev(teamBox.team?.abbreviation) || teamBox.team?.abbreviation || '';
      for (const statGroup of teamBox.statistics || []) {
        const labels: string[] = statGroup.labels || [];
        for (const athlete of statGroup.athletes || []) {
          const playerStats: Record<string, string | number> = {};
          const statValues: string[] = athlete.stats || [];
          for (let k = 0; k < labels.length && k < statValues.length; k++) {
            playerStats[labels[k]] = statValues[k];
          }
          boxScorePlayers.push({
            athleteId: String(athlete.athlete?.id || ''),
            name: athlete.athlete?.displayName || '',
            team: teamAbbrev,
            position: statGroup.name || '',
            stats: playerStats,
          });
        }
      }
    }
  }

  return {
    gameId: eventId,
    homeTeam: normalizeTeamAbbrev(homeComp.team?.abbreviation) || homeComp.team?.abbreviation || '',
    awayTeam: normalizeTeamAbbrev(awayComp.team?.abbreviation) || awayComp.team?.abbreviation || '',
    homeScore: parseInt(homeComp.score) || 0,
    awayScore: parseInt(awayComp.score) || 0,
    status: header.status?.type?.description || '',
    week: data.header?.week || null,
    season: data.header?.season?.year || 0,
    boxScore: { players: boxScorePlayers },
    drives: data.drives?.previous?.length || 0,
    venue: data.gameInfo?.venue?.fullName || null,
  };
}

export async function fetchESPNActiveAthletes(page = 1, limit = 500): Promise<ESPNAthlete[]> {
  const data = await espnFetch<any>(
    `${CORE_API}/athletes?limit=${limit}&page=${page}&active=true`,
    15000
  );
  if (!data?.items) return [];

  const athletes: ESPNAthlete[] = [];
  const resolvePromises: Promise<void>[] = [];

  for (const item of data.items) {
    if (item.$ref) {
      resolvePromises.push(
        espnFetch<any>(item.$ref, 5000).then((detail) => {
          if (detail) {
            const teamRef = detail.team?.$ref || '';
            const teamIdMatch = teamRef.match(/teams\/(\d+)/);
            const teamAbbrev = teamIdMatch ? ESPN_ID_TO_ABBREV[parseInt(teamIdMatch[1])] : undefined;

            athletes.push({
              id: String(detail.id),
              fullName: detail.fullName || detail.displayName || '',
              displayName: detail.displayName || '',
              firstName: detail.firstName || '',
              lastName: detail.lastName || '',
              jersey: detail.jersey,
              position: detail.position,
              age: detail.age,
              height: detail.height,
              weight: detail.weight,
              college: detail.college ? { name: detail.college } : undefined,
              headshot: detail.headshot,
              status: detail.status,
              experience: detail.experience,
              dateOfBirth: detail.dateOfBirth,
              team: teamAbbrev ? { $ref: teamAbbrev } : undefined,
            });
          }
        }).catch(() => {})
      );
    }
  }

  const BATCH_SIZE = 10;
  for (let i = 0; i < resolvePromises.length; i += BATCH_SIZE) {
    await Promise.allSettled(resolvePromises.slice(i, i + BATCH_SIZE));
  }

  return athletes;
}

export async function syncESPNInjuriesToDb(): Promise<{ synced: number; teams: number }> {
  const allInjuries = await fetchAllESPNInjuries();
  let synced = 0;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const fanoutByPlayer = new Map<string, InjurySyncFanoutRow>();

  for (const { team, injuries } of allInjuries) {
    for (const inj of injuries) {
      try {
        const externalId = `espn-inj-${inj.athlete.id}-${team}`;
        await prisma.sportsInjury.upsert({
          where: {
            sport_externalId_source: {
              sport: 'NFL',
              externalId,
              source: 'espn',
            },
          },
          update: {
            playerName: inj.athlete.displayName,
            team,
            position: inj.athlete.position?.abbreviation || null,
            status: inj.status,
            type: inj.details?.type || inj.type?.name || null,
            description: inj.longComment || inj.shortComment || null,
            date: inj.date ? new Date(inj.date) : null,
            fetchedAt: now,
            expiresAt,
          },
          create: {
            sport: 'NFL',
            externalId,
            source: 'espn',
            playerName: inj.athlete.displayName,
            playerId: inj.athlete.id,
            team,
            position: inj.athlete.position?.abbreviation || null,
            status: inj.status,
            type: inj.details?.type || inj.type?.name || null,
            description: inj.longComment || inj.shortComment || null,
            date: inj.date ? new Date(inj.date) : null,
            fetchedAt: now,
            expiresAt,
          },
        });
        synced++;
        if (shouldIncludeInjuryInFanoutBatch(inj.status)) {
          const k = inj.athlete.displayName.trim().toLowerCase();
          if (k) {
            fanoutByPlayer.set(k, {
              playerName: inj.athlete.displayName,
              team,
              status: inj.status,
              type: inj.details?.type || inj.type?.name || null,
              description: inj.longComment || inj.shortComment || null,
            });
          }
        }
      } catch (err) {
        console.error(`[ESPN] Failed to sync injury for ${inj.athlete.displayName}:`, err);
      }
    }
    await recordProviderSync(
      { provider: 'espn', entityType: 'injury', sport: 'NFL', key: team },
      { recordsImported: injuries.length },
    );
  }

  if (fanoutByPlayer.size > 0) {
    const injuriesPayload = [...fanoutByPlayer.values()];
    void import('@/lib/realtime-events/injurySyncFanout')
      .then((m) => m.fanoutInjurySyncBatch({ sport: 'NFL', injuries: injuriesPayload }))
      .catch(() => {});
  }

  return { synced, teams: allInjuries.length };
}

export async function syncESPNRostersToDb(teamAbbrevs?: string[]): Promise<{ synced: number; teams: number }> {
  const teams = teamAbbrevs || Object.keys(ESPN_TEAM_IDS);
  let synced = 0;
  let teamsProcessed = 0;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const BATCH_SIZE = 4;

  for (let i = 0; i < teams.length; i += BATCH_SIZE) {
    const batch = teams.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (abbrev) => {
        const athletes = await fetchESPNTeamRoster(abbrev);
        let teamSynced = 0;

        for (const a of athletes) {
          try {
            await prisma.sportsPlayer.upsert({
              where: {
                sport_externalId_source: {
                  sport: 'NFL',
                  externalId: `espn-${a.id}`,
                  source: 'espn',
                },
              },
              update: {
                name: a.fullName,
                position: a.position?.abbreviation || null,
                team: abbrev,
                number: a.jersey ? parseInt(a.jersey) || null : null,
                age: a.age || null,
                height: a.height ? String(a.height) : null,
                weight: a.weight ? String(a.weight) : null,
                college: a.college?.name || null,
                imageUrl: a.headshot?.href || null,
                status: a.status?.type?.name || null,
                dob: a.dateOfBirth || null,
                fetchedAt: now,
                expiresAt,
              },
              create: {
                sport: 'NFL',
                externalId: `espn-${a.id}`,
                source: 'espn',
                name: a.fullName,
                position: a.position?.abbreviation || null,
                team: abbrev,
                number: a.jersey ? parseInt(a.jersey) || null : null,
                age: a.age || null,
                height: a.height ? String(a.height) : null,
                weight: a.weight ? String(a.weight) : null,
                college: a.college?.name || null,
                imageUrl: a.headshot?.href || null,
                status: a.status?.type?.name || null,
                dob: a.dateOfBirth || null,
                fetchedAt: now,
                expiresAt,
              },
            });
            teamSynced++;
          } catch {}
        }

        return { team: abbrev, synced: teamSynced };
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        synced += result.value.synced;
        teamsProcessed++;
      }
    }
  }

  return { synced, teams: teamsProcessed };
}

export async function fetchESPNGameSummariesForWeek(season: number, week: number, seasonType = 2): Promise<ESPNGameSummary[]> {
  const scoreboard = await espnFetch<any>(
    `${SITE_API}/scoreboard?week=${week}&seasontype=${seasonType}&dates=${season}`,
    10000
  );
  if (!scoreboard?.events) return [];

  const completedEvents = scoreboard.events.filter((e: any) =>
    e.competitions?.[0]?.status?.type?.completed
  );

  const summaries: ESPNGameSummary[] = [];
  const BATCH_SIZE = 3;

  for (let i = 0; i < completedEvents.length; i += BATCH_SIZE) {
    const batch = completedEvents.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((event: any) => fetchESPNGameSummary(event.id))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        summaries.push(result.value);
      }
    }
  }

  return summaries;
}

export function getESPNTeamId(abbrev: string): number | undefined {
  return ESPN_TEAM_IDS[abbrev];
}

export function getESPNAbbrev(espnId: number): string | undefined {
  return ESPN_ID_TO_ABBREV[espnId];
}
