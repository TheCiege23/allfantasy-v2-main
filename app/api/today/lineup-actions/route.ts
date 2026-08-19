import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeLineupActionsForUser } from '@/lib/lineup-actions/computeLineupActionsForUser'
import { attachChimmyAdviceToLineupSummary } from '@/lib/lineup-actions/chimmyLineupAdvice'
import { buildAiTimeContextPayload } from '@/lib/time-engine/userContext'
import { shouldRunLineupShadow, shouldRunLineupLive, runLineupShadowForSummary } from '@/lib/decision-os/lineup/shadow'
import { toTodayLineupCard, type LineupTodayCard } from '@/lib/decision-os/lineup/todayCardAdapter'
import { getDecisionShadowScopeFilters } from '@/lib/decision-os/core/shadow'
import { emitLiveTelemetry } from '@/lib/decision-os/core/parity'
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
  const isLive = shouldRunLineupLive(process.env)
  const liveStart = Date.now()
  let decisionOs: { decisionId: string; card: LineupTodayCard; confidence: number; leagueId: string } | null = null

  if (isLive) {
    try {
      const results = await runLineupShadowForSummary(userId, summary, { maxLeagues: 1 })
      const first = results[0]
      if (first?.ran && first.result) {
        const { decision } = first.result
        const card = toTodayLineupCard(decision)
        decisionOs = {
          decisionId: decision.decision_id,
          card,
          confidence: decision.confidence,
          leagueId: first.leagueId,
        }
        emitLiveTelemetry('lineup.set', { enriched: true, latency_ms: Date.now() - liveStart, leagueId: first.leagueId, source: first.source }, decision.decision_id)
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
        await runLineupShadowForSummary(userId, summary, { maxLeagues: 1 })
      } catch {
        // shadow must never affect the legacy response
      }
    }
  }

  return NextResponse.json({ ...withChimmy, intelligence, ...(decisionOs ? { decisionOs } : {}) })
}
