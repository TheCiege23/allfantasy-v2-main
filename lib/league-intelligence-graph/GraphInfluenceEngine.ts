/**
 * League Intelligence Graph — Relationship and Influence Engine facade.
 * Turns graph data into relationship scores and answers high-level questions.
 */

import { buildRelationshipSummary } from "./RelationshipSummaryBuilder";
import type { LeagueRelationshipProfile, ManagerInfluenceProfile } from "./types";

export interface GraphInfluenceInput {
  leagueId: string;
  /** When null, include all seasons (dynasty history). */
  season?: number | null;
  sport?: string | null;
  limits?: Partial<{
    rivalries: number;
    clusters: number;
    influence: number;
    central: number;
    transitions: number;
    elimination: number;
  }>;
}

/**
 * Builds a full LeagueRelationshipProfile (rivalries, trade clusters, influence leaders,
 * central/isolated managers, power transitions, elimination patterns).
 */
export async function buildLeagueRelationshipProfile(
  input: GraphInfluenceInput
): Promise<LeagueRelationshipProfile> {
  return buildRelationshipSummary({
    leagueId: input.leagueId,
    season: input.season,
    sport: input.sport ?? null,
    limitRivalries: input.limits?.rivalries ?? 20,
    limitClusters: input.limits?.clusters ?? 10,
    limitInfluence: input.limits?.influence ?? 15,
    limitCentral: input.limits?.central ?? 30,
    limitTransitions: input.limits?.transitions ?? 20,
    limitElimination: input.limits?.elimination ?? 20,
  });
}

/**
 * Returns ManagerInfluenceProfile for a given manager (by entityId or userId).
 * Uses the same scoring as influence leaders; when season is null, uses all dynasty history.
 */
export async function getManagerInfluenceProfile(
  leagueId: string,
  managerIdentifier: string,
  season?: number | null
): Promise<ManagerInfluenceProfile | null> {
  const profile = await buildLeagueRelationshipProfile({
    leagueId,
    season: season ?? null,
    limits: { influence: 100 },
  });
  const leader = profile.influenceLeaders.find(
    (l) => l.entityId === managerIdentifier || l.nodeId.includes(managerIdentifier)
  );
  if (!leader) return null;
  return {
    userId: leader.entityId,
    leagueId,
    centralityScore: leader.centralityScore,
    tradeInfluenceScore: leader.tradeInfluenceScore,
    rivalryInfluenceScore: leader.rivalryInfluenceScore,
    championshipImpactScore: leader.championshipImpactScore,
    commissionerInfluenceScore: leader.commissionerInfluenceScore,
    dynastyPresenceScore: leader.dynastyPresenceScore,
    updatedAt: profile.generatedAt,
  };
}

// ─── High-level question API ─────────────────────────────────────────────────

/** Who is the most influential manager in this league? */
export async function getMostInfluentialManager(leagueId: string, season?: number | null) {
  const profile = await buildLeagueRelationshipProfile({ leagueId, season, limits: { influence: 1 } });
  return profile.influenceLeaders[0] ?? null;
}

/** Which trade relationship has shaped the league the most? */
export async function getMostShapingTradeRelationship(leagueId: string, season?: number | null) {
  const profile = await buildLeagueRelationshipProfile({ leagueId, season, limits: { clusters: 5 } });
  const top = profile.tradeClusters[0];
  return top?.dominantPair ?? null;
}

/** Which rivalry has defined this dynasty era? */
export async function getDefiningRivalry(leagueId: string, season?: number | null) {
  const profile = await buildLeagueRelationshipProfile({ leagueId, season, limits: { rivalries: 1 } });
  return profile.strongestRivalries[0] ?? null;
}

/** Who keeps knocking the same manager out of the playoffs? (repeated elimination patterns) */
export async function getRepeatedEliminators(leagueId: string, season?: number | null) {
  const profile = await buildLeagueRelationshipProfile({ leagueId, season, limits: { elimination: 20 } });
  return profile.repeatedEliminationPatterns;
}

/** Which franchises have controlled the league over recent seasons? */
export async function getDynastyControl(leagueId: string, season?: number | null) {
  const profile = await buildLeagueRelationshipProfile({ leagueId, season, limits: { transitions: 20 } });
  const era = profile.dynastyPowerTransitions;
  const control: Array<{ nodeIds: string[]; seasons: number[] }> = [];
  const seen = new Set<string>();
  for (const t of era) {
    for (const nid of t.toNodeIds) {
      if (!seen.has(nid)) {
        seen.add(nid);
        control.push({ nodeIds: [nid], seasons: [t.toSeason] });
      } else {
        const c = control.find((x) => x.nodeIds.includes(nid));
        if (c && !c.seasons.includes(t.toSeason)) c.seasons.push(t.toSeason);
      }
    }
  }
  return control.sort((a, b) => b.seasons.length - a.seasons.length).slice(0, 10);
}

/** Which managers sit at the center of league activity? */
export async function getCentralManagers(leagueId: string, season?: number | null, limit = 10) {
  const profile = await buildLeagueRelationshipProfile({ leagueId, season, limits: { central: limit } });
  return profile.centralManagers;
}
