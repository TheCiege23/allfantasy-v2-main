/**
 * POST: AI reorder draft queue by roster need and availability.
 *
 * AUDIT:
 * - **Queue storage**: `DraftQueue.order` JSON array (`sessionId` + `userId`). Active path for GET/PUT queue
 *   and autopick (`tryQueueAutoPick` reads `DraftQueue.order` via session include).
 * - **DraftQueueEntry**: Row-based newer UI path — not wired here; this route persists JSON queue only.
 * - **Autopick**: Consumes persisted `DraftQueue.order` order as-is; no AI inference inside autopick.
 * - **AF Pro**: `EntitlementResolver` + feature **`pro_draft_ai`**. Persisted AI reorder requires AF Pro +
 *   **`Roster.settings.aiManageDraftQueueEnabled`** (default false).
 * - **League UI**: `getDraftUISettingsForLeague().aiQueueReorderEnabled` gates optional OpenAI *explanation*
 *   copy only (commissioner-facing); does not replace per-user AF Pro + roster flag for persisting reorder.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'
import {
  dedupeQueueEntries,
  normalizeDraftedNameSet,
  normalizeQueueEntries,
  removeDraftedPlayersFromQueue,
} from '@/lib/draft-queue-engine'
import type { QueueEntry } from '@/lib/live-draft-engine/types'
import { normalizeDraftQueueSizeLimit } from '@/lib/draft-defaults/DraftQueueLimitResolver'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getProviderStatus } from '@/lib/provider-config'
import { openaiChatText } from '@/lib/openai-client'
import {
  buildDraftExecutionMetadata,
  evaluateAIInvocationPolicy,
  withTimeout,
} from '@/lib/draft-automation-policy'
import { getCachedAiResult, saveAiResult } from '@/lib/ai/ai-result-cache'
import { getAiManageDraftQueueEnabled } from '@/lib/live-draft-engine/draftQueueAiPreferences'
import {
  planDraftQueueAiReorder,
  suggestionOnlyExplanation,
} from '@/lib/live-draft-engine/draftQueueAiReorder'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  const wantsAiExplanation = Boolean(body.aiExplanation ?? body.ai_explanation ?? false)
  let queue: QueueEntry[] = Array.isArray(body.queue) ? body.queue : []

  if (queue.length === 0) {
    const draftSessionProbe = await prisma.draftSession.findUnique({
      where: { leagueId },
      select: { id: true },
    })
    if (draftSessionProbe) {
      const row = await prisma.draftQueue.findUnique({
        where: { sessionId_userId: { sessionId: draftSessionProbe.id, userId } },
      })
      const order = (row?.order as unknown as QueueEntry[]) ?? []
      queue = order.filter(Boolean)
    }
  }

  const currentUserRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  const draftSession = await prisma.draftSession.findUnique({
    where: { leagueId },
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!draftSession) {
    return NextResponse.json({ error: 'No draft session' }, { status: 404 })
  }
  const { getDraftConfigForLeague } = await import('@/lib/draft-defaults/DraftRoomConfigResolver')
  const draftConfig = await getDraftConfigForLeague(leagueId)
  const queueSizeLimit = normalizeDraftQueueSizeLimit(draftConfig?.queue_size_limit)
  const normalizedQueue = dedupeQueueEntries(normalizeQueueEntries(queue, queueSizeLimit))
  const draftedNames = normalizeDraftedNameSet(draftSession.picks)
  const cleanedQueue = removeDraftedPlayersFromQueue(normalizedQueue, draftedNames)
  queue = cleanedQueue.queue
  if (queue.length < 2) {
    return NextResponse.json({
      reordered: queue,
      persisted: false,
      explanation: cleanedQueue.removedCount > 0
        ? `Queue has fewer than 2 available players after removing ${cleanedQueue.removedCount} unavailable player${cleanedQueue.removedCount === 1 ? '' : 's'}.`
        : 'Queue has fewer than 2 players; no reorder needed.',
      removedUnavailable: cleanedQueue.removedCount,
    })
  }

  const rosterPositions: string[] = []
  if (draftSession.picks && (currentUserRosterId || userId)) {
    for (const p of draftSession.picks) {
      if (p.rosterId === currentUserRosterId) {
        rosterPositions.push(p.position ?? '')
      }
    }
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })
  const sport = (league?.sport as string) ?? 'NFL'

  const entitlementResolver = new EntitlementResolver()
  const { hasAccess: hasProDraftAi } = await entitlementResolver.resolveForUser(
    userId,
    'pro_draft_ai'
  )

  const rosterPrefs = await prisma.roster.findUnique({
    where: { leagueId_platformUserId: { leagueId, platformUserId: userId } },
    select: { settings: true },
  })
  const aiManageDraftQueueEnabled = getAiManageDraftQueueEnabled(rosterPrefs?.settings)

  const plan = planDraftQueueAiReorder({
    queue,
    rosterPositions,
    sport,
    hasProDraftAiAccess: hasProDraftAi,
    aiManageDraftQueueEnabled,
  })

  if (plan.mode === 'persist' && plan.persistOrder) {
    await prisma.draftQueue.upsert({
      where: { sessionId_userId: { sessionId: draftSession.id, userId } },
      create: {
        sessionId: draftSession.id,
        userId,
        order: plan.persistOrder as never,
      },
      update: {
        order: plan.persistOrder as never,
        updatedAt: new Date(),
      },
    })
  }

  let explanationBase = plan.explanation
  if (plan.mode === 'suggestion_af_pro_required') {
    explanationBase = suggestionOnlyExplanation(plan.explanation, 'af_pro')
  } else if (plan.mode === 'suggestion_ai_manage_disabled') {
    explanationBase = suggestionOnlyExplanation(plan.explanation, 'ai_manage_disabled')
  }

  let explanation = explanationBase
  let aiUsed = false
  let reasonCode = 'deterministic_rules_engine'
  const invocation = evaluateAIInvocationPolicy({
    feature: 'explain_ai_queue_reorder_rationale',
    scopeId: leagueId,
    requestAI: wantsAiExplanation,
    aiEnabled: uiSettings.aiQueueReorderEnabled,
    providerAvailable: getProviderStatus().anyAi,
  })

  const suggestionLead = plan.suggestionOrder

  if (invocation.decision === 'allow_ai') {
    const lead = suggestionLead
      .slice(0, 4)
      .map((entry) => `${entry.playerName} (${entry.position})`)
    const needEntries = Object.entries(plan.needByPosition ?? {}) as Array<[string, number]>
    const needContext = needEntries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([position, score]) => `${position}:${score}`)
      .join(', ')
    const aiCachePayload = {
      sport,
      lead,
      needContext,
      deterministic: explanationBase,
    }

    const cachedExplanation = await getCachedAiResult({
      feature: 'draft_queue_ai_explanation',
      scopeType: 'league',
      scopeId: leagueId,
      payload: aiCachePayload,
    })
    if (cachedExplanation?.resultText && cachedExplanation.resultText.trim().length > 0) {
      explanation = cachedExplanation.resultText.trim()
      aiUsed = true
      reasonCode = 'ai_explanation_db_cache_hit'
    } else {
      const aiResult = await withTimeout(
        openaiChatText({
          messages: [
            {
              role: 'system',
              content:
                'You explain fantasy draft queue reorder outcomes. Keep response to one concise sentence. Never invent players or scores.',
            },
            {
              role: 'user',
              content: [
                `Sport: ${sport}`,
                `Top queue after deterministic reorder: ${lead.join(', ') || 'none'}`,
                `Need scores: ${needContext || 'not available'}`,
                `Deterministic explanation: ${explanationBase}`,
                'Rewrite this as a clear coach-style explanation while preserving the same facts.',
              ].join('\n'),
            },
          ],
          temperature: 0.3,
          maxTokens: 120,
        }),
        invocation.maxLatencyMs
      )

      if (aiResult.ok && aiResult.value.ok && aiResult.value.text.trim().length > 0) {
        explanation = aiResult.value.text.trim()
        aiUsed = true
        reasonCode = 'ai_explanation_applied'
        await saveAiResult({
          feature: 'draft_queue_ai_explanation',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: aiResult.value.model,
          payload: aiCachePayload,
          resultText: explanation,
          resultJson: { explanation },
          ttlSeconds: 5 * 60,
          status: 'ready',
        })
      } else if (!aiResult.ok) {
        reasonCode = 'ai_timeout_deterministic_fallback'
      } else {
        reasonCode = 'ai_unavailable_deterministic_fallback'
      }
    }
  } else {
    reasonCode = invocation.reasonCode
  }

  const execution = buildDraftExecutionMetadata({
    feature: 'draft_queue_reorder_engine',
    aiUsed,
    aiEligible: invocation.canShowAIButton,
    reasonCode,
    fallbackToDeterministic: wantsAiExplanation && !aiUsed && invocation.decision !== 'deny_dead_button',
  })

  const aiMeta = {
    explanationRequested: wantsAiExplanation,
    explanationEnabled: uiSettings.aiQueueReorderEnabled,
    decision: invocation.decision,
    reasonCode: invocation.reasonCode,
    afProDraftAi: hasProDraftAi,
    aiManageDraftQueueEnabled,
    persistMode: plan.mode,
  }

  const common = {
    explanation,
    removedUnavailable: cleanedQueue.removedCount,
    execution,
    ai: aiMeta,
    suggestion: plan.suggestionOrder,
  }

  if (plan.mode === 'suggestion_af_pro_required') {
    return NextResponse.json(
      {
        error: 'AF Pro required to persist AI-adjusted draft queue order.',
        code: 'AF_PRO_REQUIRED',
        persisted: false,
        suggestionOnly: true,
        reordered: plan.displayOrder,
        ...common,
      },
      { status: 403 }
    )
  }

  if (plan.mode === 'suggestion_ai_manage_disabled') {
    return NextResponse.json({
      persisted: false,
      mode: 'suggestion_only',
      message: 'AI queue management is disabled.',
      reordered: plan.displayOrder,
      ...common,
    })
  }

  return NextResponse.json({
    persisted: true,
    reordered: plan.displayOrder,
    ...common,
  })
}
