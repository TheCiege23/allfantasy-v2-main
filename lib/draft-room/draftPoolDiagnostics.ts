/**
 * Dev-only diagnostics for draft pool completeness (no PII, no secrets).
 */

import type { DraftPoolPositionCounts } from '@/lib/draft-room/draftPoolPositionGroups'

export function logDraftPoolPositionDiagnosticsIfNeeded(input: {
  sport: string
  leagueId?: string | null
  draftId?: string | null
  totalPlayers: number
  counts: DraftPoolPositionCounts
  samplePositions: string[]
}): void {
  if (process.env.NODE_ENV === 'production') return
  const s = input.sport?.toUpperCase?.() ?? ''
  if (s !== 'NFL' && s !== 'NCAAF') return
  if (input.totalPlayers < 1) return

  const { counts } = input
  const majorZero =
    counts.QB === 0 ||
    counts.RB === 0 ||
    counts.WR === 0 ||
    counts.TE === 0 ||
    counts.K === 0 ||
    counts.DST === 0

  if (!majorZero) return

  console.info('[draft-pool:position-diagnostic]', {
    sport: input.sport,
    leagueId: input.leagueId ?? undefined,
    draftId: input.draftId ?? undefined,
    totalPlayers: input.totalPlayers,
    counts: {
      QB: counts.QB,
      RB: counts.RB,
      WR: counts.WR,
      TE: counts.TE,
      K: counts.K,
      DST: counts.DST,
      FLEX: counts.FLEX,
      IDP: counts.IDP,
    },
    samplePositions: input.samplePositions.slice(0, 12),
  })
}

export function logDraftPoolAdpDiagnosticsIfNeeded(input: {
  sport: string
  leagueId?: string | null
  withSystemAdp: number
  withAiAdp: number
  withNeither: number
}): void {
  if (process.env.NODE_ENV === 'production') return
  if (input.withSystemAdp + input.withAiAdp + input.withNeither < 1) return

  console.info('[draft-pool:adp-diagnostic]', {
    sport: input.sport,
    leagueId: input.leagueId ?? undefined,
    withSystemAdp: input.withSystemAdp,
    withAiAdp: input.withAiAdp,
    withNeither: input.withNeither,
  })
}
