import { prisma } from '@/lib/prisma';
import type {
  SleeperRosterRaw,
  SleeperUserRaw,
} from '@/lib/league-import/adapters/sleeper/types';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import {
  isLeagueTombstoned,
  LeagueDeletedByUserError,
} from '@/lib/league-delete/leagueTombstones';

export interface SleeperSyncResult {
  success: boolean;
  leagueId: string;
  unifiedLeagueId: string;
  name: string;
  totalTeams: number;
  rostersSync: number;
  scoringType: string;
  isDynasty: boolean;
  season: string;
}

function normalizeSleeperUsers(data: unknown): SleeperUserRaw[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      user_id: String(entry.user_id ?? ''),
      username: String(entry.username ?? entry.display_name ?? entry.user_id ?? ''),
      display_name:
        typeof entry.display_name === 'string' && entry.display_name.trim()
          ? entry.display_name
          : undefined,
      avatar: typeof entry.avatar === 'string' ? entry.avatar : undefined,
    }))
    .filter((entry) => entry.user_id && entry.username);
}

function normalizeSleeperRosters(data: unknown): SleeperRosterRaw[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => {
      const settings =
        entry.settings && typeof entry.settings === 'object' && !Array.isArray(entry.settings)
          ? (entry.settings as Record<string, unknown>)
          : {};
      return {
        roster_id: Number(entry.roster_id ?? 0),
        owner_id: String(entry.owner_id ?? ''),
        players: Array.isArray(entry.players) ? entry.players.map((player) => String(player)) : [],
        starters: Array.isArray(entry.starters) ? entry.starters.map((player) => String(player)) : [],
        reserve: Array.isArray(entry.reserve) ? entry.reserve.map((player) => String(player)) : [],
        taxi: Array.isArray(entry.taxi) ? entry.taxi.map((player) => String(player)) : [],
        settings: {
          wins: Number(settings.wins ?? 0),
          losses: Number(settings.losses ?? 0),
          ties: Number(settings.ties ?? 0),
          fpts: Number(settings.fpts ?? 0),
          fpts_decimal: Number(settings.fpts_decimal ?? 0),
          waiver_budget_used:
            settings.waiver_budget_used == null ? undefined : Number(settings.waiver_budget_used),
          waiver_position:
            settings.waiver_position == null ? undefined : Number(settings.waiver_position),
        },
      } satisfies SleeperRosterRaw;
    });
}

function buildSleeperLeagueAvatarUrl(avatar: unknown): string | null {
  return typeof avatar === 'string' && avatar.trim()
    ? `https://sleepercdn.com/avatars/thumbs/${avatar}`
    : null;
}

function buildSleeperUserAvatarUrl(avatar: string | undefined): string | null {
  return avatar ? `https://sleepercdn.com/avatars/thumbs/${avatar}` : null;
}

function toObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveSleeperScoringType(
  scoringSettings: Record<string, unknown>,
  rosterPositions: string[]
): string {
  const rec = toFiniteNumber(scoringSettings.rec, 0);
  let scoringType = 'standard';
  if (rec === 1) scoringType = 'ppr';
  else if (rec === 0.5) scoringType = 'half_ppr';

  if (rosterPositions.includes('SUPER_FLEX')) {
    scoringType += '_superflex';
  }

  return scoringType;
}

function resolveSleeperLeagueVariant(args: {
  sport: string;
  scoringSettings: Record<string, unknown>;
  rosterPositions: string[];
  isDynasty: boolean;
}): string | null {
  if (args.sport !== 'NFL') return null;

  const scoringFormat = resolveSleeperScoringType(args.scoringSettings, args.rosterPositions).toUpperCase();
  const hasIdpSignal =
    scoringFormat.includes('IDP') ||
    args.rosterPositions.some((slot) =>
      ['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB', 'IDP_FLEX'].includes(slot)
    );

  if (!hasIdpSignal) return null;
  return args.isDynasty ? 'DYNASTY_IDP' : 'IDP';
}

function buildUnifiedSleeperLeagueSettings(args: {
  leagueData: Record<string, unknown>;
  sleeperLeagueId: string;
  sport: string;
  leagueVariant: string | null;
  scoringSettings: Record<string, unknown>;
  rawSettings: Record<string, unknown>;
  rosterPositions: string[];
  syncedAt: Date;
}): Record<string, unknown> {
  return {
    ...args.leagueData,
    sport_type: args.sport,
    league_variant: args.leagueVariant,
    roster_positions: args.rosterPositions,
    scoring_settings: args.scoringSettings,
    raw_settings: args.rawSettings,
    source_tracking: {
      source_provider: 'sleeper',
      source_league_id: args.sleeperLeagueId,
      source_season_id: String(args.leagueData.season ?? ''),
      imported_at: args.syncedAt.toISOString(),
    },
  };
}

async function resolveSleeperManagerUserIds(ownerIds: string[]): Promise<Map<string, string>> {
  const uniqueOwnerIds = Array.from(new Set(ownerIds.filter(Boolean)));
  const resolved = new Map<string, string>();

  if (!uniqueOwnerIds.length) return resolved;

  const [usersByUsername, profilesBySleeperId] = await Promise.all([
    prisma.appUser.findMany({
      where: {
        username: {
          in: uniqueOwnerIds.map((ownerId) => `sleeper_${ownerId}`),
        },
      },
      select: {
        id: true,
        username: true,
      },
    }),
    prisma.userProfile.findMany({
      where: {
        sleeperUserId: { in: uniqueOwnerIds },
      },
      select: {
        userId: true,
        sleeperUserId: true,
      },
    }),
  ]);

  for (const user of usersByUsername) {
    if (!user.username.startsWith('sleeper_')) continue;
    const ownerId = user.username.slice('sleeper_'.length);
    if (ownerId) {
      resolved.set(ownerId, user.id);
    }
  }

  for (const profile of profilesBySleeperId) {
    if (profile.sleeperUserId) {
      resolved.set(profile.sleeperUserId, profile.userId);
    }
  }

  return resolved;
}

export async function syncSleeperLeague(
  sleeperLeagueId: string,
  userId: string,
  opts?: { forceActivate?: boolean }
): Promise<SleeperSyncResult> {
  /*
   * 🛑 REFUSE TO RESURRECT A LEAGUE THE USER DELETED. Same shape as the guard in
   * `syncLeague` (lib/league-sync-core.ts): `sleeperLeagueId` comes from a
   * request body, this function creates a League row further down, and nothing
   * else checks whether the user threw this league away.
   *
   * Note `forceActivate` does NOT override this. That flag exists to clear the
   * `legacy_summary` marker on a league the user is actively reactivating — it
   * says nothing about a deletion, and letting it double as a tombstone bypass
   * would silently reopen this path for the one caller that sets it.
   */
  if (
    await isLeagueTombstoned({ userId, platform: 'sleeper', platformLeagueId: sleeperLeagueId })
  ) {
    throw new LeagueDeletedByUserError(
      'This league was removed from your account. Re-import it to bring it back.'
    );
  }

  const [leagueRes, rostersRes, usersRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${sleeperLeagueId}`),
    fetch(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/users`),
  ]);

  if (!leagueRes.ok) throw new Error('League not found or private');
  if (!rostersRes.ok) throw new Error('Failed to fetch rosters');
  if (!usersRes.ok) throw new Error('Failed to fetch league users');

  const leagueData = await leagueRes.json();
  const rostersData = normalizeSleeperRosters(await rostersRes.json());
  const usersData = normalizeSleeperUsers(await usersRes.json());

  if (!leagueData || !leagueData.name) {
    throw new Error('Invalid league data returned from Sleeper');
  }

  const leagueRecord = toObjectRecord(leagueData);
  const rawSettings = toObjectRecord(leagueRecord.settings);
  const scoringSettings = toObjectRecord(leagueRecord.scoring_settings);
  const rosterPositions = Array.isArray(leagueRecord.roster_positions)
    ? leagueRecord.roster_positions.map((slot) => String(slot))
    : [];
  const scoringType = resolveSleeperScoringType(scoringSettings, rosterPositions);
  const sport = normalizeToSupportedSport(
    typeof leagueRecord.sport === 'string' ? leagueRecord.sport.toUpperCase() : undefined
  );
  const leagueVariant = resolveSleeperLeagueVariant({
    sport,
    scoringSettings,
    rosterPositions,
    isDynasty: toFiniteNumber(rawSettings.type, 0) === 2,
  });
  const leagueName = String(leagueRecord.name ?? 'Sleeper League');
  const totalTeams = toFiniteNumber(leagueRecord.total_rosters ?? rawSettings.num_teams, 12);
  const season = String(leagueRecord.season ?? new Date().getFullYear());
  const seasonNumber = toFiniteNumber(leagueRecord.season, new Date().getFullYear());
  const leagueStatus = String(leagueRecord.status ?? 'unknown');
  const isDynasty = toFiniteNumber(rawSettings.type, 0) === 2;
  const syncedAt = new Date();
  const waiverBudget = toFiniteNumber(rawSettings.waiver_budget, 100);

  const league = await (prisma as any).sleeperLeague.upsert({
    where: { sleeperLeagueId },
    update: {
      name: leagueName,
      totalTeams,
      season,
      status: leagueStatus,
      isDynasty,
      scoringType,
      rosterSettings: rosterPositions,
      lastSyncedAt: syncedAt,
      syncStatus: 'success',
      syncError: null,
    },
    create: {
      sleeperLeagueId,
      userId,
      name: leagueName,
      totalTeams,
      season,
      status: leagueStatus,
      isDynasty,
      scoringType,
      rosterSettings: rosterPositions,
      lastSyncedAt: syncedAt,
      syncStatus: 'success',
    },
  });

  const draftId = leagueRecord.draft_id;
  if (draftId) {
    try {
      const draftRes = await fetch(`https://api.sleeper.app/v1/draft/${draftId}`);
      if (draftRes.ok) {
        const draftData = await draftRes.json();
        const thirtyDays = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

        await prisma.sportsDataCache.upsert({
          where: { cacheKey: `draft-${draftId}` },
          update: { data: draftData, expiresAt: thirtyDays },
          create: { cacheKey: `draft-${draftId}`, data: draftData, expiresAt: thirtyDays },
        });

        const orderMapping = draftData.draft_order || {};
        await prisma.sportsDataCache.upsert({
          where: { cacheKey: `draft-order-${sleeperLeagueId}` },
          update: { data: orderMapping, expiresAt: thirtyDays },
          create: { cacheKey: `draft-order-${sleeperLeagueId}`, data: orderMapping, expiresAt: thirtyDays },
        });
      }
    } catch (draftErr) {
      console.warn(`[sleeper-sync] Draft cache failed for ${draftId}:`, draftErr);
    }
  }

  const existingUnifiedLeague = await (prisma as any).league.findFirst({
    where: {
      userId,
      platform: 'sleeper',
      platformLeagueId: sleeperLeagueId,
      season: seasonNumber,
    },
    select: {
      id: true,
      leagueVariant: true,
    },
  });

  const unifiedLeaguePayload = {
    name: leagueName,
    platform: 'sleeper',
    platformLeagueId: sleeperLeagueId,
    leagueSize: totalTeams,
    scoring: scoringType,
    isDynasty,
    sport,
    season: seasonNumber,
    rosterSize: Array.isArray(rosterPositions) ? rosterPositions.length : null,
    starters: rosterPositions,
    status: leagueStatus,
    avatarUrl: buildSleeperLeagueAvatarUrl(leagueRecord.avatar),
    settings: buildUnifiedSleeperLeagueSettings({
      leagueData: leagueRecord,
      sleeperLeagueId,
      sport,
      leagueVariant,
      scoringSettings,
      rawSettings,
      rosterPositions,
      syncedAt,
    }),
    lastSyncedAt: syncedAt,
    syncStatus: 'success',
    syncError: null,
    // Preserve ranking-import marker unless the caller explicitly force-activates the league
    // (e.g. user-triggered sync from the league management UI). Force-activate clears the
    // legacy_summary tag so the league appears in My Leagues going forward.
    leagueVariant:
      !opts?.forceActivate && existingUnifiedLeague?.leagueVariant === 'legacy_summary'
        ? 'legacy_summary'
        : leagueVariant,
  };

  const unifiedLeague = existingUnifiedLeague
    ? await (prisma as any).league.update({
        where: { id: existingUnifiedLeague.id },
        data: unifiedLeaguePayload,
      })
    : await (prisma as any).league.create({
        data: {
          userId,
          ...unifiedLeaguePayload,
        },
      });

  const sleeperUsersById = new Map(usersData.map((user) => [user.user_id, user] as const));
  const managerUserIds = await resolveSleeperManagerUserIds(
    rostersData.map((roster) => roster.owner_id || '')
  );
  const existingLeagueTeams = await prisma.leagueTeam.findMany({
    where: { leagueId: unifiedLeague.id },
    select: {
      externalId: true,
      pointsAgainst: true,
      currentRank: true,
    },
  });
  const existingLeagueTeamsByExternalId = new Map(
    existingLeagueTeams.map((team) => [team.externalId, team] as const)
  );
  const rankByRosterId = new Map(
    [...rostersData]
      .map((roster) => ({
        rosterId: String(roster.roster_id),
        wins: toFiniteNumber(roster.settings?.wins, 0),
        losses: toFiniteNumber(roster.settings?.losses, 0),
        ties: toFiniteNumber(roster.settings?.ties, 0),
        pointsFor:
          toFiniteNumber(roster.settings?.fpts, 0) +
          toFiniteNumber(roster.settings?.fpts_decimal, 0) / 100,
      }))
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        if (b.ties !== a.ties) return b.ties - a.ties;
        if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
        return a.rosterId.localeCompare(b.rosterId, undefined, { numeric: true });
      })
      .map((roster, index) => [roster.rosterId, index + 1] as const)
  );

  let rosterCount = 0;
  for (const roster of rostersData) {
    const rId = String(roster.roster_id);
    const ownerId = roster.owner_id || `unowned_${rId}`;
    const players = Array.isArray(roster.players) ? roster.players : [];
    const starters = Array.isArray(roster.starters) ? roster.starters : [];
    const reserve = Array.isArray(roster.reserve) ? roster.reserve : [];
    const taxi = Array.isArray(roster.taxi) ? roster.taxi : [];
    const bench = players.filter((p: string) => !starters.includes(p));
    const sleeperUser = sleeperUsersById.get(ownerId);
    const ownerName = sleeperUser?.display_name || sleeperUser?.username || ownerId;
    const teamName = ownerName;
    const avatarUrl = buildSleeperUserAvatarUrl(sleeperUser?.avatar);
    const pointsFor =
      Number(roster.settings?.fpts ?? 0) + Number(roster.settings?.fpts_decimal ?? 0) / 100;
    const existingLeagueTeam = existingLeagueTeamsByExternalId.get(rId);
    const currentRank = rankByRosterId.get(rId) ?? existingLeagueTeam?.currentRank ?? null;
    const platformUserId = managerUserIds.get(ownerId) ?? ownerId;
    const existingUnifiedRoster = await prisma.roster.findFirst({
      where: {
        leagueId: unifiedLeague.id,
        OR: [
          { platformUserId },
          { platformUserId: ownerId },
        ],
      },
      select: {
        id: true,
      },
    });

    await (prisma as any).sleeperRoster.upsert({
      where: {
        leagueId_rosterId: { leagueId: league.id, rosterId: rId },
      },
      update: {
        ownerId,
        players,
        starters,
        bench,
        faabRemaining: roster.settings?.waiver_budget_used != null
          ? waiverBudget - roster.settings.waiver_budget_used
          : null,
        waiverPriority: roster.settings?.waiver_position ?? null,
        updatedAt: new Date(),
      },
      create: {
        leagueId: league.id,
        ownerId,
        rosterId: rId,
        players,
        starters,
        bench,
        faabRemaining: roster.settings?.waiver_budget_used != null
          ? waiverBudget - roster.settings.waiver_budget_used
          : null,
        waiverPriority: roster.settings?.waiver_position ?? null,
      },
    });

    await prisma.leagueTeam.upsert({
      where: {
        leagueId_externalId: {
          leagueId: unifiedLeague.id,
          externalId: rId,
        },
      },
      update: {
        ownerName,
        teamName,
        avatarUrl,
        wins: roster.settings?.wins ?? 0,
        losses: roster.settings?.losses ?? 0,
        ties: roster.settings?.ties ?? 0,
        pointsFor,
        pointsAgainst: existingLeagueTeam?.pointsAgainst ?? 0,
        currentRank,
      },
      create: {
        leagueId: unifiedLeague.id,
        externalId: rId,
        ownerName,
        teamName,
        avatarUrl,
        wins: roster.settings?.wins ?? 0,
        losses: roster.settings?.losses ?? 0,
        ties: roster.settings?.ties ?? 0,
        pointsFor,
        pointsAgainst: existingLeagueTeam?.pointsAgainst ?? 0,
        currentRank,
      },
    });

    const playerData = {
      players,
      starters,
      reserve,
      taxi,
      source_provider: 'sleeper',
      source_league_id: sleeperLeagueId,
      source_team_id: rId,
      source_manager_id: ownerId,
      source_season_id: season,
      imported_at: new Date().toISOString(),
      ...(platformUserId !== ownerId ? { app_user_id: platformUserId } : {}),
    };

    if (existingUnifiedRoster) {
      await prisma.roster.update({
        where: { id: existingUnifiedRoster.id },
        data: {
          platformUserId,
          playerData: playerData as any,
          faabRemaining: roster.settings?.waiver_budget_used != null
            ? waiverBudget - roster.settings.waiver_budget_used
            : null,
          waiverPriority: roster.settings?.waiver_position ?? null,
        },
      });
    } else {
      await prisma.roster.create({
        data: {
          leagueId: unifiedLeague.id,
          platformUserId,
          playerData: playerData as any,
          faabRemaining: roster.settings?.waiver_budget_used != null
            ? waiverBudget - roster.settings.waiver_budget_used
            : null,
          waiverPriority: roster.settings?.waiver_position ?? null,
        },
      });
    }

    rosterCount++;
  }

  return {
    success: true,
    leagueId: league.id,
    unifiedLeagueId: unifiedLeague.id,
    name: league.name,
    totalTeams: league.totalTeams,
    rostersSync: rosterCount,
    scoringType: league.scoringType,
    isDynasty: league.isDynasty,
    season: league.season,
  };
}
