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
  'roster.player.added',
  'roster.player.dropped',
  'roster.player.started',
  'roster.player.benched',
  'roster.player.moved_to_ir',
  'roster.player.removed_from_ir',
  'roster.player.locked',
  'roster.player.unlocked',
  'lineup.submitted',
  'lineup.updated',
  'lineup.starter.changed',
  'schedule.generated',
  'schedule.regenerated',
  'schedule.locked',
  'schedule.week.opened',
  'schedule.week.completed',
  'matchup.created',
  'schedule.bye.assigned',
  'division.assigned',
  'waiver.period.opened',
  'waiver.period.closed',
  'waiver.claim.submitted',
  'waiver.claim.edited',
  'waiver.claim.cancelled',
  'waiver.processing.started',
  'waiver.claim.won',
  'waiver.claim.failed',
  'waiver.faab.deducted',
  'waiver.priority.updated',
  'waiver.free_agent.added',
  'waiver.processed',
  'waiver.transaction.recorded',
  'trade.proposed',
  'trade.countered',
  'trade.accepted',
  'trade.rejected',
  'trade.cancelled',
  'trade.expired',
  'trade.vetoed',
  'trade.league_vote.opened',
  'trade.league_vote.cast',
  'trade.league_vote.passed',
  'trade.league_vote.failed',
  'trade.executed',
  'trade.processed',
  'trade.roster.updated',
  'trade.transaction.recorded',
  'matchup.updated',
  'matchup.finalized',
  'scoring.period.opened',
  'scoring.player_stat.ingested',
  'scoring.fantasy_points.calculated',
  'scoring.team_score.updated',
  'scoring.matchup_score.updated',
  'scoring.updated',
  'scoring.stat_correction.applied',
  'standings.updated',
  'standings.recalculated',
  'playoffs.seeds.updated',
  'playoffs.qualification_snapshot.updated',
  'playoffs.advancement',
  'player.injury.updated',
  'player.news.updated',
  'commissioner.override',
  'commissioner.schedule_override',
  'commissioner.scoring_correction',
  'commissioner.waiver_override',
  'commissioner.trade_override',
  'lineup.illegal.flagged',
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
  lineup_submitted: 'lineup.submitted',
  lineup_updated: 'lineup.updated',
  lineup_change: 'lineup.updated',
  starter_changed: 'lineup.starter.changed',
  lineup_starter_changed: 'lineup.starter.changed',
  player_changed: 'roster.updated',
  roster_updated: 'roster.updated',
  player_added: 'roster.player.added',
  roster_player_added: 'roster.player.added',
  player_dropped: 'roster.player.dropped',
  roster_player_dropped: 'roster.player.dropped',
  player_started: 'roster.player.started',
  roster_player_started: 'roster.player.started',
  player_benched: 'roster.player.benched',
  roster_player_benched: 'roster.player.benched',
  player_moved_to_ir: 'roster.player.moved_to_ir',
  roster_player_moved_to_ir: 'roster.player.moved_to_ir',
  player_removed_from_ir: 'roster.player.removed_from_ir',
  roster_player_removed_from_ir: 'roster.player.removed_from_ir',
  player_locked: 'roster.player.locked',
  roster_player_locked: 'roster.player.locked',
  player_unlocked: 'roster.player.unlocked',
  roster_player_unlocked: 'roster.player.unlocked',
  schedule_generated: 'schedule.generated',
  schedule_regenerated: 'schedule.regenerated',
  schedule_locked: 'schedule.locked',
  week_opened: 'schedule.week.opened',
  schedule_week_opened: 'schedule.week.opened',
  week_completed: 'schedule.week.completed',
  schedule_week_completed: 'schedule.week.completed',
  matchup_created: 'matchup.created',
  bye_week_assigned: 'schedule.bye.assigned',
  schedule_bye_assigned: 'schedule.bye.assigned',
  division_assigned: 'division.assigned',
  waiver_period_opened: 'waiver.period.opened',
  waiver_period_closed: 'waiver.period.closed',
  waiver_claim_submitted: 'waiver.claim.submitted',
  waiver_submitted: 'waiver.claim.submitted',
  waiver_claim_edited: 'waiver.claim.edited',
  waiver_claim_cancelled: 'waiver.claim.cancelled',
  waiver_claim_canceled: 'waiver.claim.cancelled',
  waiver_processing_started: 'waiver.processing.started',
  waiver_claim_won: 'waiver.claim.won',
  waiver_claim_failed: 'waiver.claim.failed',
  faab_deducted: 'waiver.faab.deducted',
  waiver_faab_deducted: 'waiver.faab.deducted',
  waiver_priority_updated: 'waiver.priority.updated',
  free_agent_added: 'waiver.free_agent.added',
  waiver_free_agent_added: 'waiver.free_agent.added',
  waiver_processed: 'waiver.processed',
  waiver_transaction_recorded: 'waiver.transaction.recorded',
  trade_proposed: 'trade.proposed',
  trade_countered: 'trade.countered',
  trade_accepted: 'trade.accepted',
  trade_rejected: 'trade.rejected',
  trade_cancelled: 'trade.cancelled',
  trade_canceled: 'trade.cancelled',
  trade_expired: 'trade.expired',
  trade_vetoed: 'trade.vetoed',
  trade_league_vote_opened: 'trade.league_vote.opened',
  trade_league_vote_cast: 'trade.league_vote.cast',
  trade_league_vote_passed: 'trade.league_vote.passed',
  trade_league_vote_failed: 'trade.league_vote.failed',
  league_vote_opened: 'trade.league_vote.opened',
  league_vote_cast: 'trade.league_vote.cast',
  league_vote_passed: 'trade.league_vote.passed',
  league_vote_failed: 'trade.league_vote.failed',
  trade_executed: 'trade.executed',
  trade_processed: 'trade.processed',
  trade_roster_updated: 'trade.roster.updated',
  trade_transaction_recorded: 'trade.transaction.recorded',
  af_trade_proposed: 'trade.proposed',
  af_trade_awaiting_commissioner: 'trade.proposed',
  af_trade_veto_window: 'trade.accepted',
  af_trade_processed: 'trade.processed',
  matchup_updated: 'matchup.updated',
  matchup_changed: 'matchup.updated',
  matchup_finalized: 'matchup.finalized',
  scoring_period_opened: 'scoring.period.opened',
  player_stat_ingested: 'scoring.player_stat.ingested',
  scoring_player_stat_ingested: 'scoring.player_stat.ingested',
  fantasy_points_calculated: 'scoring.fantasy_points.calculated',
  scoring_fantasy_points_calculated: 'scoring.fantasy_points.calculated',
  team_score_updated: 'scoring.team_score.updated',
  scoring_team_score_updated: 'scoring.team_score.updated',
  matchup_score_updated: 'scoring.matchup_score.updated',
  scoring_matchup_score_updated: 'scoring.matchup_score.updated',
  matchup_live_tick: 'scoring.updated',
  score_finalized: 'scoring.updated',
  score_milestone: 'scoring.updated',
  stat_correction_applied: 'scoring.stat_correction.applied',
  scoring_stat_correction_applied: 'scoring.stat_correction.applied',
  standings_updated: 'standings.updated',
  standings_recalculated: 'standings.recalculated',
  playoff_seeds_updated: 'playoffs.seeds.updated',
  playoff_qualification_snapshot_updated: 'playoffs.qualification_snapshot.updated',
  playoff_advancement: 'playoffs.advancement',
  player_injury_update: 'player.injury.updated',
  player_news_update: 'player.news.updated',
  commissioner_override: 'commissioner.override',
  commissioner_schedule_override: 'commissioner.schedule_override',
  commissioner_scoring_correction: 'commissioner.scoring_correction',
  commissioner_waiver_override: 'commissioner.waiver_override',
  commissioner_trade_override: 'commissioner.trade_override',
  illegal_lineup_flagged: 'lineup.illegal.flagged',
  lineup_illegal_flagged: 'lineup.illegal.flagged',
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
