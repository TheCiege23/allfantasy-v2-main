import { NextResponse } from 'next/server'
import { resolveProfileAccess } from '@/lib/psychological-profiles/ProfileAccess'
import { getProfileById } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { prisma } from '@/lib/prisma'
import { runUnifiedOrchestration } from '@/lib/ai-orchestration'
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from '@/lib/ai-tool-layer'
import { readManagerTrajectory, summariseTrajectory } from '@/lib/psychological-profiles/ProfileSeasonSnapshot'
import { loadPsychologyConsistencySlice } from '@/lib/decision-os/grounding/psychologyConsistencySlice'

export const dynamic = 'force-dynamic'

function getStructuredCandidate(response: {
  modelOutputs?: Array<{ model?: string; structured?: unknown }>
}): Record<string, unknown> | null {
  const openaiStructured = response.modelOutputs?.find(
    (item) => item.model === 'openai' && item.structured && typeof item.structured === 'object'
  )?.structured
  if (openaiStructured && typeof openaiStructured === 'object') {
    return openaiStructured as Record<string, unknown>
  }
  const anyStructured = response.modelOutputs?.find(
    (item) => item.structured && typeof item.structured === 'object'
  )?.structured
  return anyStructured && typeof anyStructured === 'object'
    ? (anyStructured as Record<string, unknown>)
    : null
}

/**
 * POST /api/leagues/[leagueId]/psychological-profiles/explain
 * Body: { profileId: string }
 * Returns a short narrative explanation of the manager's behavior profile (for "Explain this manager style" UI).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

    // An explanation is the profile in prose — the most revealing form of it.
    const access = await resolveProfileAccess(leagueId)
    if (!access.ok) {
      return NextResponse.json({ error: access.reason }, { status: access.status })
    }

    const body = await req.json().catch(() => ({}))
    const profileId = body.profileId
    if (!profileId) return NextResponse.json({ error: 'Missing profileId' }, { status: 400 })

    const profile = await getProfileById(profileId)
    if (!profile || profile.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const evidence = await prisma.profileEvidenceRecord.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    /*
     * R4b.6 — trajectory (P1) and, self only, cross-league/cross-sport consistency (P5/P7).
     *
     * ⚠ NOT SELF-GATED. Trajectory is history about THIS profile, exactly as available to whoever
     * already has access to view it — the same reasoning `psychology-os/index.ts` already applies
     * to the base profile.
     */
    const trajectory = summariseTrajectory(
      await readManagerTrajectory({ leagueId, managerId: profile.managerId }),
    )

    /*
     * ⚠ SELF ONLY, DELIBERATELY. `resolveProfileAccess`'s `canSeeOpponents` governs whether the
     * CALLER may view ANOTHER manager's profile at all — a separate question from "may this
     * explanation include cross-league/cross-sport data about the profile's subject", which
     * `loadPsychologyConsistencySlice` restricts to the viewer's OWN account by design (see its
     * header). Explaining an opponent's profile therefore never includes it, matching the packet's
     * own scoping rather than inventing a second entitlement rule here.
     */
    const isSelf = access.ownManagerIds.has(profile.managerId)
    const consistency = isSelf
      ? await loadPsychologyConsistencySlice({ userId: access.userId, leagueId })
      : null
    /*
     * `GroundedSlice.present` is a plain `boolean`, not a literal `true`/`false` discriminant tied
     * to `value`'s type — so `consistency?.present && consistency.value.X` does not narrow
     * `consistency.value` away from `| null` (TS18047). This capture is what actually narrows: a
     * local `const` that TS's control-flow analysis can track through a single `!= null` check,
     * rather than re-reading a property off `consistency` at every use.
     */
    const cv = consistency?.value ?? null
    // Shaped once, used in both the AI's deterministicPayload and the JSON response, so the two
    // can never quietly disagree about what "a real cross-league/cross-sport reading" means.
    const crossLeaguePayload =
      cv && cv.crossLeagueObserved > 1
        ? { leaguesObserved: cv.crossLeagueObserved, consistentLabels: cv.crossLeagueConsistentLabels }
        : null
    const crossSportPayload =
      cv && cv.crossSportObserved > 1
        ? { sportsObserved: cv.crossSportObserved, consistentLabels: cv.crossSportConsistentLabels, sportSpecificLabels: cv.crossSportSpecificLabels }
        : null
    const trajectoryPayload = trajectory.hasTrajectory
      ? { summary: trajectory.summary, seasonsRecorded: trajectory.seasonsRecorded }
      : null

    const labelsSummary = profile.profileLabels.length > 0
      ? profile.profileLabels.join(', ')
      : 'No behavioral labels yet'

    const fallbackNarrative = [
      `Manager ${profile.managerId} has a ${profile.sportLabel} behavior profile.`,
      `Labels: ${labelsSummary}.`,
      `Scores — Aggression: ${profile.aggressionScore.toFixed(0)}, Activity: ${profile.activityScore.toFixed(0)}, Trade frequency: ${profile.tradeFrequencyScore.toFixed(0)}, Waiver focus: ${profile.waiverFocusScore.toFixed(0)}, Risk tolerance: ${profile.riskToleranceScore.toFixed(0)}.`,
      profile.evidenceCount && profile.evidenceCount > 0
        ? `Evidence: ${profile.evidenceCount} recorded signals (trades, waivers, rebuild/contention).`
        : 'Evidence is being collected.',
      // Only when it says something — summariseTrajectory's own refusal (one season, or nothing
      // clears the floor) is not worth repeating in a fallback nobody asked a second question of.
      trajectory.hasTrajectory ? `Trajectory: ${trajectory.summary}` : null,
      cv && cv.crossLeagueConsistentLabels.length > 0
        ? `Consistent across your leagues: ${cv.crossLeagueConsistentLabels.join(', ')}.`
        : null,
      cv && cv.crossSportConsistentLabels.length > 0
        ? `Consistent across your sports: ${cv.crossSportConsistentLabels.join(', ')}.`
        : null,
    ].filter((line): line is string => line != null).join(' ')

    const evidencePreview = evidence.slice(0, 10).map((e) => ({
      evidenceType: e.evidenceType,
      value: e.value,
      sourceReference: e.sourceReference,
    }))
    const envelope = buildEnvelopeForTool('psychological', {
      sport: profile.sport,
      leagueId,
      deterministicPayload: {
        profile: {
          profileId,
          managerId: profile.managerId,
          labels: profile.profileLabels,
          aggressionScore: profile.aggressionScore,
          activityScore: profile.activityScore,
          tradeFrequencyScore: profile.tradeFrequencyScore,
          waiverFocusScore: profile.waiverFocusScore,
          riskToleranceScore: profile.riskToleranceScore,
        },
        evidence: evidencePreview,
        evidenceCount: profile.evidenceCount ?? evidencePreview.length,
        // R4b.6 — null/absent fields are the honest "not enough to say" this whole profile
        // system already uses; the model is told below never to invent a trend or a consistency
        // claim that is not present here.
        trajectory: trajectoryPayload,
        crossLeagueConsistency: crossLeaguePayload,
        crossSportConsistency: crossSportPayload,
      },
      behaviorPayload: {
        profileLabels: profile.profileLabels,
      },
      userMessage:
        'Explain this manager style in 2-4 sentences with one actionable takeaway. Stay deterministic-first and confidence-aware. ' +
        'If trajectory is present, you may note the direction of change. If crossLeagueConsistency or crossSportConsistency is ' +
        'present, you may note which traits travel with this manager — but never claim a trend, a consistency, or a trait this ' +
        'payload does not contain; a null field means it was not measured, not that the answer is negative.',
    })

    const orchestration = await runUnifiedOrchestration({
      envelope,
      mode: 'consensus',
      options: { timeoutMs: 20_000, maxRetries: 1 },
    })

    let narrative = fallbackNarrative
    let verdict: string | null = null
    let sections:
      | Array<{
          id: string
          title: string
          content: string
          type: 'verdict' | 'evidence' | 'confidence' | 'risks' | 'next_action' | 'alternate' | 'narrative'
        }>
      | undefined
    let factGuardWarnings: string[] | undefined

    if (orchestration.ok) {
      const formatted = formatToolResult({
        toolKey: 'psychological',
        primaryAnswer: orchestration.response.primaryAnswer || fallbackNarrative,
        structured: getStructuredCandidate(orchestration.response),
        envelope,
        factGuardWarnings: orchestration.response.factGuardWarnings,
      })
      const factGuard = validateToolOutput(formatted.output, envelope)
      const warnings = Array.from(
        new Set([
          ...formatted.factGuardWarnings,
          ...factGuard.warnings,
          ...factGuard.errors.map((error) => `Fact guard: ${error}`),
        ])
      )
      narrative = formatted.output.narrative || orchestration.response.primaryAnswer || fallbackNarrative
      verdict = formatted.output.verdict
      sections = formatted.sections
      factGuardWarnings = warnings.length ? warnings : undefined
    }

    return NextResponse.json({
      profileId,
      leagueId,
      narrative,
      verdict,
      sections,
      factGuardWarnings,
      profileLabels: profile.profileLabels,
      evidencePreview: evidencePreview.slice(0, 5),
      // R4b.6 — the structured facts themselves, not just what the narrative chose to mention.
      trajectory: trajectory.hasTrajectory ? trajectory : null,
      crossLeagueConsistency: crossLeaguePayload,
      crossSportConsistency: crossSportPayload,
    })
  } catch (e) {
    console.error('[psychological-profiles/explain POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to explain profile' },
      { status: 500 }
    )
  }
}
