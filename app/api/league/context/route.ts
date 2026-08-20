import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  declareHouseRule,
  getLeagueContext,
  type HouseRuleId,
} from '@/lib/league-context/leagueContextService'

export const dynamic = 'force-dynamic'

const KNOWN_RULES: HouseRuleId[] = ['pirate']

async function resolveLeague(userId: string, leagueId: string, writeAccess: boolean) {
  return prisma.league.findFirst({
    where: writeAccess
      ? // House-rule declarations change every engine's advice → owner only.
        { id: leagueId, userId }
      : { id: leagueId, OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
    select: { id: true, platform: true, platformLeagueId: true },
  })
}

/**
 * GET  ?leagueId=…            → the LeagueContext envelope (slice 5)
 * POST {leagueId, ruleId, enabled} → declare/clear a house rule (league owner
 * only — a declaration changes what every engine recommends). Detection from
 * the league name is only ever a suggestion; this endpoint is the confirm.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const league = await resolveLeague(userId, leagueId, false)
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return NextResponse.json({ supported: false as const, platform: league.platform })
  }

  const context = await getLeagueContext(league.platformLeagueId)
  if (!context) {
    return NextResponse.json(
      { supported: true as const, context: null, error: 'League settings temporarily unavailable' },
      { status: 502 },
    )
  }
  const isOwner = await prisma.league
    .findFirst({ where: { id: leagueId, userId }, select: { id: true } })
    .then(Boolean)
    .catch(() => false)
  return NextResponse.json({ supported: true as const, canDeclare: isOwner, context })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leagueId?: string; ruleId?: string; enabled?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const leagueId = body.leagueId?.trim()
  const ruleId = body.ruleId?.trim() as HouseRuleId | undefined
  if (!leagueId || !ruleId || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'leagueId, ruleId and enabled are required' }, { status: 400 })
  }
  if (!KNOWN_RULES.includes(ruleId)) {
    return NextResponse.json({ error: `Unknown house rule: ${ruleId}` }, { status: 400 })
  }

  const league = await resolveLeague(userId, leagueId, true)
  if (!league) {
    return NextResponse.json(
      { error: 'Only the league owner can declare house rules' },
      { status: 403 },
    )
  }
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return NextResponse.json({ supported: false as const, platform: league.platform }, { status: 400 })
  }

  await declareHouseRule(league.platformLeagueId, ruleId, body.enabled, userId)
  const context = await getLeagueContext(league.platformLeagueId)
  return NextResponse.json({ supported: true as const, canDeclare: true, context })
}
