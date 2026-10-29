import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { loadNativeWeekResults } from '@/lib/zombie/ZombieInfectionEngine'
import { buildZombieMatchups, infectionPairsForWeek } from '@/lib/zombie/zombieMatchupBoard'
import { zombieRosterDisplayNames } from '@/lib/zombie/zombieHomeSummary'
import { resolveWhispererViewer } from '@/lib/zombie/whispererViewer'
import { redactStatusEntries } from '@/lib/zombie/whispererRedaction'
import { BASH_TRANSFER_SHARE, MAUL_TRANSFER_SHARE } from '@/lib/zombie/winningsShares'

export const dynamic = 'force-dynamic'

/**
 * GET /api/zombie/matchups?leagueId=&week= — a week's matchups for the hub's Bashing cards.
 *
 * 🛑 THIS ROUTE NAMED THE WHISPERER. It returned each side's raw `ZombieLeagueTeam.status`, so in a
 * secret league every member's matchups page said "Whisperer" next to the right team. Statuses now go
 * through the same redaction as the summary route. It also named sides by a manager's user id when the
 * season roster had no league roster (every native open seat, `roster:<id>`), judged risk on fixed NFL
 * margins, and treated only `complete` as final while native matchups finish `final`.
 */
export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const weekQ = searchParams?.get('week')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const asked = weekQ ? parseInt(weekQ, 10) : NaN
  const week = Number.isFinite(asked) && asked > 0 ? asked : Math.max(1, z.currentWeek || 1)

  const [results, rules, config, resolution, rosters, leagueTeams, zombieTeams, viewer] = await Promise.all([
    loadNativeWeekResults(leagueId, week, z.season).catch(() => null),
    getZombieRulesForSport(z.sport),
    getZombieLeagueConfig(leagueId).catch(() => null),
    prisma.zombieWeeklyResolution.findUnique({
      where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } },
      select: { status: true, resolvedAt: true, infectionCount: true },
    }),
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, playerData: true, redraftRoster: { select: { teamName: true, ownerName: true } } },
      orderBy: { id: 'asc' },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, teamName: true, ownerName: true, externalId: true, platformUserId: true, claimedByUserId: true },
    }),
    prisma.zombieLeagueTeam.findMany({
      where: { leagueId },
      select: { rosterId: true, status: true, weekBecameZombie: true, killedByRosterId: true },
    }),
    resolveWhispererViewer(leagueId, userId),
  ])
  if (!results) return NextResponse.json({ matchups: [], week })

  const raw = zombieTeams.map((t) => ({ rosterId: t.rosterId, status: t.status }))
  const shown = viewer.canSee ? raw : redactStatusEntries(raw, viewer.identity)
  const statusOf = (rosterId: string) => shown.find((s) => s.rosterId === rosterId)?.status ?? 'Survivor'
  const names = zombieRosterDisplayNames(rosters, leagueTeams)
  const myRosterId = rosters.find((r) => r.platformUserId === userId)?.id ?? null

  const matchups = buildZombieMatchups({
    results,
    statusOf,
    nameOf: (rosterId) => names[rosterId] ?? 'A team',
    infected: infectionPairsForWeek(zombieTeams, week),
    rules,
    lossToZombieInfects: config?.infectionLossToZombie !== false,
    myRosterId,
  })

  return NextResponse.json({
    matchups,
    week,
    rules: {
      bashingThreshold: rules.bashingThreshold,
      maulingThreshold: rules.maulingThreshold,
      bashShare: BASH_TRANSFER_SHARE,
      maulShare: MAUL_TRANSFER_SHARE,
    },
    resolution: resolution
      ? { status: resolution.status, resolvedAt: resolution.resolvedAt, infectionCount: resolution.infectionCount }
      : null,
  })
}
