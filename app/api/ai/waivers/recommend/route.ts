import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"

import { authOptions } from "@/lib/auth"
import { getUserAfProStatus, AfProRequiredError } from "@/lib/entitlements/afAccess"
import { rosterIdSpaceOf } from "@/lib/core-app/rosterIdSpace"
import { runWaiverClaimDecision } from "@/lib/decision-os/waiver"
import { loadWaiverWorldFacts, worldInputFromFacts } from "@/lib/decision-os/waiver/loader"
import { buildLiveWaiverDecisionDeps } from "@/lib/decision-os/waiver/deps"
import { loadWaiverPool } from "@/lib/decision-os/waiver/pool"
import { waiverEngineInputFrom } from "@/lib/decision-os/waiver/engineInput"
import { claimsToPanelRecommendations } from "@/lib/decision-os/waiver/panelRecommendations"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  leagueId: z.string().min(1),
  mode: z.enum(["quick", "deep"]).default("quick"),
  includeFaab: z.boolean().optional(),
  week: z.number().int().positive().optional(),
})

/**
 * POST /api/ai/waivers/recommend
 *
 * Returns personalized AI waiver recommendations for an AF Pro user.
 * - Requires authenticated session.
 * - Requires AF Pro entitlement (pro_waiver_ai).
 * - Never posts to league chat.
 * - Never submits waiver claims automatically.
 * - deeperAnalysisPath on each recommendation routes to Chimmy AI chat.
 */
export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // AF Pro gate
  const hasAfPro = await getUserAfProStatus(userId)
  if (!hasAfPro) {
    return NextResponse.json(new AfProRequiredError().toResponse(), { status: 402 })
  }

  const json = await request.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { leagueId, mode, includeFaab, week } = parsed.data

  const generatedAt = new Date().toISOString()
  /** An empty answer with its reason — `insufficientData` tells the panel it is a fault, not a picked-over wire. */
  const empty = (dataGaps: string[], context?: { waiverType: string; faabBudget: number | null; faabRemaining: number | null }) =>
    NextResponse.json({
      ok: true,
      insufficientData: true,
      recommendations: [],
      rosterNeeds: [],
      leagueContext: { leagueId, ...(context ?? { waiverType: "unknown", faabBudget: null, faabRemaining: null }) },
      generatedAt,
      meta: { dataGaps, mode },
    })

  try {
    /*
     * 🛑 ONLY LEAGUES WHOSE ROSTERS ARE IN SLEEPER'S ID SPACE. A Fleaflicker/MFL/Fantrax/Yahoo
     * roster's ids collide with real Sleeper ids (51 of 248 on the production Fleaflicker league),
     * and the Decision OS pool strips them — which would leave NOBODY rostered and every player
     * "available". ESPN is translated by the pool, but an ESPN id the identity map cannot place is
     * dropped, and a dropped id is still somebody's rostered player: subtracting only the translated
     * ones could offer a rostered player as an add. So ESPN stays refused here too until the pool can
     * account for its untranslated ids (ESPN 12483 is Matthew Stafford; Sleeper 12483 is Jack Bech).
     */
    const league = await prisma.league
      .findUnique({ where: { id: leagueId }, select: { platform: true } })
      .catch(() => null)
    if (rosterIdSpaceOf(league?.platform) !== "sleeper") {
      return empty(["roster_ids_not_readable_for_platform"])
    }

    /*
     * 🛑 THE DECISION OS WAIVER ENGINE, NOT THE LEGACY RECOMMENDER (2026-09-29). This route called
     * `generateWaiverRecommendations` in lib/ai/waivers (since retired, 2026-09-30) — a standing decision-engine-boundary
     * violation that could not be fixed in place (the guard refuses any edit to it). It read rosters
     * raw and matched roster ids against `id`, `externalId` AND `sleeperId`, so a Rolling Insights
     * player of the same number could lend you his position. Chimmy's waiver answer already ran
     * the Decision OS engine; this panel now asks it the same question with the same input
     * (`waiverEngineInputFrom`), so the two surfaces cannot disagree.
     *
     * `week` is accepted for compatibility and not used: the engine prices the current week the
     * projection feed carries, the one week that exists (future weeks are never projected).
     */
    void week
    const facts = await loadWaiverWorldFacts(userId, leagueId)
    if (!facts) return empty(["roster_not_found"])

    const context = {
      waiverType: facts.settings.normalizedWaiverType || facts.settings.waiverType || "unknown",
      faabBudget: facts.settings.faabBudget ?? null,
      faabRemaining: facts.faabRemaining,
    }

    const pool = await loadWaiverPool(leagueId, facts.sport, facts.rosterId)
    if (pool.availablePlayers.length === 0) {
      return empty([pool.leagueRosterCount === 0 ? "league_rosters_not_loaded" : "free_agent_pool_empty"], context)
    }

    const result = await runWaiverClaimDecision(
      {
        worldInput: worldInputFromFacts(facts),
        userId,
        leagueId,
        sport: facts.sport,
        rosterId: facts.rosterId,
        engineInput: waiverEngineInputFrom(facts, pool),
        poolIncomplete: pool.poolIncomplete,
        pricing: pool.pricing,
      },
      { decision: buildLiveWaiverDecisionDeps(facts) },
    )

    const isFaab = context.waiverType === "faab"
    const recommendations = claimsToPanelRecommendations(result.decision?.recommended_actions ?? [], {
      leagueId,
      includeFaab: includeFaab ?? isFaab,
      limit: mode === "quick" ? 3 : 5,
    })

    /*
     * ⚠ AN EMPTY LIST MUST SAY WHY. "No qualifying targets" and "the wire could not be priced" are
     * different answers (see decideWaiverClaim), and only the second is a fault the panel reports.
     */
    const dataGaps: string[] = []
    const unpriced = pool.pricing.total > 0 && pool.pricing.priced === 0
    if (unpriced) dataGaps.push("free_agent_pool_unpriced")
    if (pool.poolIncomplete) dataGaps.push("free_agent_pool_capped")
    if (!result.decision) dataGaps.push("decision_not_computed")

    const rosterNeeds = [...new Set((pool.teamNeeds?.weakestSlots ?? []).map((s) => s.position).filter(Boolean))]

    return NextResponse.json({
      ok: true,
      insufficientData: recommendations.length === 0 && (unpriced || !result.decision),
      recommendations,
      rosterNeeds,
      leagueContext: { leagueId, ...context },
      generatedAt,
      meta: { dataGaps, mode },
    })
  } catch (error) {
    console.error("[api/ai/waivers/recommend]", error)
    return NextResponse.json(
      { error: "Failed to generate waiver recommendations" },
      { status: 500 }
    )
  }
}
