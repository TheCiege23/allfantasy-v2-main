/**
 * Lightweight product analytics for league engagement (Phase 6C).
 * Dispatches a namespaced DOM event — no external provider; listeners can forward to telemetry later.
 */
export type LeagueEngagementEventKind =
  | 'predraft_strip_shown'
  | 'predraft_strip_dismissed'
  | 'predraft_cta_invite'
  | 'predraft_cta_draft'
  | 'predraft_cta_chat'
  | 'predraft_cta_listing'
  | 'predraft_cta_payment'
  | 'predraft_cta_settings'
  | 'chat_empty_cta_settings'
  | 'chat_empty_cta_invite'
  | 'chat_empty_cta_draft'
  | 'chat_empty_cta_scoring'
  | 'member_wait_chat'

export type LeagueEngagementEventDetail = {
  kind: LeagueEngagementEventKind
  leagueId: string
  /** Commissioner vs member surface */
  surface?: 'commissioner' | 'member' | 'chat'
  meta?: Record<string, unknown>
}

export function emitLeagueEngagementEvent(detail: LeagueEngagementEventDetail): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('af-league-engagement', { detail }))
  } catch {
    /* ignore */
  }
}
