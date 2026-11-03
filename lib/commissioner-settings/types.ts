/**
 * Commissioner settings types. Supports all seven sports (NFL, NHL, NBA, MLB, NCAAF, NCAAB, SOCCER).
 */

import type { LeagueSport } from "@prisma/client"

export type GeneralSettingsInput = {
  name?: string | null
  description?: string | null
  sport?: LeagueSport
  season?: number | null
}

export type RosterSettingsInput = {
  rosterSize?: number | null
  leagueSize?: number | null
  starters?: unknown
  benchSize?: number | null
  rosterPositions?: string[] | null
}

export type TradeSettingsInput = {
  tradeReviewType?: string | null
  vetoThreshold?: number | null
  /** How the veto threshold counts: a number of votes (default) or a percent of the teams. */
  vetoThresholdMode?: 'count' | 'percent' | null
}

export type LeagueSettingsPatch = GeneralSettingsInput & RosterSettingsInput & TradeSettingsInput & {
  /** Settings JSON: description, lineupLockRule, etc. */
  lineupLockRule?: string | null
  publicDashboard?: boolean
  rankedVisibility?: boolean
  orphanSeeking?: boolean
  orphanDifficulty?: string | null
  leagueChatThreadId?: string | null
}

export interface LeagueConfigurationView {
  id: string
  name: string | null
  description: string | null
  sport: LeagueSport
  leagueVariant: string | null
  season: number | null
  leagueSize: number | null
  rosterSize: number | null
  starters: unknown
  settings: Record<string, unknown>
}
