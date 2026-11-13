/**
 * SportDashboardResolver — sport-aware labels, emoji, and display order for dashboard sections.
 * Supports NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, Soccer.
 */
import { getDashboardSportOrder as getOrder } from "@/lib/multi-sport/SportSelectorUIService"
import type { SportType } from "@/lib/multi-sport/sport-types"

export interface SportSectionInfo {
  sport: SportType
  label: string
  emoji: string
}

/** Display order for dashboard sport sections (aligned with sport-scope). */
export function getDashboardSportOrder(): SportType[] {
  return getOrder()
}

