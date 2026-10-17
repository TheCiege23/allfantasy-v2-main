import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { requireAuthOrOrigin, forbiddenResponse } from '@/lib/api-auth'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { z } from 'zod'
import { getCalibratedWeights } from '@/lib/trade-engine/accept-calibration'
import { generateGoalProposals, type GoalProposal, type ProposalGoal } from '@/lib/trade-engine/goal-proposal-engine'
import { buildLeagueDecisionContext, leagueContextToIntelligence } from '@/lib/trade-engine/league-context-assembler'
import type { Asset } from '@/lib/trade-engine/types'
import { createLegacyPackageGrader, legacySessionUserId } from '@/lib/legacy/legacyOneGrade'
import { gradeInputsFromEngineAssets, type LegacyPackageGrade } from '@/lib/legacy/legacyPackageGrade'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/*
 * 🛑 EVERY GOAL PROPOSAL CARRIES THE ONE TRADE GRADE (2026-09-29).
 *
 * The goal engine (`lib/trade-engine/goal-proposal-engine.ts`) still BUILDS the packages — partners
 * chosen for the goal, packages matched on its own values. It used to also be the JUDGE: each card
 * printed the engine's fairness score and an acceptance percentage, "Key Drivers" of that acceptance,
 * sweeteners and a counter path priced in acceptance points, both sides' private value totals, and a
 * tier named "Aggressive — You Win". None of that was the letter the full analyzer gives the deal.
 *
 * Now each shown package is graded by the one grader, from your side (you send `give`), and the card
 * carries only that grade beside the package and the message copy. Tier names say how a package was
 * BUILT. No acceptance odds: nothing measured them.
 */
export const GOAL_TIER_LABELS: Record<GoalProposal['tier'], string> = {
  safe: 'Value-matched package',
  aggressive: 'Value-seeking package',
  creative: 'Multi-asset package',
}

/** An asset as the card shows it: what it is, never the engine's private value. */
function shownAsset(a: Asset) {
  return {
    id: a.id,
    rosterPlayerId: a.rosterPlayerId,
    type: a.type,
    name: a.name ?? a.displayName,
    displayName: a.displayName,
    pos: a.pos,
    team: a.team,
    pickSeason: a.pickSeason,
    round: a.round,
  }
}

const VALID_GOALS: ProposalGoal[] = [
  'rb_depth', 'wr_depth', 'qb_upgrade', 'te_upgrade',
  'get_younger_rb', 'get_younger_wr', 'acquire_picks',
  'win_now', 'rebuild',
]

const RequestSchema = z.object({
  leagueId: z.string().min(1),
  username: z.string().min(1),
  goal: z.string().refine(g => VALID_GOALS.includes(g as ProposalGoal), 'Invalid goal'),
  sport: z.enum(['nfl']).default('nfl'),
})

export const POST = withApiUsage({ endpoint: "/api/legacy/trade/goal-proposals", tool: "LegacyTradeGoalProposals" })(async (req: NextRequest) => {
  const authResult = requireAuthOrOrigin(req)
  if (!authResult.authenticated) return forbiddenResponse(authResult.error || 'Unauthorized')

  const ip = getClientIp(req)
  const rl = consumeRateLimit({
    scope: 'legacy',
    action: 'goal_proposals',
    ip,
    maxRequests: 8,
    windowMs: 60_000,
    includeIpInKey: true,
  })
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before generating more proposals.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  try {
    const body = await req.json()
    const parsed = RequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    }

    const { leagueId, username, goal } = parsed.data

    const leagueCtx = await buildLeagueDecisionContext({ leagueId, username })
    const { intelligence, parsedRosters } = leagueContextToIntelligence(leagueCtx)

    const userTeam = leagueCtx.teams.find(t =>
      t.userId?.toLowerCase() === username.toLowerCase()
    )
    const userRoster = (userTeam
      ? parsedRosters.find(r => String(r.rosterId) === userTeam.teamId)
      : null
    ) || parsedRosters.find(r => {
      const profileName = (intelligence.managerProfiles[r.rosterId]?.displayName || '').toLowerCase()
      return profileName === username.toLowerCase()
    }) || parsedRosters.find(r => {
      const profile = intelligence.managerProfiles[r.rosterId]
      return profile?.username?.toLowerCase() === username.toLowerCase()
    })

    if (!userRoster) {
      return NextResponse.json({ error: 'Could not find your roster in this league' }, { status: 404 })
    }

    const calWeights = await getCalibratedWeights()

    const result = generateGoalProposals(
      userRoster.rosterId,
      goal as ProposalGoal,
      intelligence,
      { maxPartners: 3, calibratedWeights: calWeights },
    )

    // THE grade of every shown package, from your side (you send `give`). One league load for all.
    const gradeOf = await createLegacyPackageGrader({
      suppliedLeagueId: leagueId,
      userId: await legacySessionUserId(),
      viewerSide: false,
    })
    const partners = await Promise.all(
      result.partners.map(async (partner) => ({
        rosterId: partner.rosterId,
        displayName: partner.displayName,
        avatar: partner.avatar,
        record: partner.record,
        contenderTier: partner.contenderTier,
        matchReasons: partner.matchReasons,
        proposals: await Promise.all(
          partner.proposals.map(async (p) => {
            const grade: LegacyPackageGrade = await gradeOf(gradeInputsFromEngineAssets(p.give), gradeInputsFromEngineAssets(p.receive))
            return {
              tier: p.tier,
              tierLabel: GOAL_TIER_LABELS[p.tier] ?? 'Package',
              give: p.give.map(shownAsset),
              receive: p.receive.map(shownAsset),
              grade,
              dmCopy: p.dmCopy,
            }
          }),
        ),
      })),
    )

    return NextResponse.json({
      success: true,
      goal: result.goal,
      goalDescription: result.goalDescription,
      partners,
      stats: result.stats,
      leagueInfo: {
        name: leagueCtx.leagueConfig.name,
        type: 'Dynasty',
        teams: leagueCtx.leagueConfig.numTeams,
        scoring: leagueCtx.leagueConfig.scoringType,
      },
      userInfo: {
        name: userRoster.displayName,
        record: userRoster.record ? `${userRoster.record.wins}-${userRoster.record.losses}` : '0-0',
        rosterId: userRoster.rosterId,
      },
      contextId: leagueCtx.contextId,
      sourceFreshness: leagueCtx.sourceFreshness,
    })

  } catch (error: any) {
    console.error('Goal proposals error:', error)
    return NextResponse.json({ error: error.message || 'Failed to generate proposals' }, { status: 500 })
  }
})
