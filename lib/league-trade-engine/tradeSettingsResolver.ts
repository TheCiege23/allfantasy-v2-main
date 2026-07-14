/**
 * Resolves trade review / veto / delay from `League` row + `SettingsSnapshot` JSON.
 */

import type { League } from '@prisma/client'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import type { TradeReviewType } from '@/lib/league-trade-engine/types'

export type ResolvedLeagueTradeSettings = {
  tradeReviewMode: TradeReviewType
  tradeDeadlineWeek: number | null
  tradeReviewHours: number
  vetoThresholdPercent: number
  processingDelayHours: number
  tradesAllowed: boolean
  faabTradingAllowed: boolean
  draftPickTradingAllowed: boolean
  devyTradingAllowed: boolean
  c2cTradingAllowed: boolean
  processingMode: 'immediate' | 'commissioner_review' | 'league_vote'
  reviewWindowMinutes: number
  maxAssetsPerSide: number | null
  recentlyAddedRestrictionHours: number | null
  allowFutureDraftPicks: false
  allowConditionalTrades: false
  playerLockPolicy: 'individual_game_time'
  requireRosterLegality: true
  settingsVersion: string
  scoringVersion: string
  source: 'persisted_league_settings'
}

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function resolveLeagueTradeSettings(league: League): ResolvedLeagueTradeSettings {
  const snap = parseSettingsSnapshot(league.settings ?? null)
  const comm = (snap?.commissionerSettings ?? {}) as Record<string, unknown>
  const cr = (snap?.conceptRules ?? {}) as { extensions?: Record<string, unknown> }
  const ext = cr.extensions ?? {}

  const rawMode = String(
    comm.tradeReviewMode ?? (league as { tradeReviewMode?: string }).tradeReviewMode ?? 'commissioner',
  ).toLowerCase()

  let tradeReviewMode: TradeReviewType = 'commissioner'
  if (rawMode === 'none' || rawMode === 'instant') tradeReviewMode = 'instant'
  else if (rawMode === 'league_vote') tradeReviewMode = 'league_vote'
  else if (rawMode === 'commissioner') tradeReviewMode = 'commissioner'

  const tradeDeadlineWeek =
    typeof comm.tradeDeadlineWeek === 'number'
      ? comm.tradeDeadlineWeek
      : league.tradeDeadlineWeek ?? null

  const tradeReviewHours = num(comm.tradeReviewHours ?? league.tradeReviewHours, 48)

  const vetoThresholdPercent = Math.min(
    100,
    Math.max(1, num(comm.vetoThresholdPercent ?? ext.vetoThresholdPercent, 50)),
  )

  const processingDelayHours = Math.max(
    0,
    num(comm.tradeProcessingDelayHours ?? ext.tradeProcessingDelayHours, 0),
  )

  let tradesAllowed = !league.lockAllMoves && !league.bestBallMode
  if (league.guillotineMode) {
    const g = (snap as Record<string, unknown>).guillotineSettings as { tradesAllowed?: boolean } | undefined
    tradesAllowed = tradesAllowed && Boolean(g?.tradesAllowed ?? false)
  }
  if (league.bestBallMode && league.bbTradesEnabled === false) {
    tradesAllowed = false
  }

  const faabTradingAllowed =
    Boolean((ext as { faabTradable?: boolean }).faabTradable ?? league.draftPickTrading !== false)

  const draftPickTradingAllowed = league.draftPickTrading !== false

  const leagueType = String(league.leagueType ?? '').toLowerCase()
  const devyTradingAllowed = leagueType.includes('devy') || Boolean(ext.devyTrading ?? true)
  const c2cTradingAllowed = leagueType.includes('c2c') || Boolean(ext.c2cTrading ?? true)
  const configuredMax = num(comm.maxTradeAssetsPerSide ?? ext.maxTradeAssetsPerSide, 0)
  const maxAssetsPerSide = configuredMax > 0 ? Math.floor(configuredMax) : null
  const configuredRecentHours = num(comm.recentlyAddedTradeRestrictionHours ?? ext.recentlyAddedTradeRestrictionHours, 0)
  const recentlyAddedRestrictionHours = configuredRecentHours > 0 ? Math.floor(configuredRecentHours) : null
  const processingMode = tradeReviewMode === 'instant'
    ? 'immediate'
    : tradeReviewMode === 'league_vote'
      ? 'league_vote'
      : 'commissioner_review'

  return {
    tradeReviewMode,
    tradeDeadlineWeek,
    tradeReviewHours,
    vetoThresholdPercent,
    processingDelayHours,
    tradesAllowed,
    faabTradingAllowed,
    draftPickTradingAllowed,
    devyTradingAllowed,
    c2cTradingAllowed,
    processingMode,
    reviewWindowMinutes: tradeReviewHours * 60,
    maxAssetsPerSide,
    recentlyAddedRestrictionHours,
    allowFutureDraftPicks: false,
    allowConditionalTrades: false,
    playerLockPolicy: 'individual_game_time',
    requireRosterLegality: true,
    settingsVersion: String(league.settingsSnapshotVersion ?? 'legacy'),
    scoringVersion: String(league.scoringPresetId ?? league.scoring ?? 'legacy'),
    source: 'persisted_league_settings',
  }
}

export function toRedraftProposalGovernance(settings: ResolvedLeagueTradeSettings, eligibleRosterCount: number) {
  const vetoMode = settings.tradeReviewMode === 'league_vote'
    ? 'league_vote'
    : settings.tradeReviewMode === 'instant'
      ? 'no_veto'
      : 'commissioner'
  const vetoThreshold = Math.max(1, Math.ceil(Math.max(1, eligibleRosterCount) * settings.vetoThresholdPercent / 100))
  return {
    source: settings.source,
    processingMode: settings.processingMode,
    vetoMode,
    vetoThreshold,
    vetoThresholdPercent: settings.vetoThresholdPercent,
    reviewWindowMinutes: settings.reviewWindowMinutes,
    tradeDeadlineWeek: settings.tradeDeadlineWeek,
    maxAssetsPerSide: settings.maxAssetsPerSide,
    settingsVersion: settings.settingsVersion,
    scoringVersion: settings.scoringVersion,
  } as const
}

export function isPastTradeDeadline(league: League, currentWeek: number | null): boolean {
  const s = resolveLeagueTradeSettings(league)
  if (s.tradeDeadlineWeek == null || currentWeek == null) return false
  return currentWeek > s.tradeDeadlineWeek
}
