import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getLeagueWaiverState } from "@/lib/waiver-wire/waiver-state-service"
import { getEffectiveLeagueWaiverSettings } from "@/lib/waiver-wire"

/**
 * League waiver snapshot: next run hint, priority order JSON, processing lock (for all members).
 * Also returns FAAB budget, watchlist, and waiver order for the requesting user.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leagueId = params.leagueId
  const [leagueAsOwner, rosterAsMember] = await Promise.all([
    (prisma as any).league.findFirst({ where: { id: leagueId, userId } }),
    (prisma as any).roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true, playerData: true } }),
  ])
  if (!leagueAsOwner && !rosterAsMember) {
    return NextResponse.json({ error: "League not found" }, { status: 404 })
  }

  const [state, settings] = await Promise.all([
    getLeagueWaiverState(leagueId),
    getEffectiveLeagueWaiverSettings(leagueId),
  ])

  // Get user's FAAB balance and watchlist
  let faabBudget = 100
  let watchlist: string[] = []
  let waiverPriority = 0

  if (rosterAsMember) {
    // Get FAAB from roster
    const roster = await (prisma as any).redraftRoster.findFirst({
      where: {
        season: {
          leagueId: leagueId,
        },
        ownerId: userId,
      },
      select: {
        faabBalance: true,
        waiverPriority: true,
      },
    })
    faabBudget = roster?.faabBalance ?? 100
    waiverPriority = roster?.waiverPriority ?? 0

    // Get watchlist - using only fields that exist in your schema
    try {
      const watchlistData = await (prisma as any).waiverWatchlist.findMany({
        where: {
          leagueId: leagueId,
          userId: userId,
        },
        select: {
          playerId: true,
        },
      })
      watchlist = watchlistData.map((w: any) => w.playerId)
    } catch (e) {
      // Watchlist table might not exist or have different fields
      console.log("Watchlist table not found or fields mismatch")
    }
  }

  return NextResponse.json({
    state,
    settings: {
      waiverType: settings.waiverType,
      processingDayOfWeek: settings.processingDayOfWeek,
      processingTimeUtc: settings.processingTimeUtc,
      processingDays: settings.processingDays,
      claimLimitPerWeek: settings.claimLimitPerWeek,
      claimLimitPerPeriod: settings.claimLimitPerPeriod,
      claimLimitPerRun: settings.claimLimitPerRun,
      nextRunAt: state?.nextRunAt ?? null,
      processingLocked: state?.processingLocked ?? false,
    },
    faabBudget,
    balance: faabBudget,
    watchlist,
    waiverPriority,
  })
}