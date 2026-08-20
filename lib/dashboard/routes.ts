/**
 * Dashboard Surface Consolidation — Canonical Route Ownership Map
 *
 * This file defines the single source of truth for all dashboard-related routes.
 * All internal navigation must point to these canonical destinations.
 *
 * Rules:
 * - One official destination per feature area (no fragmentation).
 * - Preserve query params for deep links (e.g., tab state in settings, league selector).
 * - Do not modify unless route ownership changes.
 *
 * Consolidation Status:
 * ✓ Dashboard CTAs updated: /tools → /tools-hub (canonical AI tools hub)
 * ✓ RightControlPanel verified: /create-league, /settings, /profile are canonical
 * ✓ Settings verified: /settings with tab query params is canonical
 * ✓ Wallet verified: /wallet is canonical destination
 * ✓ Route constants file created: this file serves as single source of truth
 *
 * TODO (future cleanup):
 * - Consolidate trade analyzer routes (/trade-analyzer vs /dynasty-trade-analyzer)
 * - Consolidate AI landing routes (SEO pages to internal routing)
 * - Consider /tools redirect or repurpose
 */

export const DASHBOARD_ROUTES = {
  // Core dashboard
  dashboard: () => '/dashboard',
  profile: () => '/profile',
  createLeague: () => '/create-league',
  leagues: () => '/leagues',

  // AI / Chat
  toolsHub: () => '/tools-hub',
  chimmyChat: () => '/chimmy/chat',
  messages: () => '/messages',

  // Trade
  tradeAnalyzer: () => '/trade-analyzer',
  dynastyTradeAnalyzer: () => '/dynasty-trade-analyzer',
  tradeFinder: () => '/trade-finder',

  // Settings & User
  settings: (tab?: string) => tab ? `/settings?tab=${tab}` : '/settings',
  wallet: () => '/wallet',

  // Legacy / SEO pages (do NOT use for internal nav — kept for backward compat only)
  // See ORPHANED_ROUTES below
} as const

/**
 * Orphaned / Legacy Routes — Do NOT use for internal CTAs
 *
 * These routes exist for historical reasons or SEO. Internal navigation should NOT point to them.
 * They may be removed in a future cleanup pass.
 */
export const ORPHANED_ROUTES = {
  // Dashboard
  dashboardContent: '/app/dashboard', // Orphaned — use /dashboard
  dashboardLegacy: '/af-legacy/dashboard',

  // Settings
  settingsFullPage: '/settings/full-page', // Orphaned — use /settings
  settingsLegacy: '/af-legacy/settings',

  // Trade (fragmented)
  tradeAnalyzerLanding: '/trade-analyzer', // SEO landing only — use /dynasty-trade-analyzer for interactive
  tradeLegacy: '/af-legacy/trade-analyzer', // Legacy UI
  tradeShare: '/trade/[id]', // Share/public view only

  // AI (fragmented)
  aiLanding: '/ai', // SEO explainer page — use /tools-hub or /chimmy/chat
  aiChatLanding: '/ai-chat', // SEO landing — use /chimmy/chat for interactive
  chimmyLanding: '/chimmy', // Marketing page — use /chimmy/chat for interactive
} as const

/**
 * Trade Analyzer Destination Decision
 *
 * Current situation:
 * - `/trade-analyzer` → SEO landing page with mostly metadata
 * - `/dynasty-trade-analyzer` → Full interactive form (DynastyTradeForm)
 * - `/af-legacy/trade-analyzer` → Legacy interactive UI
 *
 * Recommendation: Use `/trade-analyzer` as canonical if redesigned to be interactive.
 * For now, internal CTAs should point to whichever is most feature-complete.
 * This decision should be made during trade system refactoring.
 */

/**
 * Deep Link Examples
 *
 * Settings tab: `/settings?tab=profile`, `/settings?tab=connected`, etc.
 * Dashboard league: `/dashboard?league=abc123` (league selector deep link)
 * Trade analyzer sport context: `/trade-analyzer?sport=nfl&league=xyz` (if supported)
 * Chimmy league context: `/chimmy/chat?leagueId=abc123&prompt=...` (existing)
 */
