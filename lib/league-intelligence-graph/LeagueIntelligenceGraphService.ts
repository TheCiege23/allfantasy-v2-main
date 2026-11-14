/**
 * LeagueIntelligenceGraphService — main orchestrator for the League Intelligence Graph.
 * Build snapshot, query rivals/trade partners/power shift, relationship map, and AI-ready summary.
 */

import {
  buildLeagueGraph,
  getLeagueGraphSnapshot,
  buildLeagueRelationshipMap,
} from './LeagueIntelligenceGraphEngine';
import type { BuildGraphInput, BuildGraphResult } from './LeagueIntelligenceGraphEngine';
import { buildRelationshipSummary } from './RelationshipSummaryBuilder';
import type { RelationshipSummaryInput } from './RelationshipSummaryBuilder';
import type { LeagueRelationshipProfile, LeagueGraphSnapshotPayload } from './types';
import type { RelationshipMapOutput } from './LeagueRelationshipMapBuilder';
import {
  getStrongestRivals,
  getTopTradePartners,
  getPowerShiftOverTime,
  getRepeatedEliminationPatterns,
} from './GraphQueryService';
import type { GraphQueryInput } from './GraphQueryService';

/**
 * Build and persist a full graph snapshot for the league (and optional season).
 */
export async function buildSnapshot(input: BuildGraphInput): Promise<BuildGraphResult> {
  return buildLeagueGraph(input);
}

/**
 * Get latest snapshot summary for the league/season.
 */
export async function getSnapshotPayload(
  leagueId: string,
  season: number | null
): Promise<LeagueGraphSnapshotPayload | null> {
  return getLeagueGraphSnapshot(leagueId, season);
}

/**
 * Build full relationship profile (rivalries, trade clusters, influence, power transitions).
 */
export async function getRelationshipProfile(
  input: RelationshipSummaryInput
): Promise<LeagueRelationshipProfile> {
  return buildRelationshipSummary(input);
}

/**
 * Build relationship map for visualization (nodes, edges, rivals, trade partners).
 */
export async function getRelationshipMap(
  leagueId: string,
  options?: { season?: number | null; sport?: string | null; limit?: number }
): Promise<RelationshipMapOutput> {
  return buildLeagueRelationshipMap({
    leagueId,
    season: options?.season ?? null,
    sport: options?.sport ?? null,
    limit: options?.limit ?? 100,
  });
}

/**
 * Query strongest rivals in the league.
 */
export async function queryRivals(input: GraphQueryInput) {
  return getStrongestRivals(input);
}

/**
 * Query top trade partners in the league.
 */
export async function queryTradePartners(input: GraphQueryInput) {
  return getTopTradePartners(input);
}

/**
 * Query power shift over time (champions per season).
 */
export async function queryPowerShift(
  leagueId: string,
  options?: { seasons?: number[]; limit?: number }
) {
  return getPowerShiftOverTime({ leagueId, ...options });
}

/**
 * Query repeated elimination patterns (who knocks out whom).
 */
export async function queryRepeatedEliminations(input: GraphQueryInput) {
  return getRepeatedEliminationPatterns(input);
}

/**
 * Get a text summary of the graph for AI context (rivalries, trade clusters, power shift).
 */
export async function getGraphSummaryForAI(
  leagueId: string,
  options?: { season?: number | null; sport?: string | null; maxRivalries?: number; maxTradePairs?: number }
): Promise<string> {
  const [rivals, tradePartners, eliminations] = await Promise.all([
    getStrongestRivals({
      leagueId,
      season: options?.season ?? null,
      sport: options?.sport ?? null,
      limit: options?.maxRivalries ?? 10,
    }),
    getTopTradePartners({
      leagueId,
      season: options?.season ?? null,
      sport: options?.sport ?? null,
      limit: options?.maxTradePairs ?? 10,
    }),
    getRepeatedEliminationPatterns({
      leagueId,
      season: options?.season ?? null,
      sport: options?.sport ?? null,
      limit: 5,
    }),
  ]);
  const lines: string[] = [];
  if (rivals.length) {
    lines.push(`Rivalries: ${rivals.map((r) => `(${r.nodeA}, ${r.nodeB}) weight ${r.weight}`).join('; ')}`);
  }
  if (tradePartners.length) {
    lines.push(`Trade pairs: ${tradePartners.map((t) => `${t.fromNodeId}-${t.toNodeId}: ${t.tradeCount} trades`).join('; ')}`);
  }
  if (eliminations.length) {
    lines.push(`Elimination patterns: ${eliminations.map((e) => `${e.eliminatorNodeId} eliminated ${e.eliminatedNodeId} ${e.count}x`).join('; ')}`);
  }
  return lines.length ? `League graph (${leagueId}):\n` + lines.join('\n') : '';
}
