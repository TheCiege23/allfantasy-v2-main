import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getZombieRulesForLeague } from '@/lib/zombie/zombieRules'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const weekQ = searchParams?.get('week')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const lid = leagueId

  const gate = await assertLeagueMember(lid, session.user.id)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId: lid } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const week = weekQ ? parseInt(weekQ, 10) : Math.max(1, z.currentWeek || 1)
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: lid, season: z.season },
  })
  if (!season) return NextResponse.json({ matchups: [], week })

  const mm = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week },
  })

  const rules = await getZombieRulesForLeague(lid, z.sport)
  const resolution = await prisma.zombieWeeklyResolution.findUnique({
    where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } },
    select: { status: true, resolvedAt: true, infectionCount: true },
  })

  const sessionRoster = await prisma.roster.findFirst({
    where: { leagueId: lid, platformUserId: session.user.id },
    select: { id: true },
  })
  const myRedraft = sessionRoster
    ? await prisma.redraftRoster.findFirst({
        where: { seasonId: season.id, ownerId: session.user.id },
        select: { id: true },
      })
    : null

  async function sideLabel(redraftRosterId: string): Promise<{ name: string; status: string }> {
    const rr = await prisma.redraftRoster.findUnique({
      where: { id: redraftRosterId },
      select: { ownerId: true },
    })
    if (!rr?.ownerId) return { name: redraftRosterId, status: 'Survivor' }
    const ownerId = rr.ownerId
    const roster = await prisma.roster.findFirst({
      where: { leagueId: lid, platformUserId: ownerId },
      select: { id: true },
    })
    if (!roster?.id) return { name: ownerId, status: 'Survivor' }
    const zt = await prisma.zombieLeagueTeam.findUnique({
      where: { leagueId_rosterId: { leagueId: lid, rosterId: roster.id } },
      select: { status: true, fantasyTeamName: true, displayName: true },
    })
    const nm = zt?.fantasyTeamName || zt?.displayName || ownerId
    return { name: nm, status: zt?.status ?? 'Survivor' }
  }

  const out = []
  for (const m of mm) {
    if (!m.awayRosterId) continue
    const home = await sideLabel(m.homeRosterId)
    const away = await sideLabel(m.awayRosterId)
    const hs = home.status.toLowerCase()
    const as = away.status.toLowerCase()
    let infectionRisk: 'home' | 'away' | 'none' = 'none'
    if (hs.includes('survivor') && (as.includes('zombie') || as.includes('whisperer'))) infectionRisk = 'home'
    if (as.includes('survivor') && (hs.includes('zombie') || hs.includes('whisperer'))) infectionRisk = 'away'

    const hsNum = m.homeScore ?? 0
    const asNum = m.awayScore ?? 0
    const margin = Math.abs(hsNum - asNum)
    const complete = m.status === 'complete'
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' | 'na' = 'na'
    if (infectionRisk !== 'none' && !complete) {
      const survIsHome = hs.includes('survivor') && !hs.includes('zombie')
      const diff = survIsHome ? hsNum - asNum : asNum - hsNum
      if (diff > 20) riskLevel = 'low'
      else if (diff >= -20) riskLevel = 'medium'
      else if (diff >= -30) riskLevel = 'high'
      else riskLevel = 'critical'
    }

    const isMyHome = myRedraft?.id === m.homeRosterId
    const isMyAway = myRedraft?.id === m.awayRosterId
    const mySide = isMyHome ? ('home' as const) : isMyAway ? ('away' as const) : null

    out.push({
      id: m.id,
      home,
      away,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      status: m.status,
      infectionRisk,
      riskLevel,
      margin,
      mySide,
    })
  }

  return NextResponse.json({
    matchups: out,
    week,
    redraftSeasonId: season.id,
    rules: {
      bashingThreshold: rules.bashingThreshold,
      maulingThreshold: rules.maulingThreshold,
    },
    resolution: resolution
      ? { status: resolution.status, resolvedAt: resolution.resolvedAt, infectionCount: resolution.infectionCount }
      : null,
  })
}

