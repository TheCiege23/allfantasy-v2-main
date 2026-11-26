import { watchlistKeyForUser } from '@/lib/league/teamScopedKey'
import { requestedRosterIdFrom, resolveViewingRoster } from '@/lib/league/viewerTeams'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getLeagueWaiverState, nextRunAtForSchedule } from "@/lib/waiver-wire/waiver-state-service"
import { readDailyWaiverScheduleFromSettings } from "@/lib/waivers/dailyWaiverSchedule"
import { formatLocalWaiverClear, readLocalWaiverClear } from "@/lib/waivers/leagueLocalWaiverClock"
import { readWaiverExtras } from "@/lib/waivers/waiverExtras"
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
  // The team shown: the named one when the manager holds it, else their first (lib/league/viewerTeams.ts).
  const [leagueAsOwner, rosterAsMember, coOwnerRosterId] = await Promise.all([
    (prisma as any).league.findFirst({ where: { id: leagueId, userId } }),
    resolveViewingRoster(leagueId, userId, requestedRosterIdFrom(req)),
    acceptedCoOwnerRosterId(leagueId, userId),
  ])
  if (!leagueAsOwner && !rosterAsMember) {
    return NextResponse.json({ error: "League not found" }, { status: 404 })
  }

  const [storedState, settings, clockLeague] = await Promise.all([
    getLeagueWaiverState(leagueId),
    getEffectiveLeagueWaiverSettings(leagueId),
    (prisma as any).league.findUnique({ where: { id: leagueId }, select: { settings: true, timezone: true } }).catch(() => null),
  ])
  /*
   * The next clear, even before anything has written it (a new league with no claims yet): worked out
   * from the schedule — in the league's own time when it has a league-time clear — rather than shown as
   * a bare weekday. Read-only: nothing is written here.
   */
  const computedNextRunAt = storedState?.nextRunAt
    ? null
    : nextRunAtForSchedule(
        new Date(),
        {
          processingDayOfWeek: settings.processingDayOfWeek,
          processingTimeUtc: settings.processingTimeUtc,
          processingDays: settings.processingDays,
          dailyScheduleEnabled: Boolean(readDailyWaiverScheduleFromSettings(clockLeague?.settings)?.enabled),
        },
        clockLeague,
      )
  const computedDate = computedNextRunAt ? new Date(computedNextRunAt) : null
  const state = storedState
    ? { ...storedState, nextRunAt: storedState.nextRunAt ?? computedDate }
    : computedDate
      ? { nextRunAt: computedDate, processingLocked: false }
      : null
  const localClear = readLocalWaiverClear(clockLeague?.settings)
  /** "Wed 3:00 AM PT": when waivers clear, in the league's own zone (null when the league has no league-time clear). */
  const leagueClearLabel = localClear ? formatLocalWaiverClear(localClear, clockLeague?.timezone) : null

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
        ...(rosterAsMember?.redraftRosterId
          ? { id: rosterAsMember.redraftRosterId }
          : coOwnerRosterId ? { id: '__unlinked_coowner__' } : { ownerId: userId }),
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
          // The watchlist of the team being viewed (lib/league/teamScopedKey.ts).
          userId: await watchlistKeyForUser(leagueId, userId, requestedRosterIdFrom(req)),
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
      leagueClearLabel,
      conditionalClaims: readWaiverExtras(clockLeague?.settings).conditionalClaims,
    },
    faabBudget,
    balance: faabBudget,
    watchlist,
    waiverPriority,
  })
}