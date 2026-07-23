/**
 * Legacy Honesty Task 2 — provenance vocabulary for Intelligence-generated values.
 *
 * observed    = directly backed by provider data (e.g. a real FantasyCalc market value)
 * derived     = calculated from observed inputs (e.g. pick-value curve, win%-based rating)
 * fallback    = approximation used because data is missing (e.g. the ~200 unknown-player value)
 * unavailable = cannot honestly be determined
 *
 * Unknown must never appear as observed. These helpers make the classification explicit and
 * attach an `IntelligenceEvidence` block (the existing Task 1 type — no new evidence system).
 */

import type { IntelligenceEvidence, LegacyDataConfidence } from '@/lib/legacy/dataStatus'

export type ValueProvenance = 'observed' | 'derived' | 'fallback' | 'unavailable'

export interface TradePlayerValuation {
  name: string
  side: 'A' | 'B'
  value: number
  provenance: ValueProvenance
}

export interface TradeValuationEvidence {
  players: TradePlayerValuation[]
  /** Pick values always come from the internal pick-value curve, never a provider quote. */
  picksProvenance: 'derived'
  /** Players whose value is market-backed (observed, or derived from an observed value). */
  marketBackedCount: number
  fallbackCount: number
  /** Percent of involved players with a real market value; null when no players are involved. */
  coveragePercent: number | null
  evidence: IntelligenceEvidence
}

/**
 * Classifies every player valuation that entered `calculateTradeBalance`. Players the
 * FantasyCalc lookup missed carry the flat unknown-player value (~200) — that is a FALLBACK
 * approximation and must be disclosed as such, with confidence lowered accordingly.
 */
export function buildTradeValuationEvidence(input: {
  sideAPlayers: Array<{ name: string; value: number; found: boolean }>
  sideBPlayers: Array<{ name: string; value: number; found: boolean }>
  unknownPlayers?: string[]
  /** When the route applied scarcity (or other) adjustments on top of market values, a found
   * player's number is no longer the raw observation — classify as 'derived'. */
  foundValuesAdjusted?: boolean
}): TradeValuationEvidence {
  const foundProvenance: ValueProvenance = input.foundValuesAdjusted ? 'derived' : 'observed'
  // Defensive dedupe: asset lists are client-supplied, and a repeated name must not count
  // twice toward coverage (which would overstate confidence for a malformed payload).
  const seen = new Set<string>()
  const players: TradePlayerValuation[] = [
    ...input.sideAPlayers.map((p) => ({
      name: p.name,
      side: 'A' as const,
      value: p.value,
      provenance: (p.found ? foundProvenance : 'fallback') as ValueProvenance,
    })),
    ...input.sideBPlayers.map((p) => ({
      name: p.name,
      side: 'B' as const,
      value: p.value,
      provenance: (p.found ? foundProvenance : 'fallback') as ValueProvenance,
    })),
  ].filter((p) => {
    const key = `${p.side}:${p.name.trim().toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const marketBackedCount = players.filter((p) => p.provenance !== 'fallback').length
  const fallbackCount = players.length - marketBackedCount
  const coveragePercent = players.length > 0 ? Math.round((marketBackedCount / players.length) * 100) : null

  const fallbackShare = players.length > 0 ? fallbackCount / players.length : 0
  const confidence: LegacyDataConfidence =
    players.length === 0
      ? 'unknown'
      : fallbackCount === 0
        ? 'high'
        : fallbackShare <= 0.25
          ? 'medium'
          : 'low'

  const missingInputs = players
    .filter((p) => p.provenance === 'fallback')
    .map((p) => `market value for ${p.name}`)

  return {
    players,
    picksProvenance: 'derived',
    marketBackedCount,
    fallbackCount,
    coveragePercent,
    evidence: {
      confidence,
      dataCoveragePercent: coveragePercent,
      missingInputs,
      basedOn: ['FantasyCalc market values', 'internal pick-value curve'],
      disclaimer:
        fallbackCount > 0
          ? `${fallbackCount} player(s) have no market value and were approximated at a flat depth value — the balance math treats them as low-value depth, which may be wrong for rookies or IDPs.`
          : undefined,
    },
  }
}

// ── Derived-field tracking for normalized AI responses ───────────────────────

export interface DerivedFieldTracker {
  /** Bounded numeric field: model value wins; an absent/invalid model value takes the
   * synthesized fallback AND records the field as derived. */
  bounded(field: string, value: unknown, min: number, max: number, fallback: number): number
  /** Text field: non-empty model string wins; otherwise the fallback is used and recorded. */
  text(field: string, value: unknown, fallback: string): string
  fields(): string[]
}

export function createDerivedFieldTracker(): DerivedFieldTracker {
  const derived = new Set<string>()
  return {
    bounded(field, value, min, max, fallback) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        derived.add(field)
        return Math.max(min, Math.min(max, fallback))
      }
      return Math.max(min, Math.min(max, value))
    },
    text(field, value, fallback) {
      if (typeof value === 'string' && value.trim()) return value
      derived.add(field)
      return fallback
    },
    fields() {
      return Array.from(derived)
    },
  }
}

/**
 * IntelligenceEvidence for a Legacy AI run, built from the run's existing audit object plus
 * which normalized fields were synthesized rather than returned by the model. Synthesized core
 * scores (rating / power index / its breakdown) cap confidence at 'low' when the underlying
 * data was already partial, 'medium' otherwise — a formula over thin inputs must not read as a
 * confident observation.
 */
export function buildRunEvidence(input: {
  audit: { partialData: boolean; sourcesUsed: string[]; missingSources: string[] }
  derivedFields: string[]
}): IntelligenceEvidence {
  const coreDerived = input.derivedFields.some((f) =>
    /^(rating|offseason_power_index|power_index_breakdown)/.test(f),
  )

  const confidence: LegacyDataConfidence = coreDerived
    ? input.audit.partialData
      ? 'low'
      : 'medium'
    : input.audit.partialData
      ? 'medium'
      : 'high'

  return {
    confidence,
    dataCoveragePercent: null,
    missingInputs: [
      ...input.audit.missingSources,
      ...input.derivedFields.map((f) => `model output for ${f}`),
    ],
    basedOn: input.audit.sourcesUsed,
    disclaimer: coreDerived
      ? 'Some headline scores were derived from win-rate formulas rather than returned by the analysis model.'
      : input.audit.partialData
        ? 'This report was generated from partial data; some sources were unavailable.'
        : undefined,
  }
}
