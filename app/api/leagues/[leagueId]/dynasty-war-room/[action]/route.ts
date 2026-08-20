/**
 * POST /api/leagues/[leagueId]/dynasty-war-room/[action]
 *
 * Consolidated dynamic action route for the Dynasty AF War Room. One file serves
 * all POST actions (keeps the Vercel route count low):
 *   - team-direction → deterministic contention window (contend/rebuild/middle)
 *   - buy-sell-hold  → deterministic per-player asset calls (value + age + window)
 *   - waivers        → deterministic add/drop (dynasty value + age weighted)
 *   - lineup         → deterministic value-ranked start/sit (low confidence, honest)
 *   - trade-analyze  → deterministic, age-adjusted trade verdict
 *   - trade-find     → deterministic partner fit (needs + contention windows)
 *   - ask            → grounded AI answer over deterministic facts (AF War Room-gated)
 *
 * Auth: league member or commissioner. A member may only target their OWN roster.
 * A commissioner may pass `rosterId` to target any roster in the league.
 * Routes degrade safely (data-unavailable states) instead of fabricating values.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildDynastyWarRoomContext } from '@/lib/dynasty-war-room/dynastyWarRoomContext'
import { evaluateDynastyTeamNeeds } from '@/lib/dynasty-war-room/dynastyRosterNeedsEngine'
import { evaluateDynastyTeamDirection } from '@/lib/dynasty-war-room/dynastyTeamDirectionEngine'
import { evaluateBuySellHold } from '@/lib/dynasty-war-room/dynastyBuySellHoldEngine'
import { buildDynastyLineupRecommendation } from '@/lib/dynasty-war-room/dynastyLineupEngine'
import { buildDynastyWaiverRecommendations } from '@/lib/dynasty-war-room/dynastyWaiverEngine'
import { analyzeDynastyTrade, findDynastyTradeTargets } from '@/lib/dynasty-war-room/dynastyTradeEngine'
import {
  DYNASTY_WAR_ROOM_SYSTEM_RULES,
  buildDynastyWarRoomPrompt,
} from '@/lib/dynasty-war-room/dynastyWarRoomPrompt'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'
import { openaiChatText } from '@/lib/openai-client'
import type { DynastyWarRoomContext } from '@/lib/dynasty-war-room/types'
import { recordWarRoomTradeShadow } from '@/lib/decision-os/trade/warRoomShadow'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ACTIONS = new Set([
  'team-direction',
  'buy-sell-hold',
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
  outgoingPickIds?: string[]
  incomingPickIds?: string[]
  question?: string
}

/** Resolve the roster the action targets, enforcing member-vs-commissioner scope. */
function resolveTargetRoster(
  context: DynastyWarRoomContext,
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

  const result = await buildDynastyWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  const context = result.context

  const target = resolveTargetRoster(context, body.rosterId)
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })
  const rosterId = target.rosterId

  switch (action) {
    case 'team-direction':
      return NextResponse.json({ direction: evaluateDynastyTeamDirection(context, rosterId) })

    case 'buy-sell-hold':
      return NextResponse.json({ buySellHold: evaluateBuySellHold(context, rosterId) })

    case 'waivers':
      return NextResponse.json({ waivers: buildDynastyWaiverRecommendations(context, rosterId) })

    case 'lineup':
      return NextResponse.json({ lineup: buildDynastyLineupRecommendation(context, rosterId) })

    case 'trade-analyze': {
      const analysis = analyzeDynastyTrade(context, {
        rosterId,
        outgoingPlayerIds: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds : [],
        incomingPlayerIds: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds : [],
        outgoingPickIds: Array.isArray(body.outgoingPickIds) ? body.outgoingPickIds : [],
        incomingPickIds: Array.isArray(body.incomingPickIds) ? body.incomingPickIds : [],
      })
      // Slice 13 — flip-gate visibility. War rooms produce verdicts entirely
      // outside the canonical stack; recording them is what makes that
      // divergence measurable. Flag-gated, guarded, never affects the response.
      recordWarRoomTradeShadow({
        format: 'dynasty',
        leagueId,
        rosterId,
        outgoingCount: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds.length : 0,
        incomingCount: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds.length : 0,
        analysis,
      })
      return NextResponse.json({ tradeAnalysis: analysis })
    }

    case 'trade-find':
      return NextResponse.json({ tradeFinder: findDynastyTradeTargets(context, rosterId) })

    case 'ask': {
      const gate = await requireEntitlement('war_room_draft_strategy')
      if (gate instanceof Response) return gate

      const question = String(body.question ?? '').trim()
      if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

      // Ground the prompt with the deterministic engines relevant to most questions.
      const direction = evaluateDynastyTeamDirection(context, rosterId)
      const needs = evaluateDynastyTeamNeeds(context, rosterId)
      const buySellHold = evaluateBuySellHold(context, rosterId)
      const waivers = buildDynastyWaiverRecommendations(context, rosterId)
      const prompt = buildDynastyWarRoomPrompt({ context, direction, needs, buySellHold, waivers, question })

      const ai = await openaiChatText({
        messages: [
          { role: 'system', content: DYNASTY_WAR_ROOM_SYSTEM_RULES },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        maxTokens: 700,
      })

      if (!ai.ok) {
        // Degrade gracefully: return deterministic facts so the UI is never empty.
        return NextResponse.json({
          answer: null,
          aiUnavailable: true,
          detail: ai.details,
          grounding: { direction, needs, buySellHold, waivers, missingDataFlags: context.missingDataFlags },
        })
      }

      return NextResponse.json({
        answer: ai.text,
        aiUnavailable: false,
        grounding: { missingDataFlags: context.missingDataFlags },
      })
    }

    default:
      return NextResponse.json({ error: `Unhandled action: ${action}` }, { status: 404 })
  }
}
