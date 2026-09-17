/**
 * Fantasy OS Suite — shared executive-visualization status and chart types.
 *
 * This file was the view model for the League Health Map and its four supporting
 * cards on the old all-leagues `/commissioner-hub`. That page was retired on
 * 2026-09-17 (the five-doors restyle; its health analytics live in Commissioner OS),
 * and the map, the cards and their builders went with it. The types below are what
 * the other executive workspaces (manager, waiver, draft, platform) and the shared
 * chart layer still import, so they stay at this path rather than every importer
 * moving.
 */

/** 5 real health tiers (from the canonical `OverallStatus` domain) plus an explicit `unavailable` for
 * dimensions whose backing data genuinely isn't present, rather than silently drawing them as "good". */
export type ExecutiveHealthStatus = 'excellent' | 'healthy' | 'watch' | 'at_risk' | 'critical' | 'unavailable'

/** Structurally compatible with the chart layer's `ExecutiveBarItem`. */
export type ExecutiveBarDatum = {
  key: string
  label: string
  value: number
  max?: number
  status: ExecutiveHealthStatus
  valueLabel?: string
}

export type ExecutiveSupportingChart<T> = {
  headline: string
  items: T[]
  available: boolean
}
