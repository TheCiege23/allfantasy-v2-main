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

/**
 * One completed trade, normalized.
 *
 * 🛑 EVERY ROSTER IDENTITY HERE IS A PROVIDER-NATIVE STRING, AND IT USED TO BE A `number`.
 * That coercion was silently correct for the only two providers whose team ids happen to be
 * integers (Sleeper "1".."12", ESPN) and silently WRONG for the rest:
 *
 *   Yahoo    "461.l.1000.t.1"  ->  Number(...) = NaN  -> dropped by the producer's isFinite filter
 *   MFL      "0001"            ->  Number(...) = 1    -> no longer matches the "0001" map key
 *
 * Neither failed loudly. Both landed in `persistLiveTrades`'s `skippedNoOwner` counter, which
 * reads as "this league's rosters are unknown" rather than "this provider cannot be represented",
 * so a Yahoo or MFL league synced forever and wrote zero `LeagueTrade` rows.
 *
 * The rest of the normalized layer already settled on strings — `NormalizedStandingRow.rosterId`
 * above, `NormalizedTransaction.roster_ids` and `NormalizedTradedPick.original_roster_id` in
 * `lib/league-import/types.ts`, all keyed to match `league_teams.externalId`, which is a String
 * column. This type was the one place that narrowed them, so it was the one place that lost data.
 *
 * ⚠ COMPARE THESE WITH `===`, NEVER BY COERCING BACK TO A NUMBER. Reintroducing `Number(...)`
 * anywhere downstream reinstates the whole bug on a type that now looks safe.
 */
export interface NormalizedTradeFact {
  transactionId: string;
  season: number;
  week: number;
  rosterIds: string[];
  /** player id -> the roster id that received them. */
  adds: Record<string, string> | null;
  /** player id -> the roster id that gave them up. */
  drops: Record<string, string> | null;
  draftPicks: Array<{ season: string; round: number; rosterId: string; previousOwnerId: string; ownerId: string }>;
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
