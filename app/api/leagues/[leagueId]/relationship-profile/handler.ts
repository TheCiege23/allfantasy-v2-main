import { NextResponse } from "next/server";
import {
  buildLeagueGraph,
  buildLeagueRelationshipProfile,
  normalizeSportForGraph,
} from "@/lib/league-intelligence-graph";
import { syncRivalryEdgesIntoGraph } from "@/lib/relationship-insights";
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = "force-dynamic";

/**
 * GET — returns LeagueRelationshipProfile (rivalries, trade clusters, influence leaders,
 * central/isolated managers, dynasty power transitions, elimination patterns).
 * When season is omitted, includes all dynasty history.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params;
    if (!leagueId) {
      return NextResponse.json({ error: "Missing leagueId" }, { status: 400 });
    }
    // Membership gate. Reachable both directly and via the [section]
    // dispatcher, and was open to anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
    const url = new URL(_req.url);
    const seasonParam = url.searchParams?.get("season");
    const season = seasonParam != null ? parseInt(seasonParam, 10) : null;
    const sportParam = normalizeSportForGraph(url.searchParams?.get("sport"));
    const rebuild = url.searchParams?.get("rebuild") === "1";
    const syncRivalryEdges = url.searchParams?.get("syncRivalryEdges") !== "0";

    const buildInput = {
      leagueId,
      season: Number.isNaN(season) ? null : season,
      includeTrades: true,
      includeRivalries: true,
    } as const;

    if (rebuild) {
      await buildLeagueGraph(buildInput).catch(() => null);
    }
    if (syncRivalryEdges) {
      await syncRivalryEdgesIntoGraph({
        leagueId,
        sport: sportParam,
        season: Number.isNaN(season) ? null : season,
      }).catch(() => null);
    }

    let profile = await buildLeagueRelationshipProfile({
      leagueId,
      season: Number.isNaN(season) ? null : season,
      sport: sportParam,
      limits: {
        rivalries: 20,
        clusters: 10,
        influence: 15,
        central: 30,
        transitions: 20,
        elimination: 20,
      },
    });

    const seemsEmpty =
      profile.strongestRivalries.length === 0 &&
      profile.tradeClusters.length === 0 &&
      profile.influenceLeaders.length === 0 &&
      profile.dynastyPowerTransitions.length === 0 &&
      profile.repeatedEliminationPatterns.length === 0;

    if (!rebuild && seemsEmpty) {
      await buildLeagueGraph(buildInput).catch(() => null);
      if (syncRivalryEdges) {
        await syncRivalryEdgesIntoGraph({
          leagueId,
          sport: sportParam,
          season: Number.isNaN(season) ? null : season,
        }).catch(() => null);
      }
      profile = await buildLeagueRelationshipProfile({
        leagueId,
        season: Number.isNaN(season) ? null : season,
        sport: sportParam,
        limits: {
          rivalries: 20,
          clusters: 10,
          influence: 15,
          central: 30,
          transitions: 20,
          elimination: 20,
        },
      });
    }
    return NextResponse.json(profile);
  } catch (e) {
    console.error("[relationship-profile GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build relationship profile" },
      { status: 500 }
    );
  }
}
