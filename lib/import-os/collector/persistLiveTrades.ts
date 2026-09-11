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

/**
 * Sleeper's own shape for a traded pick, as passed through untouched by the history mapper.
 *
 * ⚠ The id fields are typed `string | number` because this is an untyped provider payload reaching
 * us through `unknown[]`, and only Sleeper puts numbers in them. Narrowing them to `number` is what
 * invited the `Number(...)` calls this file used to make.
 */
interface RawTradedPick {
  season?: string | number
  round?: number
  roster_id?: string | number
  previous_owner_id?: string | number
  owner_id?: string | number
}

/**
 * 🛑 THIS WAS `toNumberMap`, AND DROPPING A "NON-NUMERIC ROSTER ID" IS THE BUG IT DOCUMENTED AS A
 * SAFEGUARD. Its comment said a non-numeric id "cannot be matched against `rosterIds` downstream" —
 * true only because `rosterIds` was itself being coerced to numbers two lines below. Both sides are
 * provider-native strings now, so Yahoo's `461.l.1000.t.1` matches itself and nothing is dropped.
 *
 * The claim that dropping was "visible in the counts" did not hold either: a discarded add left the
 * trade's own `roster_ids` intact, so the trade still reached the writer and simply recorded no
 * players moving. See `NormalizedTradeFact` for the full account.
 */
function toRosterMap(input: Record<string, string> | undefined): Record<string, string> | null {
  if (!input) return null
  const out: Record<string, string> = {}
  for (const [playerId, rosterId] of Object.entries(input)) {
    const id = String(rosterId ?? '')
    if (id !== '') out[playerId] = id
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
    /*
     * `NormalizedTransaction.roster_ids` is already `string[]` and already provider-native — this
     * line used to re-derive it with `.map(Number).filter(isFinite)`, which is where a Yahoo team
     * id left the pipeline. Empty ids are still dropped; nothing else is.
     */
    rosterIds: t.roster_ids.map((r) => String(r ?? '')).filter((r) => r !== ''),
    adds: toRosterMap(t.adds),
    drops: toRosterMap(t.drops),
    draftPicks: picks
      .map((p) => ({
        season: String(p.season ?? ''),
        round: Number(p.round ?? 0),
        rosterId: String(p.roster_id ?? ''),
        previousOwnerId: String(p.previous_owner_id ?? ''),
        ownerId: String(p.owner_id ?? ''),
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
   *
   * 🛑 THIS MAP IS KEYED ON THE PROVIDER'S TEAM ID VERBATIM, AND IT ALWAYS WAS — which is why
   * coercing the OTHER side to a number broke the join rather than merely reformatting it. MFL's
   * "0001" is a key here; `Number("0001")` looked it up as "1" and missed every time.
   */
  const rosterIdToOwner = new Map<string, string>()
  for (const r of normalized.rosters ?? []) {
    if (r.source_team_id && r.source_manager_id) {
      rosterIdToOwner.set(String(r.source_team_id), String(r.source_manager_id))
    }
  }

  const facts = trades.map((t) => toTradeFact(t, season))
  const skippedNoOwner = facts.filter(
    (f) => !f.rosterIds.some((rid) => rosterIdToOwner.has(rid)),
  ).length

  const rowsWritten = await persistTradesForSeason(
    platformLeagueId,
    season,
    facts,
    rosterIdToOwner,
  )

  return { tradesSeen: trades.length, rowsWritten, skippedNoOwner }
}
