/**
 * Dynasty historical import — shared types for backfill and normalization.
 */

export type BackfillStatus = "pending" | "running" | "completed" | "partial" | "failed";

export interface HistoricalSeasonRef {
  platformLeagueId: string;
  season: number;
  provider: string;
  /**
   * The provider's own season status, carried so the backfill gate can ask whether a season is
   * actually OVER rather than whether we happen to hold rows for it.
   *
   * 🛑 IT WAS BEING DROPPED, AND THAT IS THE WHOLE BUG. `discoverSleeperSeasons` mapped
   * `getLeagueHistory` down to three fields and discarded `status`, so the orchestrator had
   * nothing to gate on and fell back to "does a SeasonResult row exist" — which is true for the
   * season being PLAYED the moment someone imports mid-season. See `lib/league-import/
   * seasonCompletion.ts`; this is the fifth place that gate shape was found.
   *
   * Optional because a provider that does not report one must read as NOT complete, which is the
   * safe direction: refetch a finished season needlessly rather than freeze a live one forever.
   */
  status?: string | null;
}

export interface NormalizedStandingRow {
  rosterId: string;
  wins: number | null;
  losses: number | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  champion: boolean;
}

export interface NormalizedTradeFact {
  transactionId: string;
  season: number;
  week: number;
  rosterIds: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draftPicks: Array<{ season: string; round: number; rosterId: number; previousOwnerId: number; ownerId: number }>;
  created: number;
  creator: string;
}

export interface BackfillObservability {
  provider: string;
  seasonsDiscovered: number[];
  seasonsImported: number[];
  seasonsSkipped: number[];
  partialSeasons: Array<{ season: number; reason: string }>;
  missingFields: string[];
  failuresPerSeason: Record<string, string>;
}
