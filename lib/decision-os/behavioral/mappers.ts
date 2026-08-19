/**
 * Decision OS — Phase 5.1 Behavioral Event Mappers.
 *
 * Pure functions: raw DB rows → canonical BehavioralEvent shapes.
 * No IO, no Prisma, no external side effects.
 *
 * Architecture invariants (ADR_PHASE5_1_BEHAVIORAL_EVENT_PORTS.md):
 * - All events have provenance.provider = null (native AF tables only)
 * - managerId is null when the source row has no actor userId
 * - Completeness degrades honestly per D4 in the ADR
 * - Never fabricates: null fields stay null; empty arrays are honest zeros
 */

import type { BehavioralEvent } from './events/types'
import {
  makeSystemProvenance,
  makeMinUncertainty,
  computeEventCompleteness,
} from './events/types'
import type {
  RawWaiverClaimRow,
  RawLeagueTradeRow,
  RawRosterMoveRow,
  RawDraftSessionRow,
  RawDraftPickRow,
  RawRedraftTradeRow,
  RawRedraftRosterPlayerRow,
  RawRedraftRosterMoveRow,
} from './port'

// ── Waiver mappers ────────────────────────────────────────────────────────────

/**
 * Map a WaiverClaim row to a `waiver_claim_created` event.
 * addPlayerName and dropPlayerName are null — WaiverClaim stores IDs only.
 */
export function mapWaiverClaimToCreatedEvent(row: RawWaiverClaimRow): BehavioralEvent {
  const waiverType: 'faab' | 'priority' = row.faabBid != null ? 'faab' : 'priority'

  // addPlayerName + dropPlayerName cannot be populated without a join → 2 missing fields
  const completeness = computeEventCompleteness({
    hasManagerId: row.userId != null,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 2,
  })

  return {
    eventId: `wc_created_${row.id}`,
    eventType: 'waiver_claim_created',
    occurredAt: row.createdAt.toISOString(),
    recordedAt: row.createdAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.userId,
    source: 'api',
    provenance: makeSystemProvenance(['WaiverClaim']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      claimId: row.id,
      addPlayerId: row.addPlayerId,
      addPlayerName: null,
      dropPlayerId: row.dropPlayerId,
      dropPlayerName: null,
      bidAmount: row.faabBid,
      priority: waiverType === 'faab' ? null : row.priorityOrder,
      waiverType,
    },
  }
}

/**
 * Map a WaiverClaim row to a `waiver_claim_processed` event, or null if not yet processed.
 * Outcome is derived from `WaiverClaim.status`: 'awarded' → awarded, anything else → denied.
 */
export function mapWaiverClaimToProcessedEvent(row: RawWaiverClaimRow): BehavioralEvent | null {
  if (!row.processedAt) return null

  const outcome: 'awarded' | 'denied' = row.status === 'awarded' ? 'awarded' : 'denied'

  const completeness = computeEventCompleteness({
    hasManagerId: row.userId != null,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 0,
  })

  return {
    eventId: `wc_processed_${row.id}`,
    eventType: 'waiver_claim_processed',
    occurredAt: row.processedAt.toISOString(),
    recordedAt: row.processedAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.userId,
    source: 'cron',
    provenance: makeSystemProvenance(['WaiverClaim']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      claimId: row.id,
      outcome,
      denialReason: outcome === 'denied' ? (row.resultMessage ?? null) : null,
      addPlayerId: row.addPlayerId,
      dropPlayerId: row.dropPlayerId,
      bidAmount: row.faabBid,
      priority: row.faabBid != null ? null : row.priorityOrder,
    },
  }
}

// ── Trade mappers ─────────────────────────────────────────────────────────────

/**
 * Map an AfLeagueTrade row to a `trade_created` event.
 * proposedByUserId is always present → managerId always set.
 */
export function mapLeagueTradeToCreatedEvent(row: RawLeagueTradeRow): BehavioralEvent {
  const vetoMode: 'commissioner' | 'league_vote' | 'no_veto' | null =
    row.reviewType === 'commissioner'
      ? 'commissioner'
      : row.reviewType === 'league_vote'
        ? 'league_vote'
        : row.reviewType === 'no_veto'
          ? 'no_veto'
          : null

  const completeness = computeEventCompleteness({
    hasManagerId: true,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 0,
  })

  return {
    eventId: `trade_created_${row.id}`,
    eventType: 'trade_created',
    occurredAt: row.createdAt.toISOString(),
    recordedAt: row.createdAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.proposedByUserId,
    source: 'api',
    provenance: makeSystemProvenance(['AfLeagueTrade', 'AfLeagueTradeItem']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      proposalId: row.id,
      proposerRosterId: row.proposerRosterId,
      receiverRosterId: row.receiverRosterId,
      assetCount: row.itemCount,
      vetoMode,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    },
  }
}

/**
 * Map an AfLeagueTrade row to a `trade_accepted` event, or null if not accepted.
 * managerId is null — receiver userId not stored in AfLeagueTrade.
 */
export function mapLeagueTradeToAcceptedEvent(row: RawLeagueTradeRow): BehavioralEvent | null {
  if (!row.acceptedAt) return null

  const completeness = computeEventCompleteness({
    hasManagerId: false,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 0,
  })

  return {
    eventId: `trade_accepted_${row.id}`,
    eventType: 'trade_accepted',
    occurredAt: row.acceptedAt.toISOString(),
    recordedAt: row.acceptedAt.toISOString(),
    leagueId: row.leagueId,
    managerId: null,
    source: 'api',
    provenance: makeSystemProvenance(['AfLeagueTrade']),
    completeness,
    uncertainty: {
      sources: ['managerId'],
      timestampConfidence: 'exact',
      actorConfidence: 'inferred',
    },
    metadata: {
      proposalId: row.id,
      acceptorRosterId: row.receiverRosterId,
      assetCount: row.itemCount,
    },
  }
}

/**
 * Map an AfLeagueTrade row to a `trade_rejected` event, or null if not rejected.
 * managerId is null — rejector userId not stored in AfLeagueTrade.
 */
export function mapLeagueTradeToRejectedEvent(row: RawLeagueTradeRow): BehavioralEvent | null {
  if (!row.rejectedAt) return null

  const completeness = computeEventCompleteness({
    hasManagerId: false,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 0,
  })

  return {
    eventId: `trade_rejected_${row.id}`,
    eventType: 'trade_rejected',
    occurredAt: row.rejectedAt.toISOString(),
    recordedAt: row.rejectedAt.toISOString(),
    leagueId: row.leagueId,
    managerId: null,
    source: 'api',
    provenance: makeSystemProvenance(['AfLeagueTrade']),
    completeness,
    uncertainty: {
      sources: ['managerId'],
      timestampConfidence: 'exact',
      actorConfidence: 'unknown',
    },
    metadata: {
      proposalId: row.id,
      rejectorRosterId: row.receiverRosterId,
      rejectionReason: null,
    },
  }
}

/**
 * Map all events from a single AfLeagueTrade row.
 * Always emits `trade_created`. Conditionally emits `trade_accepted` or `trade_rejected`.
 */
export function mapLeagueTradeToEvents(row: RawLeagueTradeRow): BehavioralEvent[] {
  const events: BehavioralEvent[] = [mapLeagueTradeToCreatedEvent(row)]
  const accepted = mapLeagueTradeToAcceptedEvent(row)
  if (accepted) events.push(accepted)
  const rejected = mapLeagueTradeToRejectedEvent(row)
  if (rejected) events.push(rejected)
  return events
}

// ── Roster move mapper ────────────────────────────────────────────────────────

/**
 * Map an AfRosterMoveHistory row to a `lineup_saved` event.
 * Slot-level detail (slotChanges, startedPlayerIds, benchedPlayerIds) is not stored in
 * AfRosterMoveHistory — provided as honest zeros/empty arrays. 1 missing metadata field counted.
 */
export function mapRosterMoveToLineupSavedEvent(row: RawRosterMoveRow): BehavioralEvent {
  const completeness = computeEventCompleteness({
    hasManagerId: row.actorUserId != null,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 1,
  })

  return {
    eventId: `lineup_saved_${row.id}`,
    eventType: 'lineup_saved',
    occurredAt: row.createdAt.toISOString(),
    recordedAt: row.createdAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.actorUserId,
    source: 'api',
    provenance: makeSystemProvenance(['AfRosterMoveHistory']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      week: row.week,
      season: row.season,
      leagueType: null,
      slotChanges: 0,
      startedPlayerIds: [],
      benchedPlayerIds: [],
    },
  }
}

// ── Draft mappers ─────────────────────────────────────────────────────────────

/**
 * Map a DraftSession row to a `draft_started` event.
 * System event — no actor (managerId null).
 */
export function mapDraftSessionToStartedEvent(row: RawDraftSessionRow): BehavioralEvent {
  const draftType: 'snake' | 'linear' | 'auction' | null =
    row.draftType === 'snake'
      ? 'snake'
      : row.draftType === 'linear'
        ? 'linear'
        : row.draftType === 'auction'
          ? 'auction'
          : null

  const completeness = computeEventCompleteness({
    hasManagerId: false,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 0,
  })

  return {
    eventId: `draft_started_${row.id}`,
    eventType: 'draft_started',
    occurredAt: row.createdAt.toISOString(),
    recordedAt: row.createdAt.toISOString(),
    leagueId: row.leagueId,
    managerId: null,
    source: 'system',
    provenance: makeSystemProvenance(['DraftSession']),
    completeness,
    uncertainty: {
      sources: ['managerId'],
      timestampConfidence: 'exact',
      actorConfidence: 'unknown',
    },
    metadata: {
      draftId: row.id,
      draftType,
      totalPicks: row.rounds * row.teamCount,
      totalManagers: row.teamCount,
    },
  }
}

/**
 * Map a DraftPick row to a `draft_pick_made` event.
 * occurredAt uses pickedAt when available, falls back to createdAt (both are system-set → exact).
 */
export function mapDraftPickToEvent(row: RawDraftPickRow): BehavioralEvent {
  const occurredAt = row.pickedAt ?? row.createdAt
  const missingFields = row.playerId == null ? 1 : 0

  const completeness = computeEventCompleteness({
    hasManagerId: row.ownerUserId != null,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: missingFields,
  })

  return {
    eventId: `draft_pick_${row.id}`,
    eventType: 'draft_pick_made',
    occurredAt: occurredAt.toISOString(),
    recordedAt: row.createdAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.ownerUserId,
    source: 'api',
    provenance: makeSystemProvenance(['DraftPick']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      draftId: row.sessionId,
      pickNumber: row.slot,
      overallPick: row.overall,
      round: row.round,
      playerId: row.playerId,
      playerName: row.playerName,
      position: row.position,
      team: row.team,
    },
  }
}

// ── Batch mappers ─────────────────────────────────────────────────────────────

/**
 * Map a batch of WaiverClaim rows to BehavioralEvent[].
 * Each row produces a `waiver_claim_created` event plus a `waiver_claim_processed` event
 * when `processedAt` is set.
 */
export function mapWaiverClaimsToEvents(rows: RawWaiverClaimRow[]): BehavioralEvent[] {
  const events: BehavioralEvent[] = []
  for (const row of rows) {
    events.push(mapWaiverClaimToCreatedEvent(row))
    const processed = mapWaiverClaimToProcessedEvent(row)
    if (processed) events.push(processed)
  }
  return events
}

/**
 * Map a batch of AfLeagueTrade rows to BehavioralEvent[].
 */
export function mapLeagueTradesToEvents(rows: RawLeagueTradeRow[]): BehavioralEvent[] {
  return rows.flatMap(mapLeagueTradeToEvents)
}

/**
 * Map a batch of AfRosterMoveHistory rows to BehavioralEvent[].
 */
export function mapRosterMovesToEvents(rows: RawRosterMoveRow[]): BehavioralEvent[] {
  return rows.map(mapRosterMoveToLineupSavedEvent)
}

/**
 * Map a DraftSession + DraftPick batch to BehavioralEvent[].
 *
 * Only emits `draft_started` when session.status !== 'pre_draft' (draft actually ran).
 * Emits one `draft_pick_made` per pick row regardless of session status.
 */
export function mapDraftRowsToEvents(
  session: RawDraftSessionRow | null,
  picks: RawDraftPickRow[],
): BehavioralEvent[] {
  const events: BehavioralEvent[] = []
  if (session && session.status !== 'pre_draft') {
    events.push(mapDraftSessionToStartedEvent(session))
  }
  for (const pick of picks) {
    events.push(mapDraftPickToEvent(pick))
  }
  return events
}

// ── Phase 2E: Redraft trade mappers ──────────────────────────────────────────
//
// Structurally mirror the AfLeagueTrade mappers above. RedraftTradeProposal
// resolves BOTH sides' owner via a roster join (see port.ts), so — unlike the
// AfLeagueTrade mapper, which has to leave managerId null on accepted/rejected
// events because the receiver's userId isn't stored there — these can honestly
// set a real, confirmed managerId on every event this domain supports.

/** Map a RedraftTradeProposal row to a `trade_created` event. */
export function mapRedraftTradeToCreatedEvent(row: RawRedraftTradeRow): BehavioralEvent {
  const vetoMode: 'commissioner' | 'league_vote' | 'no_veto' | null =
    row.vetoMode === 'commissioner'
      ? 'commissioner'
      : row.vetoMode === 'league_vote'
        ? 'league_vote'
        : row.vetoMode === 'no_veto'
          ? 'no_veto'
          : null

  const completeness = computeEventCompleteness({
    hasManagerId: true,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 0,
  })

  return {
    eventId: `redraft_trade_created_${row.id}`,
    eventType: 'trade_created',
    occurredAt: row.createdAt.toISOString(),
    recordedAt: row.createdAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.proposerOwnerId,
    source: 'api',
    provenance: makeSystemProvenance(['RedraftTradeProposal', 'RedraftTradeAsset']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      proposalId: row.id,
      proposerRosterId: row.proposerRosterId,
      receiverRosterId: row.receiverRosterId,
      assetCount: row.itemCount,
      vetoMode,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    },
  }
}

/** Map a RedraftTradeProposal row to a `trade_accepted` event, or null if not accepted. */
export function mapRedraftTradeToAcceptedEvent(row: RawRedraftTradeRow): BehavioralEvent | null {
  if (!row.acceptedAt) return null

  const completeness = computeEventCompleteness({
    hasManagerId: true,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 0,
  })

  return {
    eventId: `redraft_trade_accepted_${row.id}`,
    eventType: 'trade_accepted',
    occurredAt: row.acceptedAt.toISOString(),
    recordedAt: row.acceptedAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.receiverOwnerId,
    source: 'api',
    provenance: makeSystemProvenance(['RedraftTradeProposal']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      proposalId: row.id,
      acceptorRosterId: row.receiverRosterId,
      assetCount: row.itemCount,
    },
  }
}

/** Map a RedraftTradeProposal row to a `trade_rejected` event, or null if not rejected. */
export function mapRedraftTradeToRejectedEvent(row: RawRedraftTradeRow): BehavioralEvent | null {
  if (!row.rejectedAt) return null

  const completeness = computeEventCompleteness({
    hasManagerId: true,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 0,
  })

  return {
    eventId: `redraft_trade_rejected_${row.id}`,
    eventType: 'trade_rejected',
    occurredAt: row.rejectedAt.toISOString(),
    recordedAt: row.rejectedAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.receiverOwnerId,
    source: 'api',
    provenance: makeSystemProvenance(['RedraftTradeProposal']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      proposalId: row.id,
      rejectorRosterId: row.receiverRosterId,
      rejectionReason: null,
    },
  }
}

/**
 * Map all events from a single RedraftTradeProposal row.
 * Always emits `trade_created`. Conditionally emits `trade_accepted` or `trade_rejected`.
 */
export function mapRedraftTradeToEvents(row: RawRedraftTradeRow): BehavioralEvent[] {
  const events: BehavioralEvent[] = [mapRedraftTradeToCreatedEvent(row)]
  const accepted = mapRedraftTradeToAcceptedEvent(row)
  if (accepted) events.push(accepted)
  const rejected = mapRedraftTradeToRejectedEvent(row)
  if (rejected) events.push(rejected)
  return events
}

/** Map a batch of RedraftTradeProposal rows to BehavioralEvent[]. */
export function mapRedraftTradesToEvents(rows: RawRedraftTradeRow[]): BehavioralEvent[] {
  return rows.flatMap(mapRedraftTradeToEvents)
}

// ── Phase 2E: Redraft roster-composition mapper ──────────────────────────────

/**
 * Map a RedraftRosterPlayer row to a `lineup_saved` event, honestly
 * representing a real roster-composition change rather than a literal
 * start/bench swap — the redraft schema has no persisted slot-change history
 * (RedraftRosterPlayer.slotType is overwritten in place with no timestamp; see
 * app/api/redraft/roster/route.ts's lineup-save handler), so this is the same
 * "honest zeros for unknown slot-level detail" approximation
 * `mapRosterMoveToLineupSavedEvent` already uses for AfRosterMoveHistory —
 * not a new invention, the same existing convention applied to a new source.
 *
 * Only `acquisitionType === 'free_agent'` rows map here. 'waiver' rows are
 * already covered by the WaiverClaim mapper, 'trade' rows by the
 * RedraftTradeProposal mapper above, and 'drafted' rows by the draft mapper —
 * mapping those here too would double-count the same real-world action.
 * Returns null for any other acquisitionType.
 */
export function mapRedraftRosterPlayerToLineupSavedEvent(
  row: RawRedraftRosterPlayerRow,
): BehavioralEvent | null {
  if (row.acquisitionType !== 'free_agent') return null

  // week/season are genuinely unknown here (RedraftRosterPlayer has no such
  // columns) — stay null rather than guess, per the never-fabricate invariant.
  const completeness = computeEventCompleteness({
    hasManagerId: true,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 3, // week, season, slot-level detail all unknown
  })

  return {
    eventId: `redraft_roster_move_${row.id}`,
    eventType: 'lineup_saved',
    occurredAt: row.addedAt.toISOString(),
    recordedAt: row.addedAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.ownerUserId,
    source: 'api',
    provenance: makeSystemProvenance(['RedraftRosterPlayer']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      week: null,
      season: null,
      leagueType: 'redraft',
      slotChanges: 0,
      startedPlayerIds: [],
      benchedPlayerIds: [],
    },
  }
}

/**
 * Map a batch of RedraftRosterPlayer rows to BehavioralEvent[].
 * Rows whose acquisitionType isn't 'free_agent' are silently skipped (see
 * `mapRedraftRosterPlayerToLineupSavedEvent`'s doc comment for why).
 */
export function mapRedraftRosterPlayersToEvents(rows: RawRedraftRosterPlayerRow[]): BehavioralEvent[] {
  const events: BehavioralEvent[] = []
  for (const row of rows) {
    const event = mapRedraftRosterPlayerToLineupSavedEvent(row)
    if (event) events.push(event)
  }
  return events
}

// ── Phase 2H: Redraft lineup-save history mapper ─────────────────────────────

/**
 * Map a RedraftRosterMoveHistory row to a `lineup_saved` event with a REAL
 * week/season — unlike `mapRedraftRosterPlayerToLineupSavedEvent` above,
 * which honestly has to leave week/season null (RedraftRosterPlayer has no
 * such columns). This is the source docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md
 * scoped specifically to unlock lib/decision-os/phase6/patterns/patterns.ts's
 * lineup-based pattern detectors (which explicitly skip week=null events).
 * Slot-level detail (slotChanges, startedPlayerIds, benchedPlayerIds) is
 * still not stored per-event here — honest zeros/empty arrays, same
 * convention as every other lineup_saved mapper in this file.
 */
export function mapRedraftRosterMoveToLineupSavedEvent(row: RawRedraftRosterMoveRow): BehavioralEvent {
  const completeness = computeEventCompleteness({
    hasManagerId: row.actorUserId != null,
    timestampConfidence: 'exact',
    hasProvider: false,
    missingMetadataFieldCount: 1, // slot-level detail unavailable
  })

  return {
    eventId: `redraft_roster_move_history_${row.id}`,
    eventType: 'lineup_saved',
    occurredAt: row.createdAt.toISOString(),
    recordedAt: row.createdAt.toISOString(),
    leagueId: row.leagueId,
    managerId: row.actorUserId,
    source: 'api',
    provenance: makeSystemProvenance(['RedraftRosterMoveHistory']),
    completeness,
    uncertainty: makeMinUncertainty(),
    metadata: {
      week: row.week,
      season: row.season,
      leagueType: 'redraft',
      slotChanges: 0,
      startedPlayerIds: [],
      benchedPlayerIds: [],
    },
  }
}

/** Map a batch of RedraftRosterMoveHistory rows to BehavioralEvent[]. */
export function mapRedraftRosterMovesToEvents(rows: RawRedraftRosterMoveRow[]): BehavioralEvent[] {
  return rows.map(mapRedraftRosterMoveToLineupSavedEvent)
}
