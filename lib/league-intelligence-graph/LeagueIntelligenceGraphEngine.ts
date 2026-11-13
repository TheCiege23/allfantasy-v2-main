/**
 * League Intelligence Graph — top-level engine: snapshot build + query + relationship map + influence.
 */

import { buildAndPersistSnapshot, getSnapshot } from "./GraphSnapshotService";
import type { BuildSnapshotInput } from "./GraphSnapshotService";
import {
  getStrongestRivals,
  getTopTradePartners,
  getManagerConnectionScores,
  getDramaCentralTeams,
  getEraDominance,
  getPowerShiftOverTime,
} from "./GraphQueryService";
import type { GraphQueryInput } from "./GraphQueryService";
import { buildRelationshipMap } from "./LeagueRelationshipMapBuilder";
import type { RelationshipMapInput, RelationshipMapOutput } from "./LeagueRelationshipMapBuilder";
import { buildLeagueRelationshipProfile as buildRelationshipProfile, getManagerInfluenceProfile as getManagerProfile } from "./GraphInfluenceEngine";
import type { GraphInfluenceInput } from "./GraphInfluenceEngine";
import type { LeagueGraphSnapshotPayload, LeagueRelationshipProfile, ManagerInfluenceProfile } from "./types";

export interface BuildGraphInput extends BuildSnapshotInput {}

export interface BuildGraphResult {
  nodeCount: number;
  edgeCount: number;
  snapshotId: string;
}

/**
 * Builds and persists a full graph snapshot for the league (and optional season).
 * Call after league/trade/rivalry/result data is updated to refresh the graph.
 */
export async function buildLeagueGraph(input: BuildGraphInput): Promise<BuildGraphResult> {
  return buildAndPersistSnapshot(input);
}

/**
 * Returns the latest snapshot summary for the league (and optional season).
 */
export async function getLeagueGraphSnapshot(
  leagueId: string,
  season: number | null
): Promise<LeagueGraphSnapshotPayload | null> {
  return getSnapshot(leagueId, season);
}

/**
 * Query: who are the strongest rivals in this league?
 */
export async function queryStrongestRivals(input: GraphQueryInput) {
  return getStrongestRivals(input);
}

/**
 * Query: which managers/teams trade the most with each other?
 */
export async function queryTopTradePartners(input: GraphQueryInput) {
  return getTopTradePartners(input);
}

/**
 * Query: which franchises/teams dominate the same era?
 */
export async function queryEraDominance(input: GraphQueryInput) {
  return getEraDominance(input);
}

/**
 * Query: which teams are central to league drama?
 */
export async function queryDramaCentralTeams(input: GraphQueryInput) {
  return getDramaCentralTeams(input);
}

/**
 * Query: which managers are most connected or most isolated?
 */
export async function queryManagerConnectionScores(input: GraphQueryInput) {
  return getManagerConnectionScores(input);
}

/**
 * Query: how has league power shifted over time?
 */
export async function queryPowerShiftOverTime(
  leagueId: string,
  options?: { seasons?: number[]; limit?: number }
) {
  return getPowerShiftOverTime({ leagueId, ...options });
}

/**
 * Builds a full relationship map (nodes, edges, rivals, trade partners, drama, power shift) for UI/API.
 */
export async function buildLeagueRelationshipMap(
  input: RelationshipMapInput
): Promise<RelationshipMapOutput> {
  return buildRelationshipMap(input);
}

// ─── Relationship & Influence Engine ─────────────────────────────────────────

/**
 * Builds LeagueRelationshipProfile: rivalries, trade clusters, influence leaders,
 * central/isolated managers, dynasty power transitions, elimination patterns.
 * When season is null, includes all dynasty history.
 */
export async function buildLeagueRelationshipProfile(
  input: GraphInfluenceInput
): Promise<LeagueRelationshipProfile> {
  return buildRelationshipProfile(input);
}

/** Returns ManagerInfluenceProfile for a manager (entityId or userId). */
export async function getManagerInfluenceProfile(
  leagueId: string,
  managerIdentifier: string,
  season?: number | null
): Promise<ManagerInfluenceProfile | null> {
  return getManagerProfile(leagueId, managerIdentifier, season);
}

