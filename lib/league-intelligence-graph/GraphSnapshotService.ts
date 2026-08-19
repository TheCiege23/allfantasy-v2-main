/**
 * League Intelligence Graph — snapshot lifecycle: build nodes/edges and persist snapshot.
 */

import { prisma } from "@/lib/prisma";
import { toPrismaJsonInput, toPrismaNullableJsonInput } from "@/lib/prisma-json";
import { buildGraphNodes } from "./GraphNodeBuilder";
import { buildGraphEdges } from "./GraphEdgeBuilder";
import type { GraphNodeBuilderInput } from "./GraphNodeBuilder";
import type { LeagueGraphSnapshotPayload } from "./types";

export interface BuildSnapshotInput {
  leagueId: string;
  season: number | null;
  includeTrades?: boolean;
  includeRivalries?: boolean;
  scopeUserId?: string | null;
  graphVersion?: number;
}

/**
 * Builds a full graph snapshot for the league (and optional season):
 * 1. Deletes existing graph data for this league+season
 * 2. Builds nodes and edges via GraphNodeBuilder / GraphEdgeBuilder
 * 3. Persists nodes and edges
 * 4. Creates or updates LeagueGraphSnapshot
 */
export async function buildAndPersistSnapshot(
  input: BuildSnapshotInput
): Promise<{ nodeCount: number; edgeCount: number; snapshotId: string }> {
  const {
    leagueId,
    season,
    includeTrades = true,
    includeRivalries = true,
    scopeUserId,
    graphVersion = 1,
  } = input;

  const builderInput: GraphNodeBuilderInput = {
    leagueId,
    season,
    includeTrades,
    includeRivalries,
    scopeUserId,
  };

  const nodes = await buildGraphNodes(builderInput);
  const edges = await buildGraphEdges({
    ...builderInput,
    nodes,
  });

  const seasonFilter = season != null ? season : undefined;

  await prisma.$transaction(async (tx) => {
    const nodeIds = nodes.map((n) => n.nodeId);
    if (nodeIds.length > 0) {
      await tx.graphEdge.deleteMany({
        where: {
          OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
        },
      });
    }
    await tx.graphNode.deleteMany({
      where: {
        leagueId,
        ...(seasonFilter != null ? { season: seasonFilter } : {}),
      },
    });

    if (nodes.length > 0) {
      await tx.graphNode.createMany({
        data: nodes.map((n) => ({
          nodeId: n.nodeId,
          nodeType: n.nodeType,
          entityId: n.entityId,
          leagueId: n.leagueId,
          season: n.season,
          sport: n.sport ?? undefined,
          metadata: toPrismaNullableJsonInput(n.metadata),
        })),
        skipDuplicates: true,
      });
    }
    if (edges.length > 0) {
      await tx.graphEdge.createMany({
        data: edges.map((e) => ({
          edgeId: e.edgeId,
          fromNodeId: e.fromNodeId,
          toNodeId: e.toNodeId,
          edgeType: e.edgeType,
          weight: e.weight,
          season: e.season,
          sport: e.sport ?? undefined,
          metadata: toPrismaNullableJsonInput(e.metadata),
        })),
        skipDuplicates: true,
      });
    }

    const snapshotSeason = season ?? 0;
    await tx.leagueGraphSnapshot.upsert({
      where: {
        uniq_league_graph_snapshot_league_season: { leagueId, season: snapshotSeason },
      },
      update: {
        graphVersion,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        summary: toPrismaJsonInput({
          generatedFrom: "LeagueIntelligenceGraph",
          seasonScope: season ?? "all",
          includeTrades,
          includeRivalries,
        }),
        generatedAt: new Date(),
      },
      create: {
        leagueId,
        season: snapshotSeason,
        graphVersion,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        summary: toPrismaJsonInput({
          generatedFrom: "LeagueIntelligenceGraph",
          seasonScope: season ?? "all",
          includeTrades,
          includeRivalries,
        }),
      },
    });
  });

  const snapshot = await prisma.leagueGraphSnapshot.findUnique({
    where: {
      uniq_league_graph_snapshot_league_season: {
        leagueId,
        season: season ?? 0,
      },
    },
  });

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    snapshotId: snapshot?.id ?? "",
  };
}

/**
 * Returns the latest snapshot payload for a league (optionally for a season).
 */
export async function getSnapshot(
  leagueId: string,
  season: number | null
): Promise<LeagueGraphSnapshotPayload | null> {
  const s = season ?? 0;
  const row = await prisma.leagueGraphSnapshot.findUnique({
    where: {
      uniq_league_graph_snapshot_league_season: { leagueId, season: s },
    },
  });
  if (!row) return null;
  return {
    leagueId: row.leagueId,
    season: row.season,
    graphVersion: row.graphVersion,
    nodeCount: row.nodeCount,
    edgeCount: row.edgeCount,
    summary: (row.summary as Record<string, unknown>) ?? null,
  };
}
