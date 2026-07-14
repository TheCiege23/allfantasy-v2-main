/**
 * G15.2 — Event Catalog: the canonical, versioned vocabulary of platform domain
 * events. Sport- and league-concept-agnostic. Payloads are intentionally MINIMAL
 * (ids, counts, status) — rich/sport-specific detail belongs in the envelope
 * (`subjects`, `period`) or additive `metadata`, never as NFL/redraft-shaped columns.
 *
 * Privacy: payloads carry NO message content, NO PII beyond ids, NO secrets.
 *
 * Versioning: every type starts at v1. To evolve, register a NEW version
 * (see EVENT_SCHEMA_VERSION) — never mutate an existing payload shape.
 */
import { z } from 'zod'
import type { IEventSchemaRegistry } from './types'
import { zodValidator } from './schemaRegistry'

/** Canonical event type identifiers, grouped by domain (namespaced domain.subject.verb). */
export const EVENT = {
  // League lifecycle
  LEAGUE_CREATED: 'lifecycle.league.created',
  LEAGUE_ARCHIVED: 'lifecycle.league.archived',
  LEAGUE_LIFECYCLE_CHANGED: 'lifecycle.league.state_changed',
  SEASON_ACTIVATED: 'lifecycle.season.activated',
  SEASON_COMPLETED: 'lifecycle.season.completed',
  SEASON_SNAPSHOT_CREATED: 'lifecycle.season.snapshot_created',
  LEAGUE_ENTERED_OFFSEASON: 'lifecycle.league.entered_offseason',
  RENEWAL_OPENED: 'lifecycle.renewal.opened',
  MANAGER_RENEWED: 'lifecycle.renewal.manager_renewed',
  MANAGER_DECLINED: 'lifecycle.renewal.manager_declined',
  NEXT_SEASON_CREATED: 'lifecycle.renewal.next_season_created',
  RENEWAL_BLOCKED: 'lifecycle.renewal.blocked',
  NEXT_SEASON_DRAFT_INITIALIZATION_REQUESTED: 'lifecycle.renewal.next_season_draft_initialization_requested',
  NEXT_SEASON_SCHEDULE_INITIALIZATION_REQUESTED: 'lifecycle.renewal.next_season_schedule_initialization_requested',
  NEXT_SEASON_PLAYOFF_INITIALIZATION_REQUESTED: 'lifecycle.renewal.next_season_playoff_initialization_requested',
  SCHEDULE_GENERATED: 'lifecycle.schedule.generated',
  // Draft lifecycle + picks
  DRAFT_STARTED: 'draft.session.started',
  DRAFT_PAUSED: 'draft.session.paused',
  DRAFT_RESUMED: 'draft.session.resumed',
  DRAFT_COMPLETED: 'draft.session.completed',
  DRAFT_PICK_MADE: 'draft.pick.made',
  // Roster + lineup
  ROSTER_PLAYER_ADDED: 'roster.player.added',
  ROSTER_PLAYER_DROPPED: 'roster.player.dropped',
  LINEUP_SET: 'roster.lineup.set',
  LINEUP_LOCKED: 'roster.lineup.locked',
  // Trades
  TRADE_PROPOSED: 'transaction.trade.proposed',
  TRADE_ACCEPTED: 'transaction.trade.accepted',
  TRADE_REJECTED: 'transaction.trade.rejected',
  TRADE_CANCELED: 'transaction.trade.canceled',
  TRADE_VETOED: 'transaction.trade.vetoed',
  TRADE_PROCESSED: 'transaction.trade.processed',
  TRADE_EXECUTED: 'transaction.trade.executed',
  TRADE_REVERSED: 'transaction.trade.reversed',
  TRADE_REVERSAL_BLOCKED: 'transaction.trade.reversal_blocked',
  // IDP cap ledger (derived projections; the IDPCapTransaction ledger stays authoritative)
  IDP_CAP_PROJECTION_REFRESH_REQUESTED: 'idp.cap_projection_refresh_requested',
  // Waivers / free agency
  WAIVER_SUBMITTED: 'transaction.waiver.submitted',
  WAIVER_CANCELED: 'transaction.waiver.canceled',
  WAIVER_PROCESSED: 'transaction.waiver.processed',
  WAIVER_WINDOW_PROCESSED: 'transaction.waiver.window_processed',
  // Competition: matchups / scoring / standings / playoffs
  MATCHUP_CREATED: 'competition.matchup.created',
  MATCHUP_UPDATED: 'competition.matchup.updated',
  MATCHUP_FINALIZED: 'competition.matchup.finalized',
  SCORE_UPDATED: 'competition.score.updated',
  STANDINGS_UPDATED: 'competition.standings.updated',
  PLAYOFF_BRACKET_GENERATED: 'competition.playoff.bracket_generated',
  PLAYOFF_ADVANCED: 'competition.playoff.advanced',
  CHAMPION_CROWNED: 'competition.champion.crowned',
  // Governance / commissioner
  SETTINGS_CHANGED: 'governance.settings.changed',
  COMMISSIONER_ACTION: 'governance.commissioner.action',
  // User + chat activity
  USER_ACTIVITY: 'user.activity.recorded',
  CHAT_MESSAGE_POSTED: 'chat.message.posted',
  // Authentication
  AUTH_REGISTERED: 'auth.user.registered',
  AUTH_SIGNED_IN: 'auth.user.signed_in',
  // Subscription / entitlement
  SUBSCRIPTION_CHANGED: 'billing.subscription.changed',
  ENTITLEMENT_CHANGED: 'billing.entitlement.changed',
} as const

const id = z.string().min(1)
const optId = z.string().min(1).optional()

/**
 * Payload schemas (v1). Keyed by the canonical type string. `PayloadByType` is
 * derived from this object so the producer is fully type-checked against it.
 */
export const EVENT_PAYLOAD_SCHEMAS = {
  // ── League lifecycle ──
  [EVENT.LEAGUE_CREATED]: z.object({ leagueId: id, name: z.string().optional(), teamCount: z.number().int().nonnegative().optional() }),
  [EVENT.LEAGUE_ARCHIVED]: z.object({ leagueId: id }),
  [EVENT.LEAGUE_LIFECYCLE_CHANGED]: z.object({ leagueId: id, from: z.string(), to: z.string() }),
  [EVENT.SEASON_ACTIVATED]: z.object({ seasonId: id, season: z.number().int().optional() }),
  [EVENT.SEASON_COMPLETED]: z.object({ seasonId: id }),
  [EVENT.SEASON_SNAPSHOT_CREATED]: z.object({ seasonId: id, snapshotId: id }),
  [EVENT.LEAGUE_ENTERED_OFFSEASON]: z.object({ seasonId: id, snapshotId: id }),
  [EVENT.RENEWAL_OPENED]: z.object({ renewalId: id, seasonId: id }),
  [EVENT.MANAGER_RENEWED]: z.object({ renewalId: id, userId: id }),
  [EVENT.MANAGER_DECLINED]: z.object({ renewalId: id, userId: id }),
  [EVENT.NEXT_SEASON_CREATED]: z.object({
    renewalId: id,
    sourceLeagueId: id,
    sourceSeasonId: id,
    destinationLeagueId: id,
    destinationSeasonId: id,
    sport: z.string(),
    requestedSeason: z.number().int(),
    actorRole: z.enum(['commissioner', 'administrator']),
    rosterCount: z.number().int().nonnegative(),
    managerAssignmentCount: z.number().int().nonnegative(),
    settingsSnapshotVersion: z.number().int().nullable().optional(),
    idempotencyKey: id,
  }),
  [EVENT.RENEWAL_BLOCKED]: z.object({ renewalId: optId, sourceLeagueId: id, sourceSeasonId: id, violationCodes: z.array(z.string()) }),
  [EVENT.NEXT_SEASON_DRAFT_INITIALIZATION_REQUESTED]: z.object({ destinationSeasonId: id, destinationLeagueId: id, sport: z.string() }),
  [EVENT.NEXT_SEASON_SCHEDULE_INITIALIZATION_REQUESTED]: z.object({ destinationSeasonId: id, destinationLeagueId: id, sport: z.string() }),
  [EVENT.NEXT_SEASON_PLAYOFF_INITIALIZATION_REQUESTED]: z.object({ destinationSeasonId: id, destinationLeagueId: id, sport: z.string() }),
  [EVENT.SCHEDULE_GENERATED]: z.object({ seasonId: id, regularSeasonWeeks: z.number().int().optional(), matchupCount: z.number().int().optional() }),
  // ── Draft ──
  [EVENT.DRAFT_STARTED]: z.object({ draftId: id }),
  [EVENT.DRAFT_PAUSED]: z.object({ draftId: id }),
  [EVENT.DRAFT_RESUMED]: z.object({ draftId: id }),
  [EVENT.DRAFT_COMPLETED]: z.object({ draftId: id, pickCount: z.number().int().optional() }),
  [EVENT.DRAFT_PICK_MADE]: z.object({
    draftId: id,
    rosterId: optId,
    playerId: optId,
    overall: z.number().int().optional(),
    round: z.number().int().optional(),
    isAuto: z.boolean().optional(),
    bidAmount: z.number().optional(),
  }),
  // ── Roster / lineup ──
  [EVENT.ROSTER_PLAYER_ADDED]: z.object({ rosterId: id, playerId: id, via: z.string().optional() }),
  [EVENT.ROSTER_PLAYER_DROPPED]: z.object({ rosterId: id, playerId: id, via: z.string().optional() }),
  [EVENT.LINEUP_SET]: z.object({ rosterId: id, changeCount: z.number().int().optional() }),
  [EVENT.LINEUP_LOCKED]: z.object({ rosterId: id }),
  // ── Trades ──
  [EVENT.TRADE_PROPOSED]: z.object({ tradeId: id, proposerRosterId: optId, receiverRosterId: optId }),
  [EVENT.TRADE_ACCEPTED]: z.object({ tradeId: id }),
  [EVENT.TRADE_REJECTED]: z.object({ tradeId: id }),
  [EVENT.TRADE_CANCELED]: z.object({ tradeId: id }),
  [EVENT.TRADE_VETOED]: z.object({ tradeId: id, byUserId: optId }),
  [EVENT.TRADE_PROCESSED]: z.object({ tradeId: id }),
  [EVENT.TRADE_EXECUTED]: z.object({
    tradeId: id,
    snapshotId: id,
    sendingFranchiseIds: z.array(id),
    receivingFranchiseIds: z.array(id),
    assetSummary: z.object({ playerIds: z.array(id), faabTransfers: z.array(z.object({ fromFranchiseId: id, toFranchiseId: id, amount: z.number().nonnegative() })), idpSalaryTransfers: z.array(z.object({ playerId: id, fromFranchiseId: id, toFranchiseId: id, salary: z.number() })), draftAssetIds: z.array(id) }),
    governanceMode: z.string(),
    settingsVersion: z.string(),
    scoringVersion: z.string(),
    completeness: z.enum(['complete', 'partial']),
    source: z.enum(['native_redraft', 'generic_trade_engine']),
  }),
  [EVENT.TRADE_REVERSED]: z.object({ tradeId: id, snapshotId: id, reversalId: id }),
  [EVENT.TRADE_REVERSAL_BLOCKED]: z.object({ tradeId: id, snapshotId: optId, blockerCodes: z.array(z.string()) }),
  // ── IDP cap ledger ──
  [EVENT.IDP_CAP_PROJECTION_REFRESH_REQUESTED]: z.object({ leagueId: id, rosterIds: z.array(id), reason: z.string().optional() }),
  // ── Waivers ──
  [EVENT.WAIVER_SUBMITTED]: z.object({ claimId: id, rosterId: optId, addPlayerId: optId, dropPlayerId: optId, bid: z.number().optional() }),
  [EVENT.WAIVER_CANCELED]: z.object({ claimId: id }),
  [EVENT.WAIVER_PROCESSED]: z.object({ claimId: optId, rosterId: optId, result: z.string(), addPlayerId: optId, dropPlayerId: optId, bid: z.number().optional() }),
  [EVENT.WAIVER_WINDOW_PROCESSED]: z.object({ processed: z.number().int(), succeeded: z.number().int().optional(), failed: z.number().int().optional() }),
  // ── Competition ──
  [EVENT.MATCHUP_CREATED]: z.object({ matchupId: id }),
  [EVENT.MATCHUP_UPDATED]: z.object({ matchupId: id }),
  [EVENT.MATCHUP_FINALIZED]: z.object({ matchupId: id, homeScore: z.number().optional(), awayScore: z.number().optional(), winnerRosterId: optId }),
  [EVENT.SCORE_UPDATED]: z.object({ subjectId: id, subjectKind: z.string(), points: z.number().optional() }),
  [EVENT.STANDINGS_UPDATED]: z.object({ seasonId: id, changedRosterCount: z.number().int().optional() }),
  [EVENT.PLAYOFF_BRACKET_GENERATED]: z.object({ seasonId: id, playoffTeams: z.number().int().optional() }),
  [EVENT.PLAYOFF_ADVANCED]: z.object({ seasonId: id, round: z.number().int().optional(), advanced: z.number().int().optional() }),
  [EVENT.CHAMPION_CROWNED]: z.object({ seasonId: id, championRosterId: optId, championUserId: optId }),
  // ── Governance ──
  [EVENT.SETTINGS_CHANGED]: z.object({ leagueId: id, section: z.string().optional(), changedKeys: z.array(z.string()).optional() }),
  [EVENT.COMMISSIONER_ACTION]: z.object({ leagueId: id, action: z.string(), targetId: optId }),
  // ── User / chat ──
  [EVENT.USER_ACTIVITY]: z.object({ userId: id, action: z.string() }),
  [EVENT.CHAT_MESSAGE_POSTED]: z.object({ channelId: id, messageId: id, authorUserId: optId, scope: z.string().optional() }),
  // ── Auth ──
  [EVENT.AUTH_REGISTERED]: z.object({ userId: id }),
  [EVENT.AUTH_SIGNED_IN]: z.object({ userId: id, method: z.string().optional() }),
  // ── Billing ──
  [EVENT.SUBSCRIPTION_CHANGED]: z.object({ userId: id, status: z.string(), plan: z.string().optional() }),
  [EVENT.ENTITLEMENT_CHANGED]: z.object({ userId: id, feature: z.string(), granted: z.boolean() }),
} satisfies Record<string, z.ZodType>

export type EventType = keyof typeof EVENT_PAYLOAD_SCHEMAS
export type PayloadByType = { [K in EventType]: z.infer<(typeof EVENT_PAYLOAD_SCHEMAS)[K]> }

export const ALL_EVENT_TYPES = Object.keys(EVENT_PAYLOAD_SCHEMAS) as EventType[]

/** Current schema version per type. Bump by registering an additional version. */
export const EVENT_SCHEMA_VERSION: Record<EventType, number> = Object.fromEntries(
  ALL_EVENT_TYPES.map((t) => [t, 1]),
) as Record<EventType, number>

/**
 * Register every catalog schema into a registry (idempotent — skips already-registered
 * (type, version) pairs so it is safe to call from multiple composition roots).
 */
export function registerPlatformEventSchemas(registry: IEventSchemaRegistry): void {
  for (const type of ALL_EVENT_TYPES) {
    const version = EVENT_SCHEMA_VERSION[type]
    if (!registry.has(type, version)) {
      registry.register(type, version, zodValidator(EVENT_PAYLOAD_SCHEMAS[type]))
    }
  }
}
