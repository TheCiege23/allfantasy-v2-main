/**
 * How AllFantasy's own draft evidence is weighed against the market's.
 *
 * The product goal is a "true" ADP: take what the platforms publish as a base, then let our own
 * observed drafts correct it. The failure mode that goal invites is treating four of our drafts as
 * if they were four thousand.
 *
 * 🛑 THE BLEND USED FIXED PROPORTIONS — api 40 / app 35 / ai 25 — REGARDLESS OF EVIDENCE.
 * A player drafted in TWO of our drafts contributed the same 35% as a player drafted in two
 * thousand. Early in a season, when our corpus is a handful of drafts, that let a two-sample mean
 * move a consensus built from several platforms by a third of the way. The number looked
 * authoritative precisely when it deserved the least trust.
 *
 * The fix is shrinkage, not a bigger threshold. Our sources keep their configured weight scaled by
 *
 *     confidence(n) = n / (n + HALF_CONFIDENCE_SAMPLE)
 *
 * which is 0 at no samples, 0.5 at ten, 0.75 at thirty, 0.9 at ninety, and approaches 1. So a thin
 * corpus defers to the market automatically and a deep one takes over automatically, with nobody
 * re-tuning a constant as the season fills up. That behaviour is the point: the weights should not
 * need a human to be right in September and right again in December.
 *
 * ⚠ SHRINKAGE APPLIES ONLY TO SOURCES WHOSE SAMPLE IS A COUNT OF DRAFTS.
 * `api.sampleSize` is a count of PROVIDERS (one to six), not drafts. Running provider counts
 * through the same curve would score a perfectly ordinary two-provider consensus at 0.17 and hand
 * the board to whichever source happened to have more rows — mixing two scales that only look
 * alike because both are called "sample size". The market side keeps its configured weight, and
 * `custom` is a human's explicit ranking, which is not evidence to be discounted at all.
 *
 * ⚠ AND CONFIDENCE IS NOT PRESENCE. A source that is absent for a player contributes nothing and
 * its weight is renormalised away, which is correct. A source that is PRESENT but thin contributes
 * a little. Collapsing those two cases would make "we have never seen this player drafted" and
 * "we have seen this player drafted twice" produce the same number, and they mean different things.
 */

/**
 * Sample size at which one of our own sources carries half its configured weight.
 *
 * 10 is not a new constant: it is `LOW_SAMPLE_THRESHOLD` from
 * `lib/adp/readSnapshotForLeague.ts`, the count below which the UI already renders a "low sample"
 * pill. Reusing it means the number the interface calls thin is the same number the maths
 * discounts, rather than a second opinion that can drift from the first.
 */
export const HALF_CONFIDENCE_SAMPLE = 10

export interface BlendWeights {
  api: number
  app: number
  ai: number
  custom: number
}

export interface BlendSource {
  adp: number
  /** Drafts behind this value, for our own sources. Ignored for `api` and `custom`. */
  sampleSize?: number | null
}

export interface BlendInput {
  api?: BlendSource | null
  app?: BlendSource | null
  ai?: BlendSource | null
  custom?: (BlendSource & { locked?: boolean }) | null
}

export interface BlendResult {
  adp: number
  /**
   * The weight each source ACTUALLY contributed, after confidence scaling and presence
   * renormalisation. Sums to 1 when anything contributed. Exposed so a surface can explain a
   * number rather than assert it.
   */
  contributions: BlendWeights
  /**
   * Drafts behind our own contribution — the larger of the app and ai sample sizes.
   * Null when neither of ours contributed, which is different from zero.
   */
  ownSampleSize: number | null
  /** True when our own evidence is present but below `HALF_CONFIDENCE_SAMPLE`. */
  lowOwnSample: boolean
}

/**
 * Shrinkage factor for a count of drafts. Returns 0 for a missing or non-positive count, so an
 * absent source can never contribute.
 */
export function sampleConfidence(sampleSize: number | null | undefined): number {
  const n = typeof sampleSize === 'number' && Number.isFinite(sampleSize) ? sampleSize : 0
  if (n <= 0) return 0
  return n / (n + HALF_CONFIDENCE_SAMPLE)
}

/** Normalise raw weights (percentages or fractions) to fractions summing to 1. */
export function normalizeBlendWeights(weights?: Partial<BlendWeights>): BlendWeights {
  const base = {
    api: Number(weights?.api ?? 40),
    app: Number(weights?.app ?? 35),
    ai: Number(weights?.ai ?? 25),
    custom: Number(weights?.custom ?? 0),
  }
  for (const k of Object.keys(base) as (keyof BlendWeights)[]) {
    if (!Number.isFinite(base[k]) || base[k] < 0) base[k] = 0
  }
  const total = base.api + base.app + base.ai + base.custom
  if (total <= 0) return { api: 0.4, app: 0.35, ai: 0.25, custom: 0 }
  return {
    api: base.api / total,
    app: base.app / total,
    ai: base.ai / total,
    custom: base.custom / total,
  }
}

const EMPTY_CONTRIBUTIONS: BlendWeights = { api: 0, app: 0, ai: 0, custom: 0 }

/**
 * Blend one player's ADP across the four sources.
 *
 * A locked custom ranking short-circuits everything: a human pinned that player, and no amount of
 * market or corpus evidence overrides an explicit instruction.
 */
export function blendOne(input: BlendInput, weights: BlendWeights): BlendResult | null {
  const { api, app, ai, custom } = input

  if (custom?.locked && Number.isFinite(custom.adp)) {
    return {
      adp: round2(custom.adp),
      contributions: { ...EMPTY_CONTRIBUTIONS, custom: 1 },
      ownSampleSize: ownSample(app, ai),
      lowOwnSample: false,
    }
  }

  /*
   * `app` and `ai` are discounted by how much of our own evidence stands behind them.
   * `api` and `custom` are not — see the header for why provider count is a different scale.
   */
  const raw: Array<[keyof BlendWeights, number, number]> = [
    ['api', weights.api, api && Number.isFinite(api.adp) ? api.adp : NaN],
    [
      'app',
      weights.app * sampleConfidence(app?.sampleSize),
      app && Number.isFinite(app.adp) ? app.adp : NaN,
    ],
    ['ai', weights.ai * sampleConfidence(ai?.sampleSize), ai && Number.isFinite(ai.adp) ? ai.adp : NaN],
    ['custom', weights.custom, custom && Number.isFinite(custom.adp) ? custom.adp : NaN],
  ]

  const present = raw.filter(([, w, adp]) => w > 0 && Number.isFinite(adp))
  const totalWeight = present.reduce((sum, [, w]) => sum + w, 0)

  if (totalWeight <= 0) {
    /*
     * Nothing carried weight. That happens when the only sources present are ours AND both are at
     * zero confidence — i.e. sampleSize is missing or non-positive. Fall back to any finite value
     * rather than inventing one, and report zero contribution so a caller can see it was a
     * fallback rather than a blend.
     */
    const fallback = [api, app, ai, custom].find((s) => s && Number.isFinite(s.adp))
    if (!fallback) return null
    return {
      adp: round2(fallback.adp),
      contributions: { ...EMPTY_CONTRIBUTIONS },
      ownSampleSize: ownSample(app, ai),
      lowOwnSample: ownSample(app, ai) != null,
    }
  }

  let weighted = 0
  const contributions: BlendWeights = { ...EMPTY_CONTRIBUTIONS }
  for (const [name, w, adp] of present) {
    weighted += adp * w
    contributions[name] = w / totalWeight
  }

  const own = ownSample(app, ai)
  return {
    adp: round2(weighted / totalWeight),
    contributions,
    ownSampleSize: own,
    lowOwnSample: own != null && own < HALF_CONFIDENCE_SAMPLE,
  }
}

function ownSample(app?: BlendSource | null, ai?: BlendSource | null): number | null {
  const a = typeof app?.sampleSize === 'number' && app.sampleSize > 0 ? app.sampleSize : null
  const b = typeof ai?.sampleSize === 'number' && ai.sampleSize > 0 ? ai.sampleSize : null
  if (a == null && b == null) return null
  return Math.max(a ?? 0, b ?? 0)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
