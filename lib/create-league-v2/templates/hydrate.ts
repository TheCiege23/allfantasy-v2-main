/**
 * Template Mode — hydrate `CreateLeagueV2State` from a structured template id.
 * Delegates gameplay defaults to `getQuickTemplatePatch` (canonical pipeline parity).
 */

import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { finalizeScoringForCurrentType } from '@/lib/create-league-v2/create-league-initial-hydration'
import { getQuickTemplatePatch } from '@/lib/create-league-v2/quick-defaults'
import { buildSuggestedLeagueName } from '@/lib/create-league-v2/suggested-league-name'
import type { LeagueCreationTemplateId } from '@/lib/create-league-v2/templates/types'

export interface ApplyLeagueCreationTemplateOptions {
  commissionerFirstName?: string
}

/**
 * Applies template defaults, preserves sport/timezone/language/name-touched semantics,
 * assigns `selectedTemplateId`, and re-finalizes scoring for the effective league type.
 */
export function applyLeagueCreationTemplate(
  templateId: LeagueCreationTemplateId,
  state: CreateLeagueV2State,
  options?: ApplyLeagueCreationTemplateOptions,
): CreateLeagueV2State {
  const patch = getQuickTemplatePatch(templateId, state)
  const nextLt = patch.leagueType ?? state.leagueType
  const suggested =
    nextLt && !state.nameTouched
      ? buildSuggestedLeagueName({
          leagueType: nextLt,
          sport: patch.sport ?? state.sport,
          teamCount: patch.teamCount ?? state.teamCount,
          idpSelected: patch.idpSelected ?? state.idpSelected,
          commissionerFirstName: options?.commissionerFirstName,
        })
      : undefined

  const merged: CreateLeagueV2State = {
    ...state,
    ...patch,
    selectedTemplateId: templateId,
    ...(suggested ? { name: suggested } : {}),
  }

  return finalizeScoringForCurrentType(merged)
}
