/**
 * Persist trades seen by the LIVE sync, so a trade shows up without anyone pressing Sync.
 *
 * 🛑 WHY THIS EXISTS. The 30-minute collector FETCHED transactions and then dropped them on the
 * floor. `SleeperLeagueFetchService` pulled `/league/{id}/transactions/{week}` for all 18 weeks on
 * every single sync, the normalization pipeline carried them into
 * `NormalizedImportResult.transactions`, and `LEAGUE_SYNC_SCOPES` had no scope that wrote them
 * anywhere. The cost was already being paid; only the write was missing.
 *
 * ⚠ THE FETCH IS NO LONGER 18 WEEKS ON THE LIVE PATH, AND THIS FILE MUST NOT ASSUME IT IS.
 * `resolveTransactionWeekWindow` narrows a live refresh to a window around the current week, so
 * `normalized.transactions` now carries only those weeks. Nothing here depends on the width — the
 * filter below is over whatever arrived — but a reader reasoning about "why is an old trade
 * missing" should know the live payload is windowed and the historical backfill owns the rest.
 *
 * The scope list's own note said transactions were skipped because they had "no canonical
 * destination table (no fabrication)". That was true when written and is not true now:
 * `LeagueTrade` is that table, it holds 18,147 rows, and `persistTradesForSeason` is its writer.
 *
 * ⚠ WHAT THE USER ACTUALLY SAW, which is the reason this is not a tidy-up. Trades reached the
 * database only through `sleeper-historical-refresh` — every 4 hours, `LEAGUE_CAP = 25` leagues per
 * fire, against a 235-league rotation. That is a ~1.6-DAY lap, so a trade could sit invisible for
 * over a day in a product whose headline is that it notices trades for you. Measured 2026-09-05:
 * newest `LeagueTrade.tradeDate` was 42 hours old while the sync had run 4 times in the last 2
 * hours.
 *
 * ⚠ THIS DOES NOT REPLACE THE BACKFILL. That job owns HISTORY — prior seasons, and leagues whose
 * import died mid-run. This owns only what the current-season sync already has in hand. They write
 * the same table through the same upsert, keyed on `historyId_transactionId`, so an overlap is a
 * no-op rather than a duplicate.
 */
import { persistTradesForSeason } from '@/lib/dynasty-import/normalize-historical'
import type { NormalizedTradeFact } from '@/lib/dynasty-import/types'
import type { NormalizedImportResult, NormalizedTransaction } from '@/lib/league-import/types'

/** Sleeper's own shape for a traded pick, as passed through untouched by the history mapper. */
interface RawTradedPick {
  season?: string | number
  round?: number
  roster_id?: number
  previous_owner_id?: number
  owner_id?: number
}

function toNumberMap(input: Record<string, string> | undefined): Record<string, number> | null {
  if (!input) return null
  const out: Record<string, number> = {}
  for (const [playerId, rosterId] of Object.entries(input)) {
    const n = Number(rosterId)
    // A non-numeric roster id cannot be matched against `rosterIds` downstream, and writing it
    // would silently attribute the player to nobody. Dropping it is visible in the counts.
    if (Number.isFinite(n)) out[playerId] = n
  }
  return Object.keys(out).length > 0 ? out : null
}

function toTradeFact(t: NormalizedTransaction, season: number): NormalizedTradeFact {
  const picks = Array.isArray(t.draft_picks) ? (t.draft_picks as RawTradedPick[]) : []
  return {
    transactionId: t.source_transaction_id,
    season,
    /*
     * 0 when the provider did not carry a week. `persistTradesForSeason` writes it straight into
     * `LeagueTrade.week`, and 0 is what the historical importer already stores for a trade whose
     * week it could not establish — so this adds no new sentinel to the column.
     */
    week: t.week ?? 0,
    rosterIds: t.roster_ids.map(Number).filter((n) => Number.isFinite(n)),
    adds: toNumberMap(t.adds),
    drops: toNumberMap(t.drops),
    draftPicks: picks
      .map((p) => ({
        season: String(p.season ?? ''),
        round: Number(p.round ?? 0),
        rosterId: Number(p.roster_id ?? 0),
        previousOwnerId: Number(p.previous_owner_id ?? 0),
        ownerId: Number(p.owner_id ?? 0),
      }))
      .filter((p) => p.season !== '' && Number.isFinite(p.round)),
    created: Date.parse(t.created_at) || 0,
    /* Unused by `persistTradesForSeason`; present only to satisfy the shared type. */
    creator: '',
  }
}

export interface PersistLiveTradesResult {
  /** Completed trades present in this sync's payload. */
  tradesSeen: number
  /** Rows upserted — one PER SIDE of each trade, which is how LeagueTrade is keyed. */
  rowsWritten: number
  /** Trades skipped because no roster on either side mapped to a known owner. */
  skippedNoOwner: number
}

/**
 * ⚠ ONLY `complete` TRADES. Sleeper reports proposed and vetoed trades through the same endpoint,
 * and writing those would put trades that never happened into a table the trade grader reads.
 * The historical importer filters on `type === 'trade'` alone because it fetches finalized seasons
 * where nothing else survives; a LIVE feed sees the in-flight ones too.
 */
export async function persistLiveTrades(input: {
  platformLeagueId: string
  season: number
  normalized: NormalizedImportResult
}): Promise<PersistLiveTradesResult> {
  const { platformLeagueId, season, normalized } = input

  const trades = (normalized.transactions ?? []).filter(
    (t) => t.type === 'trade' && String(t.status).toLowerCase() === 'complete',
  )
  if (trades.length === 0) {
    return { tradesSeen: 0, rowsWritten: 0, skippedNoOwner: 0 }
  }

  /*
   * roster id -> owner id, from the rosters this same sync already normalized.
   * `persistTradesForSeason` needs it to resolve each side to a `LeagueTradeHistory` row, and
   * building it from the payload keeps this function free of its own database reads.
   */
  const rosterIdToOwner = new Map<string, string>()
  for (const r of normalized.rosters ?? []) {
    if (r.source_team_id && r.source_manager_id) {
      rosterIdToOwner.set(String(r.source_team_id), String(r.source_manager_id))
    }
  }

  const facts = trades.map((t) => toTradeFact(t, season))
  const skippedNoOwner = facts.filter(
    (f) => !f.rosterIds.some((rid) => rosterIdToOwner.has(String(rid))),
  ).length

  const rowsWritten = await persistTradesForSeason(
    platformLeagueId,
    season,
    facts,
    rosterIdToOwner,
  )

  return { tradesSeen: trades.length, rowsWritten, skippedNoOwner }
}
