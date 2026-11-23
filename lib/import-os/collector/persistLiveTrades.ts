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
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { persistTradesForSeason } from '@/lib/dynasty-import/normalize-historical'
import { buildTradeContextSnapshot, withBoardValues, withInjuryStatus } from '@/lib/trade-market/tradeContextSnapshot'
import { createInjuryRowMatcher } from '@/lib/injuries/matchInjuryRows'
import type { NormalizedTradeFact } from '@/lib/dynasty-import/types'
import { isCompletedTrade } from '@/lib/league-import/transactionFinality'
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
    created: Date.parse(t.completed_at ?? t.created_at) || 0,
    // FAAB each way, only when the provider stated it — absent leaves `LeagueTrade.budgetGiven/Received` untouched.
    ...(Array.isArray(t.waiver_budget) ? { waiverBudget: t.waiver_budget } : {}),
    /* Unused by `persistTradesForSeason`; present only to satisfy the shared type. */
    creator: '',
  }
}

interface PersistLiveTradesResult {
  /** Completed trades present in this sync's payload. */
  tradesSeen: number
  /** Trade rows given their context snapshot on this pass (first capture only — see `attachTradeContextSnapshots`). */
  contextsSaved?: number
  /** Rows upserted — one PER SIDE of each trade, which is how LeagueTrade is keyed. */
  rowsWritten: number
  /** Trades skipped because no roster on either side mapped to a known owner. */
  skippedNoOwner: number
}

/**
 * ⚠ ONLY EXECUTED TRADES. Sleeper reports proposed and vetoed trades through the same endpoint,
 * and writing those would put trades that never happened into a table the trade grader reads.
 * The historical importer filters on `type === 'trade'` alone because it fetches finalized seasons
 * where nothing else survives; a LIVE feed sees the in-flight ones too.
 *
 * 🛑 "EXECUTED" IS A PER-PROVIDER WORD. This filter was Sleeper's `complete` alone, so every ESPN,
 * Yahoo, MFL and Fleaflicker trade was dropped here and never reached `LeagueTrade`. Finality now
 * comes from `isCompletedTrade`, the same predicate the Decision OS activity emitter uses — and it
 * deliberately answers false for Fantrax, whose trades are inferred from roster snapshots.
 */
export async function persistLiveTrades(input: {
  platformLeagueId: string
  season: number
  normalized: NormalizedImportResult
}): Promise<PersistLiveTradesResult> {
  const { platformLeagueId, season, normalized } = input
  const provider = normalized.source?.source_provider ?? 'sleeper'

  const trades = (normalized.transactions ?? []).filter(
    (t) => t.type === 'trade' && isCompletedTrade(provider, t.status),
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
    // ⚠ The writer used to hard-code 'sleeper' here; a Yahoo trade must not be labelled Sleeper.
    provider,
    // …and 'nfl' for sport, so an imported NBA league's trades were labelled NFL.
    normalized.league?.sport || undefined,
  )

  const contextsSaved = await attachTradeContextSnapshots({ platformLeagueId, normalized, trades }).catch(() => 0)

  return { tradesSeen: trades.length, rowsWritten, skippedNoOwner, contextsSaved }
}

/** `TRADE_CONTEXT_SNAPSHOT=off` stops the capture; the trades themselves are still written. */
export const TRADE_CONTEXT_SNAPSHOT_ENV = 'TRADE_CONTEXT_SNAPSHOT'

/**
 * Save each trade's context (`lib/trade-market/tradeContextSnapshot.ts`) beside its `LeagueTrade` rows — the
 * learner's record of why a manager paid what they paid, which the rosters will not remember next week.
 *
 * ⚠ FIRST CAPTURE WINS. The live window shows the same trade on every sync for days; only a row whose snapshot is
 * still empty is written, so the earliest capture — the one closest to the trade — is the one kept.
 * ⚠ BEST EFFORT. A snapshot is an accelerator for learning, never a reason a sync fails: every error is swallowed and
 * counted as not saved. The trade rows were already written above.
 */
/** A player's injury designation, null for "no report", undefined when it cannot be told. */
export type InjuryLookup = (player: { position: string | null; team: string | null; name?: string | null; id: string }) => string | null | undefined

/** Injury reports newer than this are read at capture; older ones are not news. */
const INJURY_CAPTURE_FRESH_MS = 72 * 60 * 60 * 1000

/** One league's value board, as a price per traded player (`withBoardValues`). */
export type BoardPricer = { sport: string; unit: string; priceOf: (playerId: string, name: string | null) => number | null }

/**
 * The league's value board for a non-NFL Sleeper league, or null when the sport is not board-valued or the board cannot
 * be read (the snapshot is then saved without values, exactly as before). One read per sync.
 */
export async function loadBoardPricer(platformLeagueId: string): Promise<BoardPricer | null> {
  // The same Sleeper league can be imported by several members and in several seasons; the newest season is the live one.
  const league = await prisma.league.findFirst({ where: { platformLeagueId, platform: 'sleeper' }, orderBy: { season: 'desc' }, select: { id: true } })
  if (!league) return null
  const { loadLeagueValueBoard, boardUnit } = await import('@/lib/sport-values/leagueValueBoard')
  const { priceBoardPlayer } = await import('@/lib/decision-os/trade/sportPointsValue')
  const board = await loadLeagueValueBoard(league.id)
  if (board.kind !== 'ok') return null
  const ctx = board.ctx
  return {
    sport: board.sport,
    unit: boardUnit(ctx),
    priceOf: (playerId, name) => {
      const price = priceBoardPlayer({ rosterPlayerId: playerId, name }, ctx)
      return price.ok ? price.value : null
    },
  }
}

/**
 * The NFL injury designations as of now, matched to a roster player by name, VERIFIED by team and position
 * (`createInjuryRowMatcher` — a name two players share is refused, never guessed). The newest claim wins.
 */
export async function loadInjuryLookup(now: Date, sport = 'NFL'): Promise<InjuryLookup | null> {
  const rows = await prisma.sportsInjury.findMany({
    where: { sport, expiresAt: { gt: now }, fetchedAt: { gt: new Date(now.getTime() - INJURY_CAPTURE_FRESH_MS) } },
    orderBy: { fetchedAt: 'desc' },
    take: 5000,
    select: { playerName: true, team: true, position: true, status: true, date: true, fetchedAt: true },
  })
  // No fresh report at all for this sport is "no feed", not "everyone is healthy": the snapshot is then saved unmarked.
  if (rows.length === 0) return null
  const match = createInjuryRowMatcher(rows, sport)
  return (p) => {
    const name = p.name
    if (!name) return undefined
    const hit = match({ name, team: p.team, position: p.position })
    if (hit == null) return null
    if ('ambiguous' in hit) return undefined
    return hit.rows[0]?.status ?? null
  }
}

export async function attachTradeContextSnapshots(
  input: { platformLeagueId: string; normalized: NormalizedImportResult; trades: NormalizedTransaction[] },
  deps: {
    db?: Pick<typeof prisma, 'leagueTrade'>
    now?: Date
    env?: NodeJS.ProcessEnv
    /** Injury designations for the league's sport; defaults to its fresh `SportsInjury` rows (`loadInjuryLookup`). */
    injuries?: (now: Date, sport: string) => Promise<InjuryLookup | null>
    /** NBA / MLB / NHL / NCAAB / soccer: the league's value board as a pricer; defaults to `loadBoardPricer`. */
    board?: (platformLeagueId: string) => Promise<BoardPricer | null>
  } = {},
): Promise<number> {
  const env = deps.env ?? process.env
  if (String(env[TRADE_CONTEXT_SNAPSHOT_ENV] ?? '').trim().toLowerCase() === 'off') return 0
  const db = deps.db ?? prisma
  const now = deps.now ?? new Date()
  const isNfl = String(input.normalized.league?.sport ?? '').toUpperCase() === 'NFL'
  // One injury read per sync, best-effort: without it a snapshot is saved exactly as before, unmarked.
  // Every sport (2026-11-22): who was out at the trade cannot be rebuilt later, so it is recorded wherever a feed exists.
  const sport = String(input.normalized.league?.sport ?? '').trim().toUpperCase()
  const injuries = sport && input.trades.length > 0 ? await (deps.injuries ?? loadInjuryLookup)(now, sport).catch(() => null) : null
  // Other sports have no dated market chart: the board's price at capture is the only record of the trade-day value.
  const board = !isNfl && input.trades.length > 0 ? await (deps.board ?? loadBoardPricer)(input.platformLeagueId).catch(() => null) : null
  let saved = 0
  for (const trade of input.trades) {
    const built = buildTradeContextSnapshot(input.normalized, trade, now)
    if (!built) continue
    const names = input.normalized.player_map ?? {}
    const withInjuries = injuries ? withInjuryStatus(built, (p) => injuries({ ...p, name: names[p.id]?.name ?? null })) : built
    const snapshot = board ? withBoardValues(withInjuries, trade, board, (id) => board.priceOf(id, names[id]?.name ?? null)) : withInjuries
    try {
      const r = await db.leagueTrade.updateMany({
        where: {
          transactionId: trade.source_transaction_id,
          history: { sleeperLeagueId: input.platformLeagueId },
          contextSnapshot: { equals: Prisma.DbNull },
        },
        data: { contextSnapshot: snapshot as unknown as Prisma.InputJsonValue },
      })
      saved += r.count
    } catch {
      // Not saved this pass; the next sync inside the capture window tries again.
    }
  }
  return saved
}
