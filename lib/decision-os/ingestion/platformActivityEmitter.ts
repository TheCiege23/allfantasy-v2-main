import type { EspnImportTransaction } from '@/lib/league-import/adapters/espn/types'
import type { MflImportTransaction } from '@/lib/league-import/adapters/mfl/types'
import type { YahooImportTransaction } from '@/lib/league-import/adapters/yahoo/types'
import type { ExternalIdentityMapping } from '@/lib/league-import/types'
import {
  normalizeImportedActivityBatch,
  type ImportedActivityType,
  type ManagerIdentityIndex,
  type RawImportedActivity,
  type SkippedImportedActivity,
} from './importedActivityNormalizer'
import { writeImportedActivity, type WriteImportedActivitySummary } from './importedActivityWriter'
import type { ImportedActivityStore } from './importedActivityStore'

/**
 * ESPN, Yahoo and MFL transactions → Decision OS imported activity.
 *
 * Until 2026-09-06 `decision_os_imported_activity` was written by the Sleeper
 * emitter only, so the finder's "Trade window · when they move" panel had
 * nothing to read for an ESPN or Yahoo league — the window is built from a
 * manager's own move times, and none were on file. MFL joined 2026-09-11 and
 * was the same gap for the same reason. All three already arrive through the
 * league importers with real timestamps (ESPN's communication feed dates each
 * topic; Yahoo's transaction carries an epoch `timestamp`; MFL's carries its
 * own) and with the team → manager binding the importers resolve, so this is
 * the same shape the Sleeper path uses, fed from what is already fetched.
 * Nothing is invented: a transaction with no time is skipped and said so, a
 * team with no known owner attributes to nobody.
 *
 * Manager keys are `<provider>:<manager id>` — ESPN's member SWID (what the
 * ESPN importer stores as `LeagueTeam.platformUserId`), Yahoo's manager guid
 * (or team key when Yahoo withholds the guid), MFL's `owner_id` (or its
 * franchise id when MFL withholds one) — resolved to an AllFantasy user id when
 * the team is claimed (lib/core-app/managerPresence.ts reads both).
 *
 * ⚠ THE THREE PLATFORMS DO NOT AGREE ON HOW MUCH THEY TELL YOU, and each map
 * below keeps exactly what its platform actually said:
 *   - Yahoo's parsed transaction does not say whether an add went through
 *     waivers or free agency, so every add/drop is a `roster_move`.
 *   - ESPN's feed does distinguish, and so does MFL's — which names its
 *     blind-bid waiver separately again (`bbid_waiver`).
 * Flattening them to a common denominator would throw away a distinction two of
 * the three genuinely report.
 *
 * ⚠ STILL UNCOVERED: Fantrax and Fleaflicker. Fantrax has no transaction
 * endpoint at all — its importer INFERS moves by diffing roster periods — so
 * emitting from it is a correctness question, not plumbing, and the decision on
 * record (2026-09-11) is that inferred events must carry explicit provenance so
 * a consumer can exclude them. Fleaflicker's `FetchLeagueActivity` exists and is
 * simply not requested yet.
 */

export interface PlatformEmitterSkip {
  providerEventId: string | null
  reason: 'UNSUPPORTED_TRANSACTION_TYPE' | 'TRANSACTION_NOT_COMPLETE'
}

/** Statuses the importers report for a transaction that actually happened. */
const FINAL_STATUSES = new Set(['processed', 'executed', 'complete', 'completed', 'successful', 'success'])

const ESPN_TYPE_MAP: Readonly<Record<string, ImportedActivityType>> = {
  trade: 'trade',
  waiver: 'waiver',
  free_agent: 'roster_move',
  drop: 'roster_move',
}

const YAHOO_TYPE_MAP: Readonly<Record<string, ImportedActivityType>> = {
  trade: 'trade',
  add: 'roster_move',
  drop: 'roster_move',
  'add/drop': 'roster_move',
}

/**
 * MFL's own transaction vocabulary, lowercased by `parseMflTransactions`.
 *
 * ⚠ ACQUISITIONS, DROPS AND TRADES ONLY — `ir` and `taxi` are deliberately absent, and that is
 * the same line ESPN and Yahoo draw above. Moving a player to injured reserve is a roster
 * DESIGNATION, not a change in who holds him; counting it as a move would inflate every
 * manager's activity rate with housekeeping and make the finder's "when they move" window
 * answer a different question for MFL than for the other four platforms.
 *
 * `bbid_waiver` is MFL's blind-bid waiver and is a waiver in every sense that matters here.
 * Anything unlisted is skipped and counted as `UNSUPPORTED_TRANSACTION_TYPE`, never guessed at.
 */
const MFL_TYPE_MAP: Readonly<Record<string, ImportedActivityType>> = {
  trade: 'trade',
  waiver: 'waiver',
  bbid_waiver: 'waiver',
  free_agent: 'roster_move',
}

function isFinal(status: string | null | undefined): boolean {
  return FINAL_STATUSES.has(String(status ?? '').trim().toLowerCase())
}

function ownersOf(ids: readonly string[], teamOwnerMap: ReadonlyMap<string, string | null>): string[] {
  const out: string[] = []
  for (const id of ids) {
    const owner = teamOwnerMap.get(String(id))
    if (typeof owner === 'string' && owner.trim() && !out.includes(owner)) out.push(owner)
  }
  return out
}

export function emitEspnTransactionActivity(
  transactions: readonly EspnImportTransaction[],
  ctx: {
    /** ESPN's own league id — NOT AllFantasy's canonical `League.id` (that is `afLeagueId`). */
    leagueId: string
    afLeagueId?: string | null
    /** ESPN team id → the owner's member id (SWID); null for a team with no known owner. */
    teamOwnerMap: ReadonlyMap<string, string | null>
  },
): { raws: RawImportedActivity[]; skipped: PlatformEmitterSkip[] } {
  const raws: RawImportedActivity[] = []
  const skipped: PlatformEmitterSkip[] = []
  for (const tx of transactions) {
    const providerEventId = tx.transactionId?.trim() || null
    const activityType = ESPN_TYPE_MAP[String(tx.type ?? '').toLowerCase()]
    if (!activityType) {
      skipped.push({ providerEventId, reason: 'UNSUPPORTED_TRANSACTION_TYPE' })
      continue
    }
    if (!isFinal(tx.status)) {
      skipped.push({ providerEventId, reason: 'TRANSACTION_NOT_COMPLETE' })
      continue
    }
    raws.push({
      provider: 'espn',
      leagueId: ctx.leagueId,
      afLeagueId: ctx.afLeagueId ?? null,
      activityType,
      providerEventId,
      // The feed dates each topic; the parser turned that into ISO. Never substituted when absent.
      occurredAt: tx.createdAt ?? null,
      managerSourceIds: ownersOf(tx.teamIds ?? [], ctx.teamOwnerMap),
      payload: {
        source: 'espn_transaction',
        // `adds`/`drops` carry ESPN player ids; the feed must never resolve them as Sleeper ids.
        idSpace: 'espn',
        transactionType: tx.type,
        messageTypeId: tx.messageTypeId ?? null,
        adds: Object.keys(tx.adds ?? {}).length ? tx.adds : null,
        drops: Object.keys(tx.drops ?? {}).length ? tx.drops : null,
        bidAmount: tx.bidAmount ?? null,
        teamIds: tx.teamIds ?? [],
      },
    })
  }
  return { raws, skipped }
}

export function emitYahooTransactionActivity(
  transactions: readonly YahooImportTransaction[],
  ctx: {
    /** Yahoo's league key (e.g. `461.l.1361311`) — NOT AllFantasy's canonical `League.id`. */
    leagueId: string
    afLeagueId?: string | null
    /** Yahoo team key → the manager's guid (or the importer's manager id); null when unknown. */
    teamOwnerMap: ReadonlyMap<string, string | null>
  },
): { raws: RawImportedActivity[]; skipped: PlatformEmitterSkip[] } {
  const raws: RawImportedActivity[] = []
  const skipped: PlatformEmitterSkip[] = []
  for (const tx of transactions) {
    const providerEventId = tx.transactionId?.trim() || null
    const activityType = YAHOO_TYPE_MAP[String(tx.type ?? '').toLowerCase()]
    if (!activityType) {
      skipped.push({ providerEventId, reason: 'UNSUPPORTED_TRANSACTION_TYPE' })
      continue
    }
    if (!isFinal(tx.status)) {
      skipped.push({ providerEventId, reason: 'TRANSACTION_NOT_COMPLETE' })
      continue
    }
    raws.push({
      provider: 'yahoo',
      leagueId: ctx.leagueId,
      afLeagueId: ctx.afLeagueId ?? null,
      activityType,
      providerEventId,
      occurredAt: tx.createdAt ?? null,
      managerSourceIds: ownersOf(tx.teamKeys ?? [], ctx.teamOwnerMap),
      payload: {
        source: 'yahoo_transaction',
        idSpace: 'yahoo',
        transactionType: tx.type,
        adds: Object.keys(tx.adds ?? {}).length ? tx.adds : null,
        drops: Object.keys(tx.drops ?? {}).length ? tx.drops : null,
        teamKeys: tx.teamKeys ?? [],
      },
    })
  }
  return { raws, skipped }
}

/**
 * MFL transactions → imported activity.
 *
 * 🛑 TWO OF `parseMflTransactions`'s DEFAULTS POINT THE SAME WAY, AND A READER OF THIS FUNCTION
 * NEEDS TO KNOW. It defaults a missing `type` to `'trade'` and a missing `status` to
 * `'completed'`, so an MFL transaction carrying neither arrives here already labelled as a
 * completed trade — the most consequential classification available — and both gates below
 * would pass it.
 *
 * ⚠ WHAT ACTUALLY STOPS THAT IS THE NORMALIZER'S DATE RULE, AND ONLY INCIDENTALLY. A
 * transaction with no `occurredAt` is skipped downstream as `MISSING_OCCURRED_AT`, and a
 * payload malformed enough to omit its type almost always omits its timestamp too. That is
 * protection by coincidence, not by design: it is recorded here rather than relied upon
 * silently, and the honest fix is in the parser, which is not this change's to make — altering
 * those defaults would reclassify transactions on the IMPORT path as well.
 *
 * Nothing is invented here beyond what arrives: an unrecognised type is skipped and counted,
 * a franchise with no known owner attributes to nobody.
 */
export function emitMflTransactionActivity(
  transactions: readonly MflImportTransaction[],
  ctx: {
    /** MFL's own league id — NOT AllFantasy's canonical `League.id` (that is `afLeagueId`). */
    leagueId: string
    afLeagueId?: string | null
    /** MFL franchise id → the manager key; null for a franchise with no known owner. */
    teamOwnerMap: ReadonlyMap<string, string | null>
  },
): { raws: RawImportedActivity[]; skipped: PlatformEmitterSkip[] } {
  const raws: RawImportedActivity[] = []
  const skipped: PlatformEmitterSkip[] = []
  for (const tx of transactions) {
    const providerEventId = tx.transactionId?.trim() || null
    const activityType = MFL_TYPE_MAP[String(tx.type ?? '').toLowerCase()]
    if (!activityType) {
      skipped.push({ providerEventId, reason: 'UNSUPPORTED_TRANSACTION_TYPE' })
      continue
    }
    if (!isFinal(tx.status)) {
      skipped.push({ providerEventId, reason: 'TRANSACTION_NOT_COMPLETE' })
      continue
    }
    raws.push({
      provider: 'mfl',
      leagueId: ctx.leagueId,
      afLeagueId: ctx.afLeagueId ?? null,
      activityType,
      providerEventId,
      // Parsed from MFL's `timestamp`. Null when absent — never substituted with "now".
      occurredAt: tx.createdAt ?? null,
      managerSourceIds: ownersOf(tx.franchiseIds ?? [], ctx.teamOwnerMap),
      payload: {
        source: 'mfl_transaction',
        /*
         * ⚠ MFL player ids are MFL's own. Tagging the id space is what stops a consumer
         * resolving them against the Sleeper map and confidently naming the wrong players —
         * the ESPN emitter carries the same tag for the same reason.
         */
        idSpace: 'mfl',
        transactionType: tx.type,
        adds: Object.keys(tx.adds ?? {}).length ? tx.adds : null,
        drops: Object.keys(tx.drops ?? {}).length ? tx.drops : null,
        franchiseIds: tx.franchiseIds ?? [],
      },
    })
  }
  return { raws, skipped }
}

/**
 * One manager's identity for the normalizer: the AllFantasy user when the team
 * is claimed, else the provider's stable key. Mirrors buildSleeperManagerMapping.
 */
export function buildPlatformManagerMapping(
  provider: 'espn' | 'yahoo' | 'mfl',
  sourceId: string,
  afUserId: string | null,
): ExternalIdentityMapping {
  return {
    source_provider: provider,
    source_id: sourceId,
    entity_type: 'manager',
    af_id: afUserId,
    stable_key: `${provider}:${sourceId}`,
  }
}

export interface PlatformIngestionResult {
  writer: WriteImportedActivitySummary
  emitterSkipped: PlatformEmitterSkip[]
  normalizerSkipped: SkippedImportedActivity[]
}

/** Emit → normalize → write, for one ESPN, Yahoo or MFL league. Idempotent by natural key, like the Sleeper path. */
export async function ingestPlatformImportedActivity(
  input:
    | { provider: 'espn'; providerLeagueId: string; afLeagueId?: string | null; transactions: readonly EspnImportTransaction[]; teamOwnerMap: ReadonlyMap<string, string | null> }
    | { provider: 'yahoo'; providerLeagueId: string; afLeagueId?: string | null; transactions: readonly YahooImportTransaction[]; teamOwnerMap: ReadonlyMap<string, string | null> }
    | { provider: 'mfl'; providerLeagueId: string; afLeagueId?: string | null; transactions: readonly MflImportTransaction[]; teamOwnerMap: ReadonlyMap<string, string | null> },
  identityIndex: ManagerIdentityIndex,
  store: ImportedActivityStore,
): Promise<PlatformIngestionResult> {
  const ctx = { leagueId: input.providerLeagueId, afLeagueId: input.afLeagueId ?? null, teamOwnerMap: input.teamOwnerMap }
  /*
   * ⚠ A SWITCH, NOT A NESTED TERNARY. The two-provider form was `espn ? … : yahoo…`, where the
   * final branch was reached by elimination — adding a third provider to that shape would have
   * handed MFL transactions to the Yahoo emitter, which reads `teamKeys` where MFL has
   * `franchiseIds`, and emitted every MFL move attributed to nobody. Nothing would have thrown.
   */
  const emitted =
    input.provider === 'espn'
      ? emitEspnTransactionActivity(input.transactions, ctx)
      : input.provider === 'yahoo'
        ? emitYahooTransactionActivity(input.transactions, ctx)
        : emitMflTransactionActivity(input.transactions, ctx)
  const { normalized, skipped: normalizerSkipped } = normalizeImportedActivityBatch(emitted.raws, identityIndex)
  const writer = await writeImportedActivity(normalized, store)
  return { writer, emitterSkipped: emitted.skipped, normalizerSkipped }
}
