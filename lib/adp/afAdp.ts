/**
 * AF ADP — AllFantasy's own ADP, blended from three kinds of evidence:
 *
 *   market    what the platforms publish (`AdpDataRecord`, the pool's market `adp`)
 *   imported  completed drafts from real leagues users imported (`DraftFact` → `imported` boards)
 *   af        completed drafts run in AllFantasy (`DraftPick` → exact / cross-size boards)
 *
 * Pure: the draft pool supplies the three inputs, this does the arithmetic. The weighting is
 * `blendOne` from blendPolicy.ts — `imported` and `af` are scaled by how many drafts stand behind
 * them, so a player seen in two of our drafts barely moves the market number and one seen in four
 * hundred mostly replaces it. Nobody re-tunes a constant as the season fills up.
 *
 * ⚠ THE MOCK/AI BOARD IS NOT AN INPUT. `ai` (AiAdpSnapshot) mixes in mock-draft results, and mock
 * ADP is pulled toward the site's own default rankings by CPU drafters and early quitters. The
 * three inputs here are real drafts or the published market only.
 */

import type { AdpCorpusSplit } from '@/lib/adp/loadAdpBoard'
import { blendOne, normalizeBlendWeights, type BlendWeights } from '@/lib/adp/blendPolicy'

/** Shares before shrinkage. `ai` is zero by design — see the header. */
export const AF_ADP_WEIGHTS: BlendWeights = normalizeBlendWeights({
  api: 40,
  app: 35,
  imported: 30,
  ai: 0,
  custom: 0,
})

export interface AfAdpResult {
  afAdp: number
  /** Share each input actually contributed after shrinkage and presence; sums to 1. */
  contributions: { market: number; imported: number; af: number }
  importedSampleSize: number | null
  afSampleSize: number | null
}

export function computeAfAdp(input: {
  marketAdp: number | null | undefined
  split: AdpCorpusSplit | null | undefined
}): AfAdpResult | null {
  const market =
    input.marketAdp != null && Number.isFinite(input.marketAdp) && input.marketAdp > 0
      ? { adp: input.marketAdp }
      : null
  const own = input.split?.own ?? null
  const imported = input.split?.imported ?? null

  const result = blendOne(
    {
      api: market,
      app: own ? { adp: own.adp, sampleSize: own.sampleSize } : null,
      imported: imported ? { adp: imported.adp, sampleSize: imported.sampleSize } : null,
    },
    AF_ADP_WEIGHTS,
  )
  if (!result) return null

  return {
    afAdp: result.adp,
    contributions: {
      market: result.contributions.api,
      imported: result.contributions.imported,
      af: result.contributions.app,
    },
    importedSampleSize: imported?.sampleSize ?? null,
    afSampleSize: own?.sampleSize ?? null,
  }
}
