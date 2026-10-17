/**
 * PROMPT 273 — Global state consistency: when and how app state is refreshed.
 *
 * Single reference for refresh triggers so auth, leagues, drafts, chat, AI,
 * tokens, and subscriptions stay in sync and future changes stay consistent.
 */

/** Throttle for window-focus refetches (user-scoped data: tokens, entitlement). */
export const FOCUS_REFETCH_THROTTLE_MS = 5000

/**
 * Refresh triggers by domain:
 *
 * - Auth (session)
 *   - Source: next-auth SessionProvider.
 *   - Refreshed: on mount, on route change (NextAuth), refetch() when needed.
 *   - No app-level refetch on window focus; session is typically stable per tab.
 *
 * - Tokens (balance)
 *   - Hook: useTokenBalance() in hooks/useTokenBalance.ts
 *   - Refreshed: on mount; on window focus (throttled FOCUS_REFETCH_THROTTLE_MS); after spend/purchase (call refetch() or usePostPurchaseSync).
 *
 * - Subscriptions / entitlement
 *   - Hook: useEntitlement() in hooks/useEntitlement.ts
 *   - Refreshed: on mount; on window focus (throttled FOCUS_REFETCH_THROTTLE_MS); after purchase return (usePostPurchaseSync refetches entitlement + tokens when URL has success params).
 *
 * - League list (dashboard / app home)
 *   - Hook: useLeagueList(enabled) in hooks/useLeagueList.ts
 *   - Refreshed: on mount; on window focus (throttled) so list is fresh after create/join in another tab.
 *
 * - Leagues / section data
 *   - Hook: useLeagueSectionData(leagueId, sectionPath) in hooks/useLeagueSectionData.ts
 *   - Refreshed: on mount (when leagueId/sectionPath change); on window focus/visibility (throttled); manual reload().
 *   - Also listens to state refresh events for leagues/drafts (supports same-tab mutation sync).
 *   - Server/API: league data invalidated via lib/trade-engine/caching.ts (invalidateLeagueCache, handleInvalidationTrigger for trade/waiver/roster/settings).
 *
 * - Drafts
 *   - Same as leagues: section "draft" or draft-specific APIs; focus/visibility refresh + manual reload or real-time where implemented.
 *
 * - Chat / AI
 *   - No central client cache; per-thread or per-request fetch. Refetch by re-requesting or opening thread.
 *   - Global event bus can nudge consumers after successful chat/AI actions:
 *     lib/state-consistency/state-events.ts -> dispatchStateRefreshEvent().
 *
 * When adding new user-scoped global state (e.g. credits, preferences), consider:
 * - Refetch on mount.
 * - Refetch on window focus (throttled) if it can change in another tab.
 * - Expose refetch() for post-action sync (e.g. after purchase or settings change).
 */

export const REFRESH_TRIGGERS_DOC = {
  auth: 'SessionProvider (next-auth). Mount + refetch when needed; after profile/settings change call update() from useSession().',
  tokens: 'useTokenBalance: mount, window focus (throttled), refetch/post-purchase.',
  entitlement: 'useEntitlement: mount, window focus (throttled), refetch/post-purchase.',
  leagueList: 'useLeagueList: mount, window focus (throttled); keeps dashboard list fresh after create/join.',
  leagues: 'useLeagueSectionData: mount, focus/visibility (throttled), manual reload, state-event listeners; plus server cache invalidation.',
  drafts: 'Draft sections/APIs: mount, focus/visibility (throttled), manual reload, state-event listeners.',
  chat: 'Per-thread fetch. No surface dispatches chat refresh events since useAIChat was removed (2026-09-29).',
  ai: 'Per-request/session fetch; AI hooks emit refresh events after successful actions.',
  events: 'dispatchStateRefreshEvent/addStateRefreshListener provide cross-domain invalidation signals for auth/leagues/drafts/chat/ai/tokens/subscriptions.',
} as const
