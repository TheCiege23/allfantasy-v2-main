import type { NormalizedPlayerSportsProfile } from '@/lib/sports-data-normalization/types'

type PlayerIdentityAnnotation = {
  confidence: 'full' | 'degraded' | 'ambiguous'
  notes: string[]
}

/**
 * Surfaces mapping/identity risk for projections and AI — does not invent IDs.
 */
export function annotatePlayerIdentityFromProfile(
  prof: NormalizedPlayerSportsProfile | undefined | null,
): PlayerIdentityAnnotation {
  if (!prof) {
    return { confidence: 'ambiguous', notes: ['No normalized player profile available.'] }
  }
  const notes: string[] = []
  let confidence: PlayerIdentityAnnotation['confidence'] = 'full'

  if (!prof.player.id?.trim()) {
    confidence = 'degraded'
    notes.push('Missing stable player id in normalized profile — match on name/team only.')
  }
  if (prof.dataGaps?.length) {
    confidence = confidence === 'full' ? 'degraded' : confidence
    notes.push(...prof.dataGaps.slice(0, 4))
  }
  if (prof.injuryNewsLayer?.conflict) {
    confidence = 'ambiguous'
    notes.push(prof.injuryNewsLayer.conflictDetail ?? 'Conflicting injury/news sources — verify before acting.')
  }

  return { confidence, notes }
}
