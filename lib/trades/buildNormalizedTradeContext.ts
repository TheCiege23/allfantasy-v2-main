/**
 * Batch normalized player product rows for trade AI context (evidence only).
 */

import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi, type UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import {
  tradeEvidenceFromUnifiedWire,
  type TradePlayerEvidenceSlice,
} from '@/lib/player-data/adapters/tradePlayerContextAdapter'
import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { UnresolvedTradePlayerAsset } from '@/lib/trades/tradePlayerIdentityResolver'

export type NormalizedTradeContextSummary = {
  totalAssets: number
  resolvedPlayers: number
  unresolvedPlayers: number
  fallbackSources: string[]
  missingDomains: string[]
}

export type NormalizedTradePlayerEvidence = TradePlayerEvidenceSlice & {
  yearsExp: number | null
  isRookie: boolean | undefined
  collegeClass: string | null
  soccerLeague: string | null
  normalizedStats: Record<string, unknown>
  normalizedProjections: Record<string, unknown>
  providerFallbackNote?: string
}

export type BuildNormalizedTradeContextResult = {
  players: NormalizedTradePlayerEvidence[]
  wireRows: UnifiedPlayerWireDto[]
  unresolvedPlayers: UnresolvedTradePlayerAsset[]
  summary: NormalizedTradeContextSummary
}

function collectMissingDomains(wires: UnifiedPlayerWireDto[]): string[] {
  const s = new Set<string>()
  for (const w of wires) {
    if (w.providerFallbackDiagnostics?.missingDomains?.length) {
      for (const d of w.providerFallbackDiagnostics.missingDomains) s.add(String(d))
    }
    if (!w.injuryStatus) s.add('injury')
    if (!w.adp) s.add('adp')
    if (w.aiAdp == null) s.add('aiAdp')
    if (!Object.keys(w.normalizedStats || {}).length) s.add('stats')
  }
  return [...s]
}

function collectFallbackSources(wires: UnifiedPlayerWireDto[]): string[] {
  const out = new Set<string>()
  for (const w of wires) {
    if (w.profileSource) out.add(String(w.profileSource))
    if (w.statsSource) out.add(String(w.statsSource))
    if (w.projectionsSource) out.add(String(w.projectionsSource))
  }
  return [...out].filter(Boolean)
}

export async function buildNormalizedTradeContext(params: {
  internalLeagueId: string | null
  sport: string
  playerIds: string[]
  unresolved: UnresolvedTradePlayerAsset[]
  /** Trade-side player asset rows (players only); defaults to resolved+unresolved unique counts */
  totalAssetCount?: number
  includeProviderFallbackDiagnostics?: boolean
}): Promise<BuildNormalizedTradeContextResult> {
  const sport = normalizeToSupportedSport(String(params.sport || 'NFL')) as LeagueSport
  const ids = [...new Set(params.playerIds.filter(Boolean))]
  const totalAssets =
    params.totalAssetCount ?? ids.length + params.unresolved.length

  if (!params.internalLeagueId || ids.length === 0) {
    return {
      players: [],
      wireRows: [],
      unresolvedPlayers: params.unresolved,
      summary: {
        totalAssets,
        resolvedPlayers: 0,
        unresolvedPlayers: params.unresolved.length,
        fallbackSources: [],
        missingDomains: [],
      },
    }
  }

  const rows = await getNormalizedPlayerData({
    surface: 'trade',
    leagueId: params.internalLeagueId,
    sport,
    playerIds: ids,
    includeProviderFallbackDiagnostics: Boolean(params.includeProviderFallbackDiagnostics),
  })

  const wireRows = rows.map((r) => serializeUnifiedPlayerForApi(r))
  const players: NormalizedTradePlayerEvidence[] = wireRows.map((w) => {
    const base = tradeEvidenceFromUnifiedWire(w)
    return {
      ...base,
      yearsExp: w.product.yearsExp ?? null,
      isRookie: w.product.isRookie,
      collegeClass: typeof w.collegeClass === 'string' ? w.collegeClass : String(w.collegeClass ?? ''),
      soccerLeague: w.soccerLeague,
      injurySource: w.profileSource,
      adpSource: w.statsSource,
      aiAdpSource: w.statsSource,
      experienceSource: w.profileSource,
      normalizedStats: w.normalizedStats,
      normalizedProjections: w.normalizedProjections,
      lowConfidence: w.lowConfidence === true,
      providerFallbackNote: w.providerFallbackDiagnostics?.summary,
    }
  })

  return {
    players,
    wireRows,
    unresolvedPlayers: params.unresolved,
    summary: {
      totalAssets,
      resolvedPlayers: players.length,
      unresolvedPlayers: params.unresolved.length,
      fallbackSources: collectFallbackSources(wireRows),
      missingDomains: collectMissingDomains(wireRows),
    },
  }
}

export function buildNormalizedTradeEvidencePrompt(result: BuildNormalizedTradeContextResult): string {
  const lines: string[] = []
  if (result.players.length === 0) {
    if (result.unresolvedPlayers.length) {
      lines.push(
        'Some player data was unavailable from imported provider cache (unresolved asset identifiers).',
      )
    }
    return lines.join('\n')
  }
  lines.push('Provider evidence (not trade value authority):')
  for (const p of result.players) {
    const bits = [
      `${p.name} (${p.position ?? '—'}, ${p.team ?? 'FA'})`,
      p.injuryStatus ? `injury=${p.injuryStatus}` : null,
      p.injurySource ? `injurySrc=${p.injurySource}` : null,
      p.adp != null ? `adp=${p.adp}` : null,
      p.adpSource ? `adpSrc=${p.adpSource}` : null,
      p.aiAdp != null ? `aiAdp=${p.aiAdp}` : null,
      p.aiAdpSource ? `aiAdpSrc=${p.aiAdpSource}` : null,
      p.statsSource ? `statsSrc=${p.statsSource}` : null,
      p.projectionsSource ? `projSrc=${p.projectionsSource}` : null,
      p.experienceSource ? `expSrc=${p.experienceSource}` : null,
      p.yearsExp != null ? `yearsExp=${p.yearsExp}` : null,
      p.collegeClass ? `collegeClass=${p.collegeClass}` : null,
      p.soccerLeague ? `soccerLeague=${p.soccerLeague}` : null,
      p.lowConfidence ? 'lowConfidence' : null,
      p.missingDataNote ?? null,
    ].filter(Boolean)
    lines.push(bits.join(' · '))
  }
  if (result.unresolvedPlayers.length) {
    lines.push(
      'Note: Some player data was unavailable from imported provider cache for unresolved trade assets.',
    )
  }
  return lines.join('\n')
}
