/**
 * Clamp AI recommendations to supported templates and enum values only.
 */

import type { LeagueAiRecommendation } from '@/lib/create-league-v2/ai/types'
import { isLeagueCreationTemplateId } from '@/lib/create-league-v2/templates/catalog'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { SupportedSport } from '@/lib/create-league-v2/state'

const VIS = new Set(['private', 'public', 'invite_only'])

/** Returns a safe copy; never throws. */
export function normalizeLeagueAiRecommendation(input: LeagueAiRecommendation): LeagueAiRecommendation {
  const warnings = [...input.warnings]
  const unsupported = [...input.unsupportedRequests]

  let templateId = input.recommendedTemplateId
  if (templateId != null && !isLeagueCreationTemplateId(String(templateId))) {
    warnings.push(`Ignored unknown template id from AI output: ${String(templateId)}`)
    templateId = null
  }

  const es = { ...input.extractedSettings }
  if (es.sport != null) {
    const n = normalizeToSupportedSport(String(es.sport)) as SupportedSport
    if (n !== es.sport) {
      warnings.push(`Sport normalized from ${String(es.sport)} to ${n}.`)
    }
    es.sport = n
  }

  if (es.standardDiscoveryVisibility != null && !VIS.has(es.standardDiscoveryVisibility)) {
    warnings.push(`Ignored invalid standardDiscoveryVisibility: ${String(es.standardDiscoveryVisibility)}`)
    delete es.standardDiscoveryVisibility
  }

  if (es.dynastyVisibility != null && es.dynastyVisibility !== 'public' && es.dynastyVisibility !== 'private') {
    warnings.push('Ignored invalid dynastyVisibility.')
    delete es.dynastyVisibility
  }
  if (es.bestBallVisibility != null && es.bestBallVisibility !== 'public' && es.bestBallVisibility !== 'private') {
    warnings.push('Ignored invalid bestBallVisibility.')
    delete es.bestBallVisibility
  }

  if (es.teamCount != null && (!Number.isFinite(es.teamCount) || es.teamCount < 2 || es.teamCount > 64)) {
    warnings.push(`Ignored invalid teamCount: ${String(es.teamCount)}`)
    delete es.teamCount
  }

  return {
    recommendedTemplateId: templateId,
    confidence: Math.min(1, Math.max(0, input.confidence)),
    explanation: input.explanation.trim() || 'No explanation provided.',
    extractedSettings: es,
    warnings,
    unsupportedRequests: unsupported,
  }
}
