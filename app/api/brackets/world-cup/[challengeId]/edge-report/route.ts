import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { userHasBracketBrainAi } from "@/lib/bracket-brain/bracketBrainAccess"
import {
  prepareWorldCupAiTokenFallback,
  WORLD_CUP_AI_TOKEN_RULES,
} from "@/lib/world-cup/worldCupAiTokenFallback"
import { buildWorldCupChimmyContext } from "@/lib/world-cup/worldCupChimmyContext"
import { computeWorldCupEdgeReport } from "@/lib/world-cup/worldCupEdgeReport"
import {
  generateEdgeReportCoaching,
  todayUtcDate,
  edgeReportCacheKey,
} from "@/lib/world-cup/worldCupEdgeReportAi"
import { getCachedAiResult } from "@/lib/ai/ai-result-cache"
import { getWorldCupDataTrustReport } from "@/lib/world-cup/worldCupDataTrustService"
import {
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"

export const runtime = "nodejs"

// ── GET ────────────────────────────────────────────────────────────────────────
// Returns the full deterministic edge report for the authenticated user.
// Always free. No token charge. Includes a `coachingAvailable` flag and a
// `coachingFromCache` flag so the UI can show "already unlocked today" without
// making another request.

export async function GET(request: Request, props: { params: Promise<unknown> }) {
  const rawParams = await props.params
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse(rawParams)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge ID" }, { status: 400 })
  }

  const challengeId = params.data.challengeId
  const userId = auth.user.id

  // Build context (same path as Chimmy — no extra DB queries)
  const context = await buildWorldCupChimmyContext({
    challengeId,
    userId,
    locale: null,
    userRole: "participant",
  })

  const report = computeWorldCupEdgeReport(context, userId)

  const utcDate = todayUtcDate()
  const cacheKey = edgeReportCacheKey(challengeId, userId, utcDate)

  // Run data-trust and coaching-cache check in parallel — failures are non-fatal
  const [dataTrust, cachedCoaching] = await Promise.all([
    getWorldCupDataTrustReport(challengeId).catch(() => null),
    getCachedAiResult({
      feature: "world_cup_daily_edge_report",
      scopeType: "user_pool_day",
      scopeId: cacheKey,
      payload: {},
    }).catch(() => null),
  ])

  const coachingFromCache = Boolean(cachedCoaching?.resultText)

  return NextResponse.json({
    report,
    dataTrust,
    coachingAvailable: true,
    coachingFromCache,
    billing: {
      deterministicSections: "free",
      coachingTokenCost: 1,
      coachingCached: coachingFromCache,
    },
  })
}

// ── POST ───────────────────────────────────────────────────────────────────────
// Requests the AI coaching layer (coachingInsight + commissionerPost).
// Free for paid-plan users. Free on cache hit (same day).
// Costs 1 token for free users on a cache miss.

const postSchema = z.object({
  confirmedTokenSpend: z.boolean().optional().default(false),
})

export async function POST(request: Request, props: { params: Promise<unknown> }) {
  const rawParams = await props.params
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse(rawParams)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge ID" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", issues: parsed.error.issues }, { status: 400 })
  }

  const challengeId = params.data.challengeId
  const userId = auth.user.id

  // ── Subscription check ─────────────────────────────────────────────────────
  const hasAi = await userHasBracketBrainAi(userId, auth.user.email ?? null)
  const entitled = hasAi || Boolean((auth as any).access?.isAdmin)

  // ── Token gate ─────────────────────────────────────────────────────────────
  // Subscription users: commitTokenSpend = null (plan covers it).
  // Free users with cache hit: the LLM service returns early (cache_no_charge).
  // Free users on a miss: 1 token, committed after successful LLM + parse.
  const tokenAccess = await prepareWorldCupAiTokenFallback({
    userId,
    userEmail: auth.user.email ?? null,
    entitled,
    ruleCode: WORLD_CUP_AI_TOKEN_RULES.edgeReport,
    confirmTokenSpend: parsed.data.confirmedTokenSpend,
    sourceType: "world_cup_edge_report",
    sourceId: challengeId,
    // Per-day idempotency: same day = same key = no double-charge even if POST is called twice
    idempotencyKey: `edge-report:${userId}:${challengeId}:${todayUtcDate()}`,
    description: "World Cup Daily Edge Report coaching insight",
    metadata: { challengeId, date: todayUtcDate() },
    upgradePath: "/pricing?from=wc-edge-report",
  })

  if (!tokenAccess.ok) {
    return tokenAccess.response
  }

  // ── Build the deterministic report (needed as LLM grounding) ─────────────
  const context = await buildWorldCupChimmyContext({
    challengeId,
    userId,
    locale: null,
    userRole: "participant",
  })
  const report = computeWorldCupEdgeReport(context, userId)

  // ── Run the coaching layer ─────────────────────────────────────────────────
  const plan = entitled ? "pro" : null
  const commitTokenSpend =
    tokenAccess.mode === "tokens" ? tokenAccess.commitTokenSpend : null

  try {
    const result = await generateEdgeReportCoaching({
      report,
      userId,
      challengeId,
      plan,
      commitTokenSpend,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.fallback,
          code: result.reason,
          report,
        },
        { status: result.reason === "provider_missing" ? 503 : 500 }
      )
    }

    return NextResponse.json({
      report,
      coaching: result.coaching,
      billing: {
        tokenCharged: !result.coaching.fromCache && !entitled,
        fromCache: result.coaching.fromCache,
        coveredByPlan: entitled,
      },
    })
  } catch (err) {
    // Token spend failed after successful LLM — clean 402, no AI message saved
    const isSpendFailure =
      err instanceof Error &&
      (err.message.includes("Insufficient") || err.message.includes("token"))
    return NextResponse.json(
      {
        error: "Token spend failed. Your coaching was generated but the token could not be deducted. Check your balance and try again.",
        code: "edge_report_spend_failed",
        report,
      },
      { status: 402 }
    )
  }
}
