import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCommissionerRole } from "@/lib/league/permissions";
import { carryAfOwnedLeagueSettings } from "@/lib/league/afOwnedLeagueSettings";
import { sleeperAvatarUrl } from "@/lib/sleeper-avatar";
import { getLeagueInfo, getLeagueRosters, getLeagueUsers } from "@/lib/sleeper-client";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let body: { leagueId?: string };
    try {
      body = (await req.json()) as { leagueId?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const leagueId = body.leagueId?.trim();
    if (!leagueId) {
      return NextResponse.json({ error: "leagueId required" }, { status: 400 });
    }

    await requireCommissionerRole(leagueId, session.user.id);

    const league = await prisma.league.findFirst({
      where: { id: leagueId },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    if (league.platform !== "sleeper") {
      return NextResponse.json({ error: "Only Sleeper leagues can be refreshed" }, { status: 400 });
    }

    if (!league.platformLeagueId) {
      return NextResponse.json({ error: "No Sleeper league ID" }, { status: 400 });
    }

    const sleeperLeagueId = league.platformLeagueId;

    const [leagueRes, usersRes, rostersRes] = await Promise.all([
      getLeagueInfo(sleeperLeagueId),
      getLeagueUsers(sleeperLeagueId),
      getLeagueRosters(sleeperLeagueId),
    ]);

    if (!leagueRes || typeof leagueRes !== "object") {
      return NextResponse.json({ error: "Could not reach Sleeper API" }, { status: 502 });
    }

    const lr = leagueRes as {
      name?: string;
      status?: string;
      total_rosters?: number;
      settings?: Record<string, unknown>;
      avatar?: string | null;
    };

    const users = Array.isArray(usersRes) ? usersRes : [];
    const rosters = Array.isArray(rostersRes) ? rostersRes : [];

    type SleeperUserRow = {
      user_id?: string;
      display_name?: string;
      username?: string;
      avatar?: string | null;
      metadata?: { team_name?: string | null } | null;
      is_owner?: boolean;
    };
    type SleeperRosterRow = {
      roster_id?: number;
      owner_id?: string;
      settings?: {
        wins?: number;
        losses?: number;
        fpts?: number;
        fpts_decimal?: number;
      };
    };

    const updatedTeams = (users as SleeperUserRow[]).map((user) => {
      const roster = (rosters as SleeperRosterRow[]).find((r) => r.owner_id === user.user_id);
      const avatarUrl = sleeperAvatarUrl(user.avatar);

      const wins = roster?.settings?.wins ?? 0;
      const losses = roster?.settings?.losses ?? 0;
      const pf =
        (roster?.settings?.fpts ?? 0) + (roster?.settings?.fpts_decimal ?? 0) / 100;

      const displayName = user.display_name || user.username || "Unknown";
      const teamName = user.metadata?.team_name?.trim() || displayName;

      return {
        sleeperUserId: String(user.user_id ?? ""),
        displayName,
        teamName,
        avatarUrl,
        isCommissioner: user.is_owner === true,
        rosterId: roster?.roster_id ?? null,
        wins,
        losses,
        pointsFor: pf,
        externalId: roster?.roster_id != null ? String(roster.roster_id) : `user_${user.user_id}`,
      };
    });

    /*
     * Sleeper's `settings` replaces the row's — but AllFantasy's own keys (published
     * standings, dues tracker, invite code …) are carried over from the row first,
     * or a refresh would erase them. See lib/league/afOwnedLeagueSettings.ts.
     */
    const settingsJson = (
      lr.settings ? carryAfOwnedLeagueSettings(league.settings, lr.settings) : league.settings
    ) as Prisma.InputJsonValue | undefined;

    await prisma.league.update({
      where: { id: leagueId },
      data: {
        name: lr.name || league.name,
        status: lr.status || league.status,
        leagueSize: lr.total_rosters ?? league.leagueSize,
        settings: settingsJson ?? undefined,
        avatarUrl: sleeperAvatarUrl(lr.avatar) ?? league.avatarUrl,
        lastSyncedAt: new Date(),
      },
    });

    let teamsUpserted = 0;
    for (const team of updatedTeams) {
      if (!team.sleeperUserId) continue;
      try {
        await prisma.leagueTeam.upsert({
          where: {
            leagueId_externalId: {
              leagueId,
              externalId: team.externalId,
            },
          },
          update: {
            ownerName: team.displayName,
            teamName: team.teamName,
            avatarUrl: team.avatarUrl,
            role: team.isCommissioner ? "commissioner" : "member",
            platformUserId: team.sleeperUserId,
            wins: team.wins,
            losses: team.losses,
            pointsFor: team.pointsFor,
            isCommissioner: team.isCommissioner,
          },
          create: {
            leagueId,
            externalId: team.externalId,
            ownerName: team.displayName,
            teamName: team.teamName,
            avatarUrl: team.avatarUrl,
            role: team.isCommissioner ? "commissioner" : "member",
            platformUserId: team.sleeperUserId,
            wins: team.wins,
            losses: team.losses,
            pointsFor: team.pointsFor,
            isCommissioner: team.isCommissioner,
            isCoCommissioner: false,
          },
        });
        teamsUpserted += 1;
      } catch (e: unknown) {
        console.warn("[league/refresh] LeagueTeam upsert failed:", e);
      }
    }

    return NextResponse.json({
      success: true,
      leagueId,
      teamsRefreshed: updatedTeams.length,
      teamsUpserted,
      teams: updatedTeams,
    });
  } catch (err: unknown) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : "Refresh failed";
    console.error("[league/refresh]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
