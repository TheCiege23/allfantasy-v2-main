import { getLeagueTypeMedia, resolveLeagueConceptIntroKey } from '@/lib/league-media/leagueTypeMedia'
import { findScoringPresetRule } from '@/lib/league-creation-preset/scoring-presets'
import type { LeagueSettingsModalLeague } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'

/** The format label ("Guillotine") and scoring preset name the settings list and rules page show. */
export function leagueSettingsLabels(league: LeagueSettingsModalLeague): { formatLabel: string; scoringLabel: string | null } {
  const conceptKey = resolveLeagueConceptIntroKey({
    leagueType: league.leagueType,
    leagueVariant: league.leagueVariant,
    settings: league.settings,
    isDynasty: league.isDynasty,
    guillotineMode: league.guillotineMode,
    bestBallMode: league.bestBallMode,
  })
  return {
    formatLabel: getLeagueTypeMedia(conceptKey).label,
    scoringLabel: (league.scoringPresetId ? findScoringPresetRule(league.scoringPresetId)?.label : null) ?? null,
  }
}
