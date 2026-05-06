/**
 * Trade evaluator — provider evidence only; internal trade value stays caller-owned.
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

export type TradePlayerEvidenceSlice = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  sport: string
  headshotUrl: string | null
  injuryStatus: string | null
  adp: number | null
  aiAdp: number | null
  projectedPoints: number | null
  fantasyPointsPerGame: number | null
  profileSource: string | null
  statsSource: string | null
  projectionsSource: string | null
  lowConfidence: boolean
  missingDataNote?: string
}

export function tradeEvidenceFromUnifiedWire(row: UnifiedPlayerWireDto): TradePlayerEvidenceSlice {
  const missing: string[] = []
  if (!row.headshotUrl) missing.push('image')
  if (row.injuryStatus == null || String(row.injuryStatus).trim() === '') missing.push('injury')
  if (!row.normalizedStats || Object.keys(row.normalizedStats).length <= 2) missing.push('stats')
  return {
    playerId: row.id,
    name: row.name,
    position: row.position,
    team: row.team,
    sport: row.sport,
    headshotUrl: row.headshotUrl,
    injuryStatus: row.injuryStatus,
    adp: row.adp,
    aiAdp: row.aiAdp,
    projectedPoints: row.projectedPoints,
    fantasyPointsPerGame: row.fantasyPointsPerGame,
    profileSource: row.profileSource,
    statsSource: row.statsSource,
    projectionsSource: row.projectionsSource,
    lowConfidence: row.lowConfidence === true,
    missingDataNote: missing.length ? `missing: ${missing.join(', ')}` : undefined,
  }
}

export function tradeEvidenceBlockForPrompt(rows: UnifiedPlayerWireDto[], label: string): string {
  if (!rows.length) return ''
  const lines = rows.map((r) => {
    const e = tradeEvidenceFromUnifiedWire(r)
    const bits = [
      `${e.name} (${e.position ?? '—'}, ${e.team ?? 'FA'})`,
      e.injuryStatus ? `injury=${e.injuryStatus}` : null,
      e.adp != null ? `adp=${e.adp}` : null,
      e.aiAdp != null ? `aiAdp=${e.aiAdp}` : null,
      e.statsSource ? `statsSrc=${e.statsSource}` : null,
      e.lowConfidence ? 'lowConfidence' : null,
      e.missingDataNote ?? null,
    ].filter(Boolean)
    return bits.join(' · ')
  })
  return `${label}:\n${lines.join('\n')}`
}
