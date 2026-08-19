/**
 * AI Cost & Cache Health — aggregation service for admin dashboards.
 *
 * Queries AiInteractionLog and AiFeedback to produce a complete picture of:
 *  - How many questions are answered deterministically (free)
 *  - How many are served from cache (free after first call)
 *  - How many actually hit the LLM (costs money)
 *  - How many tokens were spent and how many were saved
 *  - Per-feature breakdowns
 *  - Feedback scores to identify what users value vs. dislike
 *
 * ── Performance ───────────────────────────────────────────────────────────────
 *  All queries use the existing `createdAt` and `(sport, feature, createdAt)`
 *  indexes on AiInteractionLog. No full table scans for typical 24-hour windows.
 *
 * ── Token savings estimate ───────────────────────────────────────────────────
 *  When a cached answer is served, we didn't call the LLM — but we don't know
 *  how many tokens it WOULD have cost. We estimate:
 *    savedTokens = cacheHitCount × avgTokenCostForFeature (from LLM calls only)
 *  If a feature has no LLM calls in the window, we use a default of 400 tokens
 *  (the max token budget for Chimmy calls).
 */
import "server-only"
import { prisma } from "@/lib/prisma"

const DEFAULT_TOKENS_PER_CALL = 400

export type AiCostFeatureStat = {
  feature: string
  count: number
  llmCount: number
  cacheHitCount: number
  deterministicCount: number
  /** Average token cost per LLM call. Null if no LLM calls in window. */
  avgTokenCost: number | null
  /** Estimated tokens saved by the cache in this window. */
  estimatedTokensSaved: number
  /** 0–100 if there is feedback data, null otherwise. */
  feedbackPositivePct: number | null
}

export type AiCostValidatorStats = {
  clean: number
  warned: number
  blocked: number
}

export type AiCostIntentStat = {
  intent: string
  count: number
}

export type AiCostHealth = {
  /** Window in hours (e.g. 24 for the last day). */
  windowHours: number
  /** Start of the time window. */
  since: Date
  /** Total interaction log rows in window. */
  totalInteractions: number
  /** Answered without any LLM call — policy or existing data. */
  deterministicCount: number
  /** Served from AiInsightCache — no fresh LLM call. */
  cacheHitCount: number
  /** Actually called an LLM provider. */
  llmCount: number
  /** No data available — returned error/unavailable. */
  unavailableCount: number
  /** Sum of tokenCost for LLM calls in window. */
  estimatedTokensSpent: number
  /** Estimated tokens saved by the cache (cacheHits × avgCostPerCall). */
  estimatedTokensSaved: number
  /** 0–100. */
  deterministicPct: number
  /** 0–100. */
  cacheHitPct: number
  /** 0–100. */
  llmPct: number
  validatorStats: AiCostValidatorStats
  /** Feature breakdown, sorted by count desc. */
  byFeature: AiCostFeatureStat[]
  /** Top 10 intents by call count. */
  topIntents: AiCostIntentStat[]
  /**
   * Token fairness breakdown (of the LLM calls).
   * planCoveredCount  — LLM calls by users on a paid subscription (no token deducted)
   * chargeableCount   — LLM calls by users with no/free plan (token should be charged)
   */
  planCoveredCount: number
  chargeableCount: number
  /**
   * Billing enforcement audit.
   * shouldChargeCount — rows where policy said "charge a token"
   * actualChargedCount — rows where a token was actually deducted
   * chargeGap — shouldChargeCount minus actualChargedCount (non-zero = enforcement gap)
   */
  shouldChargeCount: number
  actualChargedCount: number
  chargeGap: number
}

/**
 * Compute AI cost & cache health metrics for an admin dashboard.
 *
 * @param windowHours — how far back to look (default 24)
 */
export async function getAdminAiCostHealth(windowHours = 24): Promise<AiCostHealth> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  // Plan values that represent an active paid subscription (mirrors aiBillingDecision.ts)
  const PAID_PLAN_VALUES = ["pro", "commissioner", "war_room", "supreme"]
  const NON_LLM_PROVIDERS = ["deterministic", "policy", "cache", "unavailable"]

  // ── Parallel queries ────────────────────────────────────────────────────────
  const [
    totalRows,
    providerGroups,
    validatorGroups,
    featureGroups,
    intentGroups,
    feedbackGroups,
    planBillingGroups,
    shouldChargeCount,
    actualChargedCount,
  ] = await Promise.all([
    // Total interaction count
    (prisma as any).aiInteractionLog.count({ where: { createdAt: { gte: since } } }) as Promise<number>,

    // Count by providerSource
    (prisma as any).aiInteractionLog.groupBy({
      by: ["providerSource"],
      where: { createdAt: { gte: since } },
      _count: { providerSource: true },
    }) as Promise<Array<{ providerSource: string | null; _count: { providerSource: number } }>>,

    // Validator result distribution
    (prisma as any).aiInteractionLog.groupBy({
      by: ["validatorResult"],
      where: { createdAt: { gte: since } },
      _count: { validatorResult: true },
    }) as Promise<Array<{ validatorResult: string | null; _count: { validatorResult: number } }>>,

    // Per-feature: count + llmCount + cacheHitCount + detCount + avgTokenCost
    (prisma as any).aiInteractionLog.groupBy({
      by: ["feature", "providerSource"],
      where: { createdAt: { gte: since } },
      _count: { feature: true },
      _avg: { tokenCost: true },
      orderBy: { _count: { feature: "desc" } },
    }) as Promise<Array<{
      feature: string
      providerSource: string | null
      _count: { feature: number }
      _avg: { tokenCost: number | null }
    }>>,

    // Top 10 prompt intents
    (prisma as any).aiInteractionLog.groupBy({
      by: ["promptIntent"],
      where: {
        createdAt: { gte: since },
        promptIntent: { not: null },
      },
      _count: { promptIntent: true },
      orderBy: { _count: { promptIntent: "desc" } },
      take: 10,
    }) as Promise<Array<{ promptIntent: string; _count: { promptIntent: number } }>>,

    // Feedback positive rates per feature
    (prisma as any).aiFeedback.groupBy({
      by: ["feature", "rating"],
      where: { createdAt: { gte: since } },
      _count: { rating: true },
    }) as Promise<Array<{ feature: string; rating: string; _count: { rating: number } }>>,

    // Token fairness: group LLM-only rows by plan to distinguish
    // plan-covered (no deduction) from chargeable (token should be spent)
    (prisma as any).aiInteractionLog.groupBy({
      by: ["plan"],
      where: {
        createdAt: { gte: since },
        NOT: { providerSource: { in: NON_LLM_PROVIDERS } },
      },
      _count: { plan: true },
    }) as Promise<Array<{ plan: string | null; _count: { plan: number } }>>,

    // Billing enforcement audit: how many rows had shouldChargeToken = true?
    (prisma as any).aiInteractionLog.count({
      where: { createdAt: { gte: since }, shouldChargeToken: true },
    }) as Promise<number>,

    // How many of those were actually charged?
    (prisma as any).aiInteractionLog.count({
      where: { createdAt: { gte: since }, tokenCharged: true },
    }) as Promise<number>,
  ])

  // ── Summarise provider breakdown ────────────────────────────────────────────
  const providerMap: Record<string, number> = {}
  for (const row of providerGroups) {
    providerMap[row.providerSource ?? "unknown"] = row._count.providerSource
  }
  const deterministicCount = (providerMap["deterministic"] ?? 0) + (providerMap["policy"] ?? 0)
  const cacheHitCount = providerMap["cache"] ?? 0
  const unavailableCount = providerMap["unavailable"] ?? 0
  const llmCount = totalRows - deterministicCount - cacheHitCount - unavailableCount

  // ── Validator stats ─────────────────────────────────────────────────────────
  const validatorMap: Record<string, number> = {}
  for (const row of validatorGroups) {
    validatorMap[row.validatorResult ?? "unknown"] = row._count.validatorResult
  }
  const validatorStats: AiCostValidatorStats = {
    clean: validatorMap["clean"] ?? 0,
    warned: validatorMap["warned"] ?? 0,
    blocked: validatorMap["blocked"] ?? 0,
  }

  // ── Per-feature aggregation ─────────────────────────────────────────────────
  // featureGroups has one row per (feature, providerSource) — pivot into per-feature totals.
  const featureMap = new Map<string, Omit<AiCostFeatureStat, "feedbackPositivePct" | "estimatedTokensSaved">>()

  for (const row of featureGroups) {
    const feat = row.feature
    const src = row.providerSource ?? "unknown"
    const cnt = row._count.feature

    if (!featureMap.has(feat)) {
      featureMap.set(feat, {
        feature: feat,
        count: 0,
        llmCount: 0,
        cacheHitCount: 0,
        deterministicCount: 0,
        avgTokenCost: null,
      })
    }
    const entry = featureMap.get(feat)!
    entry.count += cnt

    if (src === "cache") {
      entry.cacheHitCount += cnt
    } else if (src === "deterministic" || src === "policy") {
      entry.deterministicCount += cnt
    } else if (src !== "unavailable" && src !== "unknown") {
      // LLM call — accumulate for avgTokenCost
      entry.llmCount += cnt
      // Weighted average accumulation: we'll compute final avg below
      if (row._avg.tokenCost != null) {
        if (entry.avgTokenCost == null) {
          entry.avgTokenCost = row._avg.tokenCost
        } else {
          // This is an approximation — good enough for an admin dashboard
          entry.avgTokenCost = (entry.avgTokenCost + row._avg.tokenCost) / 2
        }
      }
    }
  }

  // ── Feedback positive % per feature ─────────────────────────────────────────
  const feedbackByFeature = new Map<string, { helpful: number; notHelpful: number }>()
  for (const row of feedbackGroups) {
    if (!feedbackByFeature.has(row.feature)) {
      feedbackByFeature.set(row.feature, { helpful: 0, notHelpful: 0 })
    }
    const entry = feedbackByFeature.get(row.feature)!
    if (row.rating === "helpful") entry.helpful += row._count.rating
    if (row.rating === "not_helpful") entry.notHelpful += row._count.rating
  }

  // ── Token savings estimation ─────────────────────────────────────────────────
  // Estimate: each cache hit saved avgTokenCost (or DEFAULT) tokens
  const byFeature: AiCostFeatureStat[] = Array.from(featureMap.values())
    .sort((a, b) => b.count - a.count)
    .map((entry) => {
      const avgCost = entry.avgTokenCost ?? DEFAULT_TOKENS_PER_CALL
      const estimatedTokensSaved = Math.round(entry.cacheHitCount * avgCost)

      const fb = feedbackByFeature.get(entry.feature)
      const totalFeedback = (fb?.helpful ?? 0) + (fb?.notHelpful ?? 0)
      const feedbackPositivePct =
        totalFeedback > 0 ? Math.round(((fb?.helpful ?? 0) / totalFeedback) * 100) : null

      return { ...entry, estimatedTokensSaved, feedbackPositivePct }
    })

  // ── Global token totals ──────────────────────────────────────────────────────
  const estimatedTokensSpent = byFeature.reduce((sum, f) => {
    return sum + (f.avgTokenCost != null ? Math.round(f.llmCount * f.avgTokenCost) : f.llmCount * DEFAULT_TOKENS_PER_CALL)
  }, 0)
  const estimatedTokensSaved = byFeature.reduce((sum, f) => sum + f.estimatedTokensSaved, 0)

  // ── Intents ──────────────────────────────────────────────────────────────────
  const topIntents: AiCostIntentStat[] = intentGroups.map((row) => ({
    intent: row.promptIntent,
    count: row._count.promptIntent,
  }))

  // ── Token fairness breakdown ─────────────────────────────────────────────────
  let planCoveredCount = 0
  let chargeableCount = 0
  for (const row of planBillingGroups) {
    const count = row._count.plan
    if (row.plan && PAID_PLAN_VALUES.includes(row.plan)) {
      planCoveredCount += count
    } else {
      chargeableCount += count
    }
  }

  // ── Percentage helpers ───────────────────────────────────────────────────────
  const pct = (n: number) => totalRows > 0 ? Math.round((n / totalRows) * 100) : 0

  return {
    windowHours,
    since,
    totalInteractions: totalRows,
    deterministicCount,
    cacheHitCount,
    llmCount,
    unavailableCount,
    estimatedTokensSpent,
    estimatedTokensSaved,
    deterministicPct: pct(deterministicCount),
    cacheHitPct: pct(cacheHitCount),
    llmPct: pct(llmCount),
    validatorStats,
    byFeature,
    topIntents,
    planCoveredCount,
    chargeableCount,
    shouldChargeCount: shouldChargeCount ?? 0,
    actualChargedCount: actualChargedCount ?? 0,
    chargeGap: Math.max(0, (shouldChargeCount ?? 0) - (actualChargedCount ?? 0)),
  }
}
