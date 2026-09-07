import type { EspnImportTransaction } from '@/lib/league-import/adapters/espn/types'
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
 * ESPN and Yahoo transactions → Decision OS imported activity.
 *
 * Until 2026-09-06 `decision_os_imported_activity` was written by the Sleeper
 * emitter only, so the finder's "Trade window · when they move" panel had
 * nothing to read for an ESPN or Yahoo league — the window is built from a
 * manager's own move times, and none were on file. Both platforms already
 * arrive through the league importers with real timestamps (ESPN's
 * communication feed dates each topic; Yahoo's transaction carries an epoch
 * `timestamp`) and with the team → manager binding the importers resolve, so
 * this is the same shape the Sleeper path uses, fed from what is already
 * fetched. Nothing is invented: a transaction with no time is skipped and
 * said so, a team with no known owner attributes to nobody.
 *
 * Manager keys are `<provider>:<manager id>` — ESPN's member SWID (what the
 * ESPN importer stores as `LeagueTeam.platformUserId`), Yahoo's manager guid
 * (or team key when Yahoo withholds the guid) — resolved to an AllFantasy user
 * id when the team is claimed (lib/core-app/managerPresence.ts reads both).
 *
 * ⚠ Yahoo's parsed transaction does not say whether an add went through
 * waivers or free agency, so every add/drop is a `roster_move` here; only a
 * trade is a `trade`. ESPN's feed does distinguish, and the map below keeps it.
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
 * One manager's identity for the normalizer: the AllFantasy user when the team
 * is claimed, else the provider's stable key. Mirrors buildSleeperManagerMapping.
 */
export function buildPlatformManagerMapping(
  provider: 'espn' | 'yahoo',
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

/** Emit → normalize → write, for one ESPN or Yahoo league. Idempotent by natural key, like the Sleeper path. */
export async function ingestPlatformImportedActivity(
  input:
    | { provider: 'espn'; providerLeagueId: string; afLeagueId?: string | null; transactions: readonly EspnImportTransaction[]; teamOwnerMap: ReadonlyMap<string, string | null> }
    | { provider: 'yahoo'; providerLeagueId: string; afLeagueId?: string | null; transactions: readonly YahooImportTransaction[]; teamOwnerMap: ReadonlyMap<string, string | null> },
  identityIndex: ManagerIdentityIndex,
  store: ImportedActivityStore,
): Promise<PlatformIngestionResult> {
  const ctx = { leagueId: input.providerLeagueId, afLeagueId: input.afLeagueId ?? null, teamOwnerMap: input.teamOwnerMap }
  const emitted =
    input.provider === 'espn' ? emitEspnTransactionActivity(input.transactions, ctx) : emitYahooTransactionActivity(input.transactions, ctx)
  const { normalized, skipped: normalizerSkipped } = normalizeImportedActivityBatch(emitted.raws, identityIndex)
  const writer = await writeImportedActivity(normalized, store)
  return { writer, emitterSkipped: emitted.skipped, normalizerSkipped }
}
