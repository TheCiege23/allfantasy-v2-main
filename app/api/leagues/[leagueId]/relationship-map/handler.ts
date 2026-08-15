import { NextResponse } from "next/server";
import {
  buildLeagueGraph,
  buildRelationshipMap,
  normalizeSportForGraph,
} from "@/lib/league-intelligence-graph";
import { syncRivalryEdgesIntoGraph } from "@/lib/relationship-insights";
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = "force-dynamic";

/**
 * GET — returns nodes, edges, rivals, trade partners, etc. for graph visualization.
 * Optional ?season= for single season; omit for all dynasty history.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params;
    if (!leagueId) {
    // Membership gate. Reachable both directly and via the [section]
    // dispatcher, and was open to anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
      return NextResponse.json({ error: "Missing leagueId" }, { status: 400 });
    }
    const url = new URL(_req.url);
    const seasonParam = url.searchParams?.get("season");
    const season = seasonParam != null ? parseInt(seasonParam, 10) : null;
    const sport = normalizeSportForGraph(url.searchParams?.get("sport"));
    const rebuild = url.searchParams?.get("rebuild") === "1";
    const syncRivalryEdges = url.searchParams?.get("syncRivalryEdges") !== "0";
    const seasonValue = Number.isNaN(season) ? null : season;

    const buildInput = {
      leagueId,
      season: seasonValue,
      includeTrades: true,
      includeRivalries: true,
    } as const;

    if (rebuild) {
      await buildLeagueGraph(buildInput).catch(() => null);
    }
    if (syncRivalryEdges) {
      await syncRivalryEdgesIntoGraph({
        leagueId,
        sport,
        season: seasonValue,
      }).catch(() => null);
    }

    let map = await buildRelationshipMap({
      leagueId,
      season: seasonValue,
      sport,
      limit: 100,
    });

    if (!rebuild && map.nodes.length === 0) {
      await buildLeagueGraph(buildInput).catch(() => null);
      if (syncRivalryEdges) {
        await syncRivalryEdgesIntoGraph({
          leagueId,
          sport,
          season: seasonValue,
        }).catch(() => null);
      }
      map = await buildRelationshipMap({
        leagueId,
        season: seasonValue,
        sport,
        limit: 100,
      });
    }
    return NextResponse.json(map);
  } catch (e) {
    console.error("[relationship-map GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build relationship map" },
      { status: 500 }
    );
  }
}
