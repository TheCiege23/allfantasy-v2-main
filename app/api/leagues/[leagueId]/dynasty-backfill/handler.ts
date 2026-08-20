import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  runDynastyBackfill,
  getDynastyBackfillStatus,
} from "@/lib/dynasty-import";
import { buildLeagueGraph } from "@/lib/league-intelligence-graph";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  force: z.boolean().optional().default(false),
  maxSeasons: z.number().int().min(1).max(30).optional(),
  skipExistingSeasons: z.boolean().optional().default(true),
  refreshGraphAfter: z.boolean().optional().default(true),
});

/** GET — return current backfill status for the league */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params;
    if (!leagueId) {
      return NextResponse.json({ error: "Missing leagueId" }, { status: 400 });
    }
    const status = await getDynastyBackfillStatus(leagueId, "sleeper");
    const dynastySeasons = await prisma.leagueDynastySeason.findMany({
      where: { leagueId },
      orderBy: { season: "asc" },
      select: { season: true, platformLeagueId: true, importedAt: true },
    });
    return NextResponse.json({
      leagueId,
      backfill: status
        ? {
            status: status.status,
            provider: status.provider,
            seasonsDiscovered: (status.seasonsDiscovered as number[]) ?? [],
            seasonsImported: (status.seasonsImported as number[]) ?? [],
            seasonsSkipped: (status.seasonsSkipped as number[]) ?? [],
            lastStartedAt: status.lastStartedAt,
            lastCompletedAt: status.lastCompletedAt,
            failureMessage: status.failureMessage,
            metadata: status.metadata,
          }
        : null,
      dynastySeasons,
    });
  } catch (e) {
    console.error("[dynasty-backfill GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load backfill status" },
      { status: 500 }
    );
  }
}

/** POST — run historical backfill for dynasty league (Sleeper). Requires auth; league must be owned by user. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { leagueId } = await ctx.params;
    if (!leagueId) {
      return NextResponse.json({ error: "Missing leagueId" }, { status: 400 });
    }
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { userId: true },
    });
    if (!league || league.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    const options = parsed.success ? parsed.data : { force: false, skipExistingSeasons: true, refreshGraphAfter: true };

    const result = await runDynastyBackfill({
      leagueId,
      force: options.force,
      maxSeasons: options.maxSeasons,
      skipExistingSeasons: options.skipExistingSeasons,
    });

    if (options.refreshGraphAfter && (result.seasonsImported > 0 || result.seasonsSkipped > 0)) {
      try {
        await buildLeagueGraph({
          leagueId,
          season: null,
          includeTrades: true,
          includeRivalries: true,
        });
      } catch (graphErr) {
        console.warn("[dynasty-backfill] Graph refresh after backfill failed:", graphErr);
      }
    }

    return NextResponse.json({
      success: result.success,
      status: result.status,
      seasonsDiscovered: result.seasonsDiscovered,
      seasonsImported: result.seasonsImported,
      seasonsSkipped: result.seasonsSkipped,
      tradesPersisted: result.tradesPersisted,
      observability: result.observability,
      failureMessage: result.failureMessage,
    });
  } catch (e) {
    console.error("[dynasty-backfill POST]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
