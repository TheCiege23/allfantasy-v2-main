/**
 * Dynasty historical import — Sleeper: fetch prior seasons, standings, champion, trades.
 * Uses existing sleeper-client; no duplicate fetch logic.
 */

import {
  getLeagueHistory,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueTransactions,
  getPlayoffBracket,
  type SleeperRoster,
} from "@/lib/sleeper-client";
import type { HistoricalSeasonRef, NormalizedStandingRow, NormalizedTradeFact } from "./types";

const DEFAULT_WEEKS = 18;

/**
 * Discover all historical seasons for a dynasty league (Sleeper previous_league_id chain + name match).
 */
export async function discoverSleeperSeasons(
  currentPlatformLeagueId: string,
  userIdentifier?: string
): Promise<HistoricalSeasonRef[]> {
  const history = await getLeagueHistory(currentPlatformLeagueId, userIdentifier);
  return history.map((h) => ({
    platformLeagueId: String(h.league_id),
    season: parseInt(String(h.season), 10) || 0,
    provider: "sleeper",
    // Sleeper already tells us whether the season ended; dropping it here is what forced the
    // orchestrator's gate to guess from row existence instead.
    status: h.status ?? null,
  }));
}

/**
 * Fetch and normalize standings for one Sleeper league (one season).
 */
export async function fetchSleeperStandings(
  platformLeagueId: string
): Promise<{ rows: NormalizedStandingRow[]; championRosterId: string | null }> {
  const rosters = await getLeagueRosters(platformLeagueId);
  if (!Array.isArray(rosters) || rosters.length === 0) {
    return { rows: [], championRosterId: null };
  }

  let championRosterId: string | null = null;
  try {
    const bracket = await getPlayoffBracket(platformLeagueId);
    if (Array.isArray(bracket) && bracket.length > 0) {
      const highestRound = Math.max(
        ...bracket
          .map((round: any) => Number(round?.r))
          .filter((round: number) => Number.isFinite(round))
      );
      const championshipMatch = bracket.find(
        (matchup: any) =>
          Number(matchup?.r) === highestRound && matchup?.w != null
      );

      if (championshipMatch?.w != null) {
        championRosterId = String(championshipMatch.w);
      }
    }
  } catch {
    // ignore and fall back to roster standings below
  }

  if (!championRosterId) {
    const champ = (rosters as SleeperRoster[]).find(
      (r) => (r.settings?.final_rank ?? r.settings?.rank) === 1
    );
    if (champ) championRosterId = String(champ.roster_id);
  }

  const rows: NormalizedStandingRow[] = rosters.map((r: any) => {
    const s = r.settings || {};
    const wins = s.wins ?? null;
    const losses = s.losses ?? null;
    const fpts = s.fpts ?? 0;
    const fptsDec = s.fpts_decimal ?? 0;
    const fptsAgainst = s.fpts_against ?? 0;
    const fptsAgainstDec = s.fpts_against_decimal ?? 0;
    return {
      rosterId: String(r.roster_id),
      wins: typeof wins === "number" ? wins : null,
      losses: typeof losses === "number" ? losses : null,
      pointsFor: typeof fpts === "number" ? fpts + fptsDec / 100 : null,
      pointsAgainst: typeof fptsAgainst === "number" ? fptsAgainst + fptsAgainstDec / 100 : null,
      champion: championRosterId === String(r.roster_id),
    };
  });

  return { rows, championRosterId };
}

/**
 * Fetch all trades for one Sleeper league (one season), normalized (with week).
 */
export async function fetchSleeperTradesForSeason(
  platformLeagueId: string,
  season: number,
  totalWeeks: number = DEFAULT_WEEKS
): Promise<NormalizedTradeFact[]> {
  const facts: NormalizedTradeFact[] = [];
  for (let week = 1; week <= totalWeeks; week++) {
    const txList = await getLeagueTransactions(platformLeagueId, week);
    const trades = (txList ?? []).filter((t: any) => t.type === "trade");
    for (const t of trades) {
      facts.push({
        transactionId: t.transaction_id,
        season,
        week,
        rosterIds: t.roster_ids ?? [],
        adds: t.adds ?? null,
        drops: t.drops ?? null,
        draftPicks: (t.draft_picks ?? []).map((p: any) => ({
          season: String(p.season),
          round: p.round ?? 0,
          rosterId: p.roster_id ?? 0,
          previousOwnerId: p.previous_owner_id ?? 0,
          ownerId: p.owner_id ?? 0,
        })),
        created: t.created ?? 0,
        creator: t.creator ?? "",
      });
    }
  }
  return facts.sort((a, b) => b.created - a.created);
}

/**
 * Get roster_id -> owner_id (Sleeper user_id) for a league.
 */
export async function fetchSleeperRosterToOwner(
  platformLeagueId: string
): Promise<Map<string, string>> {
  const rosters = await getLeagueRosters(platformLeagueId);
  const map = new Map<string, string>();
  for (const r of rosters) {
    if (r.owner_id) map.set(String(r.roster_id), r.owner_id);
  }
  return map;
}

/**
 * Get users for a league (user_id -> display_name).
 */
export async function fetchSleeperLeagueUsers(
  platformLeagueId: string
): Promise<Map<string, string>> {
  const users = await getLeagueUsers(platformLeagueId);
  const map = new Map<string, string>();
  for (const u of users) {
    const id = (u as any).user_id;
    if (id) map.set(id, (u as any).display_name || (u as any).username || id);
  }
  return map;
}
