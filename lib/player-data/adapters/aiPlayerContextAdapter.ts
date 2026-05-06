/**
 * AI prompts — compact deterministic bullets from unified rows (no LLM calls here).
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

export function buildAiUnifiedPlayerBullets(players: UnifiedPlayerWireDto[], max = 8): string {
  const lines = players.slice(0, max).map((p) => {
    const bits = [`${p.name} (${p.position ?? '—'}, ${p.team ?? 'FA'})`]
    if (p.injuryStatus) bits.push(`injury=${p.injuryStatus}`)
    if (p.adp != null) bits.push(`adp=${p.adp}`)
    if (p.aiAdp != null) bits.push(`aiAdp=${p.aiAdp}`)
    if (p.profileSource) bits.push(`profile=${p.profileSource}`)
    if (p.statsSource) bits.push(`stats=${p.statsSource}`)
    if (p.projectionsSource) bits.push(`proj=${p.projectionsSource}`)
    if (p.lowConfidence) bits.push('lowConfidence')
    if (p.collegeClassLabel || (p.collegeClass && p.collegeClass !== 'unknown')) {
      bits.push(`class=${p.collegeClassLabel ?? p.collegeClass}`)
    }
    if (p.soccerLeague) bits.push(`soccer=${p.soccerLeague}`)
    const diag = 'providerFallbackDiagnostics' in p ? p.providerFallbackDiagnostics : undefined
    if (diag?.missingDomains?.length) {
      bits.push(`missingDomains=${diag.missingDomains.join(',')}`)
    }
    return bits.join(' · ')
  })
  return lines.join('\n')
}
