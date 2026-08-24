import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeLineupActionsForUser } from '@/lib/lineup-actions/computeLineupActionsForUser'
import { attachChimmyAdviceToLineupSummary } from '@/lib/lineup-actions/chimmyLineupAdvice'
import { buildAiTimeContextPayload } from '@/lib/time-engine/userContext'
import { shouldRunLineupShadow, shouldRunLineupLive, runLineupShadowForSummary } from '@/lib/decision-os/lineup/shadow'
import { toTodayLineupCard, type LineupTodayCard } from '@/lib/decision-os/lineup/todayCardAdapter'
import { getDecisionShadowScopeFilters } from '@/lib/decision-os/core/shadow'
import { emitLiveTelemetry, emitFeedOutcomes } from '@/lib/decision-os/core/parity'
import { createLineupOsLoaders } from '@/lib/decision-os/lineup-os'
import { attachSavedAnalysis } from '@/lib/decision-os/three-brain/phase4/attachSavedAnalysis'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await computeLineupActionsForUser(userId)
  const withChimmy = await attachChimmyAdviceToLineupSummary(summary, userId)
  const intelligence = {
    schemaVersion: 1 as const,
    time: await buildAiTimeContextPayload(userId),
  }
  // Decision OS Slice 1 — lineup shadow/live runner. Evaluation only; never sets a lineup.
  // Stage 0 (SHADOW only): scope-filtered, logs parity, result discarded.
  // Stage 1 (LIVE): unconditional, decisionOs appended to response for the first league.
  /*
   * Lineup OS feed, built ONCE per request so `drainOutcomes()` sees every fact this request
   * resolved. Both branches below get the same instance.
   *
   * ⚠ THIS CHANGES WHERE FACTS COME FROM, NEVER HOW A LINEUP IS DECIDED. `runLineupShadow`
   * already accepts these two loaders as optional dependencies with live defaults, so supplying
   * them swaps grounding and nothing else.
   *
   * SAFE BEFORE THE TABLE EXISTS. `domain_os_facts` is declared in schema.prisma but has never
   * been migrated, so in production every read throws 42P01, `safeRead` swallows it and the feed
   * falls through to the live derivation -- byte-identical behaviour to not wiring this at all.
   * That is deliberate: it lets the hit rate be MEASURED before anyone migrates a table for it.
   */
  const { drainOutcomes: drainLineupOsOutcomes, ...lineupOsLoaders } = createLineupOsLoaders()
  const isLive = shouldRunLineupLive(process.env)
  const liveStart = Date.now()
  let decisionOs: { decisionId: string; card: LineupTodayCard; confidence: number; leagueId: string } | null = null

  if (isLive) {
    try {
      const results = await runLineupShadowForSummary(userId, summary, { maxLeagues: 1 }, lineupOsLoaders)
      const first = results[0]
      if (first?.ran && first.result) {
        const { decision } = first.result
        // Attach a saved three-brain analysis, if this user has one for this league. Same seam
        // #545 mounted on the waiver surface: evidence -> analysis -> recommendation only pays
        // off if the generated analysis reaches somebody, and until now exactly one of the four
        // live surfaces read it.
        //
        // Costs one indexed count when there is nothing to show, which is every request while
        // AI spend is disabled. It cannot throw, and `aiAuthorityPolicy` resolves this decision
        // type to explanation_only (fail-closed for anything unlisted), so it can change the
        // explanation string and nothing else -- the verdict, actions and rule verdicts are
        // returned untouched.
        const attached = await attachSavedAnalysis({
          decision,
          leagueId: first.leagueId,
          userId,
          tool: 'manager_intelligence',
        })
        const card = toTodayLineupCard(attached.decision)
        decisionOs = {
          decisionId: decision.decision_id,
          card,
          confidence: decision.confidence,
          leagueId: first.leagueId,
        }
        emitLiveTelemetry('lineup.set', { enriched: true, ai_explained: attached.enriched, ai_reason: attached.reason, latency_ms: Date.now() - liveStart, leagueId: first.leagueId, source: first.source }, decision.decision_id)
      } else {
        emitLiveTelemetry('lineup.set', { enriched: false, reason: 'shadow_no_result', latency_ms: Date.now() - liveStart })
      }
    } catch {
      emitLiveTelemetry('lineup.set', { enriched: false, reason: 'exception', latency_ms: Date.now() - liveStart })
      // live path must never fail the lineup route
    }
  } else {
    const shadowFilters = getDecisionShadowScopeFilters()
    const shadowProfile = shadowFilters.hasUsernameFilter
      ? await prisma.userProfile.findUnique({
          where: { userId },
          select: { sleeperUsername: true },
        })
      : null

    if (shouldRunLineupShadow(process.env, {
      username: shadowProfile?.sleeperUsername ?? null,
      leagueIds: (summary.leagues ?? []).map((league) => league.leagueId),
    })) {
      try {
        await runLineupShadowForSummary(userId, summary, { maxLeagues: 1 }, lineupOsLoaders)
      } catch {
        // shadow must never affect the legacy response
      }
    }
  }

  // After both branches: one event carrying where each fact actually came from. Emitted
  // unconditionally -- a request that resolved nothing reports nothing and returns early.
  emitFeedOutcomes('lineup', drainLineupOsOutcomes())
  return NextResponse.json({ ...withChimmy, intelligence, ...(decisionOs ? { decisionOs } : {}) })
}
