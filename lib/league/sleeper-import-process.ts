import pLimit from "p-limit";
import { LeagueSport } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { sleeperAvatarUrl } from "@/lib/sleeper-avatar";
import { onMatchupCommentary } from "@/lib/commentary-engine";
import { normalizeToSupportedSport } from "@/lib/sport-scope";
import { getLeagueMatchups, getLeagueRosters, getLeagueUsers } from "@/lib/sleeper-client";

const weekImportLimit = pLimit(4);
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

export type SleeperLeague = {
  league_id?: string | number;
  name?: string;
  avatar?: string | null;
  commissioner_id?: string | null;
  total_rosters?: number | null;
  status?: string | null;
  scoring_settings?: {
    rec?: number | null;
  } | null;
  metadata?: {
    co_commissioners?: string[] | null;
    [key: string]: unknown;
  } | null;
  settings?: {
    type?: number | null;
    leg?: number | null;
    [key: string]: unknown;
  } | null;
  roster_positions?: string[] | null;
};

export type SleeperUser = {
  user_id?: string;
  username?: string;
  display_name?: string;
  avatar?: string | null;
  /** Sleeper: league commissioner for this user row */
  is_owner?: boolean;
  metadata?: {
    team_name?: string;
    avatar?: string;
  } | null;
};

type SleeperRoster = {
  roster_id?: number | string;
  owner_id?: string;
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
  } | null;
};

type SleeperMatchup = {
  roster_id?: number | string;
  matchup_id?: number | string;
  points?: number | null;
};

type LiveMatchupScore = {
  matchupId: string;
  teamAExternalId: string;
  teamBExternalId: string;
  scoreA: number;
  scoreB: number;
};

export type MatchupCommentaryTelemetry = {
  evaluated: number;
  featured: number;
  emitted: number;
  skippedDuplicate: number;
  skippedMinor: number;
  skippedEmpty: number;
};

const EMPTY_MATCHUP_COMMENTARY_TELEMETRY: MatchupCommentaryTelemetry = {
  evaluated: 0,
  featured: 0,
  emitted: 0,
  skippedDuplicate: 0,
  skippedMinor: 0,
  skippedEmpty: 0,
};

export function getSleeperAvatarUrl(avatar: string | null | undefined): string | null {
  return sleeperAvatarUrl(avatar);
}

function getScoringType(league: SleeperLeague): "ppr" | "half-ppr" | "standard" {
  const rec = league.scoring_settings?.rec;

  if (rec === 1) return "ppr";
  if (rec === 0.5) return "half-ppr";
  return "standard";
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function toFiniteScore(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildLiveMatchupScores(matchups: SleeperMatchup[]): LiveMatchupScore[] {
  const byMatchupId = new Map<string, SleeperMatchup[]>();
  for (const matchup of matchups) {
    const matchupIdRaw = matchup.matchup_id;
    if (matchupIdRaw == null) continue;
    const matchupId = String(matchupIdRaw).trim();
    if (!matchupId) continue;
    const list = byMatchupId.get(matchupId) ?? [];
    list.push(matchup);
    byMatchupId.set(matchupId, list);
  }

  const rows: LiveMatchupScore[] = [];
  for (const [matchupId, entries] of byMatchupId.entries()) {
    const uniqueByRoster = Array.from(
      new Map(
        entries
          .filter((entry) => entry.roster_id != null)
          .map((entry) => [String(entry.roster_id), entry])
      ).values()
    );
    if (uniqueByRoster.length !== 2) continue;

    const [teamA, teamB] = uniqueByRoster.sort(
      (left, right) => Number(left.roster_id ?? 0) - Number(right.roster_id ?? 0)
    );
    const teamAExternalId = String(teamA.roster_id ?? "").trim();
    const teamBExternalId = String(teamB.roster_id ?? "").trim();
    if (!teamAExternalId || !teamBExternalId) continue;

    rows.push({
      matchupId,
      teamAExternalId,
      teamBExternalId,
      scoreA: toFiniteScore(teamA.points),
      scoreB: toFiniteScore(teamB.points),
    });
  }

  return rows;
}

function winnerSide(scoreA: number, scoreB: number): "A" | "B" | "T" {
  if (scoreA > scoreB) return "A";
  if (scoreB > scoreA) return "B";
  return "T";
}

function safeContextValue(
  contextSnap: unknown,
  key: string
): string | number | undefined {
  if (!contextSnap || typeof contextSnap !== "object" || Array.isArray(contextSnap)) {
    return undefined;
  }
  const value = (contextSnap as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  return undefined;
}

async function emitLiveMatchupCommentary(args: {
  leagueId: string;
  leagueName?: string | null;
  sport: string;
  season: number;
  week: number;
  matchups: LiveMatchupScore[];
  teamMetaByExternalId: Map<string, { teamName: string; ownerName: string }>;
}): Promise<MatchupCommentaryTelemetry> {
  if (!args.matchups.length) {
    return {
      ...EMPTY_MATCHUP_COMMENTARY_TELEMETRY,
      skippedEmpty: 1,
    };
  }

  const telemetry: MatchupCommentaryTelemetry = {
    ...EMPTY_MATCHUP_COMMENTARY_TELEMETRY,
  };

  try {
    const now = Date.now();
    const recentEntries = await prisma.commentaryEntry.findMany({
      where: {
        leagueId: args.leagueId,
        eventType: "matchup_commentary",
        createdAt: { gte: new Date(now - 1000 * 60 * 60 * 12) },
      },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: {
        createdAt: true,
        contextSnap: true,
      },
    });

    const lastByKey = new Map<
      string,
      { createdAtMs: number; scoreA: number; scoreB: number; side: "A" | "B" | "T" }
    >();
    for (const entry of recentEntries) {
      const contextWeek = safeContextValue(entry.contextSnap, "week");
      const contextMatchupId = safeContextValue(entry.contextSnap, "matchupId");
      if (typeof contextWeek !== "number" || typeof contextMatchupId !== "string") continue;
      const key = `${contextWeek}:${contextMatchupId}`;
      if (lastByKey.has(key)) continue;
      const scoreA = Number(safeContextValue(entry.contextSnap, "scoreA") ?? 0);
      const scoreB = Number(safeContextValue(entry.contextSnap, "scoreB") ?? 0);
      lastByKey.set(key, {
        createdAtMs: entry.createdAt.getTime(),
        scoreA: Number.isFinite(scoreA) ? scoreA : 0,
        scoreB: Number.isFinite(scoreB) ? scoreB : 0,
        side: winnerSide(scoreA, scoreB),
      });
    }

    const featured = [...args.matchups]
      .sort((left, right) => {
        const marginLeft = Math.abs(left.scoreA - left.scoreB);
        const marginRight = Math.abs(right.scoreA - right.scoreB);
        if (marginLeft !== marginRight) return marginLeft - marginRight;
        return right.scoreA + right.scoreB - (left.scoreA + left.scoreB);
      })
      .slice(0, 3);
    telemetry.featured = featured.length;
    if (featured.length === 0) {
      telemetry.skippedEmpty += 1;
    }

    for (const matchup of featured) {
      telemetry.evaluated += 1;
      const key = `${args.week}:${matchup.matchupId}`;
      const previous = lastByKey.get(key);
      if (previous) {
        const identical = previous.scoreA === matchup.scoreA && previous.scoreB === matchup.scoreB;
        if (identical) {
          telemetry.skippedDuplicate += 1;
          continue;
        }
        const elapsedMs = now - previous.createdAtMs;
        const scoreDeltaA = Math.abs(matchup.scoreA - previous.scoreA);
        const scoreDeltaB = Math.abs(matchup.scoreB - previous.scoreB);
        const sideChanged = winnerSide(matchup.scoreA, matchup.scoreB) !== previous.side;
        const minorUpdate = scoreDeltaA < 2 && scoreDeltaB < 2 && !sideChanged;
        if (minorUpdate && elapsedMs < 1000 * 60 * 15) {
          telemetry.skippedMinor += 1;
          continue;
        }
      }

      const teamA = args.teamMetaByExternalId.get(matchup.teamAExternalId);
      const teamB = args.teamMetaByExternalId.get(matchup.teamBExternalId);
      const teamAName = teamA?.teamName ?? matchup.teamAExternalId;
      const teamBName = teamB?.teamName ?? matchup.teamBExternalId;
      const margin = Math.abs(matchup.scoreA - matchup.scoreB);
      const situation =
        margin <= 5
          ? "nail-biter"
          : margin >= 25
            ? "blowout"
            : "swing game";

      void onMatchupCommentary(
        {
          eventType: "matchup_commentary",
          leagueId: args.leagueId,
          sport: normalizeToSupportedSport(args.sport),
          leagueName: args.leagueName ?? undefined,
          teamAName,
          teamBName,
          scoreA: matchup.scoreA,
          scoreB: matchup.scoreB,
          week: args.week,
          season: args.season,
          situation,
          matchupId: matchup.matchupId,
        },
        { skipStats: true, persist: true }
      ).catch(() => {});
      telemetry.emitted += 1;
    }
  } catch {
    // non-fatal
  }
  return telemetry;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 10000): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function cachedSleeperFetch<T>(url: string, cacheKey: string): Promise<T | null> {
  const cached = await prisma.sportsDataCache.findUnique({
    where: { cacheKey },
  });

  if (cached && cached.expiresAt > new Date()) {
    return cached.data as T;
  }

  const data = await fetchJsonWithTimeout<T>(url);
  if (data == null) {
    return null;
  }

  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    update: {
      data,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    },
    create: {
      cacheKey,
      data,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    },
  });

  return data;
}

function buildLeagueUpdateData(leagueData: SleeperLeague, season: number, sportLabel: LeagueSport) {
  return {
    name: leagueData.name || "Unnamed League",
    avatarUrl: getSleeperAvatarUrl(leagueData.avatar),
    leagueSize: leagueData.total_rosters ?? null,
    status: leagueData.status || "active",
    season,
    sport: sportLabel,
    scoring: getScoringType(leagueData),
    isDynasty: leagueData.settings?.type === 2,
    ...(leagueData.roster_positions ? { starters: leagueData.roster_positions } : {}),
    ...(leagueData.roster_positions
      ? { rosterSize: leagueData.roster_positions.length }
      : { rosterSize: null }),
    ...(leagueData.settings ? { settings: leagueData.settings } : {}),
  };
}

/** League row only (no rosters/matchups) — used for historical Sleeper seasons. */
export async function upsertSleeperLeagueMetadataOnly(
  leagueData: SleeperLeague,
  userId: string,
  season: number,
  sportLabel: LeagueSport
) {
  const platformLeagueId = leagueData.league_id?.toString();
  if (!platformLeagueId) return null;
  const leaguePayload = buildLeagueUpdateData(leagueData, season, sportLabel);
  return prisma.league.upsert({
    where: {
      userId_platform_platformLeagueId_season: {
        userId,
        platform: "sleeper",
        platformLeagueId,
        season,
      },
    },
    update: leaguePayload,
    create: {
      userId,
      platform: "sleeper",
      platformLeagueId,
      ...leaguePayload,
    },
  });
}

export async function processLeague(
  leagueData: SleeperLeague,
  userId: string,
  season: number,
  sportLabel: LeagueSport
): Promise<{ leagueId: string; commentaryTelemetry: MatchupCommentaryTelemetry } | null> {
  const platformLeagueId = leagueData.league_id?.toString();
  if (!platformLeagueId) return null;

  const leaguePayload = {
    ...buildLeagueUpdateData(leagueData, season, sportLabel),
    /** Full Sleeper hub sync supersedes ranking-only snapshot rows (`legacy_summary` / `ranking_only`). */
    leagueVariant: null,
    importWins: null,
    importLosses: null,
    importTies: null,
    importMadePlayoffs: null,
    importWonChampionship: null,
    importFinalStanding: null,
    importPointsFor: null,
  };

  const league = await prisma.league.upsert({
    where: {
      userId_platform_platformLeagueId_season: {
        userId,
        platform: "sleeper",
        platformLeagueId,
        season,
      },
    },
    update: leaguePayload,
    create: {
      userId,
      platform: "sleeper",
      platformLeagueId,
      ...leaguePayload,
    },
  });

  await prisma.sportsDataCache.upsert({
    where: { cacheKey: `sleeper:league:${platformLeagueId}` },
    update: {
      data: leagueData,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    },
    create: {
      cacheKey: `sleeper:league:${platformLeagueId}`,
      data: leagueData,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    },
  });

  const [users, rosters] = await Promise.all([
    getLeagueUsers(platformLeagueId) as Promise<SleeperUser[]>,
    getLeagueRosters(platformLeagueId) as Promise<SleeperRoster[]>,
  ]);

  if (!Array.isArray(users) || !Array.isArray(rosters)) {
    return {
      leagueId: league.id,
      commentaryTelemetry: {
        ...EMPTY_MATCHUP_COMMENTARY_TELEMETRY,
        skippedEmpty: 1,
      },
    };
  }

  const userMap = new Map<string, SleeperUser>();
  for (const user of users) {
    if (user.user_id) {
      userMap.set(user.user_id, user);
    }
  }

  const teamUpserts = rosters
    .map((roster) => {
      const ownerId = roster.owner_id ?? null;
      const owner = ownerId ? userMap.get(ownerId) : undefined;
      const ownerName = owner?.display_name || `Owner ${roster.roster_id ?? "Unknown"}`;
      const teamName = owner?.metadata?.team_name || `${ownerName}'s Team`;
      const externalId = roster.roster_id?.toString() || roster.owner_id?.toString();
      if (!externalId) {
        return null;
      }

      const wins = roster.settings?.wins ?? 0;
      const losses = roster.settings?.losses ?? 0;
      const ties = roster.settings?.ties ?? 0;
      const pointsFor =
        (roster.settings?.fpts ?? 0) + (roster.settings?.fpts_decimal ?? 0) / 100;
      const pointsAgainst =
        (roster.settings?.fpts_against ?? 0) +
        (roster.settings?.fpts_against_decimal ?? 0) / 100;
      const isTeamCommissioner = owner?.is_owner === true;
      const isOrphan = !ownerId || ownerId === "";
      const role = isTeamCommissioner ? "commissioner" : isOrphan ? "orphan" : "member";

      /*
       * 🛑 "NO OWNER ON THE SEAT" — NOT "THE TEAM IS GONE". Sleeper lists this roster, so the
       * franchise is CURRENT; what is missing is the manager, which is the other axis.
       * `applySleeperLeagueSync` writes the identical flag to mean departure, and separating the
       * two is the whole point of these fields. See the note in that file.
       */
      const managerKind = isOrphan ? "VACANT" : "HUMAN";

      return prisma.leagueTeam.upsert({
        where: {
          leagueId_externalId: {
            leagueId: league.id,
            externalId,
          },
        },
        update: {
          ownerName,
          teamName,
          avatarUrl:
            getSleeperAvatarUrl(owner?.metadata?.avatar) ??
            getSleeperAvatarUrl(owner?.user_id || roster.owner_id),
          wins,
          losses,
          ties,
          pointsFor,
          pointsAgainst,
          role,
          isOrphan,
          /* Reappearance: the provider listing this roster retracts any earlier archive. */
          lifecycleState: "CURRENT",
          managerKind,
          archivedAt: null,
          archiveReason: null,
          platformUserId: ownerId,
          isCommissioner: isTeamCommissioner,
        },
        create: {
          leagueId: league.id,
          externalId,
          ownerName,
          teamName,
          avatarUrl:
            getSleeperAvatarUrl(owner?.metadata?.avatar) ??
            getSleeperAvatarUrl(owner?.user_id || roster.owner_id),
          wins,
          losses,
          ties,
          pointsFor,
          pointsAgainst,
          role,
          isOrphan,
          lifecycleState: "CURRENT",
          managerKind,
          platformUserId: ownerId,
          isCommissioner: isTeamCommissioner,
          isCoCommissioner: false,
        },
      });
    })
    .filter((value) => value !== null);

  await Promise.all(teamUpserts);

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: league.id },
    select: { id: true, externalId: true, teamName: true, ownerName: true },
  });

  const teamsByExternalId = new Map(teams.map((team) => [team.externalId, team.id]));
  const teamMetaByExternalId = new Map(
    teams.map((team) => [
      team.externalId,
      { teamName: team.teamName, ownerName: team.ownerName },
    ])
  );

  const currentWeek = leagueData.settings?.leg ?? 10;
  const maxWeek = Math.min(currentWeek, 18);
  let currentWeekMatchups: LiveMatchupScore[] = [];

  await Promise.all(
    Array.from({ length: maxWeek }, (_, index) => index + 1).map((week) =>
      weekImportLimit(async () => {
        const safeMatchups = await getLeagueMatchups(platformLeagueId, week) as unknown as SleeperMatchup[];

        if (!Array.isArray(safeMatchups)) {
          return;
        }

        if (week === currentWeek) {
          currentWeekMatchups = buildLiveMatchupScores(safeMatchups);
        }

        await Promise.all(
          safeMatchups.map(async (matchup) => {
            const teamId = teamsByExternalId.get(matchup.roster_id?.toString() || "");

            if (!teamId || matchup.points == null) {
              return;
            }

            await prisma.teamPerformance.upsert({
              where: {
                teamId_season_week: {
                  teamId,
                  season,
                  week,
                },
              },
              update: {
                points: matchup.points || 0,
              },
              create: {
                teamId,
                season,
                week,
                points: matchup.points || 0,
              },
            });
          })
        );
      })
    )
  );

  let commentaryTelemetry: MatchupCommentaryTelemetry = {
    ...EMPTY_MATCHUP_COMMENTARY_TELEMETRY,
    skippedEmpty: 1,
  };
  if (currentWeekMatchups.length > 0) {
    commentaryTelemetry = await emitLiveMatchupCommentary({
      leagueId: league.id,
      leagueName: league.name ?? null,
      sport: league.sport,
      season,
      week: currentWeek,
      matchups: currentWeekMatchups,
      teamMetaByExternalId,
    });
  }

  console.info(
    `[Import Sleeper][Commentary] league=${league.id} week=${currentWeek} featured=${commentaryTelemetry.featured} evaluated=${commentaryTelemetry.evaluated} emitted=${commentaryTelemetry.emitted} skippedDuplicate=${commentaryTelemetry.skippedDuplicate} skippedMinor=${commentaryTelemetry.skippedMinor} skippedEmpty=${commentaryTelemetry.skippedEmpty}`
  );

  return {
    leagueId: league.id,
    commentaryTelemetry,
  };
}

export function sumCommentaryTelemetry(
  rows: Array<{ commentaryTelemetry: MatchupCommentaryTelemetry }>
): MatchupCommentaryTelemetry {
  return rows.reduce(
    (acc, row) => ({
      evaluated: acc.evaluated + row.commentaryTelemetry.evaluated,
      featured: acc.featured + row.commentaryTelemetry.featured,
      emitted: acc.emitted + row.commentaryTelemetry.emitted,
      skippedDuplicate: acc.skippedDuplicate + row.commentaryTelemetry.skippedDuplicate,
      skippedMinor: acc.skippedMinor + row.commentaryTelemetry.skippedMinor,
      skippedEmpty: acc.skippedEmpty + row.commentaryTelemetry.skippedEmpty,
    }),
    { ...EMPTY_MATCHUP_COMMENTARY_TELEMETRY }
  );
}
