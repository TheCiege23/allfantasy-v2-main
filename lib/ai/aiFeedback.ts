/**
 * AiFeedback — store and query thumbs-up/thumbs-down ratings on AI answers.
 *
 * ── Data model ─────────────────────────────────────────────────────────────────
 *  One row per user × feature × resultKey.
 *  Upsert pattern: calling saveAiFeedback twice with the same key updates the
 *  rating (user can change their mind from 👍 to 👎).
 *
 * ── Privacy ───────────────────────────────────────────────────────────────────
 *  No raw prompt text is stored.
 *  promptHash is the first 16 chars of SHA-256(normalizedPrompt) — sufficient
 *  for analytics grouping but not reversible.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *  Called from the /api/ai/feedback POST route (see app/api/ai/feedback/route.ts).
 *  The TeachingAnswerCard onFeedback callback fires this route via client fetch.
 */
import "server-only"

import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"

export type AiFeedbackRating = "helpful" | "not_helpful"

type SaveAiFeedbackInput = {
  userId: string
  /** Which AI feature generated the answer. */
  feature: string
  /** AiResult.resultKey if known — ties feedback to a specific cached answer. */
  resultKey?: string | null
  rating: AiFeedbackRating
  /** The normalized prompt text — will be hashed before storage. */
  promptText?: string | null
  /** Sport context. */
  sport?: string | null
  /**
   * Optional reason for "not_helpful" ratings.
   * e.g. "too_basic" | "not_actionable" | "wrong_data" | "great_insight"
   */
  reason?: string | null
}

type AiFeedbackRow = {
  id: string
  userId: string
  feature: string
  resultKey: string | null
  rating: AiFeedbackRating
  promptHash: string | null
  sport: string | null
  reason: string | null
  createdAt: Date
}

/**
 * Save (or update) a feedback rating.
 *
 * Upserts by (userId, feature, resultKey) so the user can change their mind.
 * Returns the saved row, or null on DB error (non-fatal).
 */
export async function saveAiFeedback(input: SaveAiFeedbackInput): Promise<AiFeedbackRow | null> {
  const promptHash = input.promptText
    ? createHash("sha256")
        .update(input.promptText.toLowerCase().trim())
        .digest("hex")
        .slice(0, 16)
    : null

  // When resultKey is null/undefined, the unique key uses NULL which doesn't
  // conflict with itself in Postgres — use a sentinel for upsert uniqueness.
  const resultKey = input.resultKey ?? null

  try {
    const row = await (prisma as any).aiFeedback.upsert({
      where: {
        userId_feature_resultKey: {
          userId: input.userId,
          feature: input.feature,
          resultKey: resultKey ?? "",
        },
      },
      create: {
        userId: input.userId,
        feature: input.feature,
        resultKey: resultKey ?? "",
        rating: input.rating,
        promptHash,
        sport: input.sport ?? null,
        reason: input.reason ?? null,
      },
      update: {
        rating: input.rating,
        // Always update reason — user may change from no-reason "not_helpful"
        // click to a chip selection on a second tap.
        reason: input.reason ?? null,
        // Update promptHash and sport in case they've changed
        ...(promptHash ? { promptHash } : {}),
        ...(input.sport ? { sport: input.sport } : {}),
      },
    })
    return row as AiFeedbackRow
  } catch {
    return null
  }
}

/**
 * Returns the most recent feedback rating a user gave for a specific answer.
 * Returns null if no feedback exists or on DB error.
 */
export async function getUserFeedbackForResult(
  userId: string,
  feature: string,
  resultKey: string
): Promise<AiFeedbackRating | null> {
  try {
    const row = await (prisma as any).aiFeedback.findFirst({
      where: {
        userId,
        feature,
        resultKey,
      },
      select: { rating: true },
      orderBy: { createdAt: "desc" },
    })
    return (row?.rating as AiFeedbackRating) ?? null
  } catch {
    return null
  }
}

/**
 * Aggregate helpful/not_helpful counts for a feature over a time window.
 * Useful for admin dashboards and quality monitoring.
 */
export async function getAiFeedbackStats(
  feature: string,
  since?: Date
): Promise<{ helpful: number; notHelpful: number; total: number }> {
  try {
    const rows = await (prisma as any).aiFeedback.groupBy({
      by: ["rating"],
      where: {
        feature,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { rating: true },
    })
    let helpful = 0
    let notHelpful = 0
    for (const row of rows) {
      if (row.rating === "helpful") helpful = row._count.rating
      if (row.rating === "not_helpful") notHelpful = row._count.rating
    }
    return { helpful, notHelpful, total: helpful + notHelpful }
  } catch {
    return { helpful: 0, notHelpful: 0, total: 0 }
  }
}
