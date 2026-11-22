/**
 * League Intelligence Graph — builds LeagueRelationshipProfile from analyzers and graph queries.
 */

import { prisma } from "@/lib/prisma";
import { analyzeRivalryPaths } from "./RivalryPathAnalyzer";
import { detectTradeClusters } from "./TradeClusterDetector";
import { calculateCentrality } from "./CentralityCalculator";
import { detectDynastyPowerShifts } from "./DynastyPowerShiftDetector";
import { getRepeatedEliminationPatterns } from "./GraphQueryService";
import { normalizeSportForGraph } from "./SportGraphResolver";
import type {
  LeagueRelationshipProfile,
  InfluenceLeader,
  RivalryScore,
  TradeCluster,
  DynastyPowerTransition,
} from "./types";

export interface RelationshipSummaryInput {
  leagueId: string;
  season?: number | null;
  sport?: string | null;
  limitRivalries?: number;
  limitClusters?: number;
  limitInfluence?: number;
  limitCentral?: number;
  limitTransitions?: number;
  limitElimination?: number;
}

/**
 * Builds a full LeagueRelationshipProfile: rivalries, trade clusters, influence leaders,
 * central/isolated managers, dynasty power transitions, repeated elimination patterns.
 * When season is null, uses all available graph data (dynasty history).
 */
export async function buildRelationshipSummary(
  input: RelationshipSummaryInput
): Promise<LeagueRelationshipProfile> {
  const {
    leagueId,
    season = null,
    sport = null,
    limitRivalries = 20,
    limitClusters = 10,
    limitInfluence = 15,
    limitCentral = 30,
    limitTransitions = 20,
    limitElimination = 20,
  } = input;

  const [
    strongestRivalries,
    tradeClusters,
    centrality,
    dynastyPowerTransitions,
    repeatedEliminationPatterns,
  ] = await Promise.all([
    analyzeRivalryPaths({ leagueId, season, sport, limit: limitRivalries, usePathDepth: true }),
    detectTradeClusters({ leagueId, season, sport, limit: limitClusters }),
    calculateCentrality({ leagueId, season, sport, limit: limitCentral }),
    detectDynastyPowerShifts({ leagueId, season, sport, limit: limitTransitions }),
    getRepeatedEliminationPatterns({ leagueId, season, sport, limit: limitElimination }),
  ]);

  const influenceLeaders = await computeInfluenceLeaders(leagueId, season, sport, limitInfluence);

  return {
    leagueId,
    season,
    strongestRivalries: strongestRivalries as RivalryScore[],
    tradeClusters: tradeClusters as TradeCluster[],
    influenceLeaders,
    centralManagers: centrality.centralManagers,
    isolatedManagers: centrality.isolatedManagers,
    dynastyPowerTransitions: dynastyPowerTransitions as DynastyPowerTransition[],
    repeatedEliminationPatterns,
    generatedAt: new Date().toISOString(),
  };
}

async function computeInfluenceLeaders(
  leagueId: string,
  season: number | null,
  sport: string | null,
  limit: number
): Promise<InfluenceLeader[]> {
  const normalizedSport = normalizeSportForGraph(sport);
  const managerNodes = await prisma.graphNode.findMany({
    where: {
      leagueId,
      nodeType: "Manager",
      ...(season != null ? { season } : {}),
      ...(normalizedSport ? { sport: normalizedSport } : {}),
    },
    select: { nodeId: true, entityId: true },
  });
  const nodeIds = new Set(managerNodes.map((n) => n.nodeId));

  const edges = await prisma.graphEdge.findMany({
    where: {
      OR: [
        { fromNodeId: { in: [...nodeIds] } },
        { toNodeId: { in: [...nodeIds] } },
      ],
      ...(season != null ? { season } : {}),
      ...(normalizedSport ? { sport: normalizedSport } : {}),
    },
  });

  const tradeWeightByNode = new Map<string, number>();
  const rivalryWeightByNode = new Map<string, number>();
  const championshipByNode = new Map<string, number>();
  const degree = new Map<string, number>();
  const weightedDegree = new Map<string, number>();

  const teamToManager = new Map<string, string>();
  for (const e of edges) {
    if (e.edgeType === "MANAGES" || e.edgeType === "OWNS") {
      if (nodeIds.has(e.fromNodeId)) teamToManager.set(e.toNodeId, e.fromNodeId);
    }
  }

  for (const e of edges) {
    for (const nid of [e.fromNodeId, e.toNodeId]) {
      if (!nodeIds.has(nid)) continue;
      degree.set(nid, (degree.get(nid) ?? 0) + 1);
      weightedDegree.set(nid, (weightedDegree.get(nid) ?? 0) + e.weight);
      if (e.edgeType === "RIVAL_OF") {
        rivalryWeightByNode.set(nid, (rivalryWeightByNode.get(nid) ?? 0) + e.weight);
      }
    }
    if (e.edgeType === "TRADED_WITH") {
      const m1 = teamToManager.get(e.fromNodeId);
      const m2 = teamToManager.get(e.toNodeId);
      if (m1) tradeWeightByNode.set(m1, (tradeWeightByNode.get(m1) ?? 0) + e.weight);
      if (m2) tradeWeightByNode.set(m2, (tradeWeightByNode.get(m2) ?? 0) + e.weight);
    }
  }

  const wonTitleEdges = edges.filter((e) => e.edgeType === "WON_TITLE");
  for (const e of wonTitleEdges) {
    const managerId = teamToManager.get(e.fromNodeId);
    if (managerId) {
      championshipByNode.set(managerId, (championshipByNode.get(managerId) ?? 0) + 1);
    }
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true },
  });
  const commissionerUserId = league?.userId ?? null;

  const maxCentral = Math.max(1, ...[...weightedDegree.values()]);
  const maxTrade = Math.max(1, ...[...tradeWeightByNode.values()]);
  const maxRivalry = Math.max(1, ...[...rivalryWeightByNode.values()]);
  const maxChamp = Math.max(1, ...[...championshipByNode.values()]);

  const leaders: InfluenceLeader[] = managerNodes.map((n) => {
    const centralityScore = maxCentral > 0 ? (weightedDegree.get(n.nodeId) ?? 0) / maxCentral : 0;
    const tradeInfluenceScore = maxTrade > 0 ? (tradeWeightByNode.get(n.nodeId) ?? 0) / maxTrade : 0;
    const rivalryInfluenceScore = maxRivalry > 0 ? (rivalryWeightByNode.get(n.nodeId) ?? 0) / maxRivalry : 0;
    const championshipImpactScore = maxChamp > 0 ? (championshipByNode.get(n.nodeId) ?? 0) / maxChamp : 0;
    const commissionerInfluenceScore = commissionerUserId && n.entityId === commissionerUserId ? 1 : 0;
    const dynastyPresenceScore = (championshipByNode.get(n.nodeId) ?? 0) > 0 ? 0.5 + 0.5 * Math.min((championshipByNode.get(n.nodeId) ?? 0) / Math.max(maxChamp, 1), 1) : centralityScore * 0.3;
    const compositeScore =
      0.25 * centralityScore +
      0.2 * tradeInfluenceScore +
      0.2 * rivalryInfluenceScore +
      0.2 * championshipImpactScore +
      0.1 * commissionerInfluenceScore +
      0.05 * dynastyPresenceScore;

    return {
      nodeId: n.nodeId,
      entityId: n.entityId,
      compositeScore,
      centralityScore,
      tradeInfluenceScore,
      rivalryInfluenceScore,
      championshipImpactScore,
      commissionerInfluenceScore,
      dynastyPresenceScore,
      metadata: { degree: degree.get(n.nodeId) ?? 0 },
    };
  });

  leaders.sort((a, b) => b.compositeScore - a.compositeScore);
  return leaders.slice(0, limit);
}
