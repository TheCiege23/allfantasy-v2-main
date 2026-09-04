import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordLeagueTombstone } from "@/lib/league-delete/leagueTombstones";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Remove a league from the signed-in user's dashboard (deletes the user's `League` or `SleeperLeague` row).
 * Does not delete the league on Sleeper or other external platforms.
 *
 * ⚠ ALSO WRITES A TOMBSTONE, and the delete is not complete without it. This is
 * a hard delete, so once the row is gone nothing distinguishes "never imported"
 * from "deliberately removed" and the next import or sync recreates the league.
 * The tombstone is that distinction — see lib/league-delete/leagueTombstones.ts.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string };
    } | null;
    const userId = session?.user?.id?.trim();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { leagueId } = await params;
    const id = leagueId?.trim();
    if (!id) {
      return NextResponse.json({ error: "leagueId required" }, { status: 400 });
    }

    const league = await prisma.league.findFirst({
      where: { id, userId },
      select: { id: true, platform: true, platformLeagueId: true, name: true },
    });

    const sleeperLeague = await prisma.sleeperLeague.findFirst({
      where: { id, userId },
      select: { id: true, sleeperLeagueId: true },
    });

    const tournament = await prisma.legacyTournament.findFirst({
      where: { id, creatorId: userId },
      select: { id: true },
    });

    if (!league && !sleeperLeague && !tournament) {
      return NextResponse.json({
        ok: true,
        removed: {
          leagueRows: 0,
          sleeperLeagueRows: 0,
          tournamentRows: 0,
        },
      });
    }

    const normalizedPlatform = String(league?.platform ?? "").toLowerCase();
    const linkedSleeperLeagueId =
      normalizedPlatform === "sleeper" && typeof league?.platformLeagueId === "string"
        ? league.platformLeagueId
        : sleeperLeague?.sleeperLeagueId ?? null;

    const [deletedLeagueRows, deletedSleeperRows, deletedTournamentRows] =
      await prisma.$transaction([
        prisma.league.deleteMany({
          where: {
            userId,
            OR: [
              { id },
              ...(linkedSleeperLeagueId
                ? [
                    {
                      platform: "sleeper",
                      platformLeagueId: linkedSleeperLeagueId,
                    },
                  ]
                : []),
            ],
          },
        }),
        prisma.sleeperLeague.deleteMany({
          where: {
            userId,
            OR: [
              { id },
              ...(linkedSleeperLeagueId
                ? [{ sleeperLeagueId: linkedSleeperLeagueId }]
                : []),
            ],
          },
        }),
        // Dashboard reader also surfaces `LegacyTournament` rows as leagues (tournament hubs).
        // If we leave them, a deleted "league" can re-appear on refresh as its tournament row.
        // Scope by `creatorId` to mirror the reader and avoid touching other users' rows.
        prisma.legacyTournament.deleteMany({
          where: {
            creatorId: userId,
            id,
          },
        }),
      ]);

    /*
     * Remember the removal, so the next import/sync does not undo it.
     *
     * ⚠ AFTER the delete, deliberately. Writing the tombstone first would leave
     * a league suppressed but still present if the transaction above threw —
     * the user would see the league, be unable to make it go away, and get no
     * error explaining why. Losing the tombstone on a failed delete is the
     * strictly safer of the two failure modes.
     *
     * Keyed on the external identity rather than `id`, because a re-import
     * mints a new `League.id`. A Sleeper row with no `League` row still has one:
     * its `sleeperLeagueId` under the "sleeper" platform.
     *
     * `LegacyTournament` is not tombstoned: it is an internal hub row with no
     * provider identity, so no import or sync path can bring it back.
     */
    const tombstonePlatform = league?.platform ?? (sleeperLeague ? "sleeper" : null);
    const tombstoneLeagueId =
      league?.platformLeagueId ?? sleeperLeague?.sleeperLeagueId ?? null;

    let tombstoned = false;
    if (tombstonePlatform && tombstoneLeagueId) {
      try {
        tombstoned = await recordLeagueTombstone({
          userId,
          platform: tombstonePlatform,
          platformLeagueId: tombstoneLeagueId,
          leagueName: league?.name ?? null,
        });
      } catch (tombstoneError) {
        // The rows ARE gone; failing the response now would tell the user the
        // delete did not happen when it did. Report the partial outcome instead
        // so the caller can see the league will be re-importable without a
        // confirmation prompt.
        console.error("[api/league/[leagueId] DELETE] tombstone write failed", tombstoneError);
      }
    }

    return NextResponse.json({
      ok: true,
      tombstoned,
      removed: {
        leagueRows: deletedLeagueRows.count,
        sleeperLeagueRows: deletedSleeperRows.count,
        tournamentRows: deletedTournamentRows.count,
      },
    });
  } catch (e: unknown) {
    console.error("[api/league/[leagueId] DELETE]", e);
    return NextResponse.json(
      { error: "Could not remove league. It may still be in use elsewhere." },
      { status: 500 }
    );
  }
}
