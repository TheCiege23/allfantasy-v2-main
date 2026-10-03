import { matchupNoun } from "./singleGame"
import type { PlayoffSeriesView } from "./types"

export const PLAYOFF_LATE_PICK_LOCK_RULES = new Set(["none", "commissioner_override"])

export function allowsPlayoffLatePicks(lockRule: string | null | undefined): boolean {
  return PLAYOFF_LATE_PICK_LOCK_RULES.has(String(lockRule ?? "").trim().toLowerCase())
}

export function canUsePlayoffLatePicks(input: {
  lockRule: string | null | undefined
  isPoolOwner?: boolean
  isTestMode?: boolean
  hasPoolAdminAccess?: boolean
}): boolean {
  return allowsPlayoffLatePicks(input.lockRule) && (
    input.isPoolOwner === true ||
    input.isTestMode === true ||
    input.hasPoolAdminAccess === true
  )
}

export function getPlayoffSeriesLockedReason(
  // `bestOf` is optional so existing callers type-check; when present, a single
  // game reads "Game completed" rather than "Series completed".
  series: Pick<PlayoffSeriesView, "status" | "startsAt"> & { bestOf?: number | null },
  lockRule: string | null | undefined,
  options: { isPoolOwner?: boolean; isTestMode?: boolean; hasPoolAdminAccess?: boolean } = {},
): string | null {
  if (canUsePlayoffLatePicks({ lockRule, ...options })) return null
  const noun = matchupNoun(series)
  if (series.status === "final") return `${noun} completed`
  if (series.status === "in_progress") return `${noun} already started/locked`
  if (series.startsAt && new Date(series.startsAt).getTime() <= Date.now()) return `${noun} already started/locked`
  return null
}
