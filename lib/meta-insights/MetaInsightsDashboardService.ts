/**
 * MetaInsightsDashboardService – orchestrates loading and serving Meta Insights dashboard.
 * Powers dashboard open, sport/format/timeframe filters, and data reload.
 */

import { resolveMetaUIData } from './MetaUIDataResolver'
import { resolveSportForMetaUI } from './SportMetaUIResolver'

export interface DashboardLoadOptions {
  sport: string
  leagueFormat?: string
  timeframe?: string
}

/**
 * Load full dashboard data (for server component or GET /api/meta-insights/dashboard).
 */
export async function loadMetaInsightsDashboard(opts: DashboardLoadOptions) {
  const sport = resolveSportForMetaUI(opts.sport)
  return resolveMetaUIData({
    sport,
    leagueFormat: opts.leagueFormat,
    timeframe: opts.timeframe,
  })
}

