/**
 * PROMPT 273 — Global state consistency.
 *
 * Single entry point for refresh behavior and invalidation so auth, leagues,
 * drafts, chat, AI, tokens, and subscriptions stay in sync.
 */

export {
  FOCUS_REFETCH_THROTTLE_MS,
} from './refresh-triggers'

export {
  GLOBAL_STATE_REFRESH_EVENT,
  addStateRefreshListener,
  dispatchStateRefreshEvent,
  type StateRefreshDomain,
  type StateRefreshEventDetail,
} from './state-events'

// Re-export for API routes that need to invalidate after mutations
export {
  invalidateLeagueCache,
  handleInvalidationTrigger,
  type InvalidationTrigger,
} from '@/lib/trade-engine/caching'
