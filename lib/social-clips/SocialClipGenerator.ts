/**
 * Generates clip payloads for social graphics (Prompt 116).
 * Template-based; can later be wired to league/score data.
 */

import type { ClipPayload, ClipType } from './types'

const DEFAULT_TITLES: Record<ClipType, string> = {
  weekly_league_winners: 'Weekly League Winners',
  biggest_upset: 'Biggest Upset',
  top_scoring_team: 'Top Scoring Team',
}

const DEFAULT_SUBTITLES: Record<ClipType, string> = {
  weekly_league_winners: 'Champions of the week',
  biggest_upset: 'The underdog prevails',
  top_scoring_team: 'Highest score this week',
}

interface GenerateOptions {
  title?: string
  subtitle?: string
  stats?: string[]
  leagueName?: string
  week?: number
  [key: string]: unknown
}

export function getClipPayload(
  clipType: ClipType,
  options: GenerateOptions = {}
): ClipPayload {
  const title = options.title ?? DEFAULT_TITLES[clipType]
  const subtitle = options.subtitle ?? DEFAULT_SUBTITLES[clipType]
  const stats = options.stats ?? getDefaultStats(clipType, options)
  return {
    title,
    subtitle: subtitle || null,
    stats,
    meta: {
      leagueName: options.leagueName,
      week: options.week,
      ...options,
    },
  }
}

function getDefaultStats(clipType: ClipType, options: GenerateOptions): string[] {
  const league = (options.leagueName as string) || 'League'
  const week = (options.week as number) ?? 1
  switch (clipType) {
    case 'weekly_league_winners':
      return [`${league} · Week ${week}`, 'Crowned this week']
    case 'biggest_upset':
      return [`${league} · Week ${week}`, 'Underdog victory']
    case 'top_scoring_team':
      return [`${league} · Week ${week}`, 'Highest points']
    default:
      return [league]
  }
}
