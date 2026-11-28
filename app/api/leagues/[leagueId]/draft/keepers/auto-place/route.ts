/**
 * GET:  whether AF places this league's locked keepers on the board automatically, and whether the
 *       commissioner's plan allows it (drives the settings switch and the upgrade card).
 * POST: place the locked keepers on the pre-draft board now (lib/keeper/keeperAutoBoard.ts).
 *       Commissioner only, and the COMMISSIONER's plan must be AF Commissioner or AF Supreme —
 *       otherwise 403 in the shared paywall shape (lib/monetization/planRefusal.ts) and the board is
 *       left to the manual flow (POST ../route.ts per keeper).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { isSeasonTournamentDraft, SEASON_DRAFT_MUTATION_BLOCKED } from '@/lib/tournament/seasonDraftMutationGate'
import { buildFeatureUpgradePath } from '@/lib/subscription/feature-access'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { commissionerHasKeeperAutomation, placeLockedKeepersOnDraftBoard } from '@/lib/keeper/keeperAutoBoard'
import { readKeeperAutoBoard } from '@/lib/keeper/keeperAutoBoardSetting'

export const dynamic = 'force-dynamic'

const LOCKED_BODY = {
  error: 'Premium feature',
  code: 'feature_not_entitled',
  featureId: 'commissioner_automation',
  requiredPlan: 'AF Commissioner',
  message: 'Placing keepers on the draft board automatically is part of AF Commissioner and AF Supreme. Without it, add each keeper to the board by hand.',
} as const

const lockedBody = () => ({ ...LOCKED_BODY, upgradePath: buildFeatureUpgradePath('commissioner_automation') })

async function commissionerOnly(ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { leagueId } = await ctx.params
  if (!leagueId) return { error: NextResponse.json({ error: 'Missing leagueId' }, { status: 400 }) }
  try {
    await assertCommissionerAccess(leagueId, userId, 'rosters')
  } catch {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { leagueId, userId }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const who = await commissionerOnly(ctx)
  if ('error' in who) return who.error
  const league = await prisma.league.findUnique({ where: { id: who.leagueId }, select: { userId: true, settings: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  const entitled = await commissionerHasKeeperAutomation(league.userId)
  return NextResponse.json({
    enabled: readKeeperAutoBoard(league.settings),
    entitled,
    ...(entitled ? {} : { locked: lockedBody() }),
  })
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const who = await commissionerOnly(ctx)
  if ('error' in who) return who.error
  if (await isSeasonTournamentDraft(who.leagueId)) {
    return NextResponse.json({ error: SEASON_DRAFT_MUTATION_BLOCKED, code: 'TOURNAMENT_RULES_FROZEN' }, { status: 409 })
  }

  const outcome = await placeLockedKeepersOnDraftBoard(who.leagueId, { requireSetting: false })
  if (!outcome.ok) {
    if (outcome.code === 'NOT_ENTITLED') return NextResponse.json(lockedBody(), { status: 403 })
    const status = outcome.code === 'LEAGUE_NOT_FOUND' ? 404 : 409
    return NextResponse.json({ error: outcome.message, code: outcome.code }, { status })
  }
  const snapshot = await buildSessionSnapshot(who.leagueId)
  return NextResponse.json({ ok: true, summary: outcome.summary, keeper: (snapshot as { keeper?: unknown } | null)?.keeper ?? null })
}
