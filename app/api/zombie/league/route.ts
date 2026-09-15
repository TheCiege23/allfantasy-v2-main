import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createZombieLeague } from '@/lib/zombie/setupEngine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getLeagueRole, requireCommissionerOnly } from '@/lib/league/permissions'
import { isZombieEligibleLeagueSport } from '@/lib/zombie/zombie-sport-eligibility'
import { getRandomZombieTheme } from '@/lib/zombie/zombieBackgroundThemes'
import { getZombieHordeSitOutStateForWeek } from '@/lib/zombie/ZombieHordeSitOutEngine'
import { resolveWhispererViewer } from '@/lib/zombie/whispererViewer'
import { redactWhispererRecord, redactZombieEvent, redactZombieTeam } from '@/lib/zombie/whispererRedaction'

export const dynamic = 'force-dynamic'

/** Zombie leagues are limited to these team counts at create time. */
const ZOMBIE_ALLOWED_TEAM_COUNTS = [8, 10, 12, 14, 16] as const
type ZombieAllowedTeamCount = (typeof ZOMBIE_ALLOWED_TEAM_COUNTS)[number]

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  /*
   * ⚠ Head commissioner only. This handler used to check just for a session, so any signed-in user
   * could force any league to snake drafts, clear its playoff weeks and create the ZombieLeague row
   * that on its own makes a league count as a Zombie league (lib/core-app/formatHubs.ts). Checked
   * before the body is validated, so a stranger learns nothing about the league from a 400. The one
   * in-repo POST caller, app/api/zombie/universe/create, forwards the cookie of the user who has just
   * created the league through /api/league/create, so it passes as the owner.
   *
   * ⚠ The helper THROWS a Response. Next 14 route handlers convert only redirect() and notFound()
   * throws, so an uncaught Response becomes a 500 — return it as the 403 it is.
   */
  try {
    await requireCommissionerOnly(leagueId, session.user.id)
  } catch (denied) {
    if (denied instanceof Response) return denied
    throw denied
  }

  const sportRaw = typeof body.sport === 'string' ? body.sport : 'NFL'
  if (!isZombieEligibleLeagueSport(sportRaw.toUpperCase())) {
    return NextResponse.json({ error: `Zombie leagues do not support sport "${sportRaw}".` }, { status: 400 })
  }
  const sport = normalizeToSupportedSport(sportRaw)

  const teamCountRaw = typeof body.teamCount === 'number' ? body.teamCount : null
  if (teamCountRaw == null || !(ZOMBIE_ALLOWED_TEAM_COUNTS as readonly number[]).includes(teamCountRaw)) {
    return NextResponse.json(
      { error: `teamCount must be one of ${ZOMBIE_ALLOWED_TEAM_COUNTS.join(', ')}` },
      { status: 400 },
    )
  }
  const teamCount = teamCountRaw as ZombieAllowedTeamCount

  // Snake-only — auction (and any other non-snake) is not supported by the
  // weekly resolution engine. Reject early instead of silently coercing so
  // the caller sees the broken assumption.
  const requestedDraft =
    typeof body.draftType === 'string' ? body.draftType.toLowerCase() : 'snake'
  if (requestedDraft && requestedDraft !== 'snake') {
    return NextResponse.json(
      { error: 'Zombie leagues only support snake drafts (auction not supported).' },
      { status: 400 },
    )
  }

  // Zombie leagues run a flat regular season — playoffs would conflict with
  // the survivor / elimination resolution engine.
  if (body.playoffEnabled === true || body.playoffsEnabled === true) {
    return NextResponse.json({ error: 'Zombie leagues cannot enable playoffs.' }, { status: 400 })
  }

  // Paid leagues must declare a supported payment provider. Until LeagueSafe /
  // FanCred checkout integrations exist as actual server flows we still gate
  // creation on a known provider so we don't accept paid leagues that have
  // no path to collect or pay out.
  const isPaid = Boolean(body.isPaid)
  if (isPaid) {
    const provider = typeof body.paymentProvider === 'string' ? body.paymentProvider.toLowerCase() : null
    if (!provider || !['leaguesafe', 'fancred'].includes(provider)) {
      return NextResponse.json(
        { error: "Paid zombie leagues require paymentProvider: 'leaguesafe' or 'fancred'." },
        { status: 400 },
      )
    }
    const buyIn = typeof body.buyIn === 'number' ? body.buyIn : null
    if (buyIn == null || !Number.isFinite(buyIn) || buyIn <= 0) {
      return NextResponse.json(
        { error: 'Paid leagues require a buyIn amount greater than zero.' },
        { status: 400 },
      )
    }
  }

  // Force the underlying League to snake + no-playoffs so downstream draft +
  // standings code can't disagree with the zombie config.
  await prisma.leagueSettings
    .updateMany({
      where: { leagueId },
      data: { draftType: 'snake' },
    })
    .catch(() => {})
  await prisma.league
    .update({
      where: { id: leagueId },
      data: { playoffStartWeek: null, playoffWeeksPerRound: null },
    })
    .catch(() => {})

  const universeId = typeof body.universeId === 'string' ? body.universeId : undefined
  const tierId = typeof body.tierId === 'string' ? body.tierId : undefined

  const row = await createZombieLeague(
    {
      leagueId,
      name: typeof body.name === 'string' ? body.name : null,
      sport,
      teamCount,
      isPaid: Boolean(body.isPaid),
      buyInAmount: typeof body.buyIn === 'number' ? body.buyIn : null,
      whispererSelectionMode:
        typeof body.whispererSelectionMode === 'string' ? body.whispererSelectionMode : 'random',
      namingMode: typeof body.namingMode === 'string' ? body.namingMode : 'hybrid',
      backgroundTheme: getRandomZombieTheme(),
    },
    universeId ?? null,
    tierId ?? null,
  )

  return NextResponse.json({
    zombieLeague: {
      ...row,
      backgroundTheme: row.themeLabel,
    },
  })
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    include: {
      teams: true,
      level: true,
      whispererRecord: true,
      paidConfig: true,
      freeRewardConfig: true,
      weeklyResolutions: { orderBy: { week: 'desc' }, take: 4 },
      announcements: { orderBy: { createdAt: 'desc' }, take: 24 },
    },
  })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const config = await prisma.zombieLeagueConfig.findUnique({
    where: { leagueId },
  })

  const counts = z.teams.reduce(
    (acc, team) => {
      const status = String(team.status ?? '').toLowerCase()
      if (status.includes('whisperer')) acc.whisperer += 1
      else if (status.includes('zombie')) acc.zombie += 1
      else if (status.includes('revived')) acc.revived += 1
      else if (status.includes('eliminat') || status.includes('dead')) acc.eliminated += 1
      else acc.survivor += 1
      return acc
    },
    { survivor: 0, zombie: 0, whisperer: 0, revived: 0, eliminated: 0 },
  )
  const horde = counts.zombie + counts.whisperer
  const surv = counts.survivor + counts.revived

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: session.user.id },
    select: { id: true },
  })
  const myTeam = roster ? (z.teams.find((t) => t.rosterId === roster.id) ?? null) : null

  let myActiveItemCount = 0
  let myPendingItemCount = 0
  let mySerumCount = 0
  let myWeaponCount = 0
  if (myTeam) {
    const myItems = await prisma.zombieTeamItem.findMany({
      where: { teamStatusId: myTeam.id },
      select: {
        itemType: true,
        isUsed: true,
        isExpired: true,
        activationState: true,
      },
    })
    const activeItems = myItems.filter((item) => !item.isUsed && !item.isExpired)
    myActiveItemCount = activeItems.length
    myPendingItemCount = activeItems.filter((item) => item.activationState === 'pending_activation').length
    mySerumCount = activeItems.filter((item) => item.itemType.toLowerCase().includes('serum')).length
    myWeaponCount = activeItems.filter((item) => !item.itemType.toLowerCase().includes('serum')).length
  }

  const role = await getLeagueRole(leagueId, session.user.id)
  const commissionerNotifications = role === 'commissioner'
    ? await prisma.zombieCommissionerNotification.findMany({
        where: { leagueId, commissionerId: session.user.id },
        orderBy: { createdAt: 'desc' },
        take: 12,
      })
    : []

  const unreadNotifications = commissionerNotifications.filter((row) => !row.isRead).length
  const actionRequiredNotifications = commissionerNotifications.filter((row) => row.requiresAction).length

  const latestResolution = z.weeklyResolutions[0] ?? null
  const latestWeek = latestResolution?.week ?? Math.max(1, z.currentWeek || 1)
  const sitOutState = await getZombieHordeSitOutStateForWeek(leagueId, latestWeek, session.user.id)
  const recentInfections = await prisma.zombieInfectionEvent.findMany({
    where: { zombieLeagueId: z.id },
    orderBy: { createdAt: 'desc' },
    take: 6,
  })
  const recentBashings = await prisma.zombieBashingEvent.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: 4,
  })
  const recentMaulings = await prisma.zombieMaulingEvent.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: 4,
  })

  const topPerformers = [...z.teams]
    .sort((a, b) => {
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
      return b.wins - a.wins
    })
    .slice(0, 5)

  const dangerZone = [...z.teams]
    .filter((team) => {
      const status = String(team.status ?? '').toLowerCase()
      return status.includes('survivor') || status.includes('revived')
    })
    .sort((a, b) => {
      if (a.wins !== b.wins) return a.wins - b.wins
      if (a.pointsFor !== b.pointsFor) return a.pointsFor - b.pointsFor
      return b.pointsAgainst - a.pointsAgainst
    })
    .slice(0, 5)

  // Whisperer secrecy: every row that could name the Whisperer goes through the viewer's
  // permission. Counts stay real; they only say that a Whisperer exists.
  const viewer = await resolveWhispererViewer(leagueId, session.user.id)
  const team = <T extends { rosterId: string; status?: string | null }>(t: T): T =>
    viewer.canSee ? t : redactZombieTeam(t, viewer.identity)
  const event = <T extends object>(e: T): T => (viewer.canSee ? e : redactZombieEvent(e, viewer.identity))

  return NextResponse.json({
    league: {
      ...z,
      teams: z.teams.map(team),
      whispererRecord: viewer.canSee ? z.whispererRecord : redactWhispererRecord(z.whispererRecord),
      counts: {
        ...counts,
        horde: horde,
        alive: surv,
        total: z.teams.length,
      },
      level: z.level
        ? {
            id: z.level.id,
            name: z.level.name,
            rankOrder: z.level.rankOrder,
            colorHex: z.level.colorHex,
            difficultyLabel: z.level.difficultyLabel,
            tierTheme: z.level.tierTheme,
            tierLabel: z.level.tierLabel,
          }
        : null,
      config,
      latestResolution,
      topPerformers: topPerformers.map(team),
      dangerZone: dangerZone.map(team),
      recentInfections: recentInfections.map(event),
      recentBashings: recentBashings.map(event),
      recentMaulings: recentMaulings.map(event),
    },
    hordeSize: horde,
    survivorCount: surv,
    myTeam: myTeam ? team(myTeam) : myTeam,
    myActiveItemCount,
    myPendingItemCount,
    myResources: {
      serums: mySerumCount,
      weapons: myWeaponCount,
      activeItems: myActiveItemCount,
      pendingItems: myPendingItemCount,
    },
    viewerIsCommissioner: role === 'commissioner',
    latestWeek,
    commissionerNotifications: {
      unread: unreadNotifications,
      actionRequired: actionRequiredNotifications,
      recent: commissionerNotifications,
    },
    hordeSitOuts: {
      pending: sitOutState.pending,
      accepted: sitOutState.accepted,
      declined: sitOutState.declined,
      myPendingResponse: sitOutState.myPending
        ? {
            sitOutId: sitOutState.myPending.id,
            week: latestWeek,
          }
        : null,
    },
  })
}

