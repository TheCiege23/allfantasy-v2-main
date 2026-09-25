/**
 * Which provider transaction statuses mean "this actually happened".
 *
 * Pure and dependency-free on purpose: it is shared by the Decision OS activity emitter
 * (`lib/decision-os/ingestion/platformActivityEmitter.ts`) and the live trade writer
 * (`lib/import-os/collector/persistLiveTrades.ts`), and the two used to disagree.
 *
 * 🛑 WHY THIS EXISTS. `persistLiveTrades` filtered on Sleeper's word alone (`complete`), so every
 * ESPN (`processed`), Yahoo (`successful`), MFL (`completed`) and Fleaflicker (`TRADE_ACCEPTED`)
 * trade was dropped before `LeagueTrade` — the test DB held zero non-Sleeper rows there, ever —
 * while the emitter one directory over already knew the right sets. One predicate, two readers.
 */
import type { ImportProvider } from '@/lib/league-import/types'

/** Statuses the ESPN/Yahoo/MFL importers report for a transaction that actually happened. */
export const FINAL_TRANSACTION_STATUSES: ReadonlySet<string> = new Set([
  'processed',
  'executed',
  'complete',
  'completed',
  'successful',
  'success',
])

/**
 * Fleaflicker emits the whole trade lifecycle (proposed, to-review, rejected, vetoed…) through one
 * feed; only these stages mean assets moved. See `STATUS_PRIORITY` in
 * `lib/league-import/fleaflicker/fleaflickerTransactions.ts` for the full vocabulary.
 */
export const FLEAFLICKER_FINAL_TRADE_STATUSES: ReadonlySet<string> = new Set([
  'trade_accepted',
  'trade_accepted_final',
])

function norm(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase()
}

/** Generic finality for ESPN/Yahoo/MFL-style statuses (all transaction types). */
export function isFinalTransactionStatus(status: string | null | undefined): boolean {
  return FINAL_TRANSACTION_STATUSES.has(norm(status))
}

/**
 * True when a TRADE with this provider status actually executed and may be written as one.
 *
 * - sleeper: `complete` only — unchanged from the original filter; Sleeper's feed also carries
 *   `pending`/`failed` proposals through the same endpoint.
 * - espn / yahoo / mfl: the generic final set.
 * - fleaflicker: accepted lifecycle stages only.
 * - fantrax: NEVER. 🛑 Fantrax has no transaction endpoint; its importer RECONSTRUCTS trades from
 *   roster snapshots, one row per player with synthetic player ids
 *   (`lib/league-import/fantrax/FantraxLeagueFetchService.ts`, the `status: 'completed'` rows). The
 *   owner's decision on record is that inferred Fantrax activity must carry provenance before any
 *   consumer treats it as real, and `LeagueTrade` has no provenance column — so it stays out.
 * - anything else: false. An unknown provider is not guessed at.
 */
export function isCompletedTrade(
  provider: ImportProvider | string | null | undefined,
  status: string | null | undefined,
): boolean {
  switch (norm(provider)) {
    case 'sleeper':
      return norm(status) === 'complete'
    case 'espn':
    case 'yahoo':
    case 'mfl':
      return isFinalTransactionStatus(status)
    case 'fleaflicker':
      return FLEAFLICKER_FINAL_TRADE_STATUSES.has(norm(status))
    case 'fantrax':
    default:
      return false
  }
}
