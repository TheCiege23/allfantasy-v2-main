/**
 * Server-only data access for the Operator Command Center overview + attention
 * views. Wrapped in React cache() so a single request that touches it more than
 * once (e.g. layout + page) only pays for the heavy metrics query once.
 */
import "server-only"
import { cache } from "react"
import { getAdminCommandCenterMetrics, type AdminCommandCenterMetrics } from "@/lib/admin-dashboard/AdminCommandCenterService"
import { getActiveLeaguesBySport } from "@/lib/admin-dashboard/AdminLeagueManagementService"

export type OperatorOverviewData = {
  metrics: AdminCommandCenterMetrics
  /** Total League rows across supported sports, or null if the count failed. */
  activeLeagues: number | null
}

export const getOperatorOverviewData = cache(async (): Promise<OperatorOverviewData> => {
  const [metrics, activeLeagues] = await Promise.all([
    getAdminCommandCenterMetrics(""),
    getActiveLeaguesBySport()
      .then((rows) => rows.reduce((sum, r) => sum + r.count, 0))
      .catch(() => null),
  ])
  return { metrics, activeLeagues }
})
