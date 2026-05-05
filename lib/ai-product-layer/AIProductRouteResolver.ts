/**
 * AIProductRouteResolver — resolve product route from context (league, tab, sport).
 * Ensures cross-product AI navigation lands on the correct tab/page.
 */

import type { AIProductRoute } from './types';
import type { ToolAIEntryKey } from '@/lib/unified-ai/types';
import type { AIProductContext } from './types';
import { isSupportedSport } from '@/lib/sport-scope';
import { getChimmyChatHref } from './UnifiedChimmyEntryResolver';

const AF_LEGACY = '/af-legacy';

/** Map tabId to full href (no leagueId in path; af-legacy is user-scoped). */
const TAB_ROUTES: Record<string, string> = {
  overview: `${AF_LEGACY}?tab=overview`,
  trade: `${AF_LEGACY}?tab=trade`,
  finder: `${AF_LEGACY}?tab=finder`,
  waiver: `${AF_LEGACY}?tab=waiver`,
  rankings: `${AF_LEGACY}?tab=rankings`,
  'mock-draft': `${AF_LEGACY}?tab=mock-draft`,
  chat: `${AF_LEGACY}?tab=chat`,
  strategy: `${AF_LEGACY}?tab=strategy`,
  pulse: `${AF_LEGACY}?tab=pulse`,
  compare: `${AF_LEGACY}?tab=compare`,
  share: `${AF_LEGACY}?tab=share`,
  transfer: `${AF_LEGACY}?tab=transfer`,
  'player-finder': `${AF_LEGACY}?tab=player-finder`,
};

const FEATURE_ROUTES: Record<string, string> = {
  /** Interactive Trade Hub (canonical); `/trade-analyzer` is SEO/marketing landing only */
  trade_analyzer: '/trade-evaluator',
  trade_evaluator: '/trade-evaluator',
  waiver_ai: '/waiver-ai',
  rankings: '/rankings',
  draft_helper: '/mock-draft',
  graph_insight: '/app/simulation-lab',
  psychological: `${AF_LEGACY}?tab=overview`,
  psychological_profiles: `${AF_LEGACY}?tab=overview`,
  legacy_score: `${AF_LEGACY}?tab=transfer`,
  reputation: `${AF_LEGACY}?tab=transfer`,
  rivalries: `${AF_LEGACY}?tab=transfer`,
  awards: `${AF_LEGACY}?tab=overview`,
  record_book: `${AF_LEGACY}?tab=overview`,
  career_prestige: `${AF_LEGACY}?tab=overview`,
  xp_explain: `${AF_LEGACY}?tab=overview`,
  gm_economy_explain: `${AF_LEGACY}?tab=overview`,
  bracket_intelligence: '/brackets',
  simulation: '/app/simulation-lab',
  matchup: '/app/matchup-simulation',
  league_matchup_ai: '/ai',
  league_start_sit_ai: '/ai',
  commentary: `${AF_LEGACY}?tab=overview`,
  story_creator: `${AF_LEGACY}?tab=overview`,
  content: '/social-clips',
  openclaw_dev_assistant: '/ai',
  openclaw_growth_marketing_assistant: '/ai',
};

export function appendAIProductContextToHref(baseHref: string, context?: AIProductContext): string {
  if (!context) return baseHref;
  const params = new URLSearchParams();
  if (context.leagueId) params.set('leagueId', context.leagueId);
  if (context.leagueName) params.set('leagueName', context.leagueName);
  if (context.sleeperUsername) params.set('sleeperUsername', context.sleeperUsername);
  if (context.teamId) params.set('teamId', context.teamId);
  if (context.insightType) params.set('insightType', context.insightType);
  if (context.source) params.set('source', context.source);
  if (isSupportedSport(context.sport)) params.set('sport', context.sport);
  if (typeof context.season === 'number') params.set('season', String(context.season));
  if (typeof context.week === 'number') params.set('week', String(context.week));
  if (context.leagueVariant) params.set('leagueVariant', context.leagueVariant);
  const query = params.toString();
  if (!query) return baseHref;
  return `${baseHref}${baseHref.includes('?') ? '&' : '?'}${query}`;
}

export function getAIProductHrefForFeature(featureKey: ToolAIEntryKey | string, context?: AIProductContext): string {
  if (featureKey === 'chimmy_chat') {
    return getChimmyChatHref(context);
  }
  if (featureKey === 'draft_helper' && context?.leagueId) {
    return `/league/${encodeURIComponent(context.leagueId)}/draft`;
  }
  if ((featureKey === 'league_matchup_ai' || featureKey === 'league_start_sit_ai') && context?.leagueId) {
    return appendAIProductContextToHref(
      `/league/${encodeURIComponent(context.leagueId)}?view=matchup`,
      context,
    );
  }
  if ((featureKey === 'matchup' || featureKey === 'simulation') && context?.leagueId) {
    return `/league/${encodeURIComponent(context.leagueId)}?tab=Matchups`;
  }
  const base = FEATURE_ROUTES[featureKey] ?? AI_HUB_HREF;
  return appendAIProductContextToHref(base, context);
}

function toContext(leagueIdOrContext?: string | null | AIProductContext): AIProductContext | undefined {
  if (!leagueIdOrContext) return undefined;
  if (typeof leagueIdOrContext === 'string') return { leagueId: leagueIdOrContext };
  return leagueIdOrContext;
}

/**
 * Resolve href for af-legacy tab (and optional leagueId query if needed later).
 */
export function getAIProductRouteForTab(
  tabId: string,
  leagueIdOrContext?: string | null | AIProductContext
): AIProductRoute {
  const context = toContext(leagueIdOrContext);
  const href = appendAIProductContextToHref(TAB_ROUTES[tabId] ?? `${AF_LEGACY}?tab=overview`, context);
  return {
    href,
    tabId,
    label: tabId,
    featureType: tabId,
  };
}

/**
 * All known AI product tab routes.
 */
export function getAllAIProductTabRoutes(context?: AIProductContext): AIProductRoute[] {
  return Object.entries(TAB_ROUTES).map(([tabId, href]) => ({
    href: appendAIProductContextToHref(href, context),
    tabId,
    label: tabId,
    featureType: tabId,
  }));
}

/** AI Hub (unified AI command center). */
export const AI_HUB_HREF = '/ai';

/**
 * Standalone AI pages (not af-legacy tabs).
 */
export function getStandaloneAIRoutes(context?: AIProductContext): AIProductRoute[] {
  return [
    { href: appendAIProductContextToHref(AI_HUB_HREF, context), label: 'AI Hub', featureType: 'ai_hub' },
    { href: getChimmyChatHref(context), label: 'Chimmy Chat', featureType: 'chimmy_chat' },
    { href: appendAIProductContextToHref('/chimmy', context), label: 'Meet Chimmy', featureType: 'chimmy_landing' },
    { href: appendAIProductContextToHref('/waiver-ai', context), label: 'Waiver AI', featureType: 'waiver_ai' },
    { href: appendAIProductContextToHref('/social-clips', context), label: 'Social clips', featureType: 'social_clips' },
    { href: appendAIProductContextToHref('/clips', context), label: 'Clips', featureType: 'clips' },
    { href: appendAIProductContextToHref('/tools-hub', context), label: 'Tools Hub', featureType: 'tools_hub' },
  ];
}
