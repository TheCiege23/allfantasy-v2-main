/**
 * Decision OS — Phase A Increment 3: imported-activity → BehavioralEvent[] reader mapper.
 *
 * Pure conversion of persisted `DecisionOsImportedActivity` rows (imported/external-league
 * activity) into the same {@link BehavioralEvent} contract the AF-native mappers emit, so the
 * behavioral pipeline scores imported activity ALONGSIDE native activity — including managers
 * with no AllFantasy account (attributed via their stable external manager key).
 *
 * Invariants:
 * - `source: 'import'`; provenance carries provider + external source key (provenance only, never
 *   consumed by decision logic).
 * - Attribution matches behavioral semantics + keeps league counts correct: a trade emits ONE
 *   `trade_created` for the primary participant and `trade_accepted` for each counterparty (so a
 *   2-manager trade counts as 1 league trade, and both managers get attributed). Single-actor
 *   activity (waiver/roster_move/draft_pick) emits one event for the primary participant.
 * - `actorConfidence: 'inferred'` + reduced completeness for imported activity — honest, never fabricated.
 * - Unmappable activity (unknown type, no managers, bad timestamp) yields NO event and is reported
 *   in `skipped`.
 */

import type { BehavioralEvent } from './events/types'
import type { BehavioralEventType } from './events/taxonomy'
import type { ImportedActivityType } from '../ingestion/importedActivityNormalizer'

/** Read shape of a persisted imported-activity row (subset the mapper needs). Decoupled from Prisma. */
export interface ImportedActivityEventRow {
  externalSourceKey: string
  provider: string
  /** AF league id when mapped, else the provider league id (both are valid event `leagueId`s). */
  afLeagueId: string | null
  providerLeagueId: string
  activityType: string
  occurredAt: string | Date
  createdAt: string | Date
  /** Decision OS-derived fields; `managerKeys` is the authoritative attribution list. */
  normalized: { managerKeys?: unknown; hasExternalOnlyManager?: unknown } | null
  appUserId: string | null
}

export interface ImportedActivitySkip {
  externalSourceKey: string
  reason: 'UNKNOWN_ACTIVITY_TYPE' | 'NO_MANAGER_KEYS' | 'BAD_TIMESTAMP'
}

/** Single-actor activityType → behavioral event type. Trades are handled separately (proposer/acceptor). */
const SINGLE_ACTOR_EVENT: Record<Exclude<ImportedActivityType, 'trade'>, BehavioralEventType> = {
  waiver: 'waiver_claim_created',
  roster_move: 'lineup_saved', // roster-category event
  draft_pick: 'draft_pick_made',
}

function isKnownActivityType(t: string): t is ImportedActivityType {
  return t === 'trade' || t === 'waiver' || t === 'roster_move' || t === 'draft_pick'
}

function toIso(v: string | Date): string | null {
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function managerKeysOf(row: ImportedActivityEventRow): string[] {
  const raw = row.normalized?.managerKeys
  if (!Array.isArray(raw)) return []
  return raw.filter((k): k is string => typeof k === 'string' && k.length > 0)
}

/** Minimal, type-valid metadata per event type. Unknown fields default honestly (no fabrication). */
function metadataFor(eventType: BehavioralEventType, row: ImportedActivityEventRow): BehavioralEvent['metadata'] {
  switch (eventType) {
    case 'trade_created':
      return { proposalId: row.externalSourceKey, proposerRosterId: '', receiverRosterId: '', assetCount: 0, vetoMode: null, expiresAt: null }
    case 'trade_accepted':
      return { proposalId: row.externalSourceKey, acceptorRosterId: '', assetCount: 0 }
    case 'waiver_claim_created':
      return { claimId: row.externalSourceKey, addPlayerId: null, addPlayerName: null, dropPlayerId: null, dropPlayerName: null, bidAmount: null, priority: null, waiverType: null }
    case 'lineup_saved':
      return { week: null, season: null, leagueType: null, slotChanges: 0, startedPlayerIds: [], benchedPlayerIds: [] }
    case 'draft_pick_made':
      return { draftId: null, pickNumber: 0, overallPick: 0, round: null, playerId: null, playerName: null, position: null, team: null }
    default:
      return { surface: null } as BehavioralEvent['metadata']
  }
}

/**
 * Convert imported-activity rows into behavioral events + an honest `skipped` list for rows that
 * could not be represented.
 */
export function mapImportedActivityRowsToEvents(
  rows: readonly ImportedActivityEventRow[],
): { events: BehavioralEvent[]; skipped: ImportedActivitySkip[] } {
  const events: BehavioralEvent[] = []
  const skipped: ImportedActivitySkip[] = []

  for (const row of rows) {
    if (!isKnownActivityType(row.activityType)) {
      skipped.push({ externalSourceKey: row.externalSourceKey, reason: 'UNKNOWN_ACTIVITY_TYPE' })
      continue
    }
    const occurredAt = toIso(row.occurredAt)
    if (!occurredAt) {
      skipped.push({ externalSourceKey: row.externalSourceKey, reason: 'BAD_TIMESTAMP' })
      continue
    }
    const managerKeys = managerKeysOf(row)
    if (managerKeys.length === 0) {
      skipped.push({ externalSourceKey: row.externalSourceKey, reason: 'NO_MANAGER_KEYS' })
      continue
    }

    const leagueId = row.afLeagueId ?? row.providerLeagueId
    const recordedAt = toIso(row.createdAt) ?? occurredAt

    const push = (managerId: string, eventType: BehavioralEventType) => {
      const external = managerId !== row.appUserId // AF-linked managers flip to 'confirmed' once appUserId is populated (Increment 4)
      events.push({
        eventId: `${row.externalSourceKey}:${eventType}:${managerId}`,
        eventType,
        occurredAt,
        recordedAt,
        leagueId,
        managerId,
        source: 'import',
        provenance: { provider: row.provider, sourceId: row.externalSourceKey, importedAt: recordedAt, derivedFrom: [] },
        completeness: external ? 70 : 90,
        uncertainty: {
          sources: external ? ['managerId'] : [],
          timestampConfidence: 'exact',
          actorConfidence: external ? 'inferred' : 'confirmed',
        },
        metadata: metadataFor(eventType, row),
      } as BehavioralEvent)
    }

    if (row.activityType === 'trade') {
      push(managerKeys[0], 'trade_created')
      for (const counterparty of managerKeys.slice(1)) push(counterparty, 'trade_accepted')
    } else {
      push(managerKeys[0], SINGLE_ACTOR_EVENT[row.activityType])
    }
  }

  return { events, skipped }
}
