import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { assertLeagueMember } from '@/lib/league-access'
import {
  buildPremiumLineupDecision,
  explainLineupDecisionEngine,
  type PremiumLineupDecisionInput,
  type PremiumPlayerInput,
} from '@/lib/lineup-decision-engine'
import {
  explainOptimizedLineup,
  optimizeLineupDeterministic,
  type OptimizerPlayerInput,
  type OptimizerSlotInput,
} from '@/lib/lineup-optimizer-engine'
import {
  loadUserLineupPreferenceProfile,
  mergeLearnedWithRequestPreferences,
} from '@/lib/lineup-preference-learning/persistence'

export const dynamic = 'force-dynamic'

type OptimizeLineupBody = {
  leagueId?: string
  sport?: string
  useAIExplanation?: boolean
  /** When false, skip premium JSON / Weekly Start Score pipeline (projection-only optimizer). */
  premiumDecisionEngine?: boolean
  lineupMode?: PremiumLineupDecisionInput['lineupMode']
  teamContext?: PremiumLineupDecisionInput['teamContext']
  leagueContext?: PremiumLineupDecisionInput['leagueContext']
  preferenceProfile?: PremiumLineupDecisionInput['preferenceProfile']
  /** When true (default), merge stored learned preferences with `preferenceProfile` (request overrides). */
  useLearnedLineupPreferences?: boolean
  autoSubEnabled?: boolean
  players?: Array<{
    id?: string
    name?: string
    team?: string
    projectedPoints?: number
    positions?: string[]
    position?: string
    injuryStatus?: string
    projectionScore?: number
    matchupScore?: number
    usageOpportunityScore?: number
    roleSecurityScore?: number
    recentFormScore?: number
    healthAvailabilityScore?: number
    ceilingScore?: number
    floorScore?: number
    scheduleEnvironmentScore?: number
    floorProjection?: number
    ceilingProjection?: number
    isVeteran?: boolean
    isRookie?: boolean
    byeWeek?: boolean
    willNotPlayConfirmed?: boolean
  }>
  slots?: OptimizerSlotInput[]
  rosterSlots?: string[]
}

function normalizePlayers(body: OptimizeLineupBody): OptimizerPlayerInput[] {
  return normalizePremiumPlayers(body).map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    projectedPoints: p.projectedPoints,
    positions: p.positions,
  }))
}

function normalizePremiumPlayers(body: OptimizeLineupBody): PremiumPlayerInput[] {
  return (body.players ?? [])
    .map((player) => {
      const positions = Array.isArray(player.positions) ? [...player.positions] : []
      if (player.position) positions.push(player.position)
      const base: PremiumPlayerInput = {
        id: player.id,
        name: String(player.name ?? '').trim(),
        team: player.team,
        projectedPoints: Number(player.projectedPoints ?? 0),
        positions,
        injuryStatus: player.injuryStatus,
        projectionScore: player.projectionScore,
        matchupScore: player.matchupScore,
        usageOpportunityScore: player.usageOpportunityScore,
        roleSecurityScore: player.roleSecurityScore,
        recentFormScore: player.recentFormScore,
        healthAvailabilityScore: player.healthAvailabilityScore,
        ceilingScore: player.ceilingScore,
        floorScore: player.floorScore,
        scheduleEnvironmentScore: player.scheduleEnvironmentScore,
        floorProjection: player.floorProjection,
        ceilingProjection: player.ceilingProjection,
        isVeteran: player.isVeteran,
        isRookie: player.isRookie,
        byeWeek: player.byeWeek,
        willNotPlayConfirmed: player.willNotPlayConfirmed,
      }
      return base
    })
    .filter((player) => player.name.length > 0)
}

function normalizeSlots(body: OptimizeLineupBody): OptimizerSlotInput[] | undefined {
  if (Array.isArray(body.slots) && body.slots.length > 0) return body.slots
  if (Array.isArray(body.rosterSlots) && body.rosterSlots.length > 0) {
    return body.rosterSlots.map((slotCode, index) => ({
      id: `${slotCode}-${index + 1}`,
      code: slotCode,
    }))
  }
  return undefined
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as
    | { user?: { id?: string } }
    | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Plan gate before any rate-limit spend or AI call: `pro_lineup_optimizer` (lib/monetization/entitlements.ts).
  const gate = await requireFeatureEntitlement({ userId: session.user.id, userEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null, featureId: 'pro_lineup_optimizer' })
  if (!gate.ok) return gate.response

  let body: OptimizeLineupBody
  try {
    body = (await req.json()) as OptimizeLineupBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.leagueId) {
    try {
      await assertLeagueMember(body.leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const premiumPlayers = normalizePremiumPlayers(body)
  if (premiumPlayers.length === 0) {
    return NextResponse.json(
      { error: 'players must include at least one valid player row' },
      { status: 400 }
    )
  }

  try {
    const usePremium = body.premiumDecisionEngine !== false

    if (!usePremium) {
      const result = optimizeLineupDeterministic({
        sport: body.sport,
        players: normalizePlayers(body),
        slots: normalizeSlots(body),
      })
      const explanation = await explainOptimizedLineup({
        result,
        useAI: Boolean(body.useAIExplanation),
      })
      return NextResponse.json({
        ok: true,
        deterministic: true,
        result,
        explanation,
        decisionEngine: null,
        decisionExplanation: null,
      })
    }

    let preferenceProfile = body.preferenceProfile
    if (body.useLearnedLineupPreferences !== false) {
      try {
        const learned = await loadUserLineupPreferenceProfile(session.user.id)
        preferenceProfile = mergeLearnedWithRequestPreferences(
          learned.optimizerProfileInput,
          body.preferenceProfile
        )
      } catch (learnErr) {
        console.warn('[lineup/optimize] learned lineup preferences skipped', learnErr)
      }
    }

    const premium = buildPremiumLineupDecision({
      sport: body.sport,
      lineupMode: body.lineupMode,
      players: premiumPlayers,
      slots: normalizeSlots(body),
      teamContext: body.teamContext,
      leagueContext: body.leagueContext,
      preferenceProfile,
      autoSubEnabled: body.autoSubEnabled,
    })

    const explanation = await explainOptimizedLineup({
      result: premium.legacyResult,
      useAI: Boolean(body.useAIExplanation),
    })

    const decisionExplanation = await explainLineupDecisionEngine({
      json: premium.json,
      useAI: Boolean(body.useAIExplanation),
    })

    return NextResponse.json({
      ok: true,
      deterministic: true,
      result: premium.legacyResult,
      explanation,
      decisionEngine: premium.json,
      decisionExplanation: {
        summary: decisionExplanation.summary,
        bullets: decisionExplanation.bullets,
        source: decisionExplanation.source,
      },
    })
  } catch (error) {
    console.error('[lineup/optimize]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to optimize lineup' },
      { status: 500 }
    )
  }
}
