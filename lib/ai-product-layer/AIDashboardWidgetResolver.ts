/**
 * AIDashboardWidgetResolver — which AI widgets to show on dashboard, league, and app surfaces.
 * Keeps AI discovery consistent and sport-aware.
 */

import type { AIDashboardWidget, AIProductContext, AIDashboardSurface } from './types';
import { getAIProductHrefForFeature } from './AIProductRouteResolver';

const WIDGETS: Array<Omit<AIDashboardWidget, 'href'>> = [
  {
    id: 'trade',
    label: 'AI Trade Analyzer',
    description: 'Context-aware trade evaluations',
    tabId: 'trade',
    featureKey: 'trade_analyzer',
    sportAware: true,
  },
  {
    id: 'waiver',
    label: 'Waiver Engine',
    description: 'Weekly waiver priority and one-move plan',
    tabId: 'waiver',
    featureKey: 'waiver_ai',
    sportAware: true,
  },
  {
    id: 'rankings',
    label: 'Team Direction',
    description: 'Power + luck rankings',
    tabId: 'rankings',
    featureKey: 'rankings',
    sportAware: true,
  },
  {
    id: 'mock-draft',
    label: 'Draft War Room',
    description: 'Real-time draft recommendations',
    tabId: 'mock-draft',
    featureKey: 'draft_helper',
    sportAware: true,
  },
  // 🛑 No "Psychology AI" widget (owner decision 2026-09-29, Milestone 32: manager
  // characterisation is shown to nobody).
  {
    id: 'story',
    label: 'Story Creator',
    description: 'Legacy, rivalry, and prestige narratives',
    tabId: 'overview',
    featureKey: 'story_creator',
    sportAware: true,
  },
  {
    id: 'chat',
    label: 'AI Chat',
    description: 'Ask Chimmy anything',
    tabId: 'chat',
    featureKey: 'chimmy',
    sportAware: true,
  },
  {
    id: 'content',
    label: 'Content Generator',
    description: 'Social clips, media, and blog generation',
    tabId: 'share',
    featureKey: 'content',
    sportAware: true,
  },
];

const WIDGETS_BY_SURFACE: Record<AIDashboardSurface, string[]> = {
  app: ['trade', 'waiver', 'rankings', 'mock-draft', 'chat', 'content'],
  dashboard: ['trade', 'waiver', 'rankings', 'mock-draft', 'chat'],
  league: ['trade', 'waiver', 'rankings', 'story', 'chat'],
};

function resolveWidgetHref(widget: Omit<AIDashboardWidget, 'href'>, context?: AIProductContext): string {
  const featureKey = widget.featureKey;
  if (featureKey === 'chimmy') {
    return getAIProductHrefForFeature('chimmy_chat', {
      ...context,
      source: context?.source ?? 'dashboard_widget',
    });
  }
  return getAIProductHrefForFeature(featureKey, {
    ...context,
    source: context?.source ?? 'dashboard_widget',
  });
}

/**
 * All dashboard AI widgets (for app/league/dashboard surfaces).
 */
export function getAIDashboardWidgets(context?: AIProductContext): AIDashboardWidget[] {
  return WIDGETS.map((widget) => ({
    ...widget,
    href: resolveWidgetHref(widget, context),
  }));
}

/**
 * Widgets for a given surface (e.g. league context can filter by leagueId later).
 */
export function getAIDashboardWidgetsForSurface(
  surface: AIDashboardSurface,
  context?: AIProductContext
): AIDashboardWidget[] {
  const allowedIds = new Set(WIDGETS_BY_SURFACE[surface] ?? []);
  return getAIDashboardWidgets(context).filter((widget) => allowedIds.has(widget.id));
}

/**
 * Single widget by feature key (for deep links and handoffs).
 */
export function getAIDashboardWidgetByFeatureKey(
  featureKey: string,
  context?: AIProductContext
): AIDashboardWidget | null {
  return getAIDashboardWidgets(context).find((w) => w.featureKey === featureKey) ?? null;
}
