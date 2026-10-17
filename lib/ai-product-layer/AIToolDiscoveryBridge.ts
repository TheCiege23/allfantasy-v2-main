/**
 * AIToolDiscoveryBridge — connects tool hub, search, and quick actions to AI tools and Chimmy.
 * Single place for AI discovery links so product feels like one intelligence system.
 */

import { getChimmyChatHref, getChimmyLandingHref, getPrimaryChimmyEntry } from './UnifiedChimmyEntryResolver';
import { getAIProductHrefForFeature } from './AIProductRouteResolver';
import type { AIToolDiscoveryLink } from './types';
import type { AIProductContext } from './types';
import type { ToolAIEntryKey } from '@/lib/unified-ai/types';

const LINKS: Array<Omit<AIToolDiscoveryLink, 'href'> & { featureKey: ToolAIEntryKey | string }> = [
  { label: 'Ask Chimmy', description: 'Private AI chat', featureKey: 'chimmy_chat', category: 'chat' },
  { label: 'Trade Analyzer', description: 'Trade evaluations', featureKey: 'trade_analyzer', category: 'tool' },
  { label: 'Trade Evaluator', description: 'Trade acceptance guidance', featureKey: 'trade_evaluator', category: 'tool' },
  { label: 'Waiver AI', description: 'Waiver recommendations', featureKey: 'waiver_ai', category: 'tool' },
  { label: 'Rankings AI', description: 'Power rankings and explanations', featureKey: 'rankings', category: 'tool' },
  { label: 'Draft Helper', description: 'Draft picks and war room help', featureKey: 'draft_helper', category: 'tool' },
  {
    label: 'League Matchup AI',
    description: 'Head-to-head AI breakdown in the league hub',
    featureKey: 'league_matchup_ai',
    category: 'tool',
  },
  {
    label: 'Start/Sit AI',
    description: 'Compare two starters with multi-model analysis',
    featureKey: 'league_start_sit_ai',
    category: 'tool',
  },
  // 🛑 No "Psychological Profiles" link (owner decision 2026-09-29, Milestone 32:
  // manager characterisation is shown to nobody). It was the only 'governance' link.
  { label: 'Story Creator', description: 'Legacy, rivalry, and prestige narratives', featureKey: 'story_creator', category: 'story' },
  { label: 'Content Generator', description: 'Social, media, and blog generation', featureKey: 'content', category: 'media' },
  { label: 'Meet Chimmy', description: 'Chimmy landing page', featureKey: 'chimmy_landing', category: 'chat' },
];

function resolveDiscoveryHref(link: (typeof LINKS)[number], context?: AIProductContext): string {
  if (link.featureKey === 'chimmy_landing') return getChimmyLandingHref();
  if (link.featureKey === 'chimmy_chat') return getChimmyChatHref(context);
  return getAIProductHrefForFeature(link.featureKey, context);
}

/**
 * All AI discovery links (tool hub, search, quick actions).
 */
export function getAIToolDiscoveryLinks(context?: AIProductContext): AIToolDiscoveryLink[] {
  return LINKS.map((link) => ({
    ...link,
    href: resolveDiscoveryHref(link, context),
  }));
}

/**
 * Links for quick action / top bar "Ask Chimmy" (primary chat entry).
 */
export function getChimmyQuickActionLink(context?: AIProductContext): AIToolDiscoveryLink {
  const entry = getPrimaryChimmyEntry({
    ...context,
    source: context?.source ?? 'quick_action',
  });
  return {
    label: entry.label,
    href: entry.href,
    description: 'Open AI chat',
    featureKey: 'chimmy_chat',
    category: 'chat',
  };
}

/**
 * Links for a given category (tool, chat, story, media, governance).
 */
export function getAIToolDiscoveryLinksByCategory(
  category: AIToolDiscoveryLink['category'],
  context?: AIProductContext
): AIToolDiscoveryLink[] {
  return getAIToolDiscoveryLinks(context).filter((l) => l.category === category);
}

/**
 * Resolve href for a tool key (for handoffs and deep links).
 */
export function getAIDiscoveryHrefForTool(key: ToolAIEntryKey | string, context?: AIProductContext): string {
  if (key === 'chimmy_landing') return getChimmyLandingHref();
  if (key === 'chimmy_chat') {
    return getPrimaryChimmyEntry(context).href;
  }
  const matched = LINKS.find((l) => l.featureKey === key);
  if (matched) return resolveDiscoveryHref(matched, context);
  return getPrimaryChimmyEntry(context).href;
}
