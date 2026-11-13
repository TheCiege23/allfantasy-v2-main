/**
 * Computes a per-category data availability map from a WorldCupCurrentDataEvidenceSnapshot.
 * Used by Chimmy context to communicate what World Cup data is reliable for AI responses.
 * Never throws — always returns a safe fallback when evidence is missing.
 */

import type {
  WorldCupCurrentDataKey,
  WorldCupCurrentDataEvidenceSnapshot,
} from "./worldCupCurrentDataEvidence"

export type { WorldCupCurrentDataKey } from "./worldCupCurrentDataEvidence"

type WorldCupCurrentDataAvailabilityItem = {
  status: "available" | "unavailable" | "partial"
  label: string
  adminAction: string
}

export type WorldCupCurrentDataAvailability = Record<
  WorldCupCurrentDataKey,
  WorldCupCurrentDataAvailabilityItem
>

const ALL_KEYS: WorldCupCurrentDataKey[] = [
  "injuries",
  "player_stats",
  "team_stats",
  "squad_news",
  "lineups",
  "odds",
]

const DATA_LABELS: Record<WorldCupCurrentDataKey, string> = {
  injuries: "Injury reports",
  player_stats: "Player statistics",
  team_stats: "Team statistics",
  squad_news: "Squad news",
  lineups: "Lineups",
  odds: "Match odds",
}

const ADMIN_ACTIONS: Record<WorldCupCurrentDataKey, string> = {
  injuries: "Enable injury feed in the admin panel.",
  player_stats: "Sync player stats from the live data provider.",
  team_stats: "Sync team stats from the live data provider.",
  squad_news: "Enable squad news feed in the admin panel.",
  lineups: "Enable lineup feed in the admin panel.",
  odds: "Enable odds feed in the admin panel.",
}

/**
 * Build a per-category availability map.
 * Called with no args returns all categories as "unavailable" (safe fallback).
 * Called with evidence, marks categories with rows as "available".
 */
export function buildWorldCupCurrentDataAvailability(args?: {
  evidence?: WorldCupCurrentDataEvidenceSnapshot | null
}): WorldCupCurrentDataAvailability {
  const evidence = args?.evidence ?? null
  const result = {} as WorldCupCurrentDataAvailability

  for (const key of ALL_KEYS) {
    const hasRows = (evidence?.[key]?.rows.length ?? 0) > 0
    result[key] = {
      status: hasRows ? "available" : "unavailable",
      label: DATA_LABELS[key],
      adminAction: ADMIN_ACTIONS[key],
    }
  }

  return result
}
