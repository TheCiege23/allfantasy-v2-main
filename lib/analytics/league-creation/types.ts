/**
 * League Creation funnel analytics (Phase 4A) — typed events, no vendors.
 * Payloads stay small: no raw AI text, no PII, no secrets.
 */

import type { CreateMode } from '@/lib/create-league-v2/state'

/** Stable, namespaced event names for routing to future providers. */
export type LeagueCreationAnalyticsEventName =
  | 'league_create_started'
  | 'league_create_mode_selected'
  | 'league_create_template_list_viewed'
  | 'league_create_template_previewed'
  | 'league_create_template_applied'
  | 'league_create_template_mode_abandoned'
  | 'league_create_ai_recommendation_requested'
  | 'league_create_ai_unsupported_requests'
  | 'league_create_ai_recommendation_applied'
  | 'league_create_ai_recommendation_ignored'
  | 'league_create_review_viewed'
  | 'league_create_attempted'
  | 'league_create_succeeded'
  | 'league_create_failed'
  | 'league_create_validation_friction'

export type LeagueCreationFailureReason = 'validation' | 'server' | 'network' | 'unknown'

/** Normalized record passed to transports (JSON-serializable). */
export type LeagueCreationAnalyticsEvent = {
  name: LeagueCreationAnalyticsEventName
  timestamp: number
  sessionId: string
  createMode?: CreateMode
  /** Effective league type when known. */
  leagueType?: string | null
  sport?: string | null
  selectedTemplateId?: string | null
  success?: boolean
  failureReason?: LeagueCreationFailureReason
  /** Blocking completion issues or field-level friction. */
  validationWarningsCount?: number
  /** First blocking issue code when applicable (low cardinality). */
  primaryIssueCode?: string
  /** ms since funnel session began */
  elapsedMs?: number
  /** When switching creation mode — time spent in the mode being left. */
  previousMode?: CreateMode
  previousModeDurationMs?: number
  /** Template-specific */
  templateId?: string | null
  /** AI — character count only, not content */
  aiDescriptionCharCount?: number
  aiUnsupportedRequestCount?: number
  aiRecommendedTemplateId?: string | null
  aiConfidence?: number
  /** Server / client error classification (no message body). */
  errorClass?: 'field_errors' | 'general' | 'exception'
  /** Low-cardinality bucket for `league_create_validation_friction`. */
  validationFrictionKind?: 'missing_required' | 'invalid_combination' | 'unsupported_settings'
}

export type LeagueCreationAnalyticsTransport = {
  send: (event: LeagueCreationAnalyticsEvent) => void
}
