/**
 * Apply structured AI recommendation onto CreateLeagueV2State without bypassing canonical rules.
 * Order: optional template hydration → validated extracted fields → sanitize + scoring finalize.
 */

import type { LeagueAiRecommendation } from '@/lib/create-league-v2/ai/types'
import { normalizeLeagueAiRecommendation } from '@/lib/create-league-v2/ai/normalize-recommendation'
import {
  finalizeScoringForCurrentType,
  sanitizeReconciledCreateLeagueState,
} from '@/lib/create-league-v2/create-league-initial-hydration'
import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { getEffectiveLeagueType, isDynastyConcept } from '@/lib/create-league-v2/state'
import { getDefaultTeamCount, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { applyLeagueCreationTemplate, type ApplyLeagueCreationTemplateOptions } from '@/lib/create-league-v2/templates/hydrate'

function mergeExtractedSettings(state: CreateLeagueV2State, rec: LeagueAiRecommendation): CreateLeagueV2State {
  const es = rec.extractedSettings
  let next: CreateLeagueV2State = { ...state }

  if (es.sport) {
    next = { ...next, sport: es.sport }
  }

  const lt = getEffectiveLeagueType(next)
  if (es.teamCount != null && lt) {
    const allowed = getTeamCountOptions(next.sport, lt, next.soccerPipeline, next.draftType, next.idpSelected)
    if (allowed.includes(es.teamCount)) {
      next = {
        ...next,
        teamCount: es.teamCount,
        ...(lt === 'tournament' ? { tournamentPoolSize: es.teamCount } : {}),
      }
    }
  } else if (es.teamCount != null && !lt) {
    /* team count without league type — ignore until user has concept */
  }

  if (es.standardDiscoveryVisibility && lt && !isDynastyConcept(lt) && lt !== 'best_ball') {
    next = { ...next, standardDiscoveryVisibility: es.standardDiscoveryVisibility }
  }

  if (es.dynastyVisibility && lt && isDynastyConcept(lt)) {
    next = {
      ...next,
      dynasty: { ...next.dynasty, visibility: es.dynastyVisibility },
    }
  }

  if (es.bestBallVisibility && lt === 'best_ball') {
    next = {
      ...next,
      bestBall: { ...next.bestBall, visibility: es.bestBallVisibility },
    }
  }

  return next
}

/**
 * Applies a normalized AI recommendation. Does not auto-submit.
 * When `nameTouched` is true, template apply still respects existing name rules inside `applyLeagueCreationTemplate`.
 */
export function applyLeagueAiRecommendationToState(
  state: CreateLeagueV2State,
  recommendation: LeagueAiRecommendation,
  options?: ApplyLeagueCreationTemplateOptions,
): CreateLeagueV2State {
  const rec = normalizeLeagueAiRecommendation(recommendation)

  let next: CreateLeagueV2State = { ...state }

  if (rec.recommendedTemplateId) {
    next = applyLeagueCreationTemplate(rec.recommendedTemplateId, next, options)
  }

  next = mergeExtractedSettings(next, rec)

  const lt = getEffectiveLeagueType(next)
  if (lt && rec.extractedSettings.teamCount != null) {
    const allowed = getTeamCountOptions(next.sport, lt, next.soccerPipeline, next.draftType, next.idpSelected)
    if (!allowed.includes(next.teamCount)) {
      const fallback = getDefaultTeamCount(next.sport, lt, next.soccerPipeline, next.draftType, next.idpSelected)
      next = {
        ...next,
        teamCount: fallback,
        ...(lt === 'tournament' ? { tournamentPoolSize: fallback } : {}),
      }
    }
  }

  return finalizeScoringForCurrentType(sanitizeReconciledCreateLeagueState(next))
}
