export const CANONICAL_LEAGUE_RUNTIME_EVENT_TYPES = [
  'league.created',
  'league.updated',
  'settings.updated',
  'draft.scheduled',
  'draft.started',
  'draft.pick',
  'draft.pick.submitted',
  'draft.queue.selected',
  'draft.autopick',
  'draft.substitute_pick',
  'draft.player_drafted',
  'draft.paused',
  'draft.resumed',
  'draft.manager.disconnected',
  'draft.manager.reconnected',
  'draft.recommendation.viewed',
  'draft.trade_opportunity.generated',
  'draft.chat.message',
  'draft.chat.mirrored',
  'draft.completed',
  'draft.recap.generated',
  'roster.updated',
  'lineup.updated',
  'waiver.claim.submitted',
  'waiver.processed',
  'trade.proposed',
  'trade.countered',
  'trade.accepted',
  'trade.rejected',
  'trade.vetoed',
  'trade.processed',
  'matchup.updated',
  'scoring.updated',
  'standings.updated',
  'playoffs.seeds.updated',
  'playoffs.advancement',
  'player.injury.updated',
  'player.news.updated',
  'commissioner.override',
  'import.completed',
  'import.needs_review',
  'runtime.unknown',
] as const

export type CanonicalLeagueRuntimeEventType = (typeof CANONICAL_LEAGUE_RUNTIME_EVENT_TYPES)[number]

export type CanonicalLeagueRuntimeEvent = {
  leagueId: string
  type: CanonicalLeagueRuntimeEventType
  occurredAtIso: string
  actorUserId: string | null
  sourceEventType: string
  payload: Record<string, unknown>
}

export type CanonicalLeagueRuntimeEventInput = {
  leagueId: string
  eventType: string
  createdAt?: Date | string | null
  actorUserId?: string | null
  payload?: unknown
  meta?: unknown
}

const CANONICAL_EVENT_TYPE_SET = new Set<string>(CANONICAL_LEAGUE_RUNTIME_EVENT_TYPES)

const LEGACY_EVENT_TYPE_ALIASES: Record<string, CanonicalLeagueRuntimeEventType> = {
  league_created: 'league.created',
  settings_changed: 'settings.updated',
  settings_change: 'settings.updated',
  lifecycle_transition: 'league.updated',
  draft_started: 'draft.started',
  draft_pick: 'draft.pick',
  pick_submitted: 'draft.pick.submitted',
  draft_pick_submitted: 'draft.pick.submitted',
  pick_made: 'draft.pick',
  queued_player_selected: 'draft.queue.selected',
  draft_queued_player_selected: 'draft.queue.selected',
  auto_pick: 'draft.autopick',
  draft_auto_pick: 'draft.autopick',
  ai_substitute_pick: 'draft.substitute_pick',
  draft_ai_substitute_pick: 'draft.substitute_pick',
  substitute_manager_pick: 'draft.substitute_pick',
  player_drafted: 'draft.player_drafted',
  draft_player_drafted: 'draft.player_drafted',
  draft_paused: 'draft.paused',
  draft_resumed: 'draft.resumed',
  manager_disconnected: 'draft.manager.disconnected',
  manager_reconnected: 'draft.manager.reconnected',
  draft_recommendation_viewed: 'draft.recommendation.viewed',
  draft_trade_opportunity_generated: 'draft.trade_opportunity.generated',
  draft_chat_message: 'draft.chat.message',
  draft_mirrored_to_league_chat: 'draft.chat.mirrored',
  draft_completed: 'draft.completed',
  draft_recap_generated: 'draft.recap.generated',
  lineup_updated: 'lineup.updated',
  lineup_change: 'lineup.updated',
  player_changed: 'roster.updated',
  roster_updated: 'roster.updated',
  waiver_claim_submitted: 'waiver.claim.submitted',
  waiver_processed: 'waiver.processed',
  trade_proposed: 'trade.proposed',
  trade_countered: 'trade.countered',
  trade_accepted: 'trade.accepted',
  trade_rejected: 'trade.rejected',
  trade_vetoed: 'trade.vetoed',
  trade_processed: 'trade.processed',
  af_trade_proposed: 'trade.proposed',
  af_trade_awaiting_commissioner: 'trade.proposed',
  af_trade_veto_window: 'trade.accepted',
  af_trade_processed: 'trade.processed',
  matchup_updated: 'matchup.updated',
  matchup_changed: 'matchup.updated',
  matchup_live_tick: 'scoring.updated',
  score_finalized: 'scoring.updated',
  score_milestone: 'scoring.updated',
  standings_updated: 'standings.updated',
  playoff_seeds_updated: 'playoffs.seeds.updated',
  playoff_advancement: 'playoffs.advancement',
  player_injury_update: 'player.injury.updated',
  player_news_update: 'player.news.updated',
  commissioner_override: 'commissioner.override',
  import_completed: 'import.completed',
  import_needs_review: 'import.needs_review',
}

function normalizeRawType(value: string): string {
  return value.trim().toLowerCase()
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

function occurredAtIso(value: Date | string | null | undefined): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date().toISOString()
}

export function normalizeLeagueRuntimeEventType(eventType: string): CanonicalLeagueRuntimeEventType {
  const raw = normalizeRawType(eventType)
  if (CANONICAL_EVENT_TYPE_SET.has(raw)) return raw as CanonicalLeagueRuntimeEventType
  const dotted = raw.replace(/_/g, '.')
  if (CANONICAL_EVENT_TYPE_SET.has(dotted)) return dotted as CanonicalLeagueRuntimeEventType
  return LEGACY_EVENT_TYPE_ALIASES[raw] ?? 'runtime.unknown'
}

export function toCanonicalLeagueRuntimeEvent(input: CanonicalLeagueRuntimeEventInput): CanonicalLeagueRuntimeEvent {
  const payload = payloadRecord(input.payload)
  const meta = payloadRecord(input.meta)
  return {
    leagueId: input.leagueId,
    type: normalizeLeagueRuntimeEventType(input.eventType),
    occurredAtIso: occurredAtIso(input.createdAt),
    actorUserId: input.actorUserId ?? null,
    sourceEventType: input.eventType,
    payload: {
      ...payload,
      ...(Object.keys(meta).length ? { meta } : {}),
    },
  }
}

export function isDecisionOsRuntimeEvent(event: Pick<CanonicalLeagueRuntimeEvent, 'type'>): boolean {
  return event.type !== 'runtime.unknown'
}
