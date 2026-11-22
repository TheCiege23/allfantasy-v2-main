/**
 * UnifiedDashboardService — orchestrates dashboard data and section config for the unified dashboard.
 * Combines DashboardCardResolver, DashboardQuickActionResolver, DashboardAlertResolver,
 * DashboardLeagueSummaryService, and DashboardLayoutEngine.
 */

import { getProductLauncherCards } from "./DashboardCardResolver"
import { getDashboardQuickActions } from "./DashboardQuickActionResolver"
import { getDashboardSetupAlerts, needsSetupAction } from "./DashboardAlertResolver"
import {
  getAppLeaguesBySport,
  getLeagueSummaryCounts,
  type DashboardLeagueSummaryInput,
} from "./DashboardLeagueSummaryService"
import { getDashboardSections, type DashboardLayoutInput } from "./DashboardLayoutEngine"

interface UnifiedDashboardPayload {
  /** Ordered section specs (visibility + viewAllHref). */
  sections: ReturnType<typeof getDashboardSections>
  /** Product launcher cards (bracket, webapp, legacy). */
  productCards: ReturnType<typeof getProductLauncherCards>
  /** Quick action buttons. */
  quickActions: ReturnType<typeof getDashboardQuickActions>
  /** Setup alerts (verify, age, profile). */
  setupAlerts: ReturnType<typeof getDashboardSetupAlerts>
  /** League summary counts. */
  leagueCounts: ReturnType<typeof getLeagueSummaryCounts>
  /** App leagues grouped by sport (for Active Leagues section). */
  appLeaguesBySport: ReturnType<typeof getAppLeaguesBySport>
  /** Whether user needs setup action (show alert block). */
  needsSetup: boolean
}

/** Build full dashboard payload for the unified dashboard. */
export function getUnifiedDashboardPayload(
  leagueInput: DashboardLeagueSummaryInput,
  profileInput: { isVerified?: boolean; isAgeConfirmed?: boolean; profileComplete?: boolean },
  context?: { isAdmin?: boolean }
): UnifiedDashboardPayload {
  const leagueCounts = getLeagueSummaryCounts(leagueInput)
  const needsSetup = needsSetupAction(profileInput)
  const setupAlerts = getDashboardSetupAlerts(profileInput)

  const layoutInput: DashboardLayoutInput = {
    hasAppLeagues: (leagueInput.appLeagues?.length ?? 0) > 0,
    hasBracketLeagues: (leagueInput.bracketLeagues?.length ?? 0) > 0,
    hasBracketEntries: (leagueInput.bracketEntries?.length ?? 0) > 0,
    hasAlerts: setupAlerts.length > 0,
  }

  return {
    sections: getDashboardSections(layoutInput),
    productCards: getProductLauncherCards({
      poolCount: leagueCounts.totalBracketPools,
      entryCount: leagueCounts.totalBracketEntries,
    }),
    quickActions: getDashboardQuickActions({ isAdmin: context?.isAdmin }),
    setupAlerts,
    leagueCounts,
    appLeaguesBySport: getAppLeaguesBySport(leagueInput.appLeagues ?? []),
    needsSetup,
  }
}
