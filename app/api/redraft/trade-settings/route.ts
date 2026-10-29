import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isTournamentCoCommissioner } from '@/lib/league/tournamentCoCommissioners'
import { assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

/**
 * Read-only league trade settings for the Trade Center. Surfaces the settings that already exist on
 * `League` + `RedraftLeagueExtendedSettings` so the UI can gate features honestly (e.g. draft-pick
 * trading) without faking them, plus per-roster FAAB balances for the asset selector.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const [league, extended, rosters] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        tradeReviewHours: true,
        tradeDeadlineWeek: true,
        draftPickTrading: true,
        userId: true,
        settings: true,
        teams: { where: { claimedByUserId: userId }, select: { isCommissioner: true, isCoCommissioner: true } },
      },
    }),
    prisma.redraftLeagueExtendedSettings.findUnique({
      where: { leagueId },
      select: { commissionerTradeReviewType: true },
    }),
    seasonId
      ? prisma.redraftRoster.findMany({ where: { seasonId }, select: { id: true, faabBalance: true } })
      : Promise.resolve([] as { id: string; faabBalance: number | null }[]),
  ])

  const faabByRosterId: Record<string, number> = {}
  for (const r of rosters) faabByRosterId[r.id] = r.faabBalance ?? 0

  const isCommissioner =
    league?.userId === userId ||
    (league?.teams ?? []).some((t) => t.isCommissioner || t.isCoCommissioner) ||
    isTournamentCoCommissioner(league?.settings, userId)

  return NextResponse.json({
    settings: {
      tradeReviewHours: league?.tradeReviewHours ?? 48,
      tradeDeadlineWeek: league?.tradeDeadlineWeek ?? null,
      draftPickTrading: league?.draftPickTrading ?? false,
      commissionerTradeReviewType: extended?.commissionerTradeReviewType ?? 'commissioner',
    },
    faabByRosterId,
    isCommissioner,
  })
}
