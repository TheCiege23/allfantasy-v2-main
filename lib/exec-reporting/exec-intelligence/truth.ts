/**
 * Fantasy OS Phase 4 — truth-label + source-window helpers (Part 9).
 *
 * Four mutually-exclusive truth states. They are the ONLY allowed labels and must be visibly rendered
 * next to the data they describe — never blended, never hidden in developer docs.
 */
export type TruthLabel =
  | 'Live League Data' // direct persisted records from the certified portfolio
  | 'Derived League Intelligence' // deterministic metrics calculated from those records
  | 'Presentation Preview' // demonstration-only / layout-only content
  | 'Insufficient Evidence' // unavailable or unsupported intelligence

/** The certified source is a NON-PRODUCTION portfolio — never described as a live/production feed. */
export const EXEC_SOURCE_PROVIDER = 'Certified league portfolio (non-production)'

/** Disclosed sampling limitation — surfaced to the customer, not buried in docs. */
export const EXEC_OFFSEASON_LIMITATION =
  'Regular-season weeks 1–18 were sampled. Offseason week-0 dynasty transactions are not included.'

export type SourceEnvelope = {
  generatedAt: string
  source: { provider: string; manifestHash: string; runId: string; seasons: number[] }
  truthLabel: TruthLabel
  freshness: { importedAt: string; sourceWindowStart: string; sourceWindowEnd: string }
}

/** Build the shared source/freshness envelope from certified run metadata. */
export function buildEnvelope(input: {
  manifestHash: string
  runId: string
  seasons: string[]
  importedAt: string
  truthLabel: TruthLabel
  generatedAt?: string
}): SourceEnvelope {
  const seasonNums = input.seasons
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
  const start = seasonNums.length ? String(seasonNums[0]) : 'unknown'
  const end = seasonNums.length ? String(seasonNums[seasonNums.length - 1]) : 'unknown'
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: { provider: EXEC_SOURCE_PROVIDER, manifestHash: input.manifestHash, runId: input.runId, seasons: seasonNums },
    truthLabel: input.truthLabel,
    freshness: { importedAt: input.importedAt, sourceWindowStart: start, sourceWindowEnd: end },
  }
}

/** Human-readable source window, e.g. "2019–2025". */
export function sourceWindowLabel(env: SourceEnvelope): string {
  return `${env.freshness.sourceWindowStart}–${env.freshness.sourceWindowEnd}`
}
