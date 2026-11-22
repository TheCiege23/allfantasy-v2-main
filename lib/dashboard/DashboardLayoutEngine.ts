/**
 * DashboardLayoutEngine — section order and visibility for the unified dashboard.
 * Determines which sections to show and in what order.
 */

import type { DashboardSectionCardType } from "./DashboardCardResolver"

interface DashboardSectionSpec {
  id: DashboardSectionCardType
  order: number
  visible: boolean
  viewAllHref?: string
}

const DEFAULT_SECTION_ORDER: DashboardSectionCardType[] = [
  "welcome",
  "product_launchers",
  "alerts",
  "active_leagues",
  "bracket_entries",
  "quick_actions",
  "ai_activity",
  "legacy_highlights",
]

export interface DashboardLayoutInput {
  hasAppLeagues: boolean
  hasBracketLeagues: boolean
  hasBracketEntries: boolean
  hasAlerts: boolean
}

/** Resolve which sections are visible and their order. */
export function getDashboardSections(input: DashboardLayoutInput): DashboardSectionSpec[] {
  const visibility: Record<DashboardSectionCardType, boolean> = {
    welcome: true,
    product_launchers: true,
    alerts: input.hasAlerts,
    active_leagues: input.hasAppLeagues || input.hasBracketLeagues,
    bracket_entries: input.hasBracketLeagues || input.hasBracketEntries,
    quick_actions: true,
    ai_activity: true,
    legacy_highlights: true,
  }

  return DEFAULT_SECTION_ORDER.map((id, index) => ({
    id,
    order: index,
    visible: visibility[id],
    viewAllHref:
      id === "active_leagues" ? "/leagues" : id === "bracket_entries" ? "/brackets" : undefined,
  }))
}
