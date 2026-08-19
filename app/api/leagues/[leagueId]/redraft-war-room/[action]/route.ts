/**
 * POST /api/leagues/[leagueId]/redraft-war-room/[action]
 *
 * Consolidated dynamic action route for the Redraft AF War Room. One file serves
 * all POST actions (keeps the Vercel route count low):
 *   - waivers        → deterministic add/drop recommendations
 *   - lineup         → deterministic start/sit
 *   - trade-analyze  → deterministic trade verdict (body: outgoingPlayerIds, incomingPlayerIds)
 *   - trade-find     → deterministic partner fit
 *   - ask            -> grounded AI answer over deterministic facts (AF War Room-gated)
 *
 * Auth: league member or commissioner. A member may only target their OWN roster.
 * A commissioner may pass `rosterId` to target any roster in the league.
 * Routes degrade safely (data-unavailable states) instead of fabricating values.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildRedraftWarRoomContext } from '@/lib/redraft-war-room/redraftWarRoomContext'
import { evaluateTeamNeeds } from '@/lib/redraft-war-room/redraftTeamNeedsEngine'
import { buildLineupRecommendation } from '@/lib/redraft-war-room/redraftLineupEngine'
import { buildWaiverRecommendations } from '@/lib/redraft-war-room/redraftWaiverEngine'
import { analyzeTrade, findTradeTargets } from '@/lib/redraft-war-room/redraftTradeEngine'
import {
  REDRAFT_WAR_ROOM_SYSTEM_RULES,
  buildRedraftWarRoomPrompt,
} from '@/lib/redraft-war-room/redraftWarRoomPrompt'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'
import { openaiChatText } from '@/lib/openai-client'
import { classifyRedraftQuestionForModel, selectOpenAIModelForIntent } from '@/lib/ai/modelRouting'
import type { RedraftWarRoomContext } from '@/lib/redraft-war-room/types'
import { recordWarRoomTradeShadow } from '@/lib/decision-os/trade/warRoomShadow'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ACTIONS = new Set(['waivers', 'lineup', 'trade-analyze', 'trade-find', 'ask'])

type Body = {
  rosterId?: string
  outgoingPlayerIds?: string[]
  incomingPlayerIds?: string[]
  question?: string
}

/** Resolve the roster the action targets, enforcing member-vs-commissioner scope. */
function resolveTargetRoster(
  context: RedraftWarRoomContext,
  requested: string | undefined,
): { ok: true; rosterId: string } | { ok: false; status: 400 | 403; error: string } {
  if (requested && requested !== context.userRosterId) {
    if (!context.isCommissioner) {
      return { ok: false, status: 403, error: 'Members can only request recommendations for their own team.' }
    }
    const exists = context.teams.some((t) => t.rosterId === requested)
    if (!exists) return { ok: false, status: 400, error: 'Unknown rosterId for this league.' }
    return { ok: true, rosterId: requested }
  }
  if (!context.userRosterId) {
    return { ok: false, status: 400, error: 'No team for this user; pass a rosterId (commissioner only).' }
  }
  return { ok: true, rosterId: context.userRosterId }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; action: string }> },
) {
  const { leagueId, action } = await params
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 404 })
  }

  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    body = {}
  }

  const result = await buildRedraftWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  const context = result.context

  const target = resolveTargetRoster(context, body.rosterId)
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })
  const rosterId = target.rosterId

  switch (action) {
    case 'waivers':
      return NextResponse.json({ waivers: buildWaiverRecommendations(context, rosterId) })

    case 'lineup':
      return NextResponse.json({ lineup: buildLineupRecommendation(context, rosterId) })

    case 'trade-analyze': {
      const analysis = analyzeTrade(context, {
        rosterId,
        outgoingPlayerIds: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds : [],
        incomingPlayerIds: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds : [],
      })
      // Slice 13 — flip-gate visibility. War rooms produce verdicts entirely
      // outside the canonical stack; recording them is what makes that
      // divergence measurable. Flag-gated, guarded, never affects the response.
      recordWarRoomTradeShadow({
        format: 'redraft',
        leagueId,
        rosterId,
        outgoingCount: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds.length : 0,
        incomingCount: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds.length : 0,
        analysis,
      })
      return NextResponse.json({ tradeAnalysis: analysis })
    }

    case 'trade-find':
      return NextResponse.json({ tradeFinder: findTradeTargets(context, rosterId) })

    case 'ask': {
      const gate = await requireEntitlement('war_room_draft_strategy')
      if (gate instanceof Response) return gate

      const question = String(body.question ?? '').trim()
      if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

      // Ground the prompt with the deterministic engines relevant to most questions.
      const needs = evaluateTeamNeeds(context, rosterId)
      const lineup = buildLineupRecommendation(context, rosterId)
      const waivers = buildWaiverRecommendations(context, rosterId)
      const prompt = buildRedraftWarRoomPrompt({ context, needs, lineup, waivers, question })
      const modelRoute = selectOpenAIModelForIntent(classifyRedraftQuestionForModel(question))

      const ai = await openaiChatText({
        messages: [
          { role: 'system', content: REDRAFT_WAR_ROOM_SYSTEM_RULES },
          { role: 'user', content: prompt },
        ],
        model: modelRoute.model ?? undefined,
        temperature: 0.4,
        maxTokens: 700,
      })

      if (!ai.ok) {
        // Degrade gracefully: return deterministic facts so the UI is never empty.
        return NextResponse.json({
          answer: null,
          aiUnavailable: true,
          detail: ai.details,
          grounding: { needs, lineup, waivers, missingDataFlags: context.missingDataFlags, modelRoute },
        })
      }

      return NextResponse.json({
        answer: ai.text,
        aiUnavailable: false,
        grounding: { missingDataFlags: context.missingDataFlags, modelRoute },
      })
    }

    default:
      return NextResponse.json({ error: `Unhandled action: ${action}` }, { status: 404 })
  }
}
