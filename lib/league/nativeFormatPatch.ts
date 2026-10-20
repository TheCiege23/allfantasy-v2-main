import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'

/** A native format change must replace the old runtime flags as well as its display label. */
export function nativeFormatPatch(type: string, settings: unknown) {
  const format = normalizeConceptToFormat(type)?.formatId ?? type
  const prev = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings as Record<string, unknown> : {}
  const concept = prev.conceptRules && typeof prev.conceptRules === 'object' ? prev.conceptRules as Record<string, unknown> : {}
  const flags = { isDynasty: ['dynasty', 'devy', 'c2c'].includes(format), guillotineMode: format === 'guillotine', survivorMode: format === 'survivor', bestBallMode: format === 'best_ball' }
  return {
    ...flags,
    leagueVariant: format,
    settings: { ...prev, league_type: format, leagueType: format, ...flags,
      guillotine_mode: flags.guillotineMode, best_ball_mode: flags.bestBallMode,
      conceptRules: { ...concept, concept: format },
    },
  }
}
