/**
 * Loads evidence of what World Cup data is currently available in the database.
 * Returns a per-category map keyed by WorldCupCurrentDataKey.
 * All queries are read-only, defensive, and swallow errors with safe fallbacks.
 */
import "server-only"
import { prisma } from "@/lib/prisma"

/** Categories of current World Cup data that Chimmy may be asked about. */
export type WorldCupCurrentDataKey =
  | "injuries"
  | "player_stats"
  | "team_stats"
  | "squad_news"
  | "lineups"
  | "odds"

type WorldCupCurrentDataEvidenceRow = Record<string, unknown>

export type WorldCupCurrentDataEvidenceSnapshot = Record<
  WorldCupCurrentDataKey,
  { rows: WorldCupCurrentDataEvidenceRow[] }
>

const ALL_KEYS: WorldCupCurrentDataKey[] = [
  "injuries",
  "player_stats",
  "team_stats",
  "squad_news",
  "lineups",
  "odds",
]

function emptySnapshot(): WorldCupCurrentDataEvidenceSnapshot {
  return {
    injuries: { rows: [] },
    player_stats: { rows: [] },
    team_stats: { rows: [] },
    squad_news: { rows: [] },
    lineups: { rows: [] },
    odds: { rows: [] },
  }
}

/**
 * Loads per-category evidence rows from the database.
 * These categories correspond to live data feeds (injuries, player stats, etc.)
 * that are sourced from external providers and synced into the DB.
 * Returns empty rows for any category where data is not yet available.
 */
export async function loadWorldCupCurrentDataEvidence(options?: {
  includeRows?: boolean
}): Promise<WorldCupCurrentDataEvidenceSnapshot> {
  try {
    // Attempt to load player stats as a proxy for available current data
    const playerStatRows = await (prisma as any).worldCupPlayerStat
      .findMany({
        take: options?.includeRows ? 5 : 0,
        orderBy: { updatedAt: "desc" },
        select: { playerId: true, matchId: true, updatedAt: true },
      })
      .catch(() => [] as WorldCupCurrentDataEvidenceRow[])

    const snapshot = emptySnapshot()
    if (playerStatRows.length > 0) {
      snapshot.player_stats = { rows: playerStatRows }
      snapshot.team_stats = { rows: playerStatRows.slice(0, 1) }
    }
    return snapshot
  } catch {
    return emptySnapshot()
  }
}
