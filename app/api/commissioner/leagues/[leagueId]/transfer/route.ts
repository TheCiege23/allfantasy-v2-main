import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { IMPORT_CO_COMMISSIONERS_KEY, importCoCommissionerIds } from '@/lib/league/tournamentCoCommissioners'

/**
 * POST: Transfer commissioner role to another user.
 * Body: { newCommissionerUserId: string, confirm: true }.
 * New user must have a roster in the league.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const refused = await commissionerAccessResponse(params.leagueId, userId, 'head')
  if (refused) return refused

  const body = await req.json().catch(() => ({}))
  const newCommissionerUserId = body?.newCommissionerUserId ?? body?.newCommissionerId
  const confirm = body?.confirm === true

  if (!newCommissionerUserId || typeof newCommissionerUserId !== 'string') {
    return NextResponse.json({ error: 'newCommissionerUserId is required' }, { status: 400 })
  }

  if (!confirm) {
    return NextResponse.json({
      error: 'Confirmation required. Send { confirm: true } to transfer commissioner role.',
    }, { status: 400 })
  }

  if (newCommissionerUserId === userId) {
    return NextResponse.json({ error: 'New commissioner must be a different user' }, { status: 400 })
  }

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { id: true, userId: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  /*
   * The new commissioner has to be IN the league. A hosted league seats people on rosters; an
   * imported one seats them by claiming a team (`LeagueTeam.claimedByUserId`), and its rosters are
   * keyed by the host platform's ids, so the roster check alone refused every hand-over there. A
   * co-commissioner an import recorded counts as well.
   */
  const [newUserRoster, newUserTeam] = await Promise.all([
    (prisma as any).roster.findFirst({
      where: { leagueId: params.leagueId, platformUserId: newCommissionerUserId },
      select: { id: true },
    }),
    prisma.leagueTeam.findFirst({
      where: { leagueId: params.leagueId, claimedByUserId: newCommissionerUserId },
      select: { id: true },
    }),
  ])
  const coIds = importCoCommissionerIds(league.settings)
  if (!newUserRoster && !newUserTeam && !coIds.includes(newCommissionerUserId)) {
    return NextResponse.json({
      error: 'New commissioner must have a team in this league',
    }, { status: 400 })
  }

  /*
   * The person handing over stays on as co-commissioner (owner's rule, 2026-11-22): a co-commissioner
   * who imported a league first hands it to the main commissioner without losing their own tools.
   * The new commissioner leaves the co-commissioner list, since they now own the league.
   */
  const settings =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
  const nextCo = [...new Set([...coIds.filter((id) => id !== newCommissionerUserId), league.userId])].sort()
  await prisma.league.update({
    where: { id: params.leagueId },
    data: { userId: newCommissionerUserId, settings: { ...settings, [IMPORT_CO_COMMISSIONERS_KEY]: nextCo } as never },
  })

  return NextResponse.json({
    status: 'ok',
    message: 'Commissioner role transferred.',
    newCommissionerUserId,
  })
}
