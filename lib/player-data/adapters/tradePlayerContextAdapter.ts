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
  teamLogoUrl: string | null
  injuryStatus: string | null
  adp: number | null
  aiAdp: number | null
  projectedPoints: number | null
  fantasyPointsPerGame: number | null
  profileSource: string | null
  statsSource: string | null
  projectionsSource: string | null
  /** Attribution for injury/status row when present */
  injurySource: string | null
  /** Separate from AI ADP — pool ADP semantics */
  adpSource: string | null
  aiAdpSource: string | null
  experienceSource: string | null
  lowConfidence: boolean
  dataFallbacks: string[]
  staleDataWarnings: string[]
  canonicalLastUpdatedAt: string | null
  missingDataNote?: string
}

export function tradeEvidenceFromUnifiedWire(row: UnifiedPlayerWireDto): TradePlayerEvidenceSlice {
  const canonical = row.nflRedraft ?? null
  const missing: string[] = []
  if (!canonical?.media.headshot.url && !row.headshotUrl) missing.push('image')
  if ((canonical?.injury.designation ?? row.injuryStatus) == null || String(canonical?.injury.designation ?? row.injuryStatus).trim() === '') missing.push('injury')
  if (!row.normalizedStats || Object.keys(row.normalizedStats).length <= 2) missing.push('stats')
  for (const field of canonical?.dataFreshness.missingFields ?? []) {
    if (!missing.includes(field)) missing.push(field)
  }
  const u = row.product?.unified as
    | {
        profileSource?: string | null
        adpSource?: string | null
        aiAdpSource?: string | null
        yearsExpSource?: string | null
        rookieSource?: string | null
      }
    | undefined
  const injuryPresent = (canonical?.injury.designation ?? row.injuryStatus) != null && String(canonical?.injury.designation ?? row.injuryStatus).trim() !== ''
  return {
    playerId: row.id,
    name: row.name,
    position: row.position,
    team: row.team,
    sport: row.sport,
    headshotUrl: canonical?.media.headshot.url ?? row.headshotUrl,
    teamLogoUrl: canonical?.media.teamLogo.url ?? row.teamLogoUrl,
    injuryStatus: canonical?.injury.designation ?? row.injuryStatus,
    adp: row.adp,
    aiAdp: row.aiAdp,
    projectedPoints: canonical?.currentProjection.weeklyProjectedPoints ?? row.projectedPoints,
    fantasyPointsPerGame: row.fantasyPointsPerGame,
    profileSource: row.profileSource,
    statsSource: row.statsSource,
    projectionsSource: row.projectionsSource,
    injurySource: injuryPresent ? canonical?.injury.source ?? u?.profileSource ?? row.profileSource ?? null : null,
    adpSource: row.adp != null ? u?.adpSource ?? null : null,
    aiAdpSource: row.aiAdp != null ? u?.aiAdpSource ?? null : null,
    experienceSource: u?.yearsExpSource ?? u?.rookieSource ?? u?.profileSource ?? row.profileSource ?? null,
    lowConfidence: row.lowConfidence === true || Boolean(canonical?.fallbacks.length),
    dataFallbacks: canonical?.fallbacks.map((fallback) => fallback.field) ?? [],
    staleDataWarnings: canonical?.dataFreshness.staleWarnings ?? [],
    canonicalLastUpdatedAt: canonical?.lastUpdatedAt ?? null,
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
      e.injurySource ? `injurySrc=${e.injurySource}` : null,
      e.adp != null ? `adp=${e.adp}` : null,
      e.adpSource ? `adpSrc=${e.adpSource}` : null,
      e.aiAdp != null ? `aiAdp=${e.aiAdp}` : null,
      e.aiAdpSource ? `aiAdpSrc=${e.aiAdpSource}` : null,
      e.statsSource ? `statsSrc=${e.statsSource}` : null,
      e.experienceSource ? `expSrc=${e.experienceSource}` : null,
      e.lowConfidence ? 'lowConfidence' : null,
      e.staleDataWarnings.length ? `stale=${e.staleDataWarnings.length}` : null,
      e.missingDataNote ?? null,
    ].filter(Boolean)
    return bits.join(' · ')
  })
  return `${label}:\n${lines.join('\n')}`
}
