/**
 * POST /api/leagues/[leagueId]/keeper-war-room/[action]
 *
 * Consolidated dynamic action route for the Keeper AF War Room. One file serves all POST
 * actions (keeps the Vercel route count low):
 *   - keeper-recommendations → best keep set within the keeper limit
 *   - cut-list               → who to cut / not keep
 *   - draft-plan             → draft plan after keepers (consumed/remaining rounds)
 *   - roster-needs           → roster needs after keepers
 *   - waivers                → in-season add/drop (when active)
 *   - lineup                 → in-season start/sit (when active)
 *   - trade-analyze          → keeper-cost-aware trade verdict
 *   - trade-find             → keeper-surplus partner fit
 *   - ask                    → grounded AI answer (AF War Room-gated)
 *
 * Auth: league member or commissioner. A member may only target their OWN roster.
 * A commissioner may pass `rosterId` to target any roster. Routes degrade safely
 * (limited-data states) instead of fabricating keeper costs or values.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildKeeperWarRoomContext } from '@/lib/keeper-war-room/keeperWarRoomContext'
import { recommendKeepers } from '@/lib/keeper-war-room/keeperRecommendationEngine'
import { buildKeeperCutList } from '@/lib/keeper-war-room/keeperCutListEngine'
import { evaluateKeeperRosterNeeds } from '@/lib/keeper-war-room/keeperRosterNeedsEngine'
import { buildKeeperDraftPlan } from '@/lib/keeper-war-room/keeperDraftPlanEngine'
import { buildKeeperWaiverRecommendations } from '@/lib/keeper-war-room/keeperWaiverEngine'
import { buildKeeperLineupRecommendation } from '@/lib/keeper-war-room/keeperLineupEngine'
import { analyzeKeeperTrade } from '@/lib/keeper-war-room/keeperTradeEngine'
import { findKeeperTradeTargets } from '@/lib/keeper-war-room/keeperTradeFinderEngine'
import { KEEPER_WAR_ROOM_SYSTEM_RULES, buildKeeperWarRoomPrompt } from '@/lib/keeper-war-room/keeperWarRoomPrompt'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'
import { openaiChatText } from '@/lib/openai-client'
import type { KeeperWarRoomContext } from '@/lib/keeper-war-room/types'
import { recordWarRoomTradeShadow } from '@/lib/decision-os/trade/warRoomShadow'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ACTIONS = new Set([
  'keeper-recommendations',
  'cut-list',
  'draft-plan',
  'roster-needs',
  'waivers',
  'lineup',
  'trade-analyze',
  'trade-find',
  'ask',
])

type Body = {
  rosterId?: string
  outgoingPlayerIds?: string[]
  incomingPlayerIds?: string[]
  question?: string
}

function resolveTargetRoster(
  context: KeeperWarRoomContext,
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

  const result = await buildKeeperWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  const context = result.context

  const target = resolveTargetRoster(context, body.rosterId)
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })
  const rosterId = target.rosterId

  switch (action) {
    case 'keeper-recommendations':
      return NextResponse.json({ recommendations: recommendKeepers(context, rosterId) })

    case 'cut-list':
      return NextResponse.json({ cutList: buildKeeperCutList(context, rosterId) })

    case 'roster-needs':
      return NextResponse.json({ needs: evaluateKeeperRosterNeeds(context, rosterId) })

    case 'draft-plan':
      return NextResponse.json({ draftPlan: buildKeeperDraftPlan(context, rosterId) })

    case 'waivers':
      return NextResponse.json({ waivers: buildKeeperWaiverRecommendations(context, rosterId) })

    case 'lineup':
      return NextResponse.json({ lineup: buildKeeperLineupRecommendation(context, rosterId) })

    case 'trade-analyze': {
      const analysis = analyzeKeeperTrade(context, {
        rosterId,
        outgoingPlayerIds: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds : [],
        incomingPlayerIds: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds : [],
      })
      // Slice 13 — flip-gate visibility. War rooms produce verdicts entirely
      // outside the canonical stack; recording them is what makes that
      // divergence measurable. Flag-gated, guarded, never affects the response.
      recordWarRoomTradeShadow({
        format: 'keeper',
        leagueId,
        rosterId,
        outgoingCount: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds.length : 0,
        incomingCount: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds.length : 0,
        analysis,
      })
      return NextResponse.json({ tradeAnalysis: analysis })
    }

    case 'trade-find':
      return NextResponse.json({ tradeFinder: findKeeperTradeTargets(context, rosterId) })

    case 'ask': {
      const gate = await requireEntitlement('war_room_draft_strategy')
      if (gate instanceof Response) return gate

      const question = String(body.question ?? '').trim()
      if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

      const recommendations = recommendKeepers(context, rosterId)
      const cutList = buildKeeperCutList(context, rosterId)
      const needs = evaluateKeeperRosterNeeds(context, rosterId)
      const draftPlan = buildKeeperDraftPlan(context, rosterId)
      const prompt = buildKeeperWarRoomPrompt({ context, recommendations, cutList, needs, draftPlan, question })

      const ai = await openaiChatText({
        messages: [
          { role: 'system', content: KEEPER_WAR_ROOM_SYSTEM_RULES },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        maxTokens: 700,
      })

      if (!ai.ok) {
        return NextResponse.json({
          answer: null,
          aiUnavailable: true,
          detail: ai.details,
          grounding: { recommendations, cutList, needs, draftPlan, missingDataFlags: context.missingDataFlags },
        })
      }

      return NextResponse.json({ answer: ai.text, aiUnavailable: false, grounding: { missingDataFlags: context.missingDataFlags } })
    }

    default:
      return NextResponse.json({ error: `Unhandled action: ${action}` }, { status: 404 })
  }
}
