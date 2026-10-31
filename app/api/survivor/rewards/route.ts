import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { chooseSurvivorRewardTarget, listSurvivorRewards } from '@/lib/survivor/SurvivorEffectEngine'
import { describeSurvivorReward } from '@/lib/survivor/survivorRewardModel'

export const dynamic = 'force-dynamic'

/**
 * A manager's own Survivor rewards (won, pending, tokens) and their choice for one that waits on
 * them ("points on a tribemate", a steal target). Only the caller's own rewards are ever returned;
 * nobody else's tokens or blockers. League members only — one 403 for not-found and not-member.
 */
async function myRoster(leagueId: string, userId: string): Promise<string | null> {
  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } })
  return roster?.id ?? null
}

async function leagueLanguage(leagueId: string): Promise<string | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { language: true } }).catch(() => null)
  return league?.language ?? null
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const rosterId = await myRoster(leagueId, userId)
  if (!rosterId) return NextResponse.json({ rewards: [] })
  const language = await leagueLanguage(leagueId)
  const rewards = await listSurvivorRewards(leagueId, { rosterId })
  return NextResponse.json({
    rewards: rewards.map((r) => ({
      rewardId: r.rewardId,
      type: r.type,
      status: r.status,
      week: r.week,
      applyWeek: r.applyWeek,
      holder: r.holderRosterIds.includes(rosterId),
      text: describeSurvivorReward(r, language),
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  const rewardId = typeof body.rewardId === 'string' ? body.rewardId.trim() : ''
  const targetRosterId = typeof body.targetRosterId === 'string' ? body.targetRosterId.trim() : ''
  if (!leagueId || !rewardId || !targetRosterId) return NextResponse.json({ error: 'leagueId, rewardId and targetRosterId required' }, { status: 400 })
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const rosterId = await myRoster(leagueId, userId)
  if (!rosterId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const result = await chooseSurvivorRewardTarget({ leagueId, rewardId, actorRosterId: rosterId, targetRosterId, actorUserId: userId, chosenBy: 'manager' })
  if (!result.ok) {
    const status = result.code === 'invalid' ? 400 : result.code === 'forbidden' ? 403 : result.code === 'not_found' ? 404 : 409
    return NextResponse.json({ error: result.error, code: result.code }, { status })
  }
  return NextResponse.json(result)
}
