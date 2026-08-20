/**
 * POST /api/leagues/[leagueId]/best-ball-war-room/[action]
 *
 * Consolidated dynamic action route for the Best Ball AF War Room. One file serves all POST
 * actions (keeps the Vercel route count low):
 *   - roster-construction → positional build grade
 *   - depth               → depth + fragile positions
 *   - upside              → spike-week ceiling ranking
 *   - draft-plan          → positional draft targets
 *   - stacks              → same-team stack/correlation + bye clusters
 *   - risk                → aggregate construction risk
 *   - waivers             → add/drop (ONLY when the league enables waivers)
 *   - trade-analyze       → trade verdict (ONLY when trades enabled)
 *   - trade-find          → trade partner fit (ONLY when trades enabled)
 *   - ask                 → grounded AI answer (AF War Room-gated)
 *
 * Best ball has an AUTOMATIC lineup — there is NO start/sit action.
 * Auth: league member or commissioner. A member may only target their OWN roster.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildBestBallWarRoomContext } from '@/lib/best-ball-war-room/bestBallWarRoomContext'
import { evaluateRosterConstruction } from '@/lib/best-ball-war-room/bestBallRosterConstructionEngine'
import { evaluateDepth } from '@/lib/best-ball-war-room/bestBallDepthEngine'
import { evaluateUpside } from '@/lib/best-ball-war-room/bestBallUpsideEngine'
import { buildBestBallDraftPlan } from '@/lib/best-ball-war-room/bestBallDraftPlanEngine'
import { evaluateStacks } from '@/lib/best-ball-war-room/bestBallStackCorrelationEngine'
import { evaluateRisk } from '@/lib/best-ball-war-room/bestBallRiskEngine'
import { buildBestBallWaiverRecommendations } from '@/lib/best-ball-war-room/bestBallWaiverEngine'
import { analyzeBestBallTrade, findBestBallTradeTargets } from '@/lib/best-ball-war-room/bestBallTradeEngine'
import { BEST_BALL_WAR_ROOM_SYSTEM_RULES, buildBestBallWarRoomPrompt } from '@/lib/best-ball-war-room/bestBallWarRoomPrompt'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'
import { openaiChatText } from '@/lib/openai-client'
import type { BestBallWarRoomContext } from '@/lib/best-ball-war-room/types'
import { recordWarRoomTradeShadow } from '@/lib/decision-os/trade/warRoomShadow'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ACTIONS = new Set([
  'roster-construction',
  'depth',
  'upside',
  'draft-plan',
  'stacks',
  'risk',
  'waivers',
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
  context: BestBallWarRoomContext,
  requested: string | undefined,
): { ok: true; rosterId: string } | { ok: false; status: 400 | 403; error: string } {
  if (requested && requested !== context.userRosterId) {
    if (!context.isCommissioner) return { ok: false, status: 403, error: 'Members can only request analysis for their own team.' }
    if (!context.teams.some((t) => t.rosterId === requested)) return { ok: false, status: 400, error: 'Unknown rosterId for this league.' }
    return { ok: true, rosterId: requested }
  }
  if (!context.userRosterId) return { ok: false, status: 400, error: 'No team for this user; pass a rosterId (commissioner only).' }
  return { ok: true, rosterId: context.userRosterId }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; action: string }> },
) {
  const { leagueId, action } = await params
  if (!ACTIONS.has(action)) return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 404 })

  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    body = {}
  }

  const result = await buildBestBallWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  const context = result.context

  const target = resolveTargetRoster(context, body.rosterId)
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })
  const rosterId = target.rosterId

  switch (action) {
    case 'roster-construction':
      return NextResponse.json({ construction: evaluateRosterConstruction(context, rosterId) })
    case 'depth':
      return NextResponse.json({ depth: evaluateDepth(context, rosterId) })
    case 'upside':
      return NextResponse.json({ upside: evaluateUpside(context, rosterId) })
    case 'draft-plan':
      return NextResponse.json({ draftPlan: buildBestBallDraftPlan(context, rosterId) })
    case 'stacks':
      return NextResponse.json({ stacks: evaluateStacks(context, rosterId) })
    case 'risk':
      return NextResponse.json({ risk: evaluateRisk(context, rosterId) })
    case 'waivers':
      return NextResponse.json({ waivers: buildBestBallWaiverRecommendations(context, rosterId) })
    case 'trade-analyze': {
      const analysis = analyzeBestBallTrade(context, {
        rosterId,
        outgoingPlayerIds: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds : [],
        incomingPlayerIds: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds : [],
      })
      // Slice 13 — flip-gate visibility. War rooms produce verdicts entirely
      // outside the canonical stack; recording them is what makes that
      // divergence measurable. Flag-gated, guarded, never affects the response.
      recordWarRoomTradeShadow({
        format: 'bestball',
        leagueId,
        rosterId,
        outgoingCount: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds.length : 0,
        incomingCount: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds.length : 0,
        analysis,
      })
      return NextResponse.json({ tradeAnalysis: analysis })
    }
    case 'trade-find':
      return NextResponse.json({ tradeFinder: findBestBallTradeTargets(context, rosterId) })
    case 'ask': {
      const gate = await requireEntitlement('war_room_draft_strategy')
      if (gate instanceof Response) return gate
      const question = String(body.question ?? '').trim()
      if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

      const construction = evaluateRosterConstruction(context, rosterId)
      const depth = evaluateDepth(context, rosterId)
      const upside = evaluateUpside(context, rosterId)
      const draftPlan = buildBestBallDraftPlan(context, rosterId)
      const stacks = evaluateStacks(context, rosterId)
      const prompt = buildBestBallWarRoomPrompt({ context, construction, depth, upside, draftPlan, stacks, question })

      const ai = await openaiChatText({
        messages: [
          { role: 'system', content: BEST_BALL_WAR_ROOM_SYSTEM_RULES },
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
          grounding: { construction, depth, upside, draftPlan, stacks, missingDataFlags: context.missingDataFlags },
        })
      }
      return NextResponse.json({ answer: ai.text, aiUnavailable: false, grounding: { missingDataFlags: context.missingDataFlags } })
    }
    default:
      return NextResponse.json({ error: `Unhandled action: ${action}` }, { status: 404 })
  }
}
