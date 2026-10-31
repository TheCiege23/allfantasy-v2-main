import { isPlayoffSeriesResolved } from "./playoffBracketProjection"
import { allowsPlayoffLatePicks, canUsePlayoffLatePicks, getPlayoffSeriesLockedReason } from "./playoffLocking"
import type { PlayoffPickView, PlayoffSeriesView } from "./types"
import { nbaCupLockedReason } from "./nbaCupTournament"

export type PlayoffCompletionMode = "full_bracket_required" | "available_picks_only"

export type PlayoffCompletionContext = {
  sport?: string
  lockRule: string | null | undefined
  isPoolOwner?: boolean
  isTestMode?: boolean
  hasPoolAdminAccess?: boolean
  partialVerificationEnabled?: boolean
}

export type PlayoffCompletionSummary = {
  mode: PlayoffCompletionMode
  isSubmittable: boolean
  requiredPickCount: number
  savedRequiredPickCount: number
  totalSeriesCount: number
  unavailableSeriesCount: number
  missingRequiredSeriesIds: string[]
  requiredSeriesIds: string[]
  message: string
}

function hasPickForSeries(picks: PlayoffPickView[], seriesId: string): boolean {
  return picks.some((pick) => pick.seriesId === seriesId)
}

export function resolvePlayoffCompletionMode(context: PlayoffCompletionContext): PlayoffCompletionMode {
  if (context.sport === "nba_cup" && !context.isTestMode) return "available_picks_only"
  if (context.partialVerificationEnabled === true) return "available_picks_only"
  return canUsePlayoffLatePicks(context) ? "available_picks_only" : "full_bracket_required"
}

export function getRequiredPlayoffSeriesForCompletion(
  series: PlayoffSeriesView[],
  picks: PlayoffPickView[],
  context: PlayoffCompletionContext,
): PlayoffSeriesView[] {
  const mode = resolvePlayoffCompletionMode(context)
  if (mode === "full_bracket_required") return series

  return series.filter((item) => {
    if (context.sport === "nba_cup" && !context.isTestMode) return !nbaCupLockedReason(item)
    if (!isPlayoffSeriesResolved(item)) return false
    const lockReason = getPlayoffSeriesLockedReason(item, context.lockRule, context)
    return !lockReason || hasPickForSeries(picks, item.id)
  })
}

export function getPlayoffCompletionSummary(
  series: PlayoffSeriesView[],
  picks: PlayoffPickView[],
  context: PlayoffCompletionContext,
): PlayoffCompletionSummary {
  const mode = resolvePlayoffCompletionMode(context)
  const requiredSeries = getRequiredPlayoffSeriesForCompletion(series, picks, context)
  const requiredSeriesIds = requiredSeries.map((item) => item.id)
  const missingRequiredSeriesIds = requiredSeriesIds.filter((seriesId) => {
    if (context.sport === "nba_cup" && !context.isTestMode) {
      const game = requiredSeries.find((item) => item.id === seriesId)!
      return !picks.some((pick) => pick.seriesId === seriesId && [game.homeTeamName, game.awayTeamName].includes(pick.pickTeamName))
    }
    return !hasPickForSeries(picks, seriesId)
  })
  const savedRequiredPickCount = requiredSeriesIds.length - missingRequiredSeriesIds.length
  const unavailableSeriesCount = Math.max(0, series.length - requiredSeriesIds.length)
  const isSubmittable = requiredSeriesIds.length > 0 && missingRequiredSeriesIds.length === 0
  const message = context.sport === "nba_cup" && !context.isTestMode
    ? "Pick every currently available NBA Cup game, then finalize. Started games earn no late points; new matchups appear automatically."
    : mode === "available_picks_only"
    ? "Complete all currently available series before submitting this test bracket."
    : "Complete every series before submitting this bracket."

  return {
    mode,
    isSubmittable,
    requiredPickCount: requiredSeriesIds.length,
    savedRequiredPickCount,
    totalSeriesCount: series.length,
    unavailableSeriesCount,
    missingRequiredSeriesIds,
    requiredSeriesIds,
    message,
  }
}

export function canUsePartialPlayoffVerification(context: PlayoffCompletionContext): boolean {
  return context.partialVerificationEnabled === true ||
    (allowsPlayoffLatePicks(context.lockRule) && canUsePlayoffLatePicks(context))
}
