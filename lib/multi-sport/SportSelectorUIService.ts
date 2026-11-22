/**
 * SportSelectorUIService — UI-facing sport labels, emojis, and selector options.
 * Use in LeagueCreationSportSelector, DashboardSportGroups, and any sport-aware UI.
 */
import {
  type SportType,
  SPORT_TYPES,
  SPORT_DISPLAY_NAMES,
  SPORT_EMOJI,
  toSportType,
} from './sport-types'

/** Dashboard display order requested for homepage grouping. */
const DASHBOARD_SPORT_ORDER: SportType[] = [
  'NFL',
  'NHL',
  'MLB',
  'NBA',
  'NCAAF',
  'NCAAB',
  'SOCCER',
]

export function getSportLabel(sport: string): string {
  const t = toSportType(sport)
  return SPORT_DISPLAY_NAMES[t] ?? sport
}

export function getSportEmoji(sport: string): string {
  const t = toSportType(sport)
  return SPORT_EMOJI[t] ?? '🏆'
}

export function getSportsForSelector(): Array<{ value: SportType; label: string; emoji: string }> {
  return SPORT_TYPES.map((s) => ({
    value: s,
    label: SPORT_DISPLAY_NAMES[s],
    emoji: SPORT_EMOJI[s],
  }))
}

export function getDashboardSportOrder(): SportType[] {
  return DASHBOARD_SPORT_ORDER
}
