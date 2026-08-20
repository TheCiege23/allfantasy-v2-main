/**
 * Template Mode — human-readable summary rows (metadata + live sport).
 */

import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { getScoringPresetOptionsForSelection } from '@/lib/create-league-v2/rules-engine'
import { getEffectiveLeagueType } from '@/lib/create-league-v2/state'
import { getLeagueCreationTemplateMeta } from '@/lib/create-league-v2/templates/catalog'
import type { LeagueCreationTemplateId } from '@/lib/create-league-v2/templates/types'

export type TemplateSummaryRow = { label: string; value: string }

/** Rows for the Template Mode aside before a template is chosen. */
export function buildTemplateModeIntroSummary(): TemplateSummaryRow[] {
  return [
    {
      label: 'How this works',
      value: 'Pick a template to load onboarding defaults. Everything still posts through the same create league pipeline.',
    },
  ]
}

/**
 * After selection: merge static template copy with live sport + resolved scoring label when possible.
 */
export function buildTemplateModeSummaryRows(state: CreateLeagueV2State): TemplateSummaryRow[] {
  const id = state.selectedTemplateId
  if (!id) return buildTemplateModeIntroSummary()

  const meta = getLeagueCreationTemplateMeta(id as LeagueCreationTemplateId)
  const lt = getEffectiveLeagueType(state)
  let scoringLine = meta.scoringStyle
  if (lt && state.scoringPresetId?.trim()) {
    const opts = getScoringPresetOptionsForSelection({
      leagueType: lt,
      sport: state.sport,
      idpSelected: state.idpSelected,
    })
    const m = opts.find((o) => o.id === state.scoringPresetId)
    if (m?.label?.trim()) scoringLine = `${m.label} (${state.sport})`
    else scoringLine = `${meta.scoringStyle} · ${state.sport}`
  } else {
    scoringLine = `${meta.scoringStyle} · ${state.sport}`
  }

  return [
    { label: 'Template', value: meta.title },
    { label: 'Sport', value: state.sport === 'SOCCER' ? 'Soccer' : state.sport },
    { label: 'Gameplay', value: meta.gameplayStyle },
    { label: 'Roster', value: meta.rosterStyle },
    { label: 'Waivers', value: meta.waiverStyle },
    { label: 'Draft', value: meta.draftStyle },
    { label: 'Scoring', value: scoringLine },
    { label: 'Best for', value: meta.recommendedPlayerType },
    { label: 'Complexity', value: meta.complexity },
    { label: 'Visibility tip', value: meta.visibilityRecommendation },
    { label: 'Commissioner tip', value: meta.commissionerGuidance },
  ]
}
