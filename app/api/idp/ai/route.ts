import { NextRequest, NextResponse } from 'next/server'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isIdpLeague } from '@/lib/idp'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import { isCommissioner } from '@/lib/commissioner/permissions'
import {
  getDefenderStartSitRec,
  getIDPWaiverTargets,
  getIDPMatchupAnalysis,
  evaluateIDPTrade,
  getWeeklyIDPRankings,
  getSleeperDefenders,
  getSnapShareInsights,
  getIDPScarcityReport,
  generateIDPPowerRankings,
  getIdpPlayerAiAnalysis,
  saveIdpAiPrefs,
  type IdpChimmyPrefs,
} from '@/lib/idp/ai/idpChimmy'
import {
  getCapSpaceAdvice,
  evaluateContractDecision,
  getCapEfficiencyRankings,
  getCapBurdenWarnings,
  identifyTradeTargets,
  getContenderVsRebuildAdvice,
  generateDefenderWeeklyRecap,
  getDefenderEvaluationForPlayer,
} from '@/lib/idp/ai/idpCapChimmy'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Action =
  | 'start_sit'
  | 'waiver_targets'
  | 'matchup_analysis'
  | 'trade_eval'
  | 'rankings'
  | 'sleepers'
  | 'snap_analysis'
  | 'scarcity'
  | 'power_rankings'
  | 'player_analysis'
  | 'defender_eval'
  | 'cap_advice'
  | 'contract_eval'
  | 'cap_efficiency'
  | 'cap_burden'
  | 'trade_targets_cap'
  | 'contender_rebuild'
  | 'weekly_recap'
  | 'ai_prefs'

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (typeof gate !== 'string') return gate
  const userId = gate

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const body: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  const action = body.action as Action | undefined
  const week = typeof body.week === 'number' && Number.isFinite(body.week) ? Math.min(18, Math.max(1, body.week)) : 1

  if (!leagueId || !action) {
    return NextResponse.json({ error: 'leagueId and action required' }, { status: 400 })
  }

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  /*
   * ⚠ IDP AI IS DELIBERATELY OFFLINE — this is a paid surface and its data
   * layer was fabricated: waiver targets from a mock pool of invented "FA
   * Defender N" players, stats from a hash of the player id
   * (lib/idp/ai/idpChimmy.ts buildMockWaiverPool /
   * generateDeterministicWeeklyStatLine), matchup ratings from the same hash.
   * A subscriber paying for advice about nonexistent players is worse than a
   * 503. Re-enable action by action as each is rewired to the real player
   * pool and FantasyStatLine (planned work). ai_prefs stays: it only saves
   * settings.
   */
  if (action !== 'ai_prefs') {
    return NextResponse.json(
      {
        error: 'IDP AI is temporarily offline while we connect it to live defensive stats.',
        code: 'IDP_AI_OFFLINE',
      },
      { status: 503 },
    )
  }

  try {
    switch (action) {
      case 'start_sit': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (managerId !== userId) {
          return NextResponse.json({ error: 'Can only request start/sit for your own roster' }, { status: 403 })
        }
        const data = await getDefenderStartSitRec(leagueId, managerId, week)
        return NextResponse.json(data)
      }
      case 'waiver_targets': {
        const limit = typeof body.limit === 'number' ? Math.min(10, Math.max(1, body.limit)) : 5
        const data = await getIDPWaiverTargets(leagueId, week, limit)
        return NextResponse.json(data)
      }
      case 'matchup_analysis': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (managerId !== userId) {
          return NextResponse.json({ error: 'Can only request your own matchup analysis' }, { status: 403 })
        }
        const data = await getIDPMatchupAnalysis(leagueId, managerId, week)
        return NextResponse.json(data)
      }
      case 'trade_eval': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (managerId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        const offered = Array.isArray(body.offeredPlayers) ? (body.offeredPlayers as string[]) : []
        const received = Array.isArray(body.receivedPlayers) ? (body.receivedPlayers as string[]) : []
        const data = await evaluateIDPTrade(leagueId, managerId, offered, received)
        return NextResponse.json(data)
      }
      case 'rankings': {
        const positionFilter = typeof body.positionFilter === 'string' ? body.positionFilter : undefined
        const data = await getWeeklyIDPRankings(leagueId, week, positionFilter)
        return NextResponse.json(data)
      }
      case 'sleepers': {
        const data = await getSleeperDefenders(leagueId, week)
        return NextResponse.json(data)
      }
      case 'snap_analysis': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (managerId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        const data = await getSnapShareInsights(leagueId, managerId)
        return NextResponse.json(data)
      }
      case 'scarcity': {
        const data = await getIDPScarcityReport(leagueId, week)
        return NextResponse.json(data)
      }
      case 'power_rankings': {
        if (!(await isCommissioner(leagueId, userId))) {
          return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
        }
        const data = await generateIDPPowerRankings(leagueId, week)
        return NextResponse.json(data)
      }
      case 'player_analysis': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (managerId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        const playerId = typeof body.playerId === 'string' ? body.playerId : ''
        if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 })
        const narrative = await getIdpPlayerAiAnalysis(leagueId, managerId, week, playerId)
        return NextResponse.json({ narrative })
      }
      case 'defender_eval': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (managerId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        const playerId = typeof body.playerId === 'string' ? body.playerId : ''
        if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 })
        const data = await getDefenderEvaluationForPlayer(leagueId, managerId, week, playerId)
        return NextResponse.json(data)
      }
      case 'cap_advice': {
        const rosterId = typeof body.rosterId === 'string' ? body.rosterId : ''
        if (!rosterId) return NextResponse.json({ error: 'rosterId required' }, { status: 400 })
        const data = await getCapSpaceAdvice(leagueId, rosterId)
        return NextResponse.json(data)
      }
      case 'contract_eval': {
        const rosterId = typeof body.rosterId === 'string' ? body.rosterId : ''
        const playerId = typeof body.playerId === 'string' ? body.playerId : ''
        const decisionType = body.decisionType as 'cut' | 'extend' | 'tag' | 'hold' | undefined
        if (!rosterId || !playerId || !decisionType) {
          return NextResponse.json({ error: 'rosterId, playerId, decisionType required' }, { status: 400 })
        }
        const data = await evaluateContractDecision(leagueId, rosterId, playerId, decisionType)
        return NextResponse.json(data)
      }
      case 'cap_efficiency': {
        const data = await getCapEfficiencyRankings(leagueId, week)
        return NextResponse.json(data)
      }
      case 'cap_burden': {
        const rosterId = typeof body.rosterId === 'string' ? body.rosterId : ''
        if (!rosterId) return NextResponse.json({ error: 'rosterId required' }, { status: 400 })
        const data = await getCapBurdenWarnings(leagueId, rosterId)
        return NextResponse.json({ warnings: data })
      }
      case 'trade_targets_cap': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (managerId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        const data = await identifyTradeTargets(leagueId, managerId)
        return NextResponse.json(data)
      }
      case 'contender_rebuild': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (managerId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        const data = await getContenderVsRebuildAdvice(leagueId, managerId)
        return NextResponse.json(data)
      }
      case 'weekly_recap': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (managerId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        const data = await generateDefenderWeeklyRecap(leagueId, managerId, week)
        return NextResponse.json(data)
      }
      case 'ai_prefs': {
        const raw = body.prefs
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return NextResponse.json({ error: 'prefs object required' }, { status: 400 })
        }
        const prefs = raw as IdpChimmyPrefs
        await saveIdpAiPrefs(leagueId, userId, prefs)
        return NextResponse.json({ ok: true })
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('Commissioner Subscription')) {
      return NextResponse.json({ error: msg, upgrade: true }, { status: 402 })
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
