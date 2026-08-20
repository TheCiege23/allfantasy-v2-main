/**
 * POST /api/leagues/[leagueId]/guillotine-war-room/[action]
 *
 * Consolidated dynamic action route for the Guillotine AF War Room. One file serves all POST
 * actions (keeps the Vercel route count low):
 *   - survival-risk   → elimination risk + safety margin
 *   - roster-risk      → weak/low-floor positions + injured starters
 *   - lineup-safety    → high-floor lineup (+ ceiling swing when at risk)
 *   - waivers          → survival-first add/drop
 *   - faab-plan        → conserve vs aggressive FAAB
 *   - dropped-players  → eliminated-team pool ranking
 *   - trade-analyze    → trade verdict (ONLY when trades enabled)
 *   - weekly-plan      → composed survival plan
 *   - ask              → grounded AI answer (AF War Room-gated)
 *
 * Auth: league member or commissioner. A member may only target their OWN roster.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildGuillotineWarRoomContext } from '@/lib/guillotine-war-room/guillotineWarRoomContext'
import { evaluateSurvivalRisk } from '@/lib/guillotine-war-room/guillotineSurvivalRiskEngine'
import { evaluateRosterRisk } from '@/lib/guillotine-war-room/guillotineRosterRiskEngine'
import { evaluateLineupSafety } from '@/lib/guillotine-war-room/guillotineLineupSafetyEngine'
import { buildFaabPlan } from '@/lib/guillotine-war-room/guillotineFaabEngine'
import { buildWaiverRecommendations } from '@/lib/guillotine-war-room/guillotineWaiverEngine'
import { evaluateDroppedPlayers } from '@/lib/guillotine-war-room/guillotineDroppedPlayerEngine'
import { analyzeGuillotineTrade } from '@/lib/guillotine-war-room/guillotineTradeEngine'
import { buildWeeklyPlan } from '@/lib/guillotine-war-room/guillotineWeeklyPlanEngine'
import { GUILLOTINE_WAR_ROOM_SYSTEM_RULES, buildGuillotineWarRoomPrompt } from '@/lib/guillotine-war-room/guillotineWarRoomPrompt'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'
import { openaiChatText } from '@/lib/openai-client'
import type { GuillotineWarRoomContext } from '@/lib/guillotine-war-room/types'
import { recordWarRoomTradeShadow } from '@/lib/decision-os/trade/warRoomShadow'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ACTIONS = new Set([
  'survival-risk',
  'roster-risk',
  'lineup-safety',
  'waivers',
  'faab-plan',
  'dropped-players',
  'trade-analyze',
  'weekly-plan',
  'ask',
])

type Body = {
  rosterId?: string
  outgoingPlayerIds?: string[]
  incomingPlayerIds?: string[]
  question?: string
}

function resolveTargetRoster(
  context: GuillotineWarRoomContext,
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

  const result = await buildGuillotineWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  const context = result.context

  const target = resolveTargetRoster(context, body.rosterId)
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })
  const rosterId = target.rosterId

  switch (action) {
    case 'survival-risk':
      return NextResponse.json({ survival: evaluateSurvivalRisk(context, rosterId) })
    case 'roster-risk':
      return NextResponse.json({ rosterRisk: evaluateRosterRisk(context, rosterId) })
    case 'lineup-safety':
      return NextResponse.json({ lineupSafety: evaluateLineupSafety(context, rosterId) })
    case 'waivers':
      return NextResponse.json({ waivers: buildWaiverRecommendations(context, rosterId) })
    case 'faab-plan':
      return NextResponse.json({ faab: buildFaabPlan(context, rosterId) })
    case 'dropped-players':
      return NextResponse.json({ droppedPlayers: evaluateDroppedPlayers(context, rosterId) })
    case 'trade-analyze': {
      const analysis = analyzeGuillotineTrade(context, {
        rosterId,
        outgoingPlayerIds: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds : [],
        incomingPlayerIds: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds : [],
      })
      // Slice 13 — flip-gate visibility. War rooms produce verdicts entirely
      // outside the canonical stack; recording them is what makes that
      // divergence measurable. Flag-gated, guarded, never affects the response.
      recordWarRoomTradeShadow({
        format: 'guillotine',
        leagueId,
        rosterId,
        outgoingCount: Array.isArray(body.outgoingPlayerIds) ? body.outgoingPlayerIds.length : 0,
        incomingCount: Array.isArray(body.incomingPlayerIds) ? body.incomingPlayerIds.length : 0,
        analysis,
      })
      return NextResponse.json({ tradeAnalysis: analysis })
    }
    case 'weekly-plan':
      return NextResponse.json({ weeklyPlan: buildWeeklyPlan(context, rosterId) })
    case 'ask': {
      const gate = await requireEntitlement('war_room_draft_strategy')
      if (gate instanceof Response) return gate
      const question = String(body.question ?? '').trim()
      if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

      const survival = evaluateSurvivalRisk(context, rosterId)
      const rosterRisk = evaluateRosterRisk(context, rosterId)
      const lineupSafety = evaluateLineupSafety(context, rosterId)
      const faab = buildFaabPlan(context, rosterId)
      const waivers = buildWaiverRecommendations(context, rosterId)
      const droppedPlayers = evaluateDroppedPlayers(context, rosterId)
      const weeklyPlan = buildWeeklyPlan(context, rosterId)
      const prompt = buildGuillotineWarRoomPrompt({ context, survival, rosterRisk, lineupSafety, faab, waivers, droppedPlayers, weeklyPlan, question })

      const ai = await openaiChatText({
        messages: [
          { role: 'system', content: GUILLOTINE_WAR_ROOM_SYSTEM_RULES },
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
          grounding: { survival, rosterRisk, lineupSafety, faab, weeklyPlan, missingDataFlags: context.missingDataFlags },
        })
      }
      return NextResponse.json({ answer: ai.text, aiUnavailable: false, grounding: { missingDataFlags: context.missingDataFlags } })
    }
    default:
      return NextResponse.json({ error: `Unhandled action: ${action}` }, { status: 404 })
  }
}
