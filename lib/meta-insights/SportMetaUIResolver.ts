/**
 * SportMetaUIResolver – sport list and normalization for Meta Insights UI.
 * UI filters and AI summaries always respect the selected sport context.
 */
import {
  SUPPORTED_SPORTS,
  DEFAULT_SPORT,
  normalizeToSupportedSport,
} from '@/lib/sport-scope'

const META_UI_SPORTS = [...SUPPORTED_SPORTS] as const

type MetaUISport = (typeof META_UI_SPORTS)[number]

export function resolveSportForMetaUI(sport: string | null | undefined): MetaUISport {
  return normalizeToSupportedSport(sport ?? DEFAULT_SPORT)
}

