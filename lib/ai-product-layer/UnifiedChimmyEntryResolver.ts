/**
 * UnifiedChimmyEntryResolver — single source of truth for all Chimmy entry points.
 * Chimmy is the face of the AI layer; every product route to chat goes through here.
 */

import type { ChimmyEntry } from './types';
import type { AIProductContext } from './types';
import { buildAIChatHref, resolveSportForAIChat } from '@/lib/chimmy-chat';

const CHIMMY_LANDING = '/chimmy';
const CHIMMY_CHAT_ROUTE = '/chimmy/chat';
const LEGACY_CHAT = '/legacy?tab=chat';

function normalizeChimmyContext(context?: AIProductContext) {
  if (!context) return undefined;
  const prompt = context.prompt?.trim();
  return {
    prompt: prompt && prompt.length > 0 ? prompt.slice(0, 500) : undefined,
    leagueId: context.leagueId ?? undefined,
    leagueName: context.leagueName ?? undefined,
    sleeperUsername: context.sleeperUsername ?? undefined,
    insightType: context.insightType ?? undefined,
    teamId: context.teamId ?? undefined,
    sport: resolveSportForAIChat(context.sport, null),
    season: typeof context.season === 'number' ? context.season : undefined,
    week: typeof context.week === 'number' ? context.week : undefined,
    source: context.source ?? undefined,
  };
}

/**
 * Base href for opening private AI chat in Messages AI tab.
 */
export function getChimmyChatHref(context?: AIProductContext): string {
  return buildAIChatHref(normalizeChimmyContext(context));
}

/**
 * Chimmy landing page (marketing/onboarding).
 */
export function getChimmyLandingHref(): string {
  return CHIMMY_LANDING;
}

/**
 * Standalone Chimmy route (non-messages shell).
 */
export function getChimmyStandaloneChatHref(): string {
  return CHIMMY_CHAT_ROUTE;
}

/**
 * Chat with optional prompt prefill (for tool-to-Chimmy routing).
 */
export function getChimmyChatHrefWithPrompt(
  prompt: string,
  context: Omit<AIProductContext, 'prompt'> = {}
): string {
  return getChimmyChatHref({
    ...context,
    prompt,
  });
}

/**
 * All canonical Chimmy entries for nav, quick actions, and dashboard.
 */
export function getUnifiedChimmyEntries(context?: AIProductContext): ChimmyEntry[] {
  const chatHref = getChimmyChatHref(context);
  return [
    { href: chatHref, label: 'AI Chat' },
    { href: CHIMMY_CHAT_ROUTE, label: 'Chimmy Chat Route' },
    { href: CHIMMY_LANDING, label: 'Meet Chimmy' },
    { href: LEGACY_CHAT, label: 'Legacy AI Chat' },
  ];
}

/**
 * Primary entry for "Ask Chimmy" / "Open AI Chat" (used in top bar, right rail, tool hub).
 */
export function getPrimaryChimmyEntry(context?: AIProductContext): ChimmyEntry {
  return { href: getChimmyChatHref(context), label: 'Ask Chimmy' };
}
